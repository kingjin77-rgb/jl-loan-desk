import { test, assert, assertClose } from './env.js';
import { baseRate, productRate, productCap, flattenProducts } from '../src/core/products.js';
import { compareProducts, bestPick } from '../src/core/compare.js';
import { makeCap, CAP_IDS } from '../src/core/cap.js';

/** 테스트 전용 가상 상품. 어떤 실제 상품과도 무관하다. */
const DOC = {
  meta: { id: 'fixture', 기준일: '2026-01-01', 출처: '픽스처', verified: true },
  productId: 'fix',
  name: '픽스처대출',
  category: '기금',
  variants: [
    {
      variantId: 'fix-basic',
      name: '픽스처 일반',
      eligibility: { and: [
        { path: 'borrower.ownedHouses', op: 'eq', value: 0, label: '무주택' },
        { path: 'borrower.annualIncomeCombined', op: 'lte', value: 60_000_000, label: '소득', unit: '원' },
      ] },
      limit: { max: 250_000_000, ltvOverride: 0.7 },
      rateTable: {
        incomeBands: [30_000_000, 60_000_000, null],
        termYears: [10, 20, 30],
        matrix: [
          [0.020, 0.021, 0.022],
          [0.025, 0.026, 0.027],
          [0.030, 0.031, 0.032],
        ],
      },
      rateDiscounts: [
        { id: 'sub', label: '청약통장', value: 0.002,
          condition: { path: 'borrower.hasSubscriptionAccount', op: 'eq', value: true } },
        { id: 'kids', label: '다자녀', value: 0.005,
          condition: { path: 'borrower.children', op: 'gte', value: 3 } },
      ],
      rateFloor: 0.012,
      maxTermYears: 30,
      repaymentMethods: ['원리금균등', '원금균등'],
    },
    {
      variantId: 'fix-wide',
      name: '픽스처 완화형',
      eligibility: { path: 'borrower.ownedHouses', op: 'eq', value: 0, label: '무주택' },
      limit: { max: 400_000_000 },
      rateTable: { incomeBands: [null], termYears: [30], matrix: [[0.040]] },
      maxTermYears: 30,
    },
  ],
};

const CTX = {
  borrower: {
    ownedHouses: 0,
    annualIncomeCombined: 50_000_000,
    hasSubscriptionAccount: true,
    children: 1,
  },
  product: { termMonths: 360 },
  house: { price: 500_000_000 },
};

// ───────────────────────── 금리표 ─────────────────────────

test('금리표: 소득구간 × 기간으로 조회한다', () => {
  // 소득 5,000만 → 두 번째 구간(6,000만 이하), 30년 → 세 번째 열 → 0.027
  const r = baseRate(DOC.variants[0], CTX);
  assertClose(r.rate, 0.027, 1e-9);
});

test('금리표: 구간 상한이 null 이면 그 위 전부', () => {
  const r = baseRate(DOC.variants[0], { ...CTX, borrower: { ...CTX.borrower, annualIncomeCombined: 900_000_000 } });
  assertClose(r.rate, 0.032, 1e-9);
});

test('금리표: 기간이 표를 넘으면 마지막 열', () => {
  const r = baseRate(DOC.variants[0], { ...CTX, product: { termMonths: 480 } });
  assertClose(r.rate, 0.027, 1e-9);
});

test('금리표: 비어 있으면 null 과 사유', () => {
  const r = baseRate({ rateTable: { matrix: [] } }, CTX);
  assert.equal(r.rate, null);
  assert.ok(r.reason.includes('설정되지 않았'));
});

// ───────────────────────── 우대금리 ─────────────────────────

test('우대금리: 조건이 맞는 것만 적용되고 내역이 남는다', () => {
  const r = productRate(DOC.variants[0], CTX);
  assertClose(r.base, 0.027, 1e-9);
  assertClose(r.final, 0.027 - 0.002, 1e-9, '청약통장만 적용');

  const sub = r.discounts.find((d) => d.id === 'sub');
  const kids = r.discounts.find((d) => d.id === 'kids');
  assert.equal(sub.applied, true);
  assert.equal(kids.applied, false, '자녀 1명이라 다자녀 미적용');
  assert.equal(r.discounts.length, 2, '적용 안 된 항목도 내역에 남는다');
});

test('우대금리: 여러 개가 겹치면 합산된다', () => {
  const ctx = { ...CTX, borrower: { ...CTX.borrower, children: 3 } };
  const r = productRate(DOC.variants[0], ctx);
  assertClose(r.final, 0.027 - 0.002 - 0.005, 1e-9);
  assertClose(r.totalDiscount, 0.007, 1e-9);
});

test('우대금리: 하한 아래로는 내려가지 않는다', () => {
  const v = { ...DOC.variants[0], rateFloor: 0.026 };
  const r = productRate(v, CTX);
  assertClose(r.final, 0.026, 1e-9);
  assert.equal(r.floorApplied, true);
});

test('우대폭이 설정 안 됐으면 적용하지 않고 표시만 한다', () => {
  const v = { ...DOC.variants[0], rateDiscounts: [{ id: 'x', label: '미정', value: null }] };
  const r = productRate(v, CTX);
  assert.equal(r.discounts[0].applied, false);
  assert.equal(r.discounts[0].unknown, true);
  assertClose(r.final, r.base, 1e-9);
});

