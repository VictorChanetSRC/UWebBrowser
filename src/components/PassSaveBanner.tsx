import { useState } from "react";
import { Check, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { addNeverHost, pass } from "../lib/passwords";
import { Button } from "@/components/ui/button";

export type Capture = {
  tabId: string;
  host: string;
  username: string;
  /** "new" for a first login, "update" when the saved password differs. */
  mode: "new" | "update";
};

type Props = {
  capture: Capture;
  onDone: (saved: boolean) => void;
};

/** Offered after a login is submitted on a page. The password lives on the
 *  native side — this only sends the tab id to commit or dismiss it. */
export function PassSaveBanner({ capture, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const isUpdate = capture.mode === "update";

  const save = async () => {
    setBusy(true);
    try {
      await pass.commitCapture(capture.tabId);
    } finally {
      onDone(true);
    }
  };

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    await pass.dismissCapture(capture.tabId).catch(() => {});
    onDone(false);
  };

  const never = async () => {
    if (busy) return;
    addNeverHost(capture.host);
    await dismiss();
  };

  return (
    <div className="absolute right-3 top-3 z-30 flex w-[340px] animate-rise flex-col gap-2.5 rounded-xl border border-ink-800 bg-ink-900 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.55)]">
      <div className="flex items-center gap-3">
        <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-800 text-ink-200">
          {isUpdate ? (
            <RefreshCw className="size-4" aria-hidden />
          ) : (
            <KeyRound className="size-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ink-100">
            {isUpdate ? "Update saved password?" : "Save this login?"}
          </div>
          <div className="truncate font-mono text-[11.5px] text-ink-500">
            {capture.username ? `${capture.username} · ` : ""}
            {capture.host}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        {!isUpdate && (
          <Button
            size="sm"
            variant="ghost"
            className="mr-auto"
            onClick={never}
            disabled={busy}
            title={`Stop offering to save passwords for ${capture.host}`}
          >
            Never for this site
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy}>
          Not now
        </Button>
        <Button size="sm" variant="primary" onClick={save} disabled={busy}>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Check className="size-3.5" aria-hidden />
          )}
          {isUpdate ? "Update" : "Save"}
        </Button>
      </div>
    </div>
  );
}
