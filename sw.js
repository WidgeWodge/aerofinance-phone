// Keeps the app working offline, and receives the summaries the PC pushes.
// The browser decrypts each message before it gets here; only this phone can read it.

const SHELL = 'aerofinance-shell-v4';
const DATA = 'aerofinance-data';
const FILES = ['./', './index.html', './app.js', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('aerofinance-shell-') && n !== SHELL).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// The app's own files: from the cache straight away, refreshed in the background when online.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    const fresh = fetch(event.request).then(res => {
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await fresh) || new Response('Offline', { status: 503 });
  })());
});

const money = (n) => `£${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let snapshot = null;
    try { snapshot = event.data ? event.data.json() : null; } catch { snapshot = null; }
    if (!snapshot || snapshot.v !== 1) return;

    snapshot.receivedAt = new Date().toISOString();
    const cache = await caches.open(DATA);
    await cache.put('./snapshot.json', new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } }));

    // Any open copy of the app redraws straight away.
    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach(client => client.postMessage({ type: 'snapshot' }));

    const bills = (snapshot.bills || []).length;
    const headline = snapshot.safe >= 0 ? `${money(snapshot.weekly)} a week to spend` : `${money(Math.abs(snapshot.safe))} short before payday`;
    const overdue = (snapshot.stmt || []).find(a => a.at && (Date.now() - new Date(a.at).getTime()) / 86400000 > 7);
    // New problems, and the round-up after payday, get a notification of their own that makes
    // a sound. Each is only sent as new once.
    const fresh = (snapshot.al || []).filter(a => a.n).slice(0, 3);
    for (const a of fresh) {
      await self.registration.showNotification(a.t, {
        body: a.x,
        tag: `aerofinance-alert-${a.k}`,
        silent: false,
        icon: 'icon-192.png',
        badge: 'icon-192.png'
      });
    }

    await self.registration.showNotification('Budget updated', {
      body: `${headline} · ${bills} bill${bills === 1 ? '' : 's'} to come${overdue ? ` · ${overdue.n} needs a statement` : ''}`,
      tag: 'aerofinance-update',
      renotify: false,
      silent: true,
      icon: 'icon-192.png',
      badge: 'icon-192.png'
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.length) return windows[0].focus();
    return self.clients.openWindow('./');
  })());
});

// If the browser replaces the link (rare), the PC can't be told from here, so the app
// asks to be linked again next time it's opened.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(caches.open(DATA).then(cache => cache.put('./relink.json', new Response('true'))));
});
