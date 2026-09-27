/**
 * 부트스트랩 + 전체 배선.
 *
 * 흐름: manifest 로드 → store 생성 → store 변경 시 derive() → 화면 다시 그리기.
 * 계산은 즉시 돌아야 한다(상담 중이다). 입력 한 글자마다 전체를 다시 그리되,
 * 포커스와 커서 위치는 보존한다.
 */

import { loadAll, loadComplex, parseComplexFile } from './data/loader.js';
import { createStore } from './state/store.js';
import { defaultInput } from './state/defaults.js';
import { derive } from './state/derive.js';
import { toRecord, fromRecord, compareConfig } from './core/record.js';
import * as storage from './io/storage.js';
import { download, readFile, safeFilename } from './io/transfer.js';
import { el, $, replace, select, panel as panelOf } from './ui/dom.js';
import { complexPanel, borrowerPanel, collateralPanel, productPanel, schedulePanel, consultationPanel, eligibilityPanel } from './ui/panels.js';
import {
  summaryStrip, scriptPanel, limitPanel, scenarioPanel, schedulePanelResult,
  timelinePanel, fundsPanel, warningsPanel, errorsPanel,
} from './ui/results.js';
import { productsPanel } from './ui/result-products.js';
import { openComplexEditor } from './ui/complex-editor.js';
import * as complexStore from './io/complex-store.js';
import { expandYearMonth } from './core/dates.js';
import { formatKRW } from './core/money.js';
import { DISCLAIMER_SHORT, DISCLAIMER_FULL } from './ui/disclaimer.js';

const ui = {
  monthlySchedule: false,
  bannerOpen: false,
  eligibilityOpen: false,
  tab: 'input',        // 모바일 전용: input | result
  toolsOpen: false,
  // 모바일에서 기본으로 접어 둘 패널. 자주 안 여는 것부터.
  // 모바일에서 기본으로 접어 둘 패널. 결과 탭이 4,000px 를 넘지 않게.
  collapsed: {
    'panel-consultation': true,
    'result-schedule': true,
    'result-scenarios': true,
    'result-timeline': true,
    'disclaimer': true,
  },
};

function isMobile() { return window.matchMedia('(max-width:760px)').matches; }

/**
 * 홈 화면 설치.
 *
 * 안드로이드/크롬은 beforeinstallprompt 를 주므로 버튼 한 번으로 설치된다.
 * iOS 사파리는 그 이벤트가 없어 "공유 → 홈 화면에 추가" 를 안내하는 수밖에 없다.
 */
const install = { event: null, dismissed: false };
let online = navigator.onLine;

// 규제 수치 도구에서 오프라인은 "낡은 값일 수 있음"을 뜻한다. 반드시 보여야 한다.
window.addEventListener('online', () => { online = true; render(); });
window.addEventListener('offline', () => { online = false; render(); });

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  install.event = e;
  render();
});
window.addEventListener('appinstalled', () => {
  install.event = null;
  render();
});

async function doInstall() {
  if (!install.event) return;
  install.event.prompt();
  await install.event.userChoice;
  install.event = null;
  render();
}

/** 설치 안내 줄. 이미 앱으로 열렸거나 닫았으면 안 보인다. */
function installBar() {
  if (isStandalone() || install.dismissed) return null;
  if (!install.event && !isIOS()) return null;

  const close = el('button.detail-toggle', {
    type: 'button', text: '닫기',
    onClick: () => { install.dismissed = true; render(); },
  });

  if (install.event) {
    return el('div.banner.install', {}, [
      el('span.msg', { text: '홈 화면에 설치하면 매번 주소를 열지 않아도 됩니다.' }),
      el('button.btn.sm.primary', { type: 'button', text: '설치', onClick: doInstall }),
      close,
    ]);
  }
  // iOS
  return el('div.banner.install', {}, [
    el('span.msg', { text: '홈 화면에 추가: 아래 공유 버튼 → "홈 화면에 추가"' }),
    close,
  ]);
}
function collapsedOf(id, fallback = false) { return ui.collapsed[id] ?? fallback; }

/** 모바일에서만 접기를 켠다. 데스크톱 상담 데스크는 다 보이는 편이 낫다. */
function fold(id, defaultCollapsed = false) {
  if (!isMobile()) return {};
  return {
    collapsible: true,
    collapsed: collapsedOf(id, defaultCollapsed),
    onToggle: () => toggleCollapse(id, defaultCollapsed),
  };
}
/**
 * 접기 토글.
 * ★ 기본값을 함께 받아야 한다. 안 받으면 "기본 접힘" 패널을 눌렀을 때
 *   현재 상태를 false 로 잘못 읽어 다시 접힌 상태가 되어, 영영 펴지지 않는다.
 */
