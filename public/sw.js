// Minimal service worker — exists so browsers recognize this as an
// installable app. It doesn't cache anything, so the app always loads
// fresh data from Supabase (no risk of showing stale/offline data).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // passthrough — always use the network
