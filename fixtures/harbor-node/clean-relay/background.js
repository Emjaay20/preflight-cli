const CONSENT_KEY = "consent";

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "harbor:kill") {
    stopRelay();
  }
});

function stopRelay() {
  if (globalThis.__harborSocket) {
    globalThis.__harborSocket.close();
    globalThis.__harborSocket = null;
  }
}

async function maybeRelay() {
  const stored = await chrome.storage.local.get(CONSENT_KEY);
  if (stored.consent !== true) {
    return;
  }
  const ws = new WebSocket("wss://relay.harbor.example/v1/session");
  globalThis.__harborSocket = ws;
}

chrome.alarms.onAlarm.addListener(() => {
  maybeRelay();
});
