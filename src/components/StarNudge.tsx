import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { ipc } from "../lib/ipc";
import { GITHUB_REPO_URL, markStarNudgeDone, snoozeStarNudge } from "../lib/github";
import { fmtNumber } from "../lib/format";
import { Button } from "@/components/ui/button";

type Props = {
  /** Opens the repo in a browser tab. */
  onOpen: (url: string) => void;
  onDismiss: () => void;
  onToast: (message: string) => void;
};

/**
 * A one-time ask, shown only to returning users (App decides when): star the
 * repo to support the project. Clicking through opens GitHub in a tab and
 * retires the nudge for good; "Not now" snoozes it for two weeks.
 */
export function StarNudge({ onOpen, onDismiss, onToast }: Props) {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    ipc
      .githubRepoStats()
      .then((stats) => setStars(stats.stars))
      .catch(() => {});
  }, []);

  const star = () => {
    markStarNudgeDone();
    onOpen(GITHUB_REPO_URL);
    onToast("Thank you for the support ⭐");
    onDismiss();
  };

  const later = () => {
    snoozeStarNudge();
    onDismiss();
  };

  return (
    <div className="absolute bottom-5 right-3 z-40 w-[360px] animate-rise rounded-xl border border-ink-800 bg-ink-900 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.55)]">
      <div className="flex items-start gap-3">
        <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-800 text-ink-200">
          <Star className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ink-100">Is UWebBrowser saving you time?</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
            {stars !== null && stars > 0
              ? `A star on GitHub is the best way to support it — join ${fmtNumber(stars)} ${
                  stars === 1 ? "developer" : "developers"
                } who already have.`
              : "It's free and open source — a star on GitHub is the best way to support it."}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={later}>
          Not now
        </Button>
        <Button size="sm" variant="primary" onClick={star}>
          Star on GitHub
        </Button>
      </div>
    </div>
  );
}
