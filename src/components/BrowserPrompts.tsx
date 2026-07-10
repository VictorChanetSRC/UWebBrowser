import { useState } from "react";
import {
  Bell,
  Camera,
  CircleAlert,
  Clipboard,
  ExternalLink,
  KeyRound,
  Lock,
  MapPin,
  Mic,
  SearchX,
  ServerCrash,
  ServerOff,
  ShieldAlert,
  TimerOff,
  Unplug,
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPage } from "@/components/ui/status-page";
import { PromptIcon, PromptModal, PromptActions } from "@/components/ui/prompt";
import { POPOVER_SURFACE, Z_POPOVER } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import { hostOf } from "../lib/url";

/** The permission kinds the backend surfaces (see webext.rs `perm_kind_str`). */
export type PermissionReq = {
  id: string;
  tabId: string;
  kind: string;
  origin: string;
};

const PERMISSION_COPY: Record<string, { icon: typeof Camera; label: string }> = {
  camera: { icon: Camera, label: "use your camera" },
  microphone: { icon: Mic, label: "use your microphone" },
  geolocation: { icon: MapPin, label: "know your location" },
  notifications: { icon: Bell, label: "show notifications" },
  clipboard: { icon: Clipboard, label: "read from your clipboard" },
};

/** Chrome-style permission bubble that drops from under the omnibox. Allow/Block
 *  is remembered per-origin by WebView2, so we never re-ask after a decision. */
export function PermissionPrompt({
  req,
  onRespond,
}: {
  req: PermissionReq;
  onRespond: (id: string, allow: boolean) => void;
}) {
  const copy = PERMISSION_COPY[req.kind] ?? {
    icon: ShieldAlert,
    label: `use ${req.kind}`,
  };
  const Icon = copy.icon;
  return (
    <div
      className={cn(
        "absolute left-4 top-1 w-[340px] animate-rise p-4",
        Z_POPOVER,
        POPOVER_SURFACE,
      )}
    >
      <div className="flex items-start gap-3">
        <PromptIcon>
          <Icon aria-hidden />
        </PromptIcon>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink-100">
            {hostOf(req.origin) || req.origin}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
            wants to {copy.label}
          </div>
        </div>
      </div>
      <PromptActions>
        <Button size="sm" variant="ghost" onClick={() => onRespond(req.id, false)}>
          Block
        </Button>
        <Button size="sm" variant="primary" onClick={() => onRespond(req.id, true)}>
          Allow
        </Button>
      </PromptActions>
    </div>
  );
}

export type AuthReq = { id: string; tabId: string; origin: string };

/** HTTP basic-auth (401) credentials dialog. Submitting with empty fields, or
 *  cancelling, aborts the load. */
