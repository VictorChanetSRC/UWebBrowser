import { useState, type ReactNode } from "react";
import { Globe } from "lucide-react";
import { faviconUrl } from "../../lib/url";
import { cn } from "../../lib/utils";

/**
 * A site favicon that degrades to a neutral glyph instead of a broken-image
 * icon when the favicon service is blocked or offline (and when the URL has no
 * host). One place for the `onError` fallback the tab strip, work bar, omnibox
 * and password panel all need. Note the service reveals the host to Google.
 */
export function Favicon({
  url,
  size = 32,
  className,
  fallback,
}: {
  url: string;
  size?: number;
  className?: string;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url, size);
  if (failed || !src) {
    return <>{fallback ?? <Globe className={cn("size-3.5 text-ink-500", className)} aria-hidden />}</>;
  }
  return (
    <img src={src} alt="" className={className} onError={() => setFailed(true)} />
  );
}