function toggleCollapse(id, defaultCollapsed = false) {
  ui.collapsed[id] = !collapsedOf(id, defaultCollapsed);
  render();
}
let ctx = null;
let store = null;
/** 단지에서 자동으로 채운 값들 — "되돌리기"의 원본 */
let autoValues = {};
let currentRecordId = null;
let myComplexes = [];

function refreshMyComplexes() {
  myComplexes = complexStore.isAvailable() ? complexStore.list() : [];
}

boot();

async function boot() {
  const root = $('#app');
  try {
    const loaded = await loadAll(localStorage.getItem('jl-loan-desk.profile') || null);
    ctx = { ...loaded, complexDoc: null, origins: {} };
  } catch (e) {
    replace(root, [fatal(e)]);
    return;
  }

  refreshMyComplexes();
  store = createStore(defaultInput());
  store.subscribe(() => render());
  render();
}

function fatal(e) {
  return el('div', { style: 'padding:32px;max-width:720px;margin:0 auto' }, [
    el('h1', { text: '설정을 불러오지 못했습니다' }),
    el('div.callout.danger', { style: 'margin-top:16px' }, [
      el('div.script', {}, String(e.message).split('\n').map((l) => el('p', { text: l }))),
    ]),
  ]);
}

// ───────────────────────────── 렌더 ─────────────────────────────

function render() {
  const active = document.activeElement;
  const focusKey = active?.id || null;
  const selStart = active?.selectionStart ?? null;

  const input = store.get();
  let result;
  try {
    result = derive(input, ctx.policies, { products: ctx.products });
  } catch (e) {
    replace($('#app'), [fatal(e)]);
    return;
  }

  const hasErrors = result.errors.length > 0;

  const app = el('div.app', {}, [
    topbar(result),
    ...banners(),
    installBar(),
    hasErrors ? null : summaryStrip(result),
    el('div.main', {}, [
      el('div.rail', {}, [
        borrowerPanel({ store, errors: result.errors, autoValues }),
        collateralPanel({ store, ctx, errors: result.errors, autoValues }),
        productPanel({ store }),
        complexPanel({
          store, ctx,
          mine: myComplexes,
          ...fold('panel-complex', true),
          onEditComplex: editComplex,
          onExportComplexes: exportComplexes,
          onPickComplex: pickComplex,
          onImportComplex: importComplexFile,
          onClearComplex: clearComplex,
          onTypeChange: changeType,
          onConversionPreset: (d) => store.set('schedule.conversionDate', d),
        }),
        eligibilityPanel({
          store,
          open: ui.eligibilityOpen,
          onToggle: (v) => { ui.eligibilityOpen = v; render(); },
        }),
        schedulePanel({ store }),
        consultationPanel({ store, ...fold('panel-consultation', true) }),
      ].filter(Boolean)),

      el('div.results', {}, [
        errorsPanel(result.errors),
        hasErrors ? null : scriptPanel(result),
        hasErrors ? null : limitPanel(result),
        hasErrors ? null : productsPanel(result),
        hasErrors ? null : fundsPanel(result),
        hasErrors ? null : timelinePanel(result, fold('result-timeline', true)),
        hasErrors ? null : scenarioPanel(result, fold('result-scenarios', true)),
        hasErrors ? null : schedulePanelResult(result, {
          monthly: ui.monthlySchedule,
          onToggle: (v) => { ui.monthlySchedule = v; render(); },
          fold: fold('result-schedule', true),
        }),
        warningsPanel(result),
        disclaimerPanel(),
      ].filter(Boolean)),
    ]),
    el('footer.foot', {}, [
      el('div', { text: 'JL 대출데스크 · 법무법인 제이엘' }),
      el('div.tiny', { text: DISCLAIMER_SHORT }),
    ]),
    printFooter(result),
    tabbar(result),
  ].filter(Boolean));

  document.body.dataset.tab = ui.tab;
  document.body.dataset.tools = ui.toolsOpen ? 'open' : 'closed';
  document.body.dataset.banner = ui.bannerOpen ? 'open' : 'closed';

  replace($('#app'), [app]);

  if (focusKey) {
    const next = document.getElementById(focusKey);
    if (next) {
      next.focus();
      if (selStart != null && next.setSelectionRange && next.type === 'text') {
        try { next.setSelectionRange(selStart, selStart); } catch { /* number 입력 등은 무시 */ }
      }
    }
  }
}

