/**
 * 서비스 워커 — 설치형 앱으로 쓰기 위한 최소 구성.
 *
 * 목표는 두 가지뿐이다:
 *  1) 홈 화면 아이콘으로 열리게 한다(설치 가능 조건 충족)
 *  2) 현장에서 통신이 끊겨도 계산은 되게 한다
 *
 * ★ 캐시 전략은 "네트워크 우선, 실패하면 캐시"다.
 *   규제 수치(JSON)가 바뀌었는데 낡은 캐시를 보여주면 틀린 한도가 나간다.
 *   그건 오프라인 지원보다 훨씬 위험하므로, 온라인이면 항상 새 파일을 쓴다.
 */

// SHELL 목록이나 소스가 바뀌면 이 번호를 올린다 — 낡은 프리캐시를 비우고 새로 담는다.
// (평소에는 네트워크 우선이라 온라인 사용자는 항상 최신 파일을 받는다. 이 번호는
//  오프라인용으로 미리 담아 둔 묶음을 갈아 끼우기 위한 것이다.)
const VERSION = 'jl-loan-desk-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/tokens.css',
  './assets/css/base.css',
  './assets/css/layout.css',
  './assets/css/components.css',
  './assets/css/tables.css',
  './assets/css/charts.css',
  './assets/css/mobile.css',
  './assets/css/print.css',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',

  // 소스 모듈 — 하나라도 빠지면 오프라인에서 앱이 뜨지 않는다
  './src/core/amortize.js',
  './src/core/bangongje.js',
  './src/core/cap.js',
  './src/core/compare.js',
  './src/core/complex-builder.js',
  './src/core/dates.js',
  './src/core/dsr.js',
  './src/core/eligibility.js',
  './src/core/hangul.js',
  './src/core/invert.js',
  './src/core/janggeum.js',
  './src/core/bunyangjeonhwan.js',
  './src/core/jungdogeum.js',
  './src/core/limit.js',
  './src/core/ltv.js',
  './src/core/money.js',
  './src/core/narrative.js',
  './src/core/products.js',
  './src/core/record.js',
  './src/core/stress.js',
  './src/core/timeline.js',
  './src/data/loader.js',
  './src/data/validate.js',
  './src/io/complex-store.js',
  './src/io/storage.js',
  './src/io/policy-overrides.js',
  './src/io/transfer.js',
  './src/main.js',
  './src/state/defaults.js',
  './src/state/derive.js',
  './src/state/store.js',
  './src/ui/charts.js',
  './src/ui/complex-editor.js',
  './src/ui/policy-editor.js',
  './src/ui/disclaimer.js',
  './src/ui/dom.js',
  './src/ui/fields.js',
  './src/ui/panels.js',
  './src/ui/result-products.js',
  './src/ui/results.js',
];

/**
 * 설정 파일 목록을 manifest 에서 읽어 온다.
 *
 * 이걸 미리 담지 않으면 오프라인에서 앱은 열리는데 **계산이 0원으로 나온다**
 * (규제 수치를 못 읽어서). 그건 오프라인 지원이라고 할 수 없다.
 * 전부 합쳐 수십 KB 라 미리 담아도 부담이 없다.
 */
async function dataFiles() {
  try {
    const res = await fetch('./data/manifest.json', { cache: 'no-store' });
    const m = await res.json();
    const out = ['./data/manifest.json'];
    for (const profile of Object.values(m.profiles ?? {})) {
      for (const path of Object.values(profile.policy ?? {})) out.push('./data/' + path);
      for (const path of profile.products ?? []) out.push('./data/' + path);
    }
    if (m.complexes) out.push('./data/' + m.complexes);
    return out;
  } catch {
    return ['./data/manifest.json'];
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    const urls = [...SHELL, ...(await dataFiles())];
    // 하나가 실패해도 설치가 통째로 실패하지 않게 개별로 담는다
    await Promise.allSettled(urls.map((u) => c.add(u)));
    // 소스 모듈은 목록으로 관리하기 번거로워 런타임 캐시에 맡긴다
    // (첫 온라인 실행에서 fetch 핸들러가 담는다)
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // CDN 폰트 등은 건드리지 않는다

  e.respondWith(
    fetch(req)
      .then((res) => {
        // 정상 응답만 캐시에 갱신해 둔다
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        // 네비게이션이면 앱 껍데기라도 돌려준다
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw new Error('오프라인이고 캐시에도 없습니다: ' + url.pathname);
      })
  );
});

// 화면에서 "새로고침" 을 눌렀을 때 즉시 갱신
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
