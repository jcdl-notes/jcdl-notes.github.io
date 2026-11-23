const collector = "https://xinhuo-notes-traffic.devotedbagel64.chatgpt.site";

export function recordVisit() {
  if (navigator.globalPrivacyControl || navigator.doNotTrack === "1") return;

  function send() {
    try {
      const key = "xinhuo-visitor";
      let visitor = localStorage.getItem(key);
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(visitor || "")) {
        visitor = crypto.randomUUID();
        localStorage.setItem(key, visitor);
      }
      fetch(collector + "/visit", {
        method: "POST", body: visitor, keepalive: true, credentials: "omit",
        referrerPolicy: "no-referrer", signal: AbortSignal.timeout?.(3500)
      }).catch(() => {});
    } catch {
      // Storage and network availability vary across browsers.
    }
  }

  if (typeof requestIdleCallback === "function") requestIdleCallback(send);
  else setTimeout(send, 0);
}
