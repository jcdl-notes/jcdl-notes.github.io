const collector = "https://xinhuo-notes-traffic.devotedbagel64.chatgpt.site";

function privacyEnabled() {
  return navigator.globalPrivacyControl || navigator.doNotTrack === "1";
}

function report(path, body) {
  fetch(collector + path, {
    method: "POST", body, keepalive: true, credentials: "omit",
    referrerPolicy: "no-referrer", signal: AbortSignal.timeout?.(3500)
  }).catch(() => {});
}

export function recordVisit() {
  if (privacyEnabled()) return;

  function send() {
    try {
      const key = "xinhuo-visitor";
      let visitor = localStorage.getItem(key);
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(visitor || "")) {
        visitor = crypto.randomUUID();
        localStorage.setItem(key, visitor);
      }
      report("/visit", visitor);
    } catch {
      // Storage and network availability vary across browsers.
    }
  }

  if (typeof requestIdleCallback === "function") requestIdleCallback(send);
  else setTimeout(send, 0);
}

export function startTraffic() {
  if (privacyEnabled()) return;
  function recordDownload(event) {
    if (event.type === "auxclick" && event.button !== 1) return;
    const link = event.target.closest?.("a[data-download-note]");
    if (link && !event.defaultPrevented) report("/download", link.dataset.downloadNote);
  }
  document.addEventListener("click", recordDownload, {passive: true});
  document.addEventListener("auxclick", recordDownload, {passive: true});
  setTimeout(recordVisit, 1000);
}
