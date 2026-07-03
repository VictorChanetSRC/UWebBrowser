import { useState } from "react";
import { Compass } from "lucide-react";
import { ipc } from "../lib/ipc";
import { Button } from "@/components/ui/button";

type Props = {
  onDismiss: () => void;
};

/** Invites the user to make UWebBrowser their default browser. Windows only
 *  lets the user flip that choice in Settings, so the button deep-links there;
 *  App re-checks on window focus and closes this once the choice sticks. */
export function DefaultBrowserPrompt({ onDismiss }: Props) {
  const [opened, setOpened] = useState(false);

  const openSettings = () => {
    setOpened(true);
    ipc.openDefaultBrowserSettings().catch(() => {});
  };

  return (
    <div className="absolute bottom-5 right-3 z-40 w-[360px] animate-rise rounded-xl border border-ink-800 bg-ink-900 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.55)]">
      <div className="flex items-start gap-3">
        <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-800 text-ink-200">
          <Compass className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ink-100">Enjoying UWebBrowser?</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
            {opened
              ? "Pick UWebBrowser in the Windows Settings page that just opened."
              : "Make it your default browser so links from other apps open here."}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Not now
        </Button>
        <Button size="sm" variant="primary" onClick={openSettings}>
          Set as default
        </Button>
      </div>
    </div>
  );
}
