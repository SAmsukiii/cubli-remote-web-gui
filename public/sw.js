self.addEventListener('install', (e) => {
  console.log('[Service Worker] 설치 완료');
});

self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request).catch(() => new Response('오프라인 상태입니다.')));
});


