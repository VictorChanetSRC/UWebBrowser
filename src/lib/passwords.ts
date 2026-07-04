import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { loadJson, saveJson } from "./storage";

/** Lifecycle state the panel renders around; mirrors the Rust `State` enum. */
export type PassState = "unavailable" | "needs_setup" | "locked" | "unlocked";

export type PassStatus = {
  state: PassState;
  detail: string;
};

export type PassCapabilities = {
  id: string;
  label: string;
  blurb: string;
  canSave: boolean;
  canGenerate: boolean;
  /** Whether items can be edited / deleted from the panel (local vault yes,
   *  Proton items are managed through the Proton apps). */
  canEdit: boolean;
  canDelete: boolean;
  syncs: boolean;
  needsMasterPassword: boolean;
  /** "password" (local vault) or "token" (Proton) — labels the unlock field. */
  unlockSecret: "password" | "token" | "";
};

export type ProviderReport = {
  id: string;
  capabilities: PassCapabilities;
  status: PassStatus;
};

/** A non-secret list row — never carries a password. */
export type CredentialSummary = {
  id: string;
  title: string;
  username: string;
  host: string;
  /** The stored URL, so editing round-trips it unchanged. */
  url: string;
};

export type NewCredential = {
  title: string;
  username: string;
  password: string;
  url: string;
};

/** The secret half of one item, fetched only for explicit copy/edit actions
 *  in the trusted chrome UI. Never cached — use and drop. */
export type CredentialSecret = {
  username: string;
  password: string;
  totp?: string;
};

export type GenerateOptions = {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
};

/** Event pushed from the injected content script's bridge. */
export type PassBridgeEvent = {
  kind: "fill" | "capture";
  tabId: string;
  host: string;
  username: string;
  /** For `capture`: "new" (first login for this user) or "update" (the saved
   *  password differs). Empty for other kinds. */
  mode: "new" | "update" | "";
};

export const pass = {
  status: () => invoke<ProviderReport>("pass_status"),
  providers: () => invoke<ProviderReport[]>("pass_providers"),
  selectProvider: (id: string) => invoke<ProviderReport>("pass_select_provider", { id }),
  setup: (secret: string) => invoke("pass_setup", { secret }),
  installCli: () => invoke<ProviderReport>("pass_install_cli"),
  unlock: (secret: string | null) => invoke("pass_unlock", { secret }),
  lock: () => invoke("pass_lock"),
  list: () => invoke<CredentialSummary[]>("pass_list"),
  matches: (url: string) => invoke<CredentialSummary[]>("pass_matches", { url }),
  save: (item: NewCredential) => invoke<CredentialSummary>("pass_save", { item }),
  reveal: (id: string) => invoke<CredentialSecret>("pass_reveal", { id }),
  update: (id: string, item: NewCredential) =>
    invoke<CredentialSummary>("pass_update", { id, item }),
  delete: (id: string) => invoke("pass_delete", { id }),
  fill: (tabId: string, itemId: string) => invoke("pass_fill", { tabId, itemId }),
  commitCapture: (tabId: string) => invoke<CredentialSummary>("pass_commit_capture", { tabId }),
  dismissCapture: (tabId: string) => invoke("pass_dismiss_capture", { tabId }),
  generate: (opts: GenerateOptions) => invoke<string>("pass_generate", opts),
  onBridge: (handler: (payload: PassBridgeEvent) => void): Promise<UnlistenFn> =>
    listen<PassBridgeEvent>("pass-bridge", (event) => handler(event.payload)),
};

/** The user's chosen backend, persisted so it survives restarts. Proton is the
 *  default; the Rust side defaults to the same, so the two stay in step. */
const KEY = "uwb.passwords";

export const defaultProviderId = "proton";

export function loadProviderId(): string {
  return loadJson(
    [KEY],
    (raw) => {
      const id = (raw as { providerId?: unknown } | null)?.providerId;
      return typeof id === "string" ? id : null;
    },
    () => defaultProviderId,
  );
}

export function saveProviderId(providerId: string) {
  saveJson(KEY, { providerId });
}

/* --------------------------- active-provider store ------------------------ */
// The chosen backend lives in three places — Rust (`PasswordManager.active`),
// localStorage, and the UI. This store is the single path that keeps them in
// step, so App boot, the password panel and Settings can't race or disagree.

let providerId = loadProviderId();
let providerReport: ProviderReport | null = null;
const providerListeners = new Set<() => void>();

function notifyProvider() {
  providerListeners.forEach((listener) => listener());
}

export function getProviderId(): string {
  return providerId;
}

export function getProviderReport(): ProviderReport | null {
  return providerReport;
}

export function subscribeProvider(listener: () => void): () => void {
  providerListeners.add(listener);
  return () => providerListeners.delete(listener);
}

/** Switch backend everywhere: the Rust active provider, the persisted id, and
 *  every subscribed view. Use this instead of calling `pass.selectProvider`
 *  and `saveProviderId` by hand. */
export async function setProvider(id: string): Promise<ProviderReport> {
  const report = await pass.selectProvider(id);
  providerId = id;
  providerReport = report;
  saveProviderId(id);
  notifyProvider();
  return report;
}

/** Refresh the cached status of the current provider without switching. */
export async function refreshProvider(): Promise<ProviderReport> {
  const report = await pass.status();
  providerId = report.id;
  providerReport = report;
  notifyProvider();
  return report;
}

/** Boot sync: point the Rust side at the persisted provider, once. */
export async function initProvider(): Promise<void> {
  try {
    await setProvider(loadProviderId());
  } catch {
    // Backend may be unavailable (e.g. Proton CLI missing); the panel surfaces it.
  }
}

/* ----------------------------- never-save list ---------------------------- */
// Hosts the user told the save prompt to stop asking about. Chrome-side only:
// the native side still captures the submit, but App drops it silently for
// these hosts. Stored per exact host.

const NEVER_KEY = "uwb.passwords.never";

export function loadNeverHosts(): string[] {
  return loadJson(
    [NEVER_KEY],
    (raw) => {
      const hosts = (raw as { hosts?: unknown } | null)?.hosts;
      return Array.isArray(hosts) ? hosts.filter((h): h is string => typeof h === "string") : null;
    },
    () => [],
  );
}

export function addNeverHost(host: string) {
  if (!host) return;
  const hosts = loadNeverHosts();
  if (!hosts.includes(host)) saveJson(NEVER_KEY, { hosts: [...hosts, host] });
}

export function removeNeverHost(host: string) {
  saveJson(NEVER_KEY, { hosts: loadNeverHosts().filter((h) => h !== host) });
}

export function isNeverHost(host: string): boolean {
  return loadNeverHosts().includes(host);
}

/** Password-strength estimate (0–4) for the generator/add form meter. Rough by
 *  design — length and character-class variety, not a full entropy model. */
export function strength(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  const classes =
    Number(/[a-z]/.test(pw)) +
    Number(/[A-Z]/.test(pw)) +
    Number(/[0-9]/.test(pw)) +
    Number(/[^A-Za-z0-9]/.test(pw));
  if (classes >= 3) score++;
  if (classes >= 4 && pw.length >= 14) score++;
  return Math.min(score, 4);
}
