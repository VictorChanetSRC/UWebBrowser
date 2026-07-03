/** Terminal sessions, keyed by tab id, living outside React.
 *
 *  The xterm instance (and its scrollback) must survive tab switches and
 *  StrictMode's dev double-mount, so components only attach/detach a host
 *  element here; App prunes sessions whose tab is gone. */

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "./ipc";

type Session = {
  term: Terminal;
  fit: FitAddon;
  exited: boolean;
};

const sessions = new Map<string, Session>();
let wired = false;

/** Ink ramp + Signal red, with readable ANSI colors on ink-950. */
const theme = {
  background: "#0a0a0b",
  foreground: "#e4e3e8",
  cursor: "#f2f1f4",
  cursorAccent: "#0a0a0b",
  selectionBackground: "#45454d",
  black: "#141417",
  red: "#f24c3a",
  green: "#7dc87d",
  yellow: "#e0c06f",
  blue: "#6f9fe0",
  magenta: "#b58fd6",
  cyan: "#6fc7c7",
  white: "#c5c4cc",
  brightBlack: "#6e6e77",
  brightRed: "#f66f5f",
  brightGreen: "#9adb9a",
  brightYellow: "#eed392",
  brightBlue: "#93b8ea",
  brightMagenta: "#cbaee4",
  brightCyan: "#93d8d8",
  brightWhite: "#f2f1f4",
};

/** One pair of app-wide listeners dispatches to sessions by id. */
function wire() {
  if (wired) return;
  wired = true;
  ipc.onTermOutput(({ id, data }) => sessions.get(id)?.term.write(data));
  ipc.onTermExit(({ id, code }) => {
    const session = sessions.get(id);
    if (!session) return;
    session.exited = true;
    session.term.write(
      `\r\n\x1b[90m[process exited${code != null ? ` with code ${code}` : ""} — press Enter to restart]\x1b[0m\r\n`,
    );
  });
}

function startShell(id: string, session: Session) {
  ipc.termCreate(id, session.term.cols, session.term.rows).catch((err) => {
    session.exited = true;
    session.term.write(
      `\r\n\x1b[31mCould not start shell: ${err} — press Enter to retry\x1b[0m\r\n`,
    );
  });
}

/** Mount the session for `id` into `host`, creating shell + xterm on first
 *  call. Re-attaching an existing session just moves its DOM node. */
export function attachTerminal(id: string, host: HTMLElement) {
  wire();
  const existing = sessions.get(id);
  if (existing) {
    const el = existing.term.element;
    if (el && el.parentElement !== host) host.appendChild(el);
    return;
  }

  const term = new Terminal({
    fontFamily: '"Geist Mono", "Cascadia Mono", monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 8000,
    theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const session: Session = { term, fit, exited: false };
  sessions.set(id, session);

  term.open(host);
  fit.fit();

  term.onData((data) => {
    if (session.exited) {
      // The shell is dead; Enter resurrects it, everything else is ignored.
      if (data.includes("\r")) {
        session.exited = false;
        term.reset();
        startShell(id, session);
      }
      return;
    }
    ipc.termWrite(id, data).catch(() => {});
  });
  term.onResize(({ cols, rows }) => ipc.termResize(id, cols, rows).catch(() => {}));

  startShell(id, session);
}

/** Re-measure after the host becomes visible or changes size. A hidden host
 *  has zero size and would collapse the grid, so skip it. */
export function refitTerminal(id: string) {
  const session = sessions.get(id);
  const el = session?.term.element;
  if (!session || !el || !el.isConnected) return;
  if (el.clientWidth === 0 || el.clientHeight === 0) return;
  session.fit.fit();
}

export function focusTerminal(id: string) {
  sessions.get(id)?.term.focus();
}

/** Kill every session whose tab id is not in `alive` (tab closed, or the
 *  tab navigated away from uwb://terminal). */
export function pruneTerminals(alive: Set<string>) {
  for (const [id, session] of sessions) {
    if (alive.has(id)) continue;
    sessions.delete(id);
    session.term.dispose();
    ipc.termClose(id).catch(() => {});
  }
}
