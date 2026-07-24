// ============================================================
// Service Worker — 热气球大冒险
// 策略：
//   • HTML 文档 → network-first（保证用户拿到最新页面，离线时回退缓存）
//   • 静态资源(game.js/图片) → stale-while-revalidate
//     （先秒开缓存，后台静默拉取最新并刷新缓存；用户下次刷新必定拿到新版，无需手动 bump 版本号）
// CACHE 版本号仅用于隔离不同大版本的缓存。
// ============================================================

const CACHE = 'balloon-v3';

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
    // stale-while-revalidate：先返回缓存（秒开），同时后台静默拉取最新版本并刷新缓存
    e.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(e.request).then(function (cached) {
          var network = fetch(e.request).then(function (resp) {
            if (resp && resp.status === 200) cache.put(e.request, resp.clone());
            return resp;
          }).catch(function () { return cached; });
          return cached || network;
        });
      })
    );
  }
});
