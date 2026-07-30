/* 极简 Service Worker：仅为满足浏览器 PWA「可安装」判定（需存在 fetch 处理器）。
   不做任何缓存，网络请求全部走浏览器默认行为，避免影响门户正常更新。 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // 故意留空：不调用 respondWith，让请求走默认网络，仅用于满足可安装条件。
});
