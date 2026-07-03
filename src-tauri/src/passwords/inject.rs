//! Scripts that run inside tab webviews.
//!
//! The content script is injected natively at document start (via
//! `initialization_script`), so it always runs regardless of the page's CSP.
//! It installs `window.__uwbPass` helpers and, best-effort, an inline badge
//! that talks to the `uwbpass` bridge. Fills are driven from the native side by
//! evaluating [`fill_script`], which reuses the helper and falls back to inline
//! field-finding if the helper isn't present.

/// The always-injected content script.
pub fn content_script() -> &'static str {
    include_str!("content.js")
}

/// Build a one-shot fill script for a specific credential. Values are
/// JSON-encoded, so quotes and backslashes in a password can't break out of
/// the string or inject code.
///
/// This is self-contained — it finds and fills the fields itself rather than
/// relying on the content script's `window.__uwbPass`, so a fill still works if
/// that script didn't initialize on a given page.
pub fn fill_script(username: &str, password: &str) -> String {
    let u = serde_json::to_string(username).unwrap_or_else(|_| "\"\"".to_string());
    let p = serde_json::to_string(password).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#"(function(){{try{{
var U={u},P={p};
function vis(el){{if(!el||el.disabled||el.readOnly)return false;var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}}
function foc(el){{try{{el.focus();}}catch(e){{}}}}
function setVal(el,val){{if(!el)return;var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');if(d&&d.set){{d.set.call(el,val);}}else{{el.value=val;}}el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));}}
var pw=null,pws=document.querySelectorAll('input[type=password]');
for(var i=0;i<pws.length;i++){{if(vis(pws[i])){{pw=pws[i];break;}}}}
var scope=(pw&&pw.form)||document,user=null;
var cs=scope.querySelectorAll('input[type=text],input[type=email],input[type=tel],input:not([type]),input[autocomplete=username]');
for(var j=0;j<cs.length;j++){{var el=cs[j];if(!vis(el))continue;if(pw&&(el.compareDocumentPosition(pw)&Node.DOCUMENT_POSITION_FOLLOWING)){{user=el;}}else if(!user){{user=el;}}}}
if(user&&U){{foc(user);setVal(user,U);}}
if(pw&&P){{foc(pw);setVal(pw,P);}}
if(pw){{try{{pw.blur();}}catch(e){{}}}}
}}catch(e){{}}}})();"#
    )
}
