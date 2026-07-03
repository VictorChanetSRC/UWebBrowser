// UWebBrowser password-manager content script.
//
// Injected natively at document start in every tab frame. The native side
// pushes the *usernames* matching this page in via __uwbPass._set (a call that
// CSP can't block, unlike a page->native fetch). Passwords are never pushed:
// they stay on the native side and are only produced when the user explicitly
// picks an account, at which point the native side fills the fields itself.
// The dropdown opens only after the user focuses a login field (a real
// gesture) — never automatically on page load.

(function () {
  "use strict";
  if (window.__uwbPass) return;

  var C = {
    bg: "#141417",
    line: "#1f1f23",
    line2: "#2c2c32",
    text: "#f2f1f4",
    dim: "#6e6e77",
    mid: "#c5c4cc",
    signal: "#f24c3a",
  };
  var FONT =
    '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif';
  var MONO = 'ui-monospace,"Cascadia Mono",Consolas,monospace';

  // Origin-matched accounts (id + title + username, never passwords), pushed by
  // the native side. Closure-scoped on purpose.
  var creds = [];
  var host = null; // shadow host element while the dropdown is open
  var dismissed = false;

  function vis(el) {
    if (!el || el.disabled || el.readOnly) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function passwordField() {
    var fields = document.querySelectorAll('input[type="password"]');
    for (var i = 0; i < fields.length; i++) if (vis(fields[i])) return fields[i];
    return null;
  }

  // Only true for fields that are actually part of a login: a password field,
  // a text/email field explicitly marked autocomplete="username", or the
  // username box paired with a visible password field in the same form. Plain
  // search/text inputs never qualify.
  function isCredentialField(el) {
    if (!el || el.tagName !== "INPUT" || !vis(el)) return false;
    if ((el.type || "text").toLowerCase() === "password") return true;
    if ((el.getAttribute("autocomplete") || "").toLowerCase() === "username") return true;
    var pw = passwordField();
    return !!pw && el === usernameField(pw);
  }

  function usernameField(pw) {
    var scope = (pw && pw.form) || document;
    var list = scope.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type]), input[autocomplete="username"]'
    );
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!vis(el)) continue;
      if (pw && el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) best = el;
      else if (!best) best = el;
    }
    return best;
  }

  // The field the dropdown should attach to, or null when the page has no login
  // form. Never anchors to an unrelated input.
  function anchorField() {
    var a = document.activeElement;
    if (isCredentialField(a)) return a;
    var pw = passwordField();
    if (pw) return usernameField(pw) || pw;
    var hinted = document.querySelector('input[autocomplete="username" i]');
    return hinted && vis(hinted) ? hinted : null;
  }

  // Ask the native side to fill a chosen account. The password never enters the
  // page: the native side looks it up, re-checks it belongs to this origin, and
  // writes the fields directly. Best effort — if a strict page CSP blocks the
  // bridge, the user can still fill from the chrome password panel.
  function pick(id) {
    try {
      fetch("http://uwbpass.localhost/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "pick", id: id }),
      }).catch(function () {});
    } catch (e) {}
  }

  window.__uwbPass = {
    // Called by the native side with this page's matching accounts (no
    // passwords). We store them but never open unprompted — the dropdown waits
    // for the user to focus a login field.
    _set: function (list) {
      creds = Array.isArray(list) ? list : [];
      dismissed = false;
      // Re-show only if a login field is already focused (e.g. the vault was
      // unlocked while the user sat on the form); otherwise stay closed.
      if (window.top === window && creds.length && isCredentialField(document.activeElement)) show();
      else hide();
    },
  };

  if (window.top !== window) return; // fill helpers run in frames; UI is top-only

  function hide() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
  }

  function position(panel, field) {
    var r = field.getBoundingClientRect();
    var width = Math.max(r.width, 260);
    var left = Math.min(Math.max(r.left, 8), window.innerWidth - width - 8);
    panel.style.width = width + "px";
    panel.style.left = left + "px";
    // Prefer below the field; flip above if there isn't room.
    var below = r.bottom + 6;
    if (below + 240 > window.innerHeight && r.top - 6 > 240) {
      panel.style.top = "";
      panel.style.bottom = window.innerHeight - r.top + 6 + "px";
    } else {
      panel.style.bottom = "";
      panel.style.top = below + "px";
    }
  }

  function row(cred) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText =
      "all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;cursor:pointer;";
    btn.onmouseenter = function () { btn.style.background = C.line; };
    btn.onmouseleave = function () { btn.style.background = "transparent"; };

    var avatar = document.createElement("span");
    avatar.textContent = ((cred.title || cred.username || "?").trim()[0] || "?").toUpperCase();
    avatar.style.cssText =
      "flex:none;width:26px;height:26px;border-radius:7px;background:" +
      C.line +
      ";border:1px solid " +
      C.line2 +
      ";display:flex;align-items:center;justify-content:center;font:600 12px " +
      FONT +
      ";color:" +
      C.mid +
      ";";

    var textwrap = document.createElement("span");
    textwrap.style.cssText = "min-width:0;flex:1;display:flex;flex-direction:column;gap:1px;";
    var title = document.createElement("span");
    title.textContent = cred.title || cred.username || "Login";
    title.style.cssText =
      "font:500 13px " + FONT + ";color:" + C.text + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    var sub = document.createElement("span");
    sub.textContent = cred.username || "";
    sub.style.cssText =
      "font:11px " + MONO + ";color:" + C.dim + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    textwrap.appendChild(title);
    if (cred.username) textwrap.appendChild(sub);

    btn.appendChild(avatar);
    btn.appendChild(textwrap);
    // mousedown (not click) so the field doesn't blur and close us first.
    btn.addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      pick(cred.id);
      dismissed = true;
      hide();
    });
    return btn;
  }

  function show() {
    if (!creds.length || dismissed) return;
    var field = anchorField();
    if (!field) return;
    hide();

    host = document.createElement("div");
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
    var shadow = host.attachShadow({ mode: "closed" });

    var panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed;box-sizing:border-box;background:" +
      C.bg +
      ";border:1px solid " +
      C.line2 +
      ";border-radius:10px;box-shadow:0 18px 44px rgba(0,0,0,.55);overflow:hidden;";

    var header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid " + C.line + ";";
    var dot = document.createElement("span");
    dot.style.cssText = "width:7px;height:7px;border-radius:50%;background:" + C.signal + ";flex:none;";
    var label = document.createElement("span");
    label.textContent = "UWEBBROWSER PASSWORDS";
    label.style.cssText =
      "flex:1;font:500 10px " + MONO + ";letter-spacing:.14em;color:" + C.dim + ";";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.style.cssText =
      "all:unset;cursor:pointer;color:" + C.dim + ";font:16px " + FONT + ";line-height:1;padding:0 2px;";
    close.addEventListener("mousedown", function (e) {
      e.preventDefault();
      dismissed = true;
      hide();
    });
    header.appendChild(dot);
    header.appendChild(label);
    header.appendChild(close);
    panel.appendChild(header);

    var listEl = document.createElement("div");
    listEl.style.cssText = "max-height:232px;overflow-y:auto;padding:4px;";
    for (var i = 0; i < creds.length; i++) listEl.appendChild(row(creds[i]));
    panel.appendChild(listEl);

    shadow.appendChild(panel);
    document.body.appendChild(host);
    position(panel, field);

    host.__reposition = function () {
      if (host) position(panel, field);
    };
  }

  // Re-anchor while scrolling/resizing so the dropdown tracks the field.
  function reposition() {
    if (host && host.__reposition) host.__reposition();
  }
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition, true);

  document.addEventListener(
    "focusin",
    function (e) {
      if (isCredentialField(e.target) && creds.length) {
        dismissed = false;
        show();
      }
    },
    true
  );

  document.addEventListener(
    "mousedown",
    function (e) {
      // A click outside the dropdown and outside any login field dismisses it.
      if (!host) return;
      if (host.contains(e.target)) return;
      if (isCredentialField(e.target)) return;
      hide();
    },
    true
  );

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && host) {
      dismissed = true;
      hide();
    }
  });

  // Offer to save on submit (best effort — the bridge fetch may be blocked by a
  // strict page CSP, in which case saving happens from the panel instead).
  document.addEventListener(
    "submit",
    function () {
      try {
        var pw = passwordField();
        if (!pw || !pw.value) return;
        var user = usernameField(pw);
        fetch("http://uwbpass.localhost/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "capture",
            username: user ? user.value : "",
            password: pw.value,
          }),
        }).catch(function () {});
      } catch (e) {}
    },
    true
  );
})();
