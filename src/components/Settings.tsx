import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { clearHistory, historyCount } from "../lib/history";
import { ipc } from "../lib/ipc";
import {
  searchEngines,
  type BrowserSettings,
  type SearchEngineKey,
} from "../lib/settings";
import { GITHUB_REPO_URL } from "../lib/github";
import { fmtNumber } from "../lib/format";
import { FeedbackDialog } from "./FeedbackDialog";
import { Button } from "@/components/ui/button";
import { ARMED_CLASS, ConfirmButton } from "@/components/ui/confirm-button";
import { Label } from "@/components/ui/label";
import { SECTION_HAIRLINE } from "@/components/ui/section";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/ui/page-shell";
import { ChipGroup } from "@/components/ui/chip-group";

type Props = {
  settings: BrowserSettings;
  onUpdate: (settings: BrowserSettings) => void;
  onResetPins: () => void;
  onCustomizeWorkbar: () => void;
  /** Opens a URL in a browser tab (GitHub issue forms, the repo). */
  onOpen: (url: string) => void;
};

type ClearState = "idle" | "confirm" | "working" | "done" | "error";

export function Settings({
  settings,
  onUpdate,
  onResetPins,
  onCustomizeWorkbar,
  onOpen,
}: Props) {
  const [version, setVersion] = useState("");
  const [visitCount, setVisitCount] = useState(historyCount);
  const [clearState, setClearState] = useState<ClearState>("idle");
  const [clearError, setClearError] = useState("");
  const [historyCleared, setHistoryCleared] = useState(false);
  const [pinsReset, setPinsReset] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [stars, setStars] = useState<number | null>(null);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
    ipc
      .githubRepoStats()
      .then((repoStats) => setStars(repoStats.stars))
      .catch(() => {});
    return () => window.clearTimeout(resetTimer.current);
  }, []);

  const settle = (fn: () => void, ms = 2600) => {
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(fn, ms);
  };

  const clearBrowsingData = async () => {
    if (clearState === "idle" || clearState === "error") {
      setClearState("confirm");
      settle(() => setClearState("idle"), 5000);
      return;
    }
    if (clearState !== "confirm") return;
    setClearState("working");
    try {
      await ipc.clearBrowsingData();
      setClearState("done");
      settle(() => setClearState("idle"));
    } catch (error) {
      // Show a friendly line; keep the raw error in the console for debugging.
      console.error("clear browsing data failed:", error);
      setClearError(
        "Couldn’t clear site data — the web engine may still be closing. Try again in a few seconds.",
      );
      setClearState("error");
    }
  };

  const handleClearHistory = () => {
    clearHistory();
    setVisitCount(0);
    setHistoryCleared(true);
    settle(() => setHistoryCleared(false));
  };

  const setEngine = (key: SearchEngineKey) => {
    onUpdate({ ...settings, searchEngine: key });
  };

  return (
    <>
      <PageShell>
        <PageHeader
          kicker="Settings"
          title="Make it yours."
          description="Search, privacy and housekeeping for UWebBrowser. Everything here takes effect immediately."
        />

        <SettingsSection label="Search">
          <Row
            title="Default search engine"
            description="Used when the address bar input isn't a URL."
          >
            <ChipGroup
              className="justify-end"
              options={searchEngines}
              value={settings.searchEngine}
              onPick={setEngine}
            />
          </Row>
        </SettingsSection>

        <SettingsSection label="Privacy">
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
            <Row
              inset
              title="Clear cache, cookies and site data"
              description={
                clearState === "error"
                  ? clearError
                  : "Signs you out of websites. Open tabs keep running; reload them afterwards."
              }
            >
              <Button
                className={cn("flex-none", clearState === "confirm" && ARMED_CLASS)}
                disabled={clearState === "working"}
                onClick={clearBrowsingData}
              >
                {clearState === "confirm"
                  ? "Click again to confirm"
                  : clearState === "working"
                    ? "Clearing…"
                    : clearState === "done"
                      ? "Cleared"
                      : clearState === "error"
                        ? "Retry"
                        : "Clear data"}
              </Button>
            </Row>
            <Row
              inset
              title="Clear browsing history"
              description={
                historyCleared
                  ? "History cleared."
                  : `${visitCount} ${visitCount === 1 ? "page" : "pages"} remembered. Browse and search them on the History page (Ctrl+H).`
              }
            >
              <ConfirmButton
                className="flex-none"
                disabled={visitCount === 0}
                onConfirm={handleClearHistory}
              >
                Clear history
              </ConfirmButton>
            </Row>
          </div>
        </SettingsSection>

        <SettingsSection label="Work bar">
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
            <Row
              inset
              title="Customize widgets"
              description="Preview every widget live, then add, arrange and tune your bar."
            >
              <Button className="flex-none" onClick={onCustomizeWorkbar}>
                Open work bar
              </Button>
            </Row>
            <Row
              inset
              title="Reset widgets"
              description={
                pinsReset
                  ? "Work bar restored to the default widgets."
                  : "Replaces your widgets with the defaults: live status on top, curated Unreal links below."
              }
            >
              <ConfirmButton
                className="flex-none"
                onConfirm={() => {
                  onResetPins();
                  setPinsReset(true);
                  settle(() => setPinsReset(false));
                }}
              >
                Reset work bar
              </ConfirmButton>
            </Row>
          </div>
        </SettingsSection>

        <SettingsSection label="Feedback">
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
            <Row
              inset
              title="Report a bug or share an idea"
              description="Opens a prefilled GitHub issue with your app version and OS already attached."
            >
              <Button className="flex-none" onClick={() => setFeedbackOpen(true)}>
                Send feedback
              </Button>
            </Row>
            <Row
              inset
              title="Star UWebBrowser on GitHub"
              description={
                stars !== null && stars > 0
                  ? `Free and open source — ${fmtNumber(stars)} ${
                      stars === 1 ? "star" : "stars"
                    } so far. Yours keeps the project moving.`
                  : "Free and open source. A star is the easiest way to support the project."
              }
            >
              <Button className="flex-none" onClick={() => onOpen(GITHUB_REPO_URL)}>
                Open GitHub
              </Button>
            </Row>
          </div>
        </SettingsSection>

        <SettingsSection label="About">
          <p className="text-ink-400">
            UWebBrowser {version && <span className="font-mono text-[12.5px]">v{version}</span>}
            {" · "}the web browser for Unreal Engine developers. Rendering by
            Microsoft Edge WebView2.
          </p>
        </SettingsSection>
      </PageShell>

      {feedbackOpen && (
        <FeedbackDialog onClose={() => setFeedbackOpen(false)} onOpen={onOpen} />
      )}
    </>
  );
}

/** Wide screens put the section kicker beside its rows instead of above them,
 *  so settings read as a classic two-column preference sheet. */
function SettingsSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section
      className={`grid gap-3.5 ${SECTION_HAIRLINE} @3xl:grid-cols-[200px_minmax(0,1fr)] @3xl:gap-x-12`}
    >
      <Label className="@3xl:pt-1">{label}</Label>
      <div className="flex min-w-0 flex-col gap-3.5">{children}</div>
    </section>
  );
}

function Row(props: {
  title: string;
  description: string;
  inset?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        props.inset
          ? "flex items-center justify-between gap-6 px-5 py-4"
          : "flex items-center justify-between gap-6"
      }
    >
      <div className="min-w-0">
        <div className="text-[13.5px] text-ink-100">{props.title}</div>
        <div className="mt-0.5 text-[12.5px] text-ink-400">{props.description}</div>
      </div>
      {props.children}
    </div>
  );
}