export function BasicAuthDialog({
  req,
  onSubmit,
  onCancel,
}: {
  req: AuthReq;
  onSubmit: (id: string, username: string, password: string) => void;
  onCancel: (id: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = () => onSubmit(req.id, username, password);
  // Escape and scrim clicks abort the load, exactly as Cancel does.
  const cancel = () => onCancel(req.id);

  return (
    <PromptModal className="w-[380px]" label="Sign in" onDismiss={cancel} onSubmit={submit}>
      <div className="flex items-start gap-3">
        <PromptIcon>
          <Lock aria-hidden />
        </PromptIcon>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ink-100">Sign in</div>
          <div className="mt-0.5 truncate text-[11.5px] text-ink-500">
            {hostOf(req.origin) || req.origin} requires a username and password
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
        />
        <Input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Password"
          autoComplete="current-password"
        />
      </div>
      <PromptActions className="mt-4">
        <Button size="sm" variant="ghost" type="button" onClick={cancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          Sign in
        </Button>
      </PromptActions>
    </PromptModal>
  );
}

/** Deep-link confirmation ("Open this link in another app?"), matching Chrome's
 *  external-protocol prompt. */
export function ExternalLinkConfirm({
  url,
  onOpen,
  onCancel,
}: {
  url: string;
  onOpen: () => void;
  onCancel: () => void;
}) {
  const scheme = url.split(":")[0];
  return (
    <PromptModal
      className="w-[400px]"
      label={`Open ${scheme} link in another app?`}
      onDismiss={onCancel}
    >
      <div className="flex items-start gap-3">
        <PromptIcon>
          <ExternalLink aria-hidden />
        </PromptIcon>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ink-100">
            Open <span className="font-medium">{scheme}</span> link in another app?
          </div>
          <div className="mt-1 break-all rounded-md bg-ink-950 px-2 py-1.5 text-[11px] text-ink-400">
            {url.length > 160 ? `${url.slice(0, 160)}…` : url}
          </div>
        </div>
      </div>
      <PromptActions className="mt-4">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={onOpen}>
          Open
        </Button>
      </PromptActions>
    </PromptModal>
  );
}

export type CertReq = { id: string; tabId: string; url: string; code: number };

/** TLS certificate-error interstitial. Fills the content area (like Chrome's red
 *  warning page) and lets the user proceed for the session or go back. */
export function CertInterstitial({
  req,
  onProceed,
  onCancel,
}: {
  req: CertReq;
  onProceed: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const host = hostOf(req.url) || req.url;
  return (
    <StatusPage
      icon={<ShieldAlert className="size-10 text-signal-500" aria-hidden />}
      title="Your connection isn’t private"
      actions={
        <>
          <Button variant="outline" onClick={() => onCancel(req.id)}>
            Back to safety
          </Button>
          <Button variant="ghost" onClick={() => onProceed(req.id)}>
            Continue anyway
          </Button>
        </>
      }
    >
      The security certificate for <span className="text-ink-200">{host}</span> isn’t trusted.
      Someone could be trying to intercept this connection. Only continue if you know this site
      is safe.
    </StatusPage>
  );
}

type ErrorCopy = {
  /** The COREWEBVIEW2_WEB_ERROR_STATUS enumerator, minus its long prefix. We
   *  surface the engine's own name rather than a guessed Chrome `ERR_` code, so
   *  what the page shows is exactly what the navigation actually reported. */
  name: string;
  title: string;
  detail: string;
  hint?: string;
  icon: LucideIcon;
};

/** Every WebErrorStatus a main-frame navigation can fail with, named. Status 14
 *  (OPERATION_CANCELED) is filtered out in webext.rs — a stop or an external
 *  protocol handoff isn't a failure. Cert statuses (1-5) normally surface as a
 *  `cert-error` interstitial and only land here when the load failed outright. */
const ERROR_COPY: Record<number, ErrorCopy> = {
  0: {
    name: "UNKNOWN",
    title: "The page didn’t load",
    detail: "The engine stopped the navigation without reporting a reason.",
    hint: "An extension or a security policy may have blocked it.",
    icon: CircleAlert,
  },
  1: {
    name: "CERTIFICATE_COMMON_NAME_IS_INCORRECT",
    title: "Your connection isn’t private",
    detail: "The certificate this site presented was issued for a different domain.",
    icon: ShieldAlert,
  },
  2: {
    name: "CERTIFICATE_EXPIRED",
    title: "Your connection isn’t private",
    detail: "The site’s certificate has expired.",
    hint: "If your computer’s clock is wrong, valid certificates look expired.",
    icon: ShieldAlert,
  },
  3: {
    name: "CLIENT_CERTIFICATE_CONTAINS_ERRORS",
    title: "Your connection isn’t private",
    detail: "The client certificate sent to this site was rejected as invalid.",
    icon: ShieldAlert,
  },
  4: {
    name: "CERTIFICATE_REVOKED",
    title: "Your connection isn’t private",
    detail: "The site’s certificate was revoked by the authority that issued it.",
    icon: ShieldAlert,
  },
  5: {
    name: "CERTIFICATE_IS_INVALID",
    title: "Your connection isn’t private",
    detail: "The site’s certificate is malformed or signed by an untrusted authority.",
    icon: ShieldAlert,
  },
  6: {
    name: "SERVER_UNREACHABLE",
    title: "This server is unreachable",
    detail: "The address resolved, but no route to the server exists from this network.",
    hint: "A VPN, firewall or proxy is the usual cause.",
    icon: ServerOff,
  },
  7: {
    name: "TIMEOUT",
    title: "This site took too long to respond",
    detail: "The server accepted the connection but never sent a response.",
    icon: TimerOff,
  },
  8: {
    name: "ERROR_HTTP_INVALID_SERVER_RESPONSE",
    title: "The server sent an invalid response",
    detail: "The reply wasn’t valid HTTP, so it couldn’t be parsed.",
    icon: ServerCrash,
  },
  9: {
    name: "CONNECTION_ABORTED",
    title: "The connection was interrupted",
    detail: "The transfer stopped partway through, before the page finished loading.",
    icon: Unplug,
  },
  10: {
    name: "CONNECTION_RESET",
    title: "The connection was reset",
    detail: "The server closed the connection abruptly.",
    icon: Unplug,
  },
  11: {
    name: "DISCONNECTED",
    title: "You’re offline",
    detail: "This computer has no working network connection.",
    hint: "Check your Wi-Fi or cable, then reload.",
    icon: WifiOff,
  },
  12: {
    name: "CANNOT_CONNECT",
    title: "This site refused to connect",
    detail: "The server was found but rejected the connection on that port.",
    hint: "It may be down, or listening on a different port.",
    icon: ServerOff,
  },
  13: {
    name: "HOST_NAME_NOT_RESOLVED",
    title: "This site’s address couldn’t be found",
    detail: "DNS has no IP address for this hostname.",
    hint: "Check the address for a typo.",
    icon: SearchX,
  },
  15: {
    name: "REDIRECT_FAILED",
    title: "This page has a redirect problem",
    detail: "The site redirected in a loop, or to somewhere that couldn’t be loaded.",
    icon: CircleAlert,
  },
  16: {
    name: "UNEXPECTED_ERROR",
    title: "Something went wrong loading this page",
    detail: "The engine hit an internal error it couldn’t classify.",
    icon: CircleAlert,
  },
  17: {
    name: "VALID_AUTHENTICATION_CREDENTIALS_REQUIRED",
    title: "This page needs a sign-in",
    detail: "The server rejected the credentials it was given.",
    icon: KeyRound,
  },
  18: {
    name: "VALID_PROXY_AUTHENTICATION_REQUIRED",
    title: "Your proxy needs a sign-in",
    detail: "The proxy between you and this site rejected the credentials it was given.",
    icon: KeyRound,
  },
};

/** Branded network-error page shown when a main-frame navigation fails. Names
 *  the exact failure — Chrome's blanket "site can't be reached" tells a user
 *  nothing about whether to fix a typo, a proxy, or their Wi-Fi. */
export function NavErrorPage({
  code,
  url,
  onReload,
}: {
  code: number;
  url: string;
  onReload: () => void;
}) {
  const copy = ERROR_COPY[code];
  const Icon = copy?.icon ?? CircleAlert;
  return (
    <StatusPage
      icon={<Icon className="size-10 text-ink-500" aria-hidden />}
      title={copy?.title ?? "This page didn’t load"}
      actions={
        <Button variant="outline" onClick={onReload}>
          Reload
        </Button>
      }
    >
      {copy?.detail ?? "The navigation failed with an error this build doesn’t recognise."}
      {copy?.hint && <div className="mt-1 text-ink-500">{copy.hint}</div>}
      <div className="mt-3 break-all text-[11.5px] text-ink-500">{url}</div>
      <div className="mt-1 font-mono text-[11.5px] uppercase tracking-wide text-ink-500">
        {copy ? `${copy.name} · ${code}` : `WEB_ERROR_STATUS · ${code}`}
      </div>
    </StatusPage>
  );
}