// ───────────────────────────── 상단 ─────────────────────────────

function topbar(result) {
  return el('header.topbar', {}, [
    el('div.brand', {}, [
      el('span.dot'),
      el('span', {}, ['JL 대출데스크 ', el('span.sub', { text: '법무법인 제이엘' })]),
    ]),
    el('div.spacer'),
    el('button.btn.sm.tools-toggle', {
      type: 'button',
      text: ui.toolsOpen ? '닫기' : '메뉴',
      'aria-expanded': String(ui.toolsOpen),
      onClick: () => { ui.toolsOpen = !ui.toolsOpen; render(); },
    }),
    el('div.tools', {}, [
      select(
        ctx.profiles.map((p) => ({ value: p.key, label: p.label })),
        ctx.profileName,
        switchProfile,
        { title: '규제 수치 설정 세트' }
      ),
      el('button.btn.sm', { type: 'button', text: '저장', onClick: () => saveRecord(result) }),
      el('button.btn.sm', { type: 'button', text: '불러오기', onClick: openRecords }),
      el('button.btn.sm', { type: 'button', text: '내보내기', onClick: () => exportRecord(result) }),
      el('label.btn.sm', {}, ['파일 열기', el('input', {
        type: 'file', accept: '.json', class: 'sr-only',
        onChange: (e) => { const f = e.target.files?.[0]; if (f) importRecordFile(f); e.target.value = ''; },
      })]),
      el('button.btn.sm.primary', { type: 'button', text: '인쇄', onClick: () => window.print() }),
      el('button.btn.sm.danger', { type: 'button', text: '새 상담', onClick: resetAll }),
    ]),
  ]);
}

function banners() {
  const out = [];
  const t = ctx.trust;

  if (t.demo.length) {
    out.push(el('div.banner.danger', {}, [
      el('span.msg', {}, [
        el('b', { text: '⚠ 데모 수치 — 실제 상담 사용 금지. ' }),
        `LTV·DSR·방공제 등 ${t.demo.length}개 설정이 가상의 값입니다.`,
      ]),
      bannerToggle(),
    ]));
  } else if (t.unverified.length) {
    out.push(el('div.banner.warn', {}, [
      el('span.msg', {}, [
        el('b', { text: '미검증 설정값 사용 중. ' }),
        `${t.unverified.join(', ')} 의 수치가 아직 원문으로 확인되지 않았습니다.`,
      ]),
      bannerToggle(),
    ]));
  }

  if (ctx.productWarnings?.length) {
    out.push(el('div.banner.warn', {}, [
      el('b', { text: '상품 설정을 일부 읽지 못했습니다. ' }),
      el('ul', {}, ctx.productWarnings.map((w) => el('li', { text: w }))),
    ]));
  }

  if (ctx.unset.length) {
    out.push(el('div.banner.danger', {}, [
      el('b', { text: '비어 있는 설정값이 있어 한도가 정확하지 않습니다. ' }),
      el('ul', {}, ctx.unset.map((u) => el('li', { text: `${u.file} — ${u.path}: ${u.why}` }))),
    ]));
  }

  if (!online) {
    out.push(el('div.banner.warn', {}, [
      el('span.msg', {}, [
        el('b', { text: '오프라인입니다. ' }),
        `기기에 저장된 설정(기준일 ${ctx.trust.oldest ?? '-'})으로 계산 중이며, 그 사이 규정이 바뀌었을 수 있습니다.`,
      ]),
    ]));
  }

  out.push(el('div.banner.info', {}, [
    el('span.msg', { text: `설정 기준일 ${ctx.trust.oldest ?? '-'} · 프로파일 「${ctx.profileLabel}」` }),
    ui.bannerOpen ? el('ul', {}, Object.entries(ctx.policies).map(([k, p]) =>
      el('li', { text: `${k}: 기준일 ${p.meta?.기준일 ?? '-'} · 출처 ${p.meta?.출처 || '(없음)'} · ${p.meta?.verified ? '검수완료' : '미검증'}` })
    )) : null,
  ].filter(Boolean)));

  return out;
}

