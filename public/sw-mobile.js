// Enhanced Service Worker for Mobile Instant Loading
const CACHE_NAME = 'whoeverwants-mobile-v3';

const STATIC_FILE_RE = /\.(json|png|svg|ico|woff2?)$/;

const ASSETS_TO_CACHE = [
  '/manifest.json',
];

// Install event - cache critical resources immediately
self.addEventListener('install', (event) => {
  console.log('SW: Installing enhanced mobile service worker v3');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('SW: Caching critical assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        // Force activation immediately
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('SW: Installation failed', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('SW: Activating enhanced mobile service worker v3');

  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => {
              console.log('SW: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            })
        );
      }),
      // Take control immediately
      self.clients.claim()
    ])
  );
});

// Fetch event - network-first for pages, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // Skip API requests — always go to network
  if (url.pathname.startsWith('/api/')) return;

  // Handle navigation requests with network-first strategy
  // This ensures users always get the latest HTML (which references correct JS bundles)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failed, try cache as fallback for offline support
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || caches.match('/');
          });
        })
    );
    return;
  }

  // Handle static assets with cache-first (content-hashed filenames are immutable)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          return cachedResponse || fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return networkResponse;
          });
        })
    );
    return;
  }

  // Handle other static files (manifest, icons, etc.) with cache-first + background update
  if (STATIC_FILE_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          const fetchPromise = fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return networkResponse;
          }).catch(() => cachedResponse);

          return cachedResponse || fetchPromise;
        })
    );
    return;
  }
});

// Background sync for pre-caching pages
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PRECACHE_PAGES') {
    const pages = event.data.pages || [];

    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return Promise.all(
          pages.map((page) => {
            return fetch(page).then((response) => {
              if (response && response.status === 200) {
                return cache.put(page, response.clone());
              }
            }).catch((error) => {
              console.warn('SW: Failed to precache:', page, error);
            });
          })
        );
      })
    );
  }

  if (event.data && event.data.type === 'WARM_PAGE') {
    const page = event.data.page;
    if (page) {
      fetch(page).then((response) => {
        if (response && response.status === 200) {
          return caches.open(CACHE_NAME).then((cache) => {
            return cache.put(page, response.clone());
          });
        }
      }).catch((error) => {
        console.warn('SW: Failed to warm page:', page, error);
      });
    }
  }
});

console.log('SW: Enhanced mobile service worker v3 loaded');
