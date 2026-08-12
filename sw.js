/* 筋メシ - Service Worker（オフライン対応） */
const CACHE = 'kinmeshi-v1.3.0';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/presets.js',
  './js/art.js',
  './js/store.js',
  './js/gemini.js',
  './js/suggest.js',
  './js/charts.js',
  './js/ui.js',
  './js/scr-home.js',
  './js/scr-workout.js',
  './js/scr-meals.js',
  './js/scr-calendar.js',
  './js/scr-settings.js',
  './js/app.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API通信はネットワークのみ
  if (url.hostname.endsWith('googleapis.com')) return;
  // 自分のファイルはキャッシュ優先＋裏で更新
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetched = fetch(e.request).then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || fetched;
      })
    );
  }
});