/**
 * 모바일 하단 탭바.
 * 결과 탭에는 결론(부족자금/한도)을 배지로 붙여, 입력 중에도 상태가 보이게 한다.
 */
function tabbar(result) {
  const hasProblem = result.janggeum ? result.janggeum.shortfall > 0
    : result.limit.requestedAmount != null ? !result.limit.isSufficient : false;

  const tab = (key, ico, label, badge) => el('button', {
    type: 'button',
    'aria-selected': String(ui.tab === key),
    onClick: () => { ui.tab = key; window.scrollTo(0, 0); render(); },
  }, [
    el('span.ico', { text: ico }),
    el('span', { text: label }),
    badge ? el('span.dot') : null,
  ].filter(Boolean));

  return el('nav.tabbar', { 'aria-label': '화면 전환' }, [
    tab('input', '⌨', '입력', false),
    tab('result', '▤', '결과', hasProblem),
  ]);
}

function bannerToggle() {
  return el('button.detail-toggle', {
    type: 'button',
    text: ui.bannerOpen ? '접기' : '자세히',
    onClick: () => { ui.bannerOpen = !ui.bannerOpen; render(); },
  });
}

function disclaimerPanel() {
  return panelOf('면책 고지', [
    el('div.script.small.muted', {}, DISCLAIMER_FULL.map((p) => el('p', { text: p }))),
  ], { id: 'disclaimer', ...fold('disclaimer', true) });
}

function printFooter(result) {
  return el('div.print-footer', {}, [
    el('div', { text: DISCLAIMER_SHORT }),
    el('div', { text: `설정 기준일 ${ctx.trust.oldest ?? '-'} · 프로파일 ${ctx.profileLabel}${ctx.trust.demo.length ? ' · ⚠ 데모 수치' : ''}` }),
    el('div', { text: `출력 ${new Date().toLocaleString('ko-KR')} · 법무법인 제이엘` }),
  ]);
}

// ───────────────────────────── 단지 ─────────────────────────────

async function pickComplex(complexId) {
  // 내가 만든 단지가 우선이다 — 같은 이름이면 내 것을 쓴다.
  const own = complexStore.isAvailable() ? complexStore.get(complexId) : null;
  if (own) { applyComplex(own); return; }

  const entry = ctx.complexIndex.complexes.find((c) => c.complexId === complexId);
  if (!entry) return;
  try {
    const doc = await loadComplex(entry, ctx.policies);
    applyComplex(doc);
  } catch (e) {
    alert(e.message);
  }
}

/** 단지 만들기 / 수정. */
function editComplex(complexId) {
  if (!complexStore.isAvailable()) {
    alert('이 브라우저에서는 단지를 저장할 수 없습니다(시크릿 모드이거나 저장이 차단되어 있습니다).\n' +
          '다른 브라우저에서 만든 뒤 "파일 열기"로 불러와 쓰십시오.');
    return;
  }
  const doc = complexId ? complexStore.get(complexId) : null;
  openComplexEditor({
    doc,
    policies: ctx.policies,
    onSave: (built) => {
      try {
        complexStore.save(built);
        refreshMyComplexes();
        applyComplex(built);
      } catch (e) {
        alert(e.message);
      }
    },
  });
}

function exportComplexes() {
  const bundle = complexStore.exportAll();
  if (!bundle.complexes.length) { alert('내보낼 단지가 없습니다.'); return; }
  download(`단지-${bundle.complexes.length}건.json`, bundle);
}

async function importComplexFile(file) {
  const text = await readFile(file);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    alert(`${file.name}: JSON 형식이 잘못되었습니다.\n${e.message}`);
    return;
  }

  // 여러 단지 묶음이면 보관함에 담는다
  if (Array.isArray(parsed?.complexes)) {
    try {
      const r = complexStore.importBundle(parsed);
      refreshMyComplexes();
      render();
      alert(`단지 ${r.added + r.replaced}건을 불러왔습니다.` +
            (r.replaced ? ` (${r.replaced}건은 기존 것을 덮어썼습니다)` : '') +
            `\n${r.names.join(', ')}`);
    } catch (e) {
      alert(e.message);
    }
    return;
  }

  // 단일 단지 파일
  try {
    const doc = parseComplexFile(text, file.name, ctx.policies);
    if (complexStore.isAvailable()) {
      complexStore.save(doc);
      refreshMyComplexes();
    }
    applyComplex(doc);
  } catch (e) {
    alert(e.message);
  }
}

