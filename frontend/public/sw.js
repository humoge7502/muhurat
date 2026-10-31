/* Muhurat service worker: shell cache-first, API network-first with fallback. */
const SHELL = "muhurat-shell-v1";
const RUNTIME = "muhurat-runtime-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(["/", "/index.html", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== SHELL && key !== RUNTIME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

/* Push: real web-push notifications for deadline warnings. */
self.addEventListener("push", (event) => {
  let payload = { title: "Muhurat", body: "A deadline is approaching.", url: "/" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    /* plain-text push */
    if (event.data && event.data.text) payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: payload.url,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(
        (client) => client.url.includes("muhurat") || new URL(client.url).pathname === "/",
      );
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(event.request, copy));
          return response;
        }),
    ),
  );
});
