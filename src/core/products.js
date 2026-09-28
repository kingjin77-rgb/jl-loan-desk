/**
 * 정책자금 상품: 금리 산출 + 한도 Cap.
 *
 * 금리표는 보통 (소득구간 × 대출기간) 격자다. 우대금리는 항목별로 붙고, 하한이 있다.
 * 상담사가 "청약통장 0.2%p 빠졌습니다"를 짚을 수 있어야 하므로 **내역을 보존**한다.
 *
 * 순수 함수. 규제 수치를 모른다 — 전부 productDef 로 받는다.
 */

import { won, formatKRW, formatPct } from './money.js';
import { makeCap, CAP_IDS } from './cap.js';
import { evaluate, summarizeFailure } from './eligibility.js';

/**
 * 금리표 조회.
 * rateTable = { incomeBands:[...상한...], termYears:[...], matrix:[[...]] }
 * matrix[소득구간][기간] 순서.
 */
export function baseRate(variant, ctx) {
  const t = variant?.rateTable;
  if (!t || !Array.isArray(t.matrix) || !t.matrix.length) {
    return { rate: null, reason: '금리표가 설정되지 않았습니다' };
  }

  const income = num(readCtx(ctx, t.incomePath ?? 'borrower.annualIncomeCombined'));
  const years = Math.round((num(readCtx(ctx, t.termPath ?? 'product.termMonths')) || 0) / 12);

  const bands = t.incomeBands ?? [];
  let bi = bands.findIndex((cap) => cap == null || income <= cap);
  if (bi < 0) bi = bands.length - 1;
  if (bi < 0) bi = 0;

  const terms = t.termYears ?? [];
  let ti = terms.findIndex((y) => years <= y);
  if (ti < 0) ti = terms.length - 1;
  if (ti < 0) ti = 0;

  const row = t.matrix[Math.min(bi, t.matrix.length - 1)] ?? [];
  const rate = row[Math.min(ti, row.length - 1)];

  if (rate == null) return { rate: null, reason: '해당 소득구간·기간의 금리가 비어 있습니다' };

  return {
    rate,
    band: bands[bi] != null ? `${formatKRW(bands[bi])} 이하` : '상한 없음',
    term: terms[ti] != null ? `${terms[ti]}년` : `${years}년`,
  };
}

/**
 * 최종 금리 = 기본금리 − 우대금리(상한 적용) + 별도조정, 단 하한 미만으로는 못 내려간다.
 *
 * ★ 우대금리에는 **합계 상한**이 있다. 항목을 다 더해서 상한을 넘기면 상한까지만 깎인다.
 *   (디딤돌: 우대 합계 0.5%p, 다자녀 가구는 0.7%p — 상한 자체가 달라진다)
 *   이걸 빼먹으면 우대항목을 많이 체크한 고객의 금리가 실제보다 낮게 나와
 *   월 상환액을 과소 안내하게 된다.
 *
 * ★ 상한 **밖에서** 적용되는 조정이 따로 있다.
 *   (디딤돌: 대상주택이 지방 소재면 0.2%p 인하 — "우대금리와 별개")
 *   그래서 rateAdjustments 는 합계 상한을 거치지 않는다.
 *
 * @returns {{final, base, discounts, adjustments, discountCap, discountCapApplied, floorApplied}}
 */
export function productRate(variant, ctx) {
  const b = baseRate(variant, ctx);
  if (b.rate == null) {
    return { final: null, base: null, discounts: [], adjustments: [], floorApplied: false, reason: b.reason };
  }

  const discounts = [];
  for (const d of variant.rateDiscounts ?? []) {
    if (d.value == null) {
      discounts.push({ ...d, applied: false, unknown: true, note: '우대폭이 설정되지 않았습니다' });
      continue;
    }
    const ok = d.condition ? evaluate(d.condition, ctx).eligible : true;
    discounts.push({ id: d.id, label: d.label ?? d.id, value: d.value, applied: ok });
  }

  const rawDiscount = discounts.filter((d) => d.applied).reduce((s, d) => s + d.value, 0);

  // 상한. discountCapWhen 의 조건을 만족하면 그쪽 상한으로 갈아탄다(더 큰 쪽이 아니라 **조건**이 기준).
  let cap = variant.discountCap ?? null;
  let capLabel = null;
  for (const rule of variant.discountCapWhen ?? []) {
    if (rule.value == null) continue;
    if (rule.condition && !evaluate(rule.condition, ctx).eligible) continue;
    cap = rule.value;
    capLabel = rule.label ?? null;
  }
  const appliedDiscount = cap != null ? Math.min(rawDiscount, cap) : rawDiscount;
  const discountCapApplied = cap != null && rawDiscount > cap;

  // 상한 밖 조정(지방 소재 인하 등). 인하는 음수로 적는다.
  const adjustments = [];
  for (const a of variant.rateAdjustments ?? []) {
    if (a.value == null) {
      adjustments.push({ ...a, applied: false, unknown: true, note: '조정폭이 설정되지 않았습니다' });
      continue;
    }
    const ok = a.condition ? evaluate(a.condition, ctx).eligible : true;
    adjustments.push({ id: a.id, label: a.label ?? a.id, value: a.value, applied: ok });
  }
  const adjTotal = adjustments.filter((a) => a.applied).reduce((s, a) => s + a.value, 0);

  let final = b.rate - appliedDiscount + adjTotal;

  const floor = variant.rateFloor;
  const floorApplied = floor != null && final < floor;
  if (floorApplied) final = floor;

  return {
    final: round6(final),
    base: b.rate,
    band: b.band,
    term: b.term,
    rawDiscount: round6(rawDiscount),
    appliedDiscount: round6(appliedDiscount),
    discountCap: cap,
    discountCapLabel: capLabel,
    discountCapApplied,
    adjustments,
    adjustmentTotal: round6(adjTotal),
    totalDiscount: round6(b.rate - final),
    discounts,
    floorApplied,
    floor,
  };
}

