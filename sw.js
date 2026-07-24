// ============================================================
// Service Worker — 热气球大冒险
// 策略：
//   • HTML 文档 → network-first（保证用户拿到最新页面，离线时回退缓存）
//   • 静态资源 → cache-first（快速加载，SW 更新时自动清理旧缓存）
// 更新资源后只需改 CACHE 版本号，旧缓存会在 activate 阶段被清除。
// ============================================================

const CACHE = 'balloon-v2';

// 预缓存：核心资源（安装时即缓存，保证离线可用）
const PRECACHE = [
  './',
  'index.html',
  'game.js',
  'manifest.webmanifest',
  'assets/gif_color_hotAirBalloon.gif',
  'assets/single_fence.png',
  'assets/square_box.png',
  'assets/square_color.gif',
  'assets/apple-touch-icon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png'
];

// 安装：预缓存核心资源
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

// 激活：清除旧版本缓存并接管客户端
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k !== CACHE; })
              .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

// 请求拦截：按资源类型分流
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  var url = new URL(e.request.url);
  // 只处理同源请求，跨域资源直接放行
  if (url.origin !== self.location.origin) return;

  var isHTML = e.request.mode === 'navigate' ||
               url.pathname.endsWith('.html') ||
               url.pathname === '/';

  if (isHTML) {
    // network-first：优先拿最新 HTML，失败时回退缓存
    e.respondWith(
      fetch(e.request)
        .then(function (resp) {
          var cp = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, cp); });
          return resp;
        })
        .catch(function () {
          return caches.match(e.request).then(function (r) {
            return r || caches.match('./');
          });
        })
    );
  } else {
    // cache-first：静态资源优先用缓存，缓存未命中时走网络并缓存
    e.respondWith(
      caches.match(e.request).then(function (r) {
        if (r) return r;
        return fetch(e.request).then(function (resp) {
          var cp = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, cp); });
          return resp;
        }).catch(function () { return caches.match('./'); });
      })
    );
  }
});
