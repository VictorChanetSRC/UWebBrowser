import { PromptModal } from "@/components/ui/prompt";
import { Label } from "@/components/ui/label";

/**
 * The keyboard reference, opened with Ctrl+/.
 *
 * UWebBrowser binds around twenty shortcuts, and before this dialog existed the
 * only way to learn most of them was to read `App.tsx`. A handful leak out via
 * button tooltips; the rest — reopen a closed tab, hard reload, pin, print,
 * jump to tab N — were invisible.
 *
 * Keep this table in step with `actionForKey` in `App.tsx` and `action_for` in
 * `src-tauri/src/webext.rs`. Those two are the implementation; this is the only
 * place a user can see it.
 */
const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Tabs",
    rows: [
      ["Ctrl+T", "New tab"],
      ["Ctrl+W", "Close tab"],
      ["Ctrl+Shift+T", "Reopen the last closed tab"],
      ["Ctrl+Tab", "Next tab"],
      ["Ctrl+Shift+Tab", "Previous tab"],
      ["Ctrl+1 … Ctrl+9", "Jump to tab"],
    ],
  },
  {
    title: "Navigation",
    rows: [
      ["Ctrl+L", "Focus the address bar"],
      ["Alt+←  /  Alt+→", "Back / forward"],
      ["Ctrl+R  ·  F5", "Reload"],
      ["Ctrl+Shift+R  ·  Ctrl+F5", "Reload, bypassing the cache"],
      ["Ctrl+F", "Find on page"],
      ["Ctrl+D", "Pin to the work bar"],
    ],
  },
  {
    title: "Tools",
    rows: [
      ["F12  ·  Ctrl+Shift+I", "DevTools"],
      ["Ctrl+`", "Terminal"],
      ["Ctrl+J", "Downloads"],
      ["Ctrl+H", "History"],
      ["Ctrl+P", "Print"],
      ["Ctrl+,", "Settings"],
      ["Ctrl+Shift+Del", "Clear browsing data"],
      ["Ctrl+/", "This list"],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <PromptModal
      label="Keyboard shortcuts"
      placement="center"
      anchor="window"
      onDismiss={onClose}
      className="w-[560px] max-w-[calc(100%-48px)] rounded-2xl p-6"
    >
      <Label>Keyboard</Label>
      <h2 className="mt-1.5 text-[19px] font-semibold tracking-[-0.02em]">Shortcuts</h2>

      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <Label size="micro">{group.title}</Label>
            <dl className="mt-2 flex flex-col gap-1.5">
              {group.rows.map(([keys, action]) => (
                <div key={keys} className="flex items-baseline justify-between gap-3">
                  <dt className="min-w-0 text-[12.5px] text-ink-300">{action}</dt>
                  <dd className="flex-none font-mono text-[11px] leading-none text-ink-500">
                    {keys}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <p className="mt-5 text-[11.5px] leading-snug text-ink-500">
        These work whether the chrome or the page has focus.
      </p>
    </PromptModal>
  );
}
