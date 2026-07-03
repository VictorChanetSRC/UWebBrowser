import { useState } from "react";
import { Check, KeyRound, Loader2, X } from "lucide-react";
import { pass } from "../lib/passwords";
import { Button } from "@/components/ui/button";

export type Capture = {
  tabId: string;
  host: string;
  username: string;
};

type Props = {
  capture: Capture;
  onDone: (saved: boolean) => void;
};

/** Offered after a login is submitted on a page. The password lives on the
 *  native side — this only sends the tab id to commit or dismiss it. */
export function PassSaveBanner({ capture, onDone }: Props) {
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await pass.commitCapture(capture.tabId);
    } finally {
      onDone(true);
    }
  };

  const dismiss = async () => {
    await pass.dismissCapture(capture.tabId).catch(() => {});
    onDone(false);
  };

  return (
    <div className="absolute right-3 top-3 z-30 flex w-[340px] animate-rise items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.55)]">
      <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-800 text-ink-200">
        <KeyRound className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink-100">Save this login?</div>
        <div className="truncate font-mono text-[11.5px] text-ink-500">
          {capture.username ? `${capture.username} · ` : ""}
          {capture.host}
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy} aria-label="Not now">
          <X className="size-3.5" aria-hidden />
        </Button>
        <Button size="sm" variant="primary" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          Save
        </Button>
      </div>
    </div>
  );
}
