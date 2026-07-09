import { useState } from "react";
import { Compass } from "lucide-react";
import { ipc } from "../lib/ipc";
import { NudgeCard } from "@/components/ui/nudge-card";

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
    <NudgeCard
      icon={<Compass aria-hidden />}
      title="Enjoying UWebBrowser?"
      body={
        opened
          ? "Pick UWebBrowser in the Windows Settings page that just opened."
          : "Make it your default browser so links from other apps open here."
      }
      primaryLabel="Set as default"
      onPrimary={openSettings}
      onDismiss={onDismiss}
    />
  );
}
