import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { ipc } from "../lib/ipc";
import { GITHUB_REPO_URL, markStarNudgeDone, snoozeStarNudge } from "../lib/github";
import { fmtNumber } from "../lib/format";
import { NudgeCard } from "@/components/ui/nudge-card";

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
    <NudgeCard
      icon={<Star aria-hidden />}
      title="Is UWebBrowser saving you time?"
      body={
        stars !== null && stars > 0
          ? `A star on GitHub is the best way to support it — join ${fmtNumber(stars)} ${
              stars === 1 ? "developer" : "developers"
            } who already have.`
          : "It's free and open source — a star on GitHub is the best way to support it."
      }
      primaryLabel="Star on GitHub"
      onPrimary={star}
      onDismiss={later}
    />
  );
}
