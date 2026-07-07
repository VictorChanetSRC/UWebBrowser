import { useState } from "react";
import { Search } from "lucide-react";

type Props = {
  placeholder: string;
  autoFocus?: boolean;
  /** Remount the input (re-running autofocus) when this changes. */
  inputKey?: string;
  /** Controlled mode: pass both value and onValueChange. */
  value?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
};

/** The home screen's search. Bigger than the toolbar field on purpose. */
export function SearchField({
  placeholder,
  autoFocus,
  inputKey,
  value,
  onValueChange,
  onSubmit,
}: Props) {
  const [inner, setInner] = useState("");
  const shown = value ?? inner;

  return (
    <form
      className="flex h-[54px] items-center gap-3.5 rounded-xl border border-ink-700 bg-ink-900 px-5 transition-[border-color,background-color] duration-[130ms] ease-brand focus-within:border-ink-400 focus-within:bg-ink-950 hover:border-ink-600"
      onSubmit={(e) => {
        e.preventDefault();
        if (shown.trim()) onSubmit?.(shown);
      }}
    >
      <Search className="size-4 shrink-0 text-ink-500" aria-hidden />
      <input
        key={inputKey}
        type="search"
        autoFocus={autoFocus}
        value={shown}
        spellCheck={false}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          setInner(e.target.value);
          onValueChange?.(e.target.value);
        }}
        className="min-w-0 flex-1 select-text bg-transparent text-base text-ink-100 outline-none placeholder:text-ink-500"
      />
    </form>
  );
}
