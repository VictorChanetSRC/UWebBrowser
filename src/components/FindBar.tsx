import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { ipc } from "../lib/ipc";
import { IconButton } from "./ui/icon-button";

/**
 * Find-in-page bar. Lives in a reserved strip at the top of the content area
 * (a floating overlay would be painted over by the native tab webview), and
 * drives Chromium's `window.find` through the backend. Each query change
 * restarts the search from the top; Enter / the arrows step matches.
 */
export function FindBar({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field whenever the bar opens for a (possibly different) tab.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [tabId]);

  const empty = query.trim() === "";

  const search = (forward: boolean, fromStart: boolean) => {
    if (empty) return;
    ipc.tabFind(tabId, query, forward, fromStart).catch(() => {});
  };

  // Restart the search from the top on every query change, debounced so a fast
  // typist doesn't fire (and re-highlight) a search on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      ipc.tabFind(tabId, query, true, true).catch(() => {});
    }, 140);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const close = () => {
    ipc.tabFind(tabId, "", true, false).catch(() => {}); // clear the highlight
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
