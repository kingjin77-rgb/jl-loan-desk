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
import { evaluate } from './eligibility.js';

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
 * 최종 금리 = 기본금리 − 적용되는 우대금리 합, 단 하한(rateFloor) 미만으로는 못 내려간다.
 * @returns {{final:number|null, base:number|null, discounts:Array, floorApplied:boolean, reason?:string}}
 */
export function productRate(variant, ctx) {
  const b = baseRate(variant, ctx);
  if (b.rate == null) return { final: null, base: null, discounts: [], floorApplied: false, reason: b.reason };

  const discounts = [];
  for (const d of variant.rateDiscounts ?? []) {
    if (d.value == null) {
      discounts.push({ ...d, applied: false, unknown: true, note: '우대폭이 설정되지 않았습니다' });
      continue;
    }
    const ok = d.condition ? evaluate(d.condition, ctx).eligible : true;
    discounts.push({ id: d.id, label: d.label ?? d.id, value: d.value, applied: ok });
  }

  const total = discounts.filter((d) => d.applied).reduce((s, d) => s + d.value, 0);
  let final = b.rate - total;

  const floor = variant.rateFloor;
  const floorApplied = floor != null && final < floor;
  if (floorApplied) final = floor;

  return {
    final,
    base: b.rate,
    band: b.band,
    term: b.term,
    totalDiscount: b.rate - final,
    discounts,
    floorApplied,
    floor,
  };
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
      why: `상품 LTV ${formatPct(variant.limit.ltvOverride, 0)} × ${formatKRW(houseValue)}`,
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