function applyComplex(doc) {
  ctx.complexDoc = doc;
  const type = doc.unitTypes[0];
  const floor = type.priceByFloor[0];
  const moveIn = doc.moveIn;
  const conversion = expandYearMonth(moveIn?.입주지정기간?.start ?? moveIn?.예정시기);
  const 중도금은행 = (doc.groupLoanBanks ?? []).find((b) => b.kind === '중도금');
  const 잔금은행 = (doc.groupLoanBanks ?? []).find((b) => b.kind === '잔금');

  const total = priceOf(floor, true, true);

  autoValues = {
    'borrower.regionGrade': doc.location.regionGrade,
    'collateral.bangongjeRegion': doc.location.bangongjeRegion,
    'collateral.basis': '분양가',
    'collateral.amount': total,
    'collateral.areaSqm': type.전용면적,
    'schedule.enabled': true,
    'schedule.complexId': doc.complexId,
    'schedule.complexName': doc.name,
    'schedule.typeId': type.typeId,
    'schedule.floorBand': floor.floorBand,
    'schedule.includeExpansion': true,
    'schedule.includeOptions': true,
    'schedule.salePrice': floor.분양가,
    'schedule.totalPrice': total,
    'schedule.paymentSchedule': doc.paymentSchedule,
    'schedule.moveIn': moveIn,
    'schedule.conversionDate': conversion,
    'schedule.jungdogeumRatio': 중도금은행?.ratio ?? 0.6,
    'schedule.jungdogeumRatioCap': 중도금은행?.ratio ?? null,
    'schedule.jungdogeumRate': 중도금은행?.rate?.annualRate ?? 0.045,
    'schedule.interestMode': doc.paymentSchedule?.중도금?.interestMode ?? 중도금은행?.interestMode ?? '후불제',
    'schedule.extras': doc.extras ?? {},
  };
  if (잔금은행?.rate?.annualRate) autoValues['product.annualRate'] = 잔금은행.rate.annualRate;

  const skipped = store.applyAuto(autoValues);
  if (skipped.length) {
    // 상담사가 이미 고친 값은 덮어쓰지 않았다는 사실을 알려준다.
    console.info('단지값으로 덮어쓰지 않은 항목(직접 수정됨):', skipped);
  }
}

function changeType(patch) {
  const s = store.get().schedule;
  const doc = ctx.complexDoc;
  if (!doc) return;

  const typeId = patch.typeId ?? s.typeId;
  const type = doc.unitTypes.find((t) => t.typeId === typeId) ?? doc.unitTypes[0];
  const floorBand = patch.typeId ? type.priceByFloor[0].floorBand : (patch.floorBand ?? s.floorBand);
  const floor = type.priceByFloor.find((f) => f.floorBand === floorBand) ?? type.priceByFloor[0];

  const includeExpansion = patch.includeExpansion ?? s.includeExpansion;
  const includeOptions = patch.includeOptions ?? s.includeOptions;
  const total = priceOf(floor, includeExpansion, includeOptions);

  // 타입·층·옵션은 상담사가 직접 고른 것이므로 manual 로 쓴다.
  store.set('schedule.typeId', type.typeId);
  store.set('schedule.floorBand', floor.floorBand);
  store.set('schedule.includeExpansion', includeExpansion);
  store.set('schedule.includeOptions', includeOptions);
  store.set('schedule.salePrice', floor.분양가);
  store.set('schedule.totalPrice', total);
  store.set('collateral.areaSqm', type.전용면적);

  // 담보가액은 "단지가 채운 값"의 성격이므로 autoValues 를 갱신하고 auto 로 시도한다.
  autoValues['collateral.amount'] = total;
  autoValues['schedule.totalPrice'] = total;
  if (!store.setAuto('collateral.amount', total)) {
    // 상담사가 담보가액을 직접 고쳐 둔 경우 — 덮어쓰지 않고 "수정됨" 칩만 남는다.
  }
  render();
}

function priceOf(floor, expansion, options) {
  return (floor.분양가 ?? 0) + (expansion ? floor.발코니확장 ?? 0 : 0) + (options ? floor.옵션 ?? 0 : 0);
}

function clearComplex() {
  ctx.complexDoc = null;
  autoValues = {};
  store.set('schedule', { ...defaultInput().schedule });
  store.set('schedule.enabled', false);
}

