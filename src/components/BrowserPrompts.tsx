import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Camera,
  Clipboard,
  ExternalLink,
  Lock,
  MapPin,
  Mic,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { hostOf } from "../lib/url";

/** The permission kinds the backend surfaces (see webext.rs `perm_kind_str`). */
export type PermissionReq = {
  id: string;
  tabId: string;
  kind: string;
  origin: string;
};

const PERMISSION_COPY: Record<string, { icon: typeof Camera; label: string }> = {
  camera: { icon: Camera, label: "use your camera" },
  microphone: { icon: Mic, label: "use your microphone" },
  geolocation: { icon: MapPin, label: "know your location" },
  notifications: { icon: Bell, label: "show notifications" },
  clipboard: { icon: Clipboard, label: "read from your clipboard" },
};

/** Chrome-style permission bubble that drops from under the omnibox. Allow/Block
 *  is remembered per-origin by WebView2, so we never re-ask after a decision. */
export function PermissionPrompt({
  req,
  onRespond,
}: {
  req: PermissionReq;
  onRespond: (id: string, allow: boolean) => void;
}) {
  const copy = PERMISSION_COPY[req.kind] ?? {
    icon: ShieldAlert,
    label: `use ${req.kind}`,
  };
  const Icon = copy.icon;
  return (
    <div className="absolute left-4 top-1 z-40 w-[340px] animate-rise rounded-xl border border-ink-800 bg-ink-900 p-4 shadow-modal">
      <div className="flex items-start gap-3">
        <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-800 text-ink-200">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink-100">
            {hostOf(req.origin) || req.origin}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
            wants to {copy.label}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => onRespond(req.id, false)}>
          Block
        </Button>
        <Button size="sm" variant="primary" onClick={() => onRespond(req.id, true)}>
          Allow
        </Button>
      </div>
    </div>
  );
}

export type AuthReq = { id: string; tabId: string; origin: string };

/** HTTP basic-auth (401) credentials dialog. Submitting with empty fields, or
 *  cancelling, aborts the load. */
export function BasicAuthDialog({
  req,
  onSubmit,
  onCancel,
}: {
  req: AuthReq;
  onSubmit: (id: string, username: string, password: string) => void;
  onCancel: (id: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const submit = () => onSubmit(req.id, username, password);

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/40 p-16">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="w-[380px] animate-rise rounded-xl border border-ink-800 bg-ink-900 p-5 shadow-modal"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-800 text-ink-200">
            <Lock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink-100">Sign in</div>
            <div className="mt-0.5 truncate text-[11.5px] text-ink-500">
              {hostOf(req.origin) || req.origin} requires a username and password
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <input
            ref={firstRef}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            className="w-full rounded-lg border border-ink-800 bg-ink-950 px-3 py-2 text-[13px] text-ink-100 outline-none placeholder:text-ink-500 focus:border-ink-600"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            className="w-full rounded-lg border border-ink-800 bg-ink-950 px-3 py-2 text-[13px] text-ink-100 outline-none placeholder:text-ink-500 focus:border-ink-600"
          />
        </div>
        <div className="mt-4 flex items-center justify-end gap-1.5">
          <Button size="sm" variant="ghost" type="button" onClick={() => onCancel(req.id)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Sign in
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Deep-link confirmation ("Open this link in another app?"), matching Chrome's
 *  external-protocol prompt. */
export function ExternalLinkConfirm({
  url,
  onOpen,
  onCancel,
}: {
  url: string;
  onOpen: () => void;
  onCancel: () => void;
}) {
  const scheme = url.split(":")[0];
  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/40 p-16">
      <div className="w-[400px] animate-rise rounded-xl border border-ink-800 bg-ink-900 p-5 shadow-modal">
        <div className="flex items-start gap-3">
          <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-800 text-ink-200">
            <ExternalLink className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink-100">
              Open <span className="font-medium">{scheme}</span> link in another app?
            </div>
            <div className="mt-1 break-all rounded-md bg-ink-950 px-2 py-1.5 text-[11px] text-ink-400">
              {url.length > 160 ? `${url.slice(0, 160)}…` : url}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={onOpen}>
            Open
          </Button>
        </div>
      </div>
    </div>
  );
}

export type CertReq = { id: string; tabId: string; url: string; code: number };

/** TLS certificate-error interstitial. Fills the content area (like Chrome's red
 *  warning page) and lets the user proceed for the session or go back. */
export function CertInterstitial({
  req,
  onProceed,
  onCancel,
}: {
  req: CertReq;
  onProceed: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const host = hostOf(req.url) || req.url;
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background p-8 text-center">
      <ShieldAlert className="size-10 text-signal-500" aria-hidden />
      <div className="text-[15px] font-medium text-ink-100">Your connection isn’t private</div>
      <div className="max-w-md text-[13px] leading-relaxed text-ink-400">
        The security certificate for <span className="text-ink-200">{host}</span> isn’t
        trusted. Someone could be trying to intercept this connection. Only continue if you
        know this site is safe.
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => onCancel(req.id)}>
          Back to safety
        </Button>
        <Button variant="ghost" onClick={() => onProceed(req.id)}>
          Continue anyway
        </Button>
      </div>
    </div>
  );
}

/** Human summary for a WebView2 WebErrorStatus code. Only the codes users
 *  actually hit are named; the rest fall back to a generic line. */
const ERROR_COPY: Record<number, { title: string; detail: string }> = {
  // COREWEBVIEW2_WEB_ERROR_STATUS enum ordinals (webview2-com).
  2: { title: "Can’t reach this site", detail: "The server took too long to respond." },
  3: { title: "Can’t reach this site", detail: "The connection was reset." },
  4: { title: "Can’t reach this site", detail: "The connection was interrupted." },
  6: {
    title: "This site can’t be reached",
    detail: "The server refused the connection or is unreachable.",
  },
  7: {
    title: "This site can’t be reached",
    detail: "Its server IP address could not be found (DNS).",
  },
};

/** Branded network-error page shown when a main-frame navigation fails. */
export function NavErrorPage({
  code,
  url,
  onReload,
}: {
  code: number;
  url: string;
  onReload: () => void;
}) {
  const copy = ERROR_COPY[code] ?? {
    title: "This site can’t be reached",
    detail: "Something went wrong loading the page.",
  };
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background p-8 text-center">
      <WifiOff className="size-10 text-ink-500" aria-hidden />
      <div className="text-[15px] font-medium text-ink-100">{copy.title}</div>
      <div className="max-w-md text-[13px] leading-relaxed text-ink-400">
        {copy.detail}
        <div className="mt-1 break-all text-[11.5px] text-ink-500">{hostOf(url) || url}</div>
      </div>
      <Button variant="outline" onClick={onReload}>
        Reload
      </Button>
    </div>
  );
}
