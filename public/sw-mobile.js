// Enhanced Service Worker for Mobile Instant Loading
const CACHE_NAME = 'whoeverwants-mobile-v2';
const CRITICAL_PAGES = [
  '/',
  '/create-poll',
];

const ASSETS_TO_CACHE = [
  '/',
  '/create-poll',
  '/manifest.json',
];

// Install event - cache critical resources immediately
self.addEventListener('install', (event) => {
  console.log('SW: Installing enhanced mobile service worker');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('SW: Caching critical pages for mobile');
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
  console.log('SW: Activating enhanced mobile service worker');
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        );
      }),
      // Take control immediately
      self.clients.claim()
    ])
  );
});

// Fetch event - serve from cache first for instant loading
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Only handle same-origin requests
  if (url.origin !== location.origin) return;
  
  // Handle page requests with cache-first strategy for instant loading
  if (request.mode === 'navigate' || 
      CRITICAL_PAGES.some(page => url.pathname.startsWith(page))) {
    
    event.respondWith(
      // Try cache first for instant loading
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            console.log('SW: Serving from cache (instant):', url.pathname);
            
            // Fetch in background to update cache
            fetch(request).then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(request, responseClone);
                });
              }
            }).catch(() => {
              // Network failed, cached version is still good
            });
            
            return cachedResponse;
          }
          
          // Not in cache, fetch from network
          console.log('SW: Fetching from network:', url.pathname);
          return fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return networkResponse;
          });
        })
        .catch((error) => {
          console.error('SW: Fetch failed:', error);
          // Return offline page if available
          return caches.match('/');
        })
    );
    return;
  }
  
  // Handle static assets
  if (request.url.includes('/_next/static/') || 
      request.url.includes('.css') || 
      request.url.includes('.js')) {
    
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
      // Warm up page by fetching it
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

console.log('SW: Enhanced mobile service worker loaded');