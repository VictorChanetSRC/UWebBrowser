import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { ipc, silent } from "../lib/ipc";
import { IconButton } from "./ui/icon-button";

/**
 * Find-in-page bar. Lives in a reserved strip at the top of the content area
 * (a floating overlay would be painted over by the native tab webview), and
 * drives Chromium's `window.find` through the backend. Each query change
 * restarts the search from the top; Enter / the arrows step matches.
 *
 * There is no match count: `window.find` doesn't return one, and we have no
 * ExecuteScript-with-result plumbing to compute one. What the bar *can* do is
 * say whether the current query matched anything at all, which is announced to
 * assistive tech — otherwise a screen-reader user typing a search hears only
 * their own keystrokes.
 */
export function FindBar({
  tabId,
  pageUrl,
  focusSignal,
  onClose,
}: {
  tabId: string;
  /** The tab's current URL. A same-tab navigation drops the old highlight, so
   *  the search has to be re-issued against the new document. */
  pageUrl: string;
  /** Bumped on every Ctrl+F, including while the bar is already open. */
  focusSignal: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [missed, setMissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field when the bar opens, when the tab changes, and on every
  // repeat Ctrl+F — pressing it again with the bar already open must re-focus
  // and select the query, as it does in Chrome, not silently do nothing.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [tabId, focusSignal]);

  const empty = query.trim() === "";

  const search = (forward: boolean, fromStart: boolean) => {
    if (empty) return;
    silent(ipc.tabFind(tabId, query, forward, fromStart));
  };

  // Restart the search from the top on every query change, debounced so a fast
  // typist doesn't fire (and re-highlight) a search on every keystroke. Also
  // re-runs when the page navigates under us, which would otherwise leave the
  // field populated and nothing highlighted until the user retyped.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query.trim() === "") {
        setMissed(false);
        silent(ipc.tabFind(tabId, "", true, false));
        return;
      }
      ipc
        .tabFind(tabId, query, true, true)
        .then((found) => setMissed(!found))
        .catch(() => setMissed(false));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [query, tabId, pageUrl]);

  const close = () => {
    silent(ipc.tabFind(tabId, "", true, false)); // clear the highlight
    onClose();
  };

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-b-lg border border-t-0 border-ink-800 bg-ink-900 px-2 py-1.5 shadow-popover">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            search(!e.shiftKey, false);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        placeholder="Find in page"
        aria-label="Find in page"
        className="w-48 bg-transparent px-1 text-[13px] text-ink-100 outline-none placeholder:text-ink-500"
      />
      {/* Always mounted so the result is announced when it appears, not just
          when the region is created. */}
      <span
        role="status"
        aria-live="polite"
        className="min-w-0 font-mono text-[11px] leading-none text-ink-500"
      >
        {missed && !empty ? "No matches" : ""}
      </span>
      <IconButton label="Previous match" disabled={empty} onClick={() => search(false, false)}>
        <ChevronUp />
      </IconButton>
      <IconButton label="Next match" disabled={empty} onClick={() => search(true, false)}>
        <ChevronDown />
      </IconButton>
      <IconButton label="Close find bar" onClick={close}>
        <X />
      </IconButton>
    </div>
  );
}