// ───────────────────────── 상품 한도 ─────────────────────────

test('상품 한도: 최대한도와 LTV 중 작은 쪽', () => {
  const cap = productCap(DOC.variants[0], CTX, { houseValue: 500_000_000 });
  // 최대 2.5억 vs LTV 70% × 5억 = 3.5억 → 2.5억
  assert.equal(cap.amount, 250_000_000);
  assert.ok(cap.formula.includes('최소'));
});

test('상품 한도: 집값이 작으면 LTV 쪽이 물린다', () => {
  const cap = productCap(DOC.variants[0], CTX, { houseValue: 200_000_000 });
  assert.equal(cap.amount, 140_000_000);
});

test('상품 한도: 전세는 보증금 기준으로 계산한다', () => {
  const v = { variantId: 'j', name: '전세픽스처', limit: { depositRatio: 0.8 } };
  const cap = productCap(v, { lease: { deposit: 300_000_000 } }, {});
  assert.equal(cap.amount, 240_000_000);
  assert.ok(cap.formula.includes('보증금'));
});

test('상품 한도: 설정이 없으면 조용히 무제한으로 두지 않고 미적용 + 경고', () => {
  const cap = productCap({ variantId: 'x', name: '빈상품', limit: {} }, CTX, { houseValue: 5e8 });
  assert.equal(cap.applicable, false);
  assert.ok(cap.formula.includes('과대계상'));
});

// ───────────────────────── 평탄화 ─────────────────────────

test('평탄화: variant 마다 한 줄, 출처가 따라붙는다', () => {
  const list = flattenProducts([DOC]);
  assert.equal(list.length, 2);
  assert.equal(list[0].productId, 'fix');
  assert.equal(list[0].__source.기준일, '2026-01-01');
});

// ───────────────────────── 비교 ─────────────────────────

test('비교: 적격이 먼저, 그 안에서는 금리 낮은 순', () => {
  const rows = compareProducts(flattenProducts([DOC]), CTX, { houseValue: 500_000_000, termMonths: 360 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].eligible, true);
  assert.equal(rows[1].eligible, true);
  assert.ok(rows[0].rate < rows[1].rate, '금리 낮은 것이 앞');
  assert.equal(rows[0].variantId, 'fix-basic');
});

test('비교: 부적격은 뒤로 가고 탈락 사유가 붙는다', () => {
  const ctx = { ...CTX, borrower: { ...CTX.borrower, annualIncomeCombined: 90_000_000 } };
  const rows = compareProducts(flattenProducts([DOC]), ctx, { houseValue: 500_000_000 });
  const basic = rows.find((r) => r.variantId === 'fix-basic');
  assert.equal(basic.eligible, false);
  assert.ok(basic.failureSummary.includes('소득'), basic.failureSummary);
  assert.ok(basic.failureSummary.includes('초과'), basic.failureSummary);
  assert.equal(rows[0].variantId, 'fix-wide', '적격 상품이 앞으로');
});

test('비교: 다른 상한(DSR 등)과 함께 최솟값을 취한다', () => {
  const dsr = makeCap({ id: CAP_IDS.DSR, label: 'DSR 한도', amount: 180_000_000 });
  const rows = compareProducts(flattenProducts([DOC]), CTX, {
    houseValue: 500_000_000, otherCaps: [dsr],
  });
  assert.equal(rows[0].amount, 180_000_000);
  assert.equal(rows[0].binding.id, CAP_IDS.DSR, 'DSR 에서 막혔다고 지목해야 한다');
});

test('비교: 상품 최대만기가 짧으면 그쪽을 따른다', () => {
  const short = { ...DOC, variants: [{ ...DOC.variants[1], maxTermYears: 10 }] };
  const rows = compareProducts(flattenProducts([short]), CTX, { houseValue: 5e8, termMonths: 360 });
  assert.equal(rows[0].termMonths, 120);
  assert.equal(rows[0].termCapped, true);
});

test('비교: 월 상환액이 산출된다', () => {
  const rows = compareProducts(flattenProducts([DOC]), CTX, { houseValue: 500_000_000, termMonths: 360 });
  assert.ok(rows[0].monthlyPayment > 0);
  assert.ok(rows[0].totalInterest > 0);
});

test('비교: 금리를 모르는 상품은 맨 뒤로 (싼 상품으로 오해하면 안 된다)', () => {
  const unknown = {
    ...DOC,
    variants: [{ variantId: 'u', name: '미설정', limit: { max: 1e9 }, rateTable: { matrix: [] } }, DOC.variants[1]],
  };
  const rows = compareProducts(flattenProducts([unknown]), CTX, { houseValue: 5e8 });
  assert.equal(rows[rows.length - 1].variantId, 'u');
  assert.equal(rows[rows.length - 1].rate, null);
});

