/*
 * Handoff service worker.
 *
 * Why this file is so small: it is not an offline cache. The SPA has one Nitro
 * bundle and one cache policy, and a second caching layer would serve stale
 * code after a deploy. This worker exists only for Web Push and its click.
 *
 * Used by: features/notifications/push.ts (registration).
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  if (!payload || typeof payload.title !== "string") return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // A visible window already showed the in-app toast and badge. Do not
        // duplicate it in the operating system.
        const visible = clients.some(
          (client) => client.visibilityState === "visible",
        );

        if (visible) return undefined;

        return self.registration.showNotification(payload.title, {
          body: typeof payload.body === "string" ? payload.body : "",
          icon: "/favicon.svg",
          tag: typeof payload.tag === "string" ? payload.tag : "handoff",
          data: {
            href: typeof payload.href === "string" ? payload.href : "/",
            tag: typeof payload.tag === "string" ? payload.tag : "",
          },
        });
      }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const href = typeof data.href === "string" ? data.href : "/";
  const tag = typeof data.tag === "string" ? data.tag : "";
  const url = new URL(href, self.location.origin);

  // Opening from an OS alert is a real click. The query parameter lets the app
  // mark that notification read, including reminder and project rows that have
  // no message read event to clear them.
  if (tag) url.searchParams.set("notification", tag);

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const sameOrigin = clients.filter(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        const target = sameOrigin[0];

        if (target) {
          try {
            await target.focus();
            await target.navigate(url.toString());
            return undefined;
          } catch {
            return self.clients.openWindow(url.toString());
          }
        }

        return self.clients.openWindow(url.toString());
      }),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // The browser invalidated the subscription. An open app can re-subscribe with
  // the current account; with no app open, the next visit repairs it.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "handoff:push-subscription-changed" });
        }
      }),
  );
});
