import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { newGame, type Game, type UwbConfig } from "../lib/config";
import { PLATFORMS } from "../lib/platforms";
import { ipc, type SalesStatus } from "@/lib/ipc";
import { ago } from "@/lib/format";
import { usePlatformCheck } from "@/hooks/use-platform-check";
import { GameFinder, SetupHero } from "./GameFinder";
import { PlatformCheckList, Spinner } from "./PlatformCheckList";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Game + account setup. First run opens with the guided finder; the manual
 * form (also used by "Edit setup") carries the same live storefront sweep,
 * one per game.
 */
export function Setup({
  config,
  firstRun,
  onSave,
  onCancel,
  onOpen,
}: {
  config: UwbConfig;
  firstRun: boolean;
  onSave: (config: UwbConfig) => void;
  onCancel?: () => void;
  onOpen: (url: string) => void;
}) {
  const [manual, setManual] = useState(!firstRun);
  const [draft, setDraft] = useState<UwbConfig>(() => ({
    ...config,
    games: config.games.length > 0 ? config.games : [newGame()],
  }));

  const updateGame = (id: string, patch: Partial<Game>) =>
    setDraft((d) => ({
      ...d,
      games: d.games.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));

  if (!manual) {
    return (
      <GameFinder
        onOpen={onOpen}
        onManual={(game) => {
          if (game?.name) setDraft((d) => ({ ...d, games: [game] }));
          setManual(true);
        }}
        onSave={(game) => onSave({ ...config, games: [game] })}
      />
    );
  }

  const removeGame = (id: string) =>
    setDraft((d) => ({ ...d, games: d.games.filter((g) => g.id !== id) }));

  const addGame = () => setDraft((d) => ({ ...d, games: [...d.games, newGame()] }));

  // A game counts once it has a name or a Steam App ID; without at least one,
  // saving would wire a dashboard to nothing.
  const canSave = draft.games.some((g) => g.name.trim() || g.steamAppId.trim());

  const save = () => {
    if (!canSave) return;
    onSave({
      ...draft,
      games: draft.games
        .filter((g) => g.name.trim() || g.steamAppId.trim())
        .map((g) => ({ ...g, name: g.name.trim(), steamAppId: g.steamAppId.trim() })),
    });
  };

  return (
    <div className="flex max-w-[560px] flex-col gap-8">
      {firstRun ? (
        <SetupHero lede="Tell UWebBrowser what you're building. It wires your dashboard to Steam, itch.io and the places players talk about your games." />
      ) : (
        <h2 className="text-[28px] font-semibold tracking-[-0.02em]">Setup</h2>
      )}

      <div className="flex flex-col gap-[22px]">
        <Field label="Your games">
          <div className="flex flex-col gap-3">
            {draft.games.map((g, index) => (
              <GameRow
                key={g.id}
                game={g}
                index={index}
                removable={draft.games.length > 1}
                onChange={(patch) => updateGame(g.id, patch)}
                onRemove={() => removeGame(g.id)}
                onOpen={onOpen}
              />
            ))}
          </div>
          <button
            className="self-start px-0.5 py-[5px] text-left text-[13px] font-medium text-ink-400 transition-[color] duration-[130ms] ease-brand hover:text-ink-100"
            onClick={addGame}
          >
            + Add game
          </button>
          <Hint>
            Find checks Steam, Epic, consoles, mobile, itch.io and Twitch and fills
            the Steam App ID for you. The ID is also in your store page URL.
          </Hint>
        </Field>

        <label className="flex flex-col gap-2">
          <Label>itch.io API key · optional</Label>
          <Input
            value={draft.itchApiKey}
            type="password"
            placeholder="from itch.io settings → API keys"
            onChange={(e) => setDraft({ ...draft, itchApiKey: e.target.value.trim() })}
          />
          <Hint>Stays on this machine. Pulls views, downloads and purchases for all your games.</Hint>
        </label>

        <SteamworksField />

        <div className="flex gap-2.5 pt-1">
          <Button
            variant="primary"
            onClick={save}
            disabled={!canSave}
            title={canSave ? undefined : "Add a game name or Steam App ID first"}
          >
            Save setup
          </Button>
          {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        </div>
      </div>
    </div>
  );
}

/**
 * One game in the manual form: inputs plus the same live storefront sweep
 * the finder has. Results fold into the draft when every store has answered.
 */
function GameRow({
  game,
  index,
  removable,
  onChange,
  onRemove,
  onOpen,
}: {
  game: Game;
  index: number;
  removable: boolean;
  onChange: (patch: Partial<Game>) => void;
  onRemove: () => void;
  onOpen: (url: string) => void;
}) {
  const check = usePlatformCheck();

  useEffect(() => {
    if (!check.done) return;
    const platforms = check.foundPlatforms();
    onChange({ platforms, steamAppId: game.steamAppId || platforms.steam?.id || "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.done]);

  const live = PLATFORMS.filter((p) => game.platforms?.[p.key]?.url);

  return (
    <Card className="gap-3.5 p-4">
      <CardHeader>
        <Label size="micro">Game {String(index + 1).padStart(2, "0")}</Label>
        {removable && (
          <Button
            variant="ghost"
            size="icon"
            className="-m-1.5"
            onClick={onRemove}
            aria-label={`Remove ${game.name || "game"}`}
          >
            <X className="size-2.5" aria-hidden />
          </Button>
        )}
      </CardHeader>

      <div className="flex gap-2">
        <Input
          className="h-[38px]"
          value={game.name}
          placeholder={index === 0 ? "My Game" : "Another game"}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <Button
          className="h-[38px] flex-none min-w-[108px]"
          onClick={() => check.search(game.name)}
          disabled={!game.name.trim() || check.searching}
        >
          {check.searching ? <Spinner /> : check.rows ? "Check again" : "Find stores"}
        </Button>
      </div>

      <label className="flex max-w-[200px] flex-col gap-2">
        <Label size="micro">Steam App ID</Label>
        <Input
          className="font-mono text-[12.5px]"
          value={game.steamAppId}
          placeholder="Filled by Find"
          spellCheck={false}
          onChange={(e) => onChange({ steamAppId: e.target.value.trim() })}
        />
      </label>

      {check.rows && (
        <div className="border-t border-border">
          <PlatformCheckList rows={check.rows} onOpen={onOpen} dense />
          {check.done && (
            <p className="border-t border-border pt-2.5 text-[13px] text-ink-500">
              {check.foundCount > 0
                ? `Live on ${check.foundCount} of ${PLATFORMS.length} channels. Saved with this game.`
                : check.allFailed
                  ? "Couldn’t reach the stores — check your connection and try again."
                  : "No listings found. Save anyway; the dashboard fills in when your game ships."}
            </p>
          )}
        </div>
      )}

      {!check.rows && live.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-3.5">
          <Label size="micro">Live on</Label>
          {live.map((p) => (
            <Button
              key={p.key}
              variant="link"
              size="none"
              className="text-[12.5px] font-normal"
              onClick={() => onOpen(game.platforms![p.key]!.url!)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * Connect the Steamworks publisher key that unlocks the revenue widgets.
 *
 * Unlike every other field on this page, this one doesn't live in the draft:
 * the key goes straight to the OS credential store and never comes back, so
 * there is nothing to save and nothing to show. Connect and Disconnect apply
 * the moment they're pressed.
 */
function SteamworksField() {
  const [status, setStatus] = useState<SalesStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ipc.steamSalesStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const run = async (action: () => Promise<SalesStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      setKey("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (status?.connected) {
    return (
      <div className="flex flex-col gap-2">
        <Label>Steamworks · connected</Label>
        <Card className="flex-row items-center justify-between gap-3 p-3.5">
          <span className="text-[13px] text-ink-300">
            {status.lastSyncedAt
              ? `Sales synced ${ago(status.lastSyncedAt)}`
              : "Waiting for the first sync"}
          </span>
          <Button onClick={() => run(ipc.steamSalesDisconnect)} disabled={busy}>
            Disconnect
          </Button>
        </Card>
        {error && <small className="text-xs text-ink-300">{error}</small>}
        <Hint>Disconnecting forgets the key and deletes the sales history it collected.</Hint>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Steamworks publisher key · optional</Label>
      <div className="flex gap-2">
        <Input
          value={key}
          type="password"
          spellCheck={false}
          placeholder="from Steamworks → Users &amp; Permissions"
          onChange={(e) => setKey(e.target.value.trim())}
        />
        <Button
          className="flex-none min-w-[108px]"
          onClick={() => run(() => ipc.steamSalesConnect(key))}
          disabled={!key || busy}
        >
          {busy ? "Checking…" : "Connect"}
        </Button>
      </div>
      {error && <small className="text-xs text-ink-300">{error}</small>}
      <Hint>
        Unlocks the Revenue widgets. Create the key under Manage Groups with the Sales Data
        permission, in a group of its own. It goes to the Windows Credential Manager, never to
        the browser.
      </Hint>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <small className="text-xs text-ink-500">{children}</small>;
}
