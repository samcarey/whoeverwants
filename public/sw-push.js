/**
 * Push-only service worker.
 *
 * Registered at scope `/push/` (NOT `/`) so it doesn't conflict with the
 * caching service workers (`sw.js` / `sw-mobile.js`) at the root scope.
 * Scope only governs which pages this worker controls; the push event
 * arrives at every registration with an active subscription regardless
 * of scope, so a scope no page actually visits is fine.
 *
 * Lives in one file (no environment forks) so dev and prod behave the
 * same way. This is the only SW registered on dev servers — the
 * caching SW is unregistered there per layout.tsx.
 *
 * Payload schema is defined by the server's fan-out helpers (see
 * server/services/push.py):
 *   { title: string, body: string, url: string, group_id: string,
 *     tag: string, badge?: number }
 * `badge` is the app-icon badge count (currently always 1 — the "you have
 * something unseen" dot, not a real unread count). Set via setAppBadge on
 * push, cleared on notification click and on app focus (see
 * lib/pushNotifications.ts: clearAppBadge).
 */

self.addEventListener('install', function (event) {
  // Activate immediately on update.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  if (!event.data) return;
  var payload;
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: 'WhoeverWants', body: event.data.text() };
  }

  var title = payload.title || 'WhoeverWants';
  var options = {
    body: payload.body || '',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    // Tag dedupes — a second push for the same poll replaces the first
    // banner rather than stacking them.
    tag: payload.tag || 'whoeverwants',
    data: {
      url: payload.url || '/',
      group_id: payload.group_id || null,
    },
  };

  // App-icon badge. `navigator.setAppBadge` is supported in the SW global
  // scope on Chromium / installed PWAs; iOS APNS carries its own aps.badge.
  // Guarded so unsupported browsers (and the value being absent) no-op.
  if (typeof payload.badge === 'number' && self.navigator && self.navigator.setAppBadge) {
    self.navigator.setAppBadge(payload.badge).catch(function () {});
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  // Opening the notification clears the badge — the user has now seen it.
  if (self.navigator && self.navigator.clearAppBadge) {
    self.navigator.clearAppBadge().catch(function () {});
  }
  var url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // If a window is already open at any URL, focus it and navigate
      // it to the notification target. Avoids opening a duplicate tab.
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) {
          if ('navigate' in client) {
            try {
              client.navigate(url);
            } catch (e) {
              // Cross-origin navigate is blocked; fall through.
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
