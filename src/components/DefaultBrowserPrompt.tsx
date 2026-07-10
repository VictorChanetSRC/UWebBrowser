import { useState } from "react";
import { Compass } from "lucide-react";
import { fire, ipc } from "../lib/ipc";
import { NudgeCard } from "@/components/ui/nudge-card";

type Props = {
  onDismiss: () => void;
};

/** Invites the user to make UWebBrowser their default browser. Windows only
 *  lets the user flip that choice in Settings, so the button deep-links there;
 *  App re-checks on window focus and closes this once the choice sticks. */
export function DefaultBrowserPrompt({ onDismiss }: Props) {
  const [opened, setOpened] = useState(false);

  // Only claim a Settings page opened once one actually has: the body text
  // below tells the user to go and pick UWebBrowser in it.
  const openSettings = () => {
    fire(
      ipc.openDefaultBrowserSettings().then(() => setOpened(true)),
      "Couldn’t open Windows Settings",
    );
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
