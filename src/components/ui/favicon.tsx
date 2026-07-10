import { useEffect, useState, type ReactNode } from "react";
import { Globe } from "lucide-react";
import { faviconUrl } from "../../lib/url";
import { cn } from "../../lib/utils";

/**
 * A site favicon that degrades to a neutral glyph instead of a broken-image
 * icon when the favicon service is blocked or offline (and when the URL has no
 * host). One place for the `onError` fallback the tab strip, work bar, omnibox
 * and history all need.
 *
 * Prefers a real favicon URL captured natively from the page (`realSrc`, no
 * third-party lookup); falls back to the favicon service only when the page
 * hasn't reported one. `failed` resets when the source changes so a slot reused
 * for a different URL isn't stuck on the globe after one 404.
 */
export function Favicon({
  url,
  realSrc,
  size = 32,
  className,
  fallback,
}: {
  url: string;
  realSrc?: string;
  size?: number;
  className?: string;
  fallback?: ReactNode;
}) {
  const service = faviconUrl(url, size);
  const [realFailed, setRealFailed] = useState(false);
  const [serviceFailed, setServiceFailed] = useState(false);
  useEffect(() => {
    setRealFailed(false);
    setServiceFailed(false);
  }, [realSrc, url]);
  // Prefer the page's own favicon, fall back to the service, then the glyph.
  const usingReal = !!realSrc && !realFailed;
  const src = usingReal ? realSrc! : serviceFailed ? "" : service;
  if (!src) {
    return <>{fallback ?? <Globe className={cn("size-3.5 text-ink-500", className)} aria-hidden />}</>;
  }
  return (
    <img
      src={src}
      alt=""
      className={className}
      onError={() => (usingReal ? setRealFailed(true) : setServiceFailed(true))}
    />
  );
}
