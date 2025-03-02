const CACHE_NAME = 'wyzwanie2025-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Otwarto pamięć podręczną');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Zwróć z pamięci podręcznej, jeśli istnieje
                if (response) {
                    return response;
                }
                
                return fetch(event.request)
                    .then(response => {
                        // Sprawdź, czy jest to zasób, który powinniśmy zapisać w pamięci podręcznej
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        // Sklonuj odpowiedź, ponieważ jest to strumień jednorazowego użytku
                        const responseToCache = response.clone();
                        
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });
                            
                        return response;
                    })
                    .catch(() => {
                        // Jeśli jesteśmy offline, można zwrócić zapasową stronę
                        return new Response('Jesteś offline. Niektóre funkcje mogą być niedostępne.');
                    });
            })
    );
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Obsługa powiadomień push
self.addEventListener('push', event => {
    const data = event.data.json();
    const options = {
        body: data.body,
        icon: data.icon || '/icon-192x192.png',
        badge: '/badge-72x72.png',
        data: {
            url: data.url || '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Obsługa kliknięcia w powiadomienie
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});

// Synchronizacja w tle
self.addEventListener('sync', event => {
    if (event.tag === 'sync-activities') {
        event.waitUntil(syncActivities());
    }
});

// Funkcja do synchronizacji danych
async function syncActivities() {
    // Tu można umieścić kod do synchronizacji aktywności ze Strava
    // gdy użytkownik jest ponownie online
    console.log('Synchronizacja aktywności w tle');
}
