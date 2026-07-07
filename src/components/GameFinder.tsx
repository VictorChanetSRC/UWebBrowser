import { useState } from "react";
import { newGame, type Game } from "../lib/config";
import { PLATFORMS } from "../lib/platforms";
import { usePlatformCheck } from "@/hooks/use-platform-check";
import { Mark } from "./TitleBar";
import { PlatformCheckList } from "./PlatformCheckList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The big first-run opener, shared with the manual setup form. */
export function SetupHero({ spinning, lede }: { spinning?: boolean; lede: string }) {
  return (
    <div className="flex flex-col gap-3.5 pt-4">
      <div
        className={cn(
          "mb-2.5 self-start text-ink-200",
          spinning && "animate-spin [animation-duration:1.4s]",
        )}
      >
        <Mark size={28} />
      </div>
      <Label>UWebBrowser</Label>
      <h1 className="text-[64px] font-semibold leading-[1.1] tracking-[-0.03em]">
        Set up your space.
      </h1>
      <p className="max-w-[46ch] text-[17px] leading-[1.55] text-ink-400">{lede}</p>
    </div>
  );
}

/**
 * First-run setup: one name in, every storefront checked live.
 */
export function GameFinder({
  onSave,
  onManual,
  onOpen,
}: {
  onSave: (game: Game) => void;
  onManual: (game?: Game) => void;
  onOpen: (url: string) => void;
}) {
  const [name, setName] = useState("");
  const { rows, searching, done, foundCount, allFailed, search, foundPlatforms } =
    usePlatformCheck();

  const buildGame = (): Game => ({
    ...newGame(),
    name: name.trim(),
    steamAppId: rows?.steam?.hit?.id ?? "",
    platforms: foundPlatforms(),
  });

  return (
    <div className="flex max-w-[560px] flex-col gap-8">
      <SetupHero
        spinning={searching}
        lede="Type your game's name. UWebBrowser finds it on Steam, Epic, consoles, mobile, itch.io and Twitch, then wires your dashboard."
      />

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(name);
        }}
      >
        <Input
          autoFocus
          value={name}
          placeholder="Your game's name"
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          type="submit"
          variant={rows ? "outline" : "primary"}
          className="h-[38px] flex-none"
          disabled={!name.trim() || searching}
        >
          {rows ? "Check again" : "Find my game"}
        </Button>
      </form>

      {rows && <PlatformCheckList rows={rows} onOpen={onOpen} />}

      {done && (
        <div className="flex flex-col gap-4">
          <p className="text-ink-400">
            {foundCount > 0
              ? `Live on ${foundCount} of ${PLATFORMS.length} channels.`
              : allFailed
                ? "Couldn’t reach the stores — check your connection and try again."
                : "No listings found. Save anyway; the dashboard fills in when your game ships."}
          </p>
          <div className="flex gap-2.5">
            <Button variant="primary" onClick={() => onSave(buildGame())}>
              Save setup
            </Button>
            <Button onClick={() => onManual(buildGame())}>Adjust manually</Button>
          </div>
        </div>
      )}

      {!rows && (
        <button
          className="self-start text-[13px] font-medium text-ink-500 transition-[color] duration-[130ms] ease-brand hover:text-ink-100"
          onClick={() => onManual()}
        >
          Set up manually instead
        </button>
      )}
    </div>
  );
}
