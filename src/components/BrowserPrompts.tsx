import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { StatusPage } from "@/components/ui/status-page";
import { PromptIcon, PromptModal, PromptActions } from "@/components/ui/prompt";
import { POPOVER_SURFACE, Z_POPOVER } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
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
    <div
      className={cn(
        "absolute left-4 top-1 w-[340px] animate-rise p-4",
        Z_POPOVER,
        POPOVER_SURFACE,
      )}
    >
      <div className="flex items-start gap-3">
        <PromptIcon>
          <Icon aria-hidden />
        </PromptIcon>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink-100">
            {hostOf(req.origin) || req.origin}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
            wants to {copy.label}
          </div>
        </div>
      </div>
      <PromptActions>
        <Button size="sm" variant="ghost" onClick={() => onRespond(req.id, false)}>
          Block
        </Button>
        <Button size="sm" variant="primary" onClick={() => onRespond(req.id, true)}>
          Allow
        </Button>
      </PromptActions>
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

  const submit = () => onSubmit(req.id, username, password);
  // Escape and scrim clicks abort the load, exactly as Cancel does.
  const cancel = () => onCancel(req.id);

  return (
    <PromptModal className="w-[380px]" label="Sign in" onDismiss={cancel} onSubmit={submit}>
      <div className="flex items-start gap-3">
        <PromptIcon>
          <Lock aria-hidden />
        </PromptIcon>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ink-100">Sign in</div>
          <div className="mt-0.5 truncate text-[11.5px] text-ink-500">
            {hostOf(req.origin) || req.origin} requires a username and password
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
        />
        <Input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Password"
          autoComplete="current-password"
        />
      </div>
      <PromptActions className="mt-4">
        <Button size="sm" variant="ghost" type="button" onClick={cancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          Sign in
        </Button>
      </PromptActions>
    </PromptModal>
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
    <PromptModal
      className="w-[400px]"
      label={`Open ${scheme} link in another app?`}
      onDismiss={onCancel}
    >
      <div className="flex items-start gap-3">
        <PromptIcon>
          <ExternalLink aria-hidden />
        </PromptIcon>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ink-100">
            Open <span className="font-medium">{scheme}</span> link in another app?
          </div>
          <div className="mt-1 break-all rounded-md bg-ink-950 px-2 py-1.5 text-[11px] text-ink-400">
            {url.length > 160 ? `${url.slice(0, 160)}…` : url}
          </div>
        </div>
      </div>
      <PromptActions className="mt-4">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={onOpen}>
          Open
        </Button>
      </PromptActions>
    </PromptModal>
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
    <StatusPage
      icon={<ShieldAlert className="size-10 text-signal-500" aria-hidden />}
      title="Your connection isn’t private"
      actions={
        <>
          <Button variant="outline" onClick={() => onCancel(req.id)}>
            Back to safety
          </Button>
          <Button variant="ghost" onClick={() => onProceed(req.id)}>
            Continue anyway
          </Button>
        </>
      }
    >
      The security certificate for <span className="text-ink-200">{host}</span> isn’t trusted.
      Someone could be trying to intercept this connection. Only continue if you know this site
      is safe.
    </StatusPage>
  );
}

/** Human summary for a WebView2 WebErrorStatus code. Only the codes users
 *  actually hit are named; the rest fall back to a generic line. */
const ERROR_COPY: Record<number, { title: string; detail: string }> = {
  // COREWEBVIEW2_WEB_ERROR_STATUS ordinals, per webview2-com-sys bindings.rs.
  // Cert statuses (1-5) normally surface as a `cert-error` interstitial instead;
  // they only land here when the navigation failed outright.
  1: { title: "Your connection isn’t private", detail: "The certificate is for a different site." },
  2: { title: "Your connection isn’t private", detail: "The site’s certificate has expired." },
  3: { title: "Your connection isn’t private", detail: "The client certificate has errors." },
  4: { title: "Your connection isn’t private", detail: "The site’s certificate was revoked." },
  5: { title: "Your connection isn’t private", detail: "The site’s certificate is invalid." },
  6: {
    title: "This site can’t be reached",
    detail: "The server refused the connection or is unreachable.",
  },
  7: { title: "This site can’t be reached", detail: "The server took too long to respond." },
  8: { title: "This site can’t be reached", detail: "The server sent an invalid response." },
  9: { title: "This site can’t be reached", detail: "The connection was interrupted." },
  10: { title: "This site can’t be reached", detail: "The connection was reset." },
  11: { title: "You’re offline", detail: "Check your network connection and try again." },
  12: { title: "This site can’t be reached", detail: "The connection could not be established." },
  13: {
    title: "This site can’t be reached",
    detail: "Its server IP address could not be found (DNS).",
  },
  15: { title: "This site can’t be reached", detail: "The redirect failed." },
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
    <StatusPage
      icon={<WifiOff className="size-10 text-ink-500" aria-hidden />}
      title={copy.title}
      actions={
        <Button variant="outline" onClick={onReload}>
          Reload
        </Button>
      }
    >
      {copy.detail}
      <div className="mt-1 break-all text-[11.5px] text-ink-500">{hostOf(url) || url}</div>
    </StatusPage>
  );
}
