/*
 * Push suppression policy.
 *
 * Why this is a plain script and not a module: the service worker is a classic
 * worker, so it loads this with importScripts. Keeping the rule in its own file
 * lets a unit test exercise it without a browser, and keeps sw.js to wiring.
 *
 * The rule: a visible window suppresses the operating system alert only when it
 * is showing the workspace that produced the alert. That window already showed
 * the in-app event. A visible window on a different workspace has not, so the
 * alert must still appear.
 */

(function (root) {
  /** The first path segment of a URL, which is the workspace slug. */
  function firstPathSegment(url) {
    try {
      const pathname = new URL(url).pathname;
      const segment = pathname.split("/").filter(Boolean)[0];

      return typeof segment === "string" ? segment : "";
    } catch {
      return "";
    }
  }

  /**
   * True when the alert should be suppressed.
   *
   * An empty or missing slug means an older payload from before the workspace
   * was included. Falling back to "any visible window suppresses" keeps the old
   * behaviour for those, rather than showing a duplicate alert.
   */
  function shouldSuppressPush(clients, slug) {
    if (!Array.isArray(clients)) return false;

    return clients.some(function (client) {
      if (!client || client.visibilityState !== "visible") return false;
      if (typeof client.url !== "string") return false;
      if (typeof slug !== "string" || slug.length === 0) return true;

      return firstPathSegment(client.url) === slug;
    });
  }

  root.HandoffPushPolicy = { shouldSuppressPush: shouldSuppressPush };
})(typeof self !== "undefined" ? self : globalThis);
