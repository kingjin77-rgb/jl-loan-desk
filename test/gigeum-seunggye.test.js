/**
 * ★ 기금대출 승계 — 상담일지 숫자를 그대로 재현해야 한다.
 *
 * 분양전환 기금승계는 타입으로 한도가 정해져 있고, 상담일지에 월 상환액이
 * 6개 적혀 있다. "기금 + 대출조건은 정확해야 한다"는 요구를 이 테스트가 고정한다.
 * **실제 상품 파일**(data/products/gigeum-seunggye.*.json)을 읽어 엔진에 넣는다 —
 * 파일의 금리·만기·거치 어느 하나가 바뀌어도 여기서 깨진다.
 *
 * 상담일지는 백원 단위로 올림해 적었다(128,333 → 128,400).
 */
import { test, assert } from './env.js';
import { amortize, METHODS } from '../src/core/amortize.js';
import { ceilTo } from '../src/core/money.js';
import { flattenProducts } from '../src/core/products.js';
import { derive } from '../src/state/derive.js';
import { POLICIES, baseInput } from './fixtures/policies.js';
import 상품 from '../data/products/gigeum-seunggye.2026-09-28.json' with { type: 'json' };

const 문서 = {
  '51·59': { 원금: 55_000_000, 거치중이자: 128_400, 거치1년: 311_400, 거치3년: 339_200 },
  '74·84': { 원금: 75_000_000, 거치중이자: 175_000, 거치1년: 424_600, 거치3년: 462_500 },
};

const variants = flattenProducts([상품]);
const byType = (t) => variants.find((v) => v.eligibility.or[0].value.includes(t));

for (const [group, 기대] of Object.entries(문서)) {
  test(`★ 상담일지 ${group}타입: 거치중 이자 · 1년거치 · 3년거치 6개 숫자 재현`, () => {
    const v = byType(group.split('·')[0]);
    assert.ok(v, `${group} 타입의 variant 가 있어야 한다`);
    assert.equal(v.limit.max, 기대.원금, '한도가 상담일지와 다르다');

    const rate = v.rateTable.matrix[0][0];
    const term = v.fixedTermYears * 12;
    assert.equal(term, 240, '총 만기 20년');

    for (const [months, key] of [[12, '거치1년'], [36, '거치3년']]) {
      const r = amortize({ principal: 기대.원금, annualRate: rate, termMonths: term, graceMonths: months, method: METHODS.EQUAL_TOTAL });
      assert.equal(ceilTo(r.firstPayment, 100), 기대.거치중이자, `${group} 거치중 월이자`);
      assert.equal(ceilTo(r.maxPaymentAfterGrace ?? r.monthlyPayment, 100), 기대[key], `${group} ${key} 원리금`);
    }
  });
}

test('거치 선택지는 1년·3년뿐이고 만기는 20년 고정', () => {
  for (const v of variants) {
    assert.deepEqual(v.graceOptions.map((g) => g.months), [12, 36]);
    assert.equal(v.fixedTermYears, 20);
    assert.deepEqual(v.repaymentMethods, ['원리금균등']);
  }
});

/* ── 타입 → 한도, 그리고 "기본 제안" ── */

const 입력 = (over = {}) => {
  const i = baseInput();
  i.borrower.annualIncome = 50_000_000;
  i.collateral.amount = 275_000_000;
  i.conversion = { ...i.conversion, enabled: true, 분양가: 275_000_000, 납입보증금: 170_000_000, 타입: '84', ...over };
  return i;
};

test('★ 타입 84 → 기금승계 7,500만원이 자동으로 기본 제안된다', () => {
  const r = derive(입력(), POLICIES, { products: [상품] });
  assert.equal(r.limit.selectedProduct?.productId, 'gigeum-seunggye');
  assert.equal(r.limit.selectedProduct.auto, true, '자동 선택임을 남긴다');
  assert.equal(r.limit.caps.find((c) => c.id === 'PRODUCT').amount, 75_000_000);
  assert.equal(r.paymentRate.termMonths, 240, '만기 20년 고정');
  assert.equal(r.paymentRate.graceMonths, 12, '거치 기본 1년');
});

test('타입 59 → 5,500만원', () => {
  const r = derive(입력({ 타입: '59' }), POLICIES, { products: [상품] });
  assert.equal(r.limit.caps.find((c) => c.id === 'PRODUCT').amount, 55_000_000);
});

test('★ 「기금대출 승계 사용」을 끄면 자동 제안이 물러난다 — 모두가 기금을 쓰는 건 아니다', () => {
  const r = derive(입력({ 기금승계사용: false }), POLICIES, { products: [상품] });
  assert.equal(r.limit.selectedProduct, null);
});

test('상담사가 다른 상품을 고르면 자동 제안은 끼어들지 않는다', () => {
  const i = 입력();
  i.product.selectedVariantId = '없는상품';   // 고른 것이 있으면 자동 아님
  const r = derive(i, POLICIES, { products: [상품] });
  assert.equal(r.limit.selectedProduct, null);
});

test('거치 3년을 고르면 3년거치 상환액으로 갚는다 (상담일지 462,500)', () => {
  const i = 입력();
  i.product.graceMonths = 36;
  const r = derive(i, POLICIES, { products: [상품] });
  assert.equal(r.paymentRate.graceMonths, 36);
  assert.equal(ceilTo(r.payment.maxPaymentAfterGrace ?? r.payment.monthlyPayment, 100), 462_500);
});

test('거치를 엉뚱하게 넣으면(24개월) 상품 선택지의 첫 값으로 돌아간다', () => {
  const i = 입력();
  i.product.graceMonths = 24;
  const r = derive(i, POLICIES, { products: [상품] });
  assert.equal(r.paymentRate.graceMonths, 12);
});

test('타입 없이 면적만 있으면 면적으로 보조 판정한다', () => {
  const i = 입력({ 타입: null });
  i.collateral.areaSqm = 84;
  i.product.selectedVariantId = 'gigeum-seunggye-84';
  const r = derive(i, POLICIES, { products: [상품] });
  assert.equal(r.limit.selectedProduct.eligible, true);
});
