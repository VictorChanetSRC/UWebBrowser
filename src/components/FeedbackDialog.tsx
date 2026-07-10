import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bug, Lightbulb, X } from "lucide-react";
import {
  feedbackIssueUrl,
  gatherDiagnostics,
  type FeedbackKind,
} from "../lib/github";
import { silent } from "../lib/ipc";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PromptModal } from "@/components/ui/prompt";
import { ChipGroup } from "@/components/ui/chip-group";

type Props = {
  onClose: () => void;
  /** Opens the prefilled GitHub issue in a browser tab. */
  onOpen: (url: string) => void;
};

const KINDS: { key: FeedbackKind; label: string; icon: ReactNode }[] = [
  { key: "bug", label: "Report a bug", icon: <Bug className="size-3.5" aria-hidden /> },
  { key: "idea", label: "Share an idea", icon: <Lightbulb className="size-3.5" aria-hidden /> },
];

/**
 * Collects a bug report or an idea, then hands off to a prefilled GitHub
 * issue form — the user reviews and submits on github.com, owns the issue,
 * and gets notified when it moves. Bugs carry auto-gathered diagnostics
 * (app version, OS, WebView2) so nobody has to hunt those down.
 */
export function FeedbackDialog({ onClose, onOpen }: Props) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // No diagnostics is a thinner bug report, not a broken dialog.
    silent(gatherDiagnostics().then(setDiagnostics));
  }, []);

  const submit = () => {
    onOpen(
      feedbackIssueUrl(
        kind,
        title,
        details,
        includeDiagnostics ? diagnostics : undefined,
      ),
    );
    onClose();
  };

  return (
    <PromptModal
      label="Send feedback"
      placement="center"
      anchor="window"
      initialFocus={titleRef}
      onDismiss={onClose}
      // The feedback form is the app's largest dialog; it carries a softer corner.
      className="w-[520px] max-w-[calc(100%-48px)] rounded-2xl p-6"
    >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label>Feedback</Label>
            <h2 className="mt-1.5 text-[19px] font-semibold tracking-[-0.02em]">
              Help make UWebBrowser better.
            </h2>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X aria-hidden />
          </IconButton>
        </div>

        <ChipGroup className="mt-4" options={KINDS} value={kind} onPick={setKind} />

        <div className="mt-4 flex flex-col gap-3">
          <Input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "bug" ? "Short summary of the bug" : "Short summary of the idea"}
            aria-label="Title"
          />
          <Textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={
              kind === "bug"
                ? "What did you do, what did you expect, and what happened instead?"
                : "What should it do, and what problem would it solve for you?"
            }
            aria-label="Details"
            rows={5}
            className="leading-relaxed"
          />
          {kind === "bug" && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background p-3">
              <input
                type="checkbox"
                checked={includeDiagnostics}
                onChange={(e) => setIncludeDiagnostics(e.target.checked)}
                className="mt-0.5 accent-ink-300"
              />
              <span className="min-w-0">
                <span className="block text-[12.5px] text-ink-200">
                  Attach diagnostics
                </span>
                <span className="mt-1 block whitespace-pre-line font-mono text-[11px] leading-[1.6] text-ink-500">
                  {diagnostics || "Collecting…"}
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-[11.5px] leading-snug text-ink-500">
            Opens a prefilled GitHub issue — review it there before posting.
          </p>
          <div className="flex flex-none items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!title.trim() && !details.trim()}
              onClick={submit}
            >
              Continue on GitHub
            </Button>
          </div>
        </div>
    </PromptModal>
  );
}
