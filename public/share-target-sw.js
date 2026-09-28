/*
 * Web Share Target handler (imported into the Workbox-generated service worker).
 * Android Chrome POSTs the shared image to ./share-target; we stash it in Cache
 * Storage on this device and redirect to the app, which picks it up and clears it.
 * Nothing is sent over the network.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll('image').filter((f) => f && typeof f !== 'string');
        const file = files[0];
        if (file) {
          const cache = await caches.open('share-target');
          await cache.put(
            'shared-image',
            new Response(file, {
              headers: {
                'content-type': file.type || 'application/octet-stream',
                'x-filename': encodeURIComponent(file.name || 'shared-image'),
              },
            }),
          );
        }
      } catch (e) {
        /* ignore – the app just opens normally */
      }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })(),
  );
});
