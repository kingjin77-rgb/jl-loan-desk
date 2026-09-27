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
import { el, $, replace, select } from './ui/dom.js';
import { complexPanel, borrowerPanel, collateralPanel, productPanel, schedulePanel, consultationPanel, eligibilityPanel } from './ui/panels.js';
import {
  summaryStrip, scriptPanel, limitPanel, scenarioPanel, schedulePanelResult,
  timelinePanel, fundsPanel, warningsPanel, errorsPanel,
} from './ui/results.js';
import { productsPanel } from './ui/result-products.js';
import { expandYearMonth } from './core/dates.js';
import { formatKRW } from './core/money.js';
import { DISCLAIMER_SHORT, DISCLAIMER_FULL } from './ui/disclaimer.js';

const ui = { monthlySchedule: false, bannerOpen: false, eligibilityOpen: false };
let ctx = null;
let store = null;
/** 단지에서 자동으로 채운 값들 — "되돌리기"의 원본 */
let autoValues = {};
let currentRecordId = null;

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
    hasErrors ? null : summaryStrip(result),
    el('div.main', {}, [
      el('div.rail', {}, [
        complexPanel({
          store, ctx,
          onPickComplex: pickComplex,
          onImportComplex: importComplexFile,
          onClearComplex: clearComplex,
          onTypeChange: changeType,
          onConversionPreset: (d) => store.set('schedule.conversionDate', d),
        }),
        borrowerPanel({ store, errors: result.errors, autoValues }),
        collateralPanel({ store, ctx, errors: result.errors, autoValues }),
        productPanel({ store }),
        eligibilityPanel({
          store,
          open: ui.eligibilityOpen,
          onToggle: (v) => { ui.eligibilityOpen = v; render(); },
        }),
        schedulePanel({ store }),
        consultationPanel({ store }),
      ].filter(Boolean)),

      el('div.results', {}, [
        errorsPanel(result.errors),
        hasErrors ? null : scriptPanel(result),
        hasErrors ? null : limitPanel(result),
        hasErrors ? null : productsPanel(result),
        hasErrors ? null : fundsPanel(result),
        hasErrors ? null : timelinePanel(result),
        hasErrors ? null : scenarioPanel(result),
        hasErrors ? null : schedulePanelResult(result, {
          monthly: ui.monthlySchedule,
          onToggle: (v) => { ui.monthlySchedule = v; render(); },
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
  ].filter(Boolean));

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
      el('b', { text: '⚠ 데모 수치로 계산 중입니다 — 실제 상담에 사용하지 마십시오. ' }),
      `LTV·DSR·방공제 등 ${t.demo.length}개 설정이 가상의 값입니다.`,
      bannerToggle(),
    ]));
  } else if (t.unverified.length) {
    out.push(el('div.banner.warn', {}, [
      el('b', { text: '미검증 설정값 사용 중. ' }),
      `${t.unverified.join(', ')} 의 수치가 아직 원문으로 확인되지 않았습니다.`,
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

  out.push(el('div.banner.info', {}, [
    `설정 기준일 ${ctx.trust.oldest ?? '-'} · 프로파일 「${ctx.profileLabel}」`,
    ui.bannerOpen ? el('ul', {}, Object.entries(ctx.policies).map(([k, p]) =>
      el('li', { text: `${k}: 기준일 ${p.meta?.기준일 ?? '-'} · 출처 ${p.meta?.출처 || '(없음)'} · ${p.meta?.verified ? '검수완료' : '미검증'}` })
    )) : null,
  ].filter(Boolean)));

  return out;
}

function bannerToggle() {
  return el('button.detail-toggle', {
    type: 'button',
    text: ui.bannerOpen ? '접기' : '자세히',
    onClick: () => { ui.bannerOpen = !ui.bannerOpen; render(); },
  });
}

function disclaimerPanel() {
  return el('section.panel', { id: 'disclaimer' }, [
    el('header', {}, [el('h2', { text: '면책 고지' })]),
    el('div.body', {}, [
      el('div.script.small.muted', {}, DISCLAIMER_FULL.map((p) => el('p', { text: p }))),
    ]),
  ]);
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
  const entry = ctx.complexIndex.complexes.find((c) => c.complexId === complexId);
  if (!entry) return;
  try {
    const doc = await loadComplex(entry, ctx.policies);
    applyComplex(doc);
  } catch (e) {
    alert(e.message);
  }
}

async function importComplexFile(file) {
  try {
    const doc = parseComplexFile(await readFile(file), file.name, ctx.policies);
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