/**
 * 만기별 자격. 같은 상품인데 **만기에 따라 요건이 다른** 경우가 있다.
 *   보금자리론 40년 만기: 만 39세 이하(또는 만 49세 이하 신혼)
 *   보금자리론 50년 만기: 만 34세 이하(또는 만 39세 이하 신혼)
 * 이 고객이 실제로 쓸 수 있는 최장 만기를 돌려준다. 요건을 모르면(null) 막지 않는다.
 *
 * @returns {{maxYears:number|null, blocked:Array<{maxYears, label, reason}>}}
 */
export function termLimit(variant, ctx) {
  const rules = variant.termRules ?? [];
  if (!rules.length) return { maxYears: variant.maxTermYears ?? null, blocked: [] };

  let maxYears = null;
  const blocked = [];
  for (const r of rules) {
    if (r.maxYears == null) continue;
    const res = r.eligibility ? evaluate(r.eligibility, ctx) : { eligible: true, unknown: [] };
    // 모른다고 탈락시키면 상담이 멈춘다 — 나이를 아직 안 물어봤다는 이유로
    // 40·50년 만기를 지워 버리면 안 된다.
    //
    // 다만 "모름"과 "안 됨"을 섞으면 안 된다. or 가지 안에 입력이 없는 항목이
    // 하나 있다는 이유로, 같은 규칙의 다른 항목이 **확실히 미달**인 것을 덮으면
    // 만 37세에게 50년 만기를 열어 주게 된다.
    // 그래서 확정된 실패(입력이 있는데 미달)가 하나라도 있으면 막는다.
    const 확정실패 = (res.failed ?? []).filter((c) => !c.notApplicable && !c.unknown);
    if (res.eligible || 확정실패.length === 0) {
      if (maxYears == null || r.maxYears > maxYears) maxYears = r.maxYears;
    } else {
      blocked.push({
        maxYears: r.maxYears,
        label: r.label ?? `${r.maxYears}년 만기`,
        reason: summarizeFailure({ ...res, failed: 확정실패 }),
      });
    }
  }
  if (maxYears == null) maxYears = variant.maxTermYears ?? null;
  return { maxYears, blocked };
}

function round6(n) {
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n;
}

/**
 * 상품 한도 Cap.
 * 상품마다 최대한도가 있고, LTV/DTI 를 상품 기준으로 덮어쓰는 경우도 있다
 * (예: 기금 상품이 일반 규제보다 높은 LTV 를 허용).
 */
export function productCap(variant, ctx, { houseValue = 0 } = {}) {
  const source = variant.__source ?? null;
  const caps = [];

  if (variant.limit?.max != null) {
    caps.push({ amount: won(variant.limit.max), why: `상품 최대한도 ${formatKRW(variant.limit.max)}` });
  }
  if (variant.limit?.ltvOverride != null && houseValue > 0) {
    caps.push({
      amount: won(houseValue * variant.limit.ltvOverride),
      // ★ 무엇의 70%인지가 상품마다 다르다(디딤돌=공시가격, 보금자리론=분양가).
      //   상담사가 담보가액 칸에 무엇을 넣어야 하는지 알아야 하므로 기준을 같이 적는다.
      why: `상품 LTV ${formatPct(variant.limit.ltvOverride, 0)} × ${variant.limit.ltvBase ?? '담보가액'} ${formatKRW(houseValue)}`,
    });
  }
  if (variant.limit?.depositRatio != null) {
    // 전세자금: 담보가 아니라 보증금 기준
    const deposit = num(readCtx(ctx, 'lease.deposit'));
    if (deposit > 0) {
      caps.push({
        amount: won(deposit * variant.limit.depositRatio),
        why: `보증금 ${formatKRW(deposit)} × ${formatPct(variant.limit.depositRatio, 0)}`,
      });
    }
  }

  if (!caps.length) {
    return makeCap({
      id: CAP_IDS.PRODUCT,
      label: `${variant.name} 한도`,
      amount: Infinity,
      applicable: false,
      formula: '상품 한도가 설정되지 않았습니다 — 이 상태의 한도는 과대계상입니다',
      source,
    });
  }

  const min = caps.reduce((a, b) => (a.amount <= b.amount ? a : b));
  return makeCap({
    id: CAP_IDS.PRODUCT,
    label: `${variant.name} 한도`,
    amount: min.amount,
    formula: caps.length > 1
      ? `${caps.map((c) => c.why).join(' / ')} 중 최소`
      : min.why,
    inputs: { 상품: variant.variantId, 후보: caps },
    source,
  });
}

/** 상품 파일(여러 variant 포함)을 평탄한 후보 목록으로. */
export function flattenProducts(productDocs) {
  const out = [];
  for (const doc of productDocs ?? []) {
    const source = {
      file: doc.meta?.id,
      기준일: doc.meta?.기준일,
      verified: Boolean(doc.meta?.verified),
      demo: Boolean(doc.meta?.demo),
    };
    for (const v of doc.variants ?? []) {
      out.push({
        ...v,
        productId: doc.productId,
        productName: doc.name,
        category: doc.category,
        kind: doc.kind ?? v.kind ?? '주택담보',
        name: v.name ?? doc.name,
        __source: source,
      });
    }
  }
  return out;
}

function readCtx(ctx, path) {
  return String(path).split('.').reduce((n, k) => (n == null ? undefined : n[k]), ctx);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
