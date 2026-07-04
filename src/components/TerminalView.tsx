import { useEffect, useRef } from "react";
import { attachTerminal, focusTerminal, refitTerminal } from "../lib/terminal";

/** Host for one terminal session. The xterm instance itself lives in
 *  lib/terminal.ts and outlives this component; we only give it a DOM node,
 *  keep it sized to the pane, and hand it focus when the tab is active. */
export function TerminalView({ id, active }: { id: string; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    attachTerminal(id, host);
    const observer = new ResizeObserver(() => refitTerminal(id));
    observer.observe(host);
    return () => observer.disconnect();
  }, [id]);

  useEffect(() => {
    if (!active) return;
    // The pane was display:none while inactive; measure it fresh.
    refitTerminal(id);
    focusTerminal(id);
    // Activating an internal tab hides the native page webview, which hands
    // OS focus back to the chrome document a beat later and blurs xterm —
    // leaving a hollow, non-blinking cursor. Take focus back once settled.
    const timer = window.setTimeout(() => focusTerminal(id), 120);
    return () => window.clearTimeout(timer);
  }, [id, active]);

  return (
    <div
      data-terminal
      ref={hostRef}
      onMouseDown={() => focusTerminal(id)}
      className="h-full w-full bg-ink-950 pl-3 pt-2"
    />
  );
}
