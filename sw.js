/* 電波がなくても開けるように、アプリのファイルを端末に保存しておく(Service Worker)。
   ネットにつながるときは毎回新しいファイルを取りに行き(更新がすぐ届く)、届かないときだけ保存した分を使う。
   ファイルを足したら FILES にも足す。AI に質問(Worker)など、ほかのサイトへの通信には関わらない */
var CACHE = 'fp3-v3';
var FILES = [
  './', 'index.html', 'style.css', 'app.js', 'questions.js', 'cases.js', 'config.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png'
];
var TIMEOUT_MS = 4000;   // 電波が弱いとき、これだけ待っても届かなければ保存した分を出す

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FILES.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  function fromCache() {
    return caches.match(req, { ignoreSearch: true }).then(function (r) {
      return r || (req.mode === 'navigate' ? caches.match('./') : null);
    });
  }
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function give(r) { if (!done && r) { done = true; resolve(r); } }
    var timer = setTimeout(function () { fromCache().then(give); }, TIMEOUT_MS);
    // HTTP のキャッシュ(GitHub Pages は 10 分)を使わず、毎回サーバーに新しいか確かめる(変わっていなければ 304 で軽い)
    var fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' }) : new Request(req, { cache: 'no-cache' });
    fetch(fresh).then(function (res) {
      clearTimeout(timer);
      if (res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      give(res);
    }).catch(function () {
      clearTimeout(timer);
      fromCache().then(function (r) { give(r || Response.error()); });
    });
  }));
});