test('추천: 가장 싼 적격 상품과 2순위와의 격차', () => {
  const rows = compareProducts(flattenProducts([DOC]), CTX, { houseValue: 500_000_000, termMonths: 360 });
  const p = bestPick(rows);
  assert.equal(p.row.variantId, 'fix-basic');
  assert.equal(p.runnerUp.variantId, 'fix-wide');
  assert.ok(p.rateGap > 0);
  assert.ok(p.monthlyGap !== null);
});

test('추천: 적격 상품이 없으면 null', () => {
  const ctx = { ...CTX, borrower: { ...CTX.borrower, ownedHouses: 2 } };
  const rows = compareProducts(flattenProducts([DOC]), ctx, { houseValue: 5e8 });
  assert.equal(bestPick(rows), null);
});

// ──────────────── derive 를 통한 통합 ────────────────

import { POLICIES, baseInput } from './fixtures/policies.js';
import { derive } from '../src/state/derive.js';

const PRODUCT_DOCS = [DOC];

test('derive: 상품 문서를 주면 비교 결과가 붙는다', () => {
  const r = derive(baseInput({
    borrower: { annualIncome: 50_000_000 },
    collateral: { amount: 500_000_000, areaSqm: 84.97 },
  }), POLICIES, { products: PRODUCT_DOCS });

  assert.ok(r.products, '상품 비교 결과가 있어야 한다');
  assert.equal(r.products.rows.length, 2);
  assert.ok(r.products.best, '적격 상품이 있으면 추천이 나온다');
});

test('derive: 상품 문서가 없으면 products 는 null (기존 동작 유지)', () => {
  const r = derive(baseInput(), POLICIES);
  assert.equal(r.products, null);
});

test('derive: 상품 한도는 LTV·DSR 과 함께 최솟값을 취한다', () => {
  // 소득을 낮춰 DSR 이 상품 한도보다 낮아지게 한다
  const r = derive(baseInput({
    borrower: { annualIncome: 30_000_000 },
    collateral: { amount: 500_000_000, areaSqm: 84.97 },
  }), POLICIES, { products: PRODUCT_DOCS });

  const row = r.products.rows.find((x) => x.variantId === 'fix-basic');
  assert.ok(row.amount <= 250_000_000, '상품 최대한도를 넘지 않는다');
  assert.ok(row.binding, '무엇이 막았는지 지목한다');
});

test('derive: 자격판정 컨텍스트에 부부합산 소득이 들어간다', () => {
  const r = derive(baseInput({
    borrower: { annualIncome: 40_000_000, spouseIncome: 30_000_000, combineSpouse: true },
    collateral: { amount: 500_000_000, areaSqm: 84.97 },
  }), POLICIES, { products: PRODUCT_DOCS });

  // 합산 7,000만 → fix-basic 의 소득요건 6,000만 초과로 부적격
  const row = r.products.rows.find((x) => x.variantId === 'fix-basic');
  assert.equal(row.eligible, false);
  assert.ok(row.failureSummary.includes('소득'), row.failureSummary);
});

test('derive: 전용면적이 자격판정에 전달된다', () => {
  const area = {
    ...DOC,
    variants: [{
      ...DOC.variants[1],
      eligibility: { path: 'house.areaSqm', op: 'lte', value: 60, label: '전용면적', unit: '㎡' },
    }],
  };
  const r = derive(baseInput({
    collateral: { amount: 500_000_000, areaSqm: 84.97 },
  }), POLICIES, { products: [area] });
  assert.equal(r.products.rows[0].eligible, false);
  assert.ok(r.products.rows[0].failureSummary.includes('전용면적'));
});

test('상환방식: 상품이 지원하지 않는 방식을 고르면 그 상품의 방식으로 계산한다', () => {
  // 전세자금은 만기일시만 지원한다. 원리금균등으로 떨어뜨리면 이자가 크게 과소계상된다.
  const lease = {
    meta: { id: 'lease-fx', 기준일: '2026-01-01', 출처: '픽스처', verified: true },
    productId: 'lease', name: '전세픽스처', category: '기금', kind: '전세',
    variants: [{
      variantId: 'lease-a', name: '전세 일반',
      eligibility: null,
      limit: { max: 120_000_000 },
      rateTable: { incomeBands: [null], termYears: [10], matrix: [[0.027]] },
      maxTermYears: 10,
      repaymentMethods: ['만기일시'],
    }],
  };
  const rows = compareProducts(flattenProducts([lease]), CTX, {
    termMonths: 120, method: '원리금균등',
  });
  const r = rows[0];
  assert.equal(r.method, '만기일시');
  assert.equal(r.methodSwapped, true);
  // 만기일시 10년 총이자 = 1.2억 × 2.7% × 10 = 3,240만원
  assertClose(r.totalInterest, 120_000_000 * 0.027 * 10, 50_000);
  assertClose(r.monthlyPayment, 120_000_000 * 0.027 / 12, 100, '매달 이자만 낸다');
});

test('상환방식: 지원하는 방식이면 그대로 쓴다', () => {
  const rows = compareProducts(flattenProducts([DOC]), CTX, {
    houseValue: 5e8, termMonths: 360, method: '원금균등',
  });
  assert.equal(rows[0].method, '원금균등');
  assert.equal(rows[0].methodSwapped, false);
});
