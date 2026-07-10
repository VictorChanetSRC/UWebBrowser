import { Favicon } from "./favicon";
import { formatBareUrl, hostOf } from "@/lib/url";
import { cn } from "@/lib/utils";

/**
 * The two halves of a "site" row — one in the omnibox suggestions, one in
 * history. Both render the same favicon slot and the same
 * `title · bare-url` two-tone label, so they live here rather than being
 * typed out (and drifting) in each list.
 */

/** The fixed favicon slot that leads a site row. */
export function SiteIcon({ url }: { url: string }) {
  return (
    <span className="flex size-5 flex-none items-center justify-center">
      <Favicon url={url} className="size-3.5 rounded-[3px]" />
    </span>
  );
}

/** A site's title (falling back to its host) with the bare URL trailing in mono. */
export function SiteLabel({
  title,
  url,
  className,
}: {
  title?: string;
  url: string;
  className?: string;
}) {
  return (
    <span className={cn("min-w-0 flex-1 truncate", className)}>
      {title || hostOf(url)}
      <span className="font-mono text-[12px] text-ink-500">
        {" · "}
        {formatBareUrl(url)}
      </span>
    </span>
  );
}