// ───────────────────────────── 기록 ─────────────────────────────

function saveRecord(result) {
  if (!storage.isAvailable()) {
    alert('이 브라우저에서는 저장 기능을 쓸 수 없습니다(시크릿 모드이거나 저장이 차단되어 있습니다).\n"내보내기"로 파일로 저장하십시오.');
    return;
  }
  const input = store.get();
  if (!input.consultation.clientAlias) {
    if (!confirm('고객 표기가 비어 있습니다. 그대로 저장할까요?')) return;
  }
  try {
    const rec = toRecord({ ...input, recordId: currentRecordId }, result, { ...ctx, origins: store.origins });
    const saved = storage.save(rec);
    currentRecordId = saved.recordId;
    alert(`저장했습니다: ${saved.title}\n이 기록은 이 PC의 브라우저에만 저장됩니다.`);
  } catch (e) {
    alert(e.message);
  }
}

function openRecords() {
  const records = storage.list();
  const dlg = el('dialog', {}, [
    el('div.body', {}, [
      el('h2', { text: `저장된 상담 (${records.length}건)` }),
      el('p.tiny.faint', { text: '이 PC의 브라우저에만 저장된 기록입니다. 다른 PC에서는 보이지 않습니다.', style: 'margin:4px 0 12px' }),
      records.length
        ? el('div.rows', {}, records.map((r) => el('div.callout', { style: 'display:flex;gap:8px;align-items:center' }, [
            el('div', { style: 'flex:1' }, [
              el('div', {}, [el('b', { text: r.title })]),
              el('div.tiny.faint', { text: `${(r.updatedAt ?? '').slice(0, 16).replace('T', ' ')} · ${r.resultSnapshot ? formatKRW(r.resultSnapshot.finalAmount) : '-'} · 기준 ${r.configVersions?.policies?.ltv?.기준일 ?? '-'}` }),
            ]),
            el('button.btn.sm', { type: 'button', text: '열기', onClick: () => { dlg.close(); loadRecord(r); } }),
            el('button.btn.sm.danger', { type: 'button', text: '삭제', onClick: (e) => { storage.remove(r.recordId); e.target.closest('.callout').remove(); } }),
          ])))
        : el('p.muted', { text: '저장된 상담이 없습니다.' }),
    ]),
    el('footer', {}, [
      el('button.btn.danger', { type: 'button', text: '이 PC의 상담기록 전체 삭제', onClick: () => {
        if (confirm('이 PC에 저장된 상담기록을 전부 삭제합니다. 되돌릴 수 없습니다.\n계속할까요?')) {
          storage.clearAll();
          dlg.close();
          alert('삭제했습니다.');
        }
      } }),
      el('button.btn', { type: 'button', text: '닫기', onClick: () => dlg.close() }),
    ]),
  ]);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

function loadRecord(record) {
  try {
    const { input, origins } = fromRecord(record);
    store.load(input, origins);
    currentRecordId = record.recordId;
    autoValues = {};

    const diffs = compareConfig(record, ctx);
    if (diffs.length) {
      alert(
        `이 상담은 저장 당시의 규정으로 계산되었습니다. 현재 설정과 다음이 다릅니다:\n\n` +
        diffs.map((d) => `· ${d}`).join('\n') +
        `\n\n화면의 숫자는 지금 설정으로 다시 계산된 값입니다.`
      );
    }
  } catch (e) {
    alert(e.message);
  }
}

function exportRecord(result) {
  const input = store.get();
  const rec = toRecord({ ...input, recordId: currentRecordId }, result, { ...ctx, origins: store.origins });
  download(`${safeFilename(rec.title)}.json`, rec);
}

async function importRecordFile(file) {
  try {
    const rec = JSON.parse(await readFile(file));
    loadRecord(rec);
  } catch (e) {
    alert(`상담기록 파일을 읽지 못했습니다.\n${e.message}`);
  }
}

function resetAll() {
  if (!confirm('입력을 모두 지우고 새 상담을 시작합니다. 계속할까요?')) return;
  store.reset();
  ctx.complexDoc = null;
  autoValues = {};
  currentRecordId = null;
}

async function switchProfile(key) {
  try {
    const loaded = await loadAll(key);
    ctx = { ...loaded, complexDoc: ctx.complexDoc, origins: ctx.origins };
    localStorage.setItem('jl-loan-desk.profile', key);
    render();
  } catch (e) {
    alert(e.message);
  }
}
