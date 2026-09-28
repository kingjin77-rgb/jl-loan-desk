/**
 * 「이 상품으로 계산」 — 고른 상품이 최종 한도에 들어간다.
 *
 * 이것이 필요한 이유: 규제 LTV 표(data/policy/ltv.*.json)가 비어 있으면
 * derive() 가 LtvRuleNotFoundError 를 던져 **최종 한도가 아예 안 나왔다**.
 * 그런데 분양전환 상담에서 쓰는 디딤돌·보금자리·기금승계는 상담일지에서 확인된
 * 자기 LTV·DTI 를 갖고 있다. 규제표를 못 채웠다는 이유로 이미 확인된 상품까지
 * 막으면 프로그램을 쓸 수가 없다.
 */
import { test, assert } from './env.js';
import { derive } from '../src/state/derive.js';
import { POLICIES, baseInput } from './fixtures/policies.js';

/** 디딤돌을 닮은 가상 상품. 값은 계산 검증용이며 어떤 규정과도 무관하다. */
const 상품문서 = [{
  meta: { id: 'test-fund', 기준일: '2026-09-28', verified: false },
  productId: 'testfund', name: '시험용 기금', category: '기금', kind: '주택담보',
  variants: [{
    variantId: 'testfund-general', name: '시험용 기금 일반',
    eligibility: { and: [{ path: 'borrower.ownedHouses', op: 'eq', value: 0, label: '무주택' }] },
    limit: { max: 200_000_000, ltvOverride: 0.7, ltvBase: '공시가격', dtiOverride: 0.6 },
    rateTable: { incomeBands: [null], termYears: [30], matrix: [[0.038]] },
    repaymentMethods: ['원리금균등'], maxTermYears: 30,
  }],
}];

/** 규제 LTV 규칙이 비어 있는 설정(= 아직 못 채운 실무 프로파일). */
const LTV빈설정 = {
  ...POLICIES,
  ltv: { ...POLICIES.ltv, rules: (POLICIES.ltv.rules ?? []).map((r) => ({ ...r, ltv: null })) },
};

const 입력 = (over = {}) => {
  const i = baseInput();
  i.borrower.annualIncome = 50_000_000;
  i.borrower.ownedHouses = 0;
  i.collateral.amount = 400_000_000;
  i.collateral.areaSqm = 84;
  i.product.termMonths = 360;
  return { ...i, ...over, product: { ...i.product, ...(over.product ?? {}) } };
};

test('상품을 고르지 않으면 지금까지와 똑같다', () => {
  const r = derive(입력(), POLICIES, { products: 상품문서 });
  assert.equal(r.limit.basis, '규제 기준');
  assert.equal(r.limit.selectedProduct, null);
});

test('★ 상품을 고르면 그 상품의 한도가 최종 한도에 들어간다', () => {
  const r = derive(입력({ product: { selectedVariantId: 'testfund-general' } }), POLICIES, { products: 상품문서 });
  const 상품cap = r.limit.caps.find((c) => c.id === 'PRODUCT');
  assert.ok(상품cap, '상품 Cap 이 caps 에 있어야 한다');
  // 담보 4억 × 70% = 2.8억 vs 상품 최대 2억 → 2억
  assert.equal(상품cap.amount, 200_000_000);
  assert.ok(r.limit.finalAmount <= 200_000_000, '최종 한도가 상품 한도를 넘을 수 없다');
  assert.equal(r.limit.selectedProduct.name, '시험용 기금 일반');
});

test('★ 상품 DTI(60%)가 별도 상한으로 선다 — 지금까지 죽은 값이었다', () => {
  const r = derive(입력({ product: { selectedVariantId: 'testfund-general' } }), POLICIES, { products: 상품문서 });
  const dti = r.limit.caps.filter((c) => c.id === 'DTI');
  const 상품dti = dti.find((c) => /시험용 기금/.test(c.label));
  assert.ok(상품dti, '상품 DTI 상한이 있어야 한다 (label 에 상품명이 붙는다)');
  assert.equal(상품dti.inputs.한도율, 0.6);
  assert.equal(상품dti.inputs.한도율출처, '시험용 기금 일반');
});

test('★ 규제 LTV 가 비어 있어도 고른 상품으로 한도가 나온다', () => {
  const 안고름 = derive(입력(), LTV빈설정, { products: 상품문서 });
  assert.ok(안고름.errors.some((e) => e.field === 'ltv'), '규제 LTV 오류는 그대로 난다');
  assert.equal(안고름.limit.basis, '규제 기준');

  const 고름 = derive(입력({ product: { selectedVariantId: 'testfund-general' } }), LTV빈설정, { products: 상품문서 });
  assert.equal(고름.limit.basis, '상품 기준');
  assert.ok(고름.limit.finalAmount > 0, '상품 기준이면 한도가 0 이 아니어야 한다');
  assert.ok(고름.limit.finalAmount <= 200_000_000);
});

test('★ 상품 기준일 때 무엇이 빠졌는지 남긴다 — 과대계상 가능성을 숨기지 않는다', () => {
  const r = derive(입력({ product: { selectedVariantId: 'testfund-general' } }), LTV빈설정, { products: 상품문서 });
  assert.ok(r.limit.missingRegulation.includes('LTV(규제)'));
  assert.ok(r.limit.missingRegulation.length >= 1);
});

test('없는 상품 id 를 고르면 조용히 무시한다 (저장된 상담을 나중에 열 때)', () => {
  const r = derive(입력({ product: { selectedVariantId: '없는상품' } }), POLICIES, { products: 상품문서 });
  assert.equal(r.limit.selectedProduct, null);
  assert.ok(r.limit.finalAmount > 0);
});

test('★ 상품을 고르면 그 상품 금리로 월 상환액을 낸다', () => {
  const 기본 = derive(입력(), POLICIES, { products: 상품문서 });
  assert.equal(기본.paymentRate.source, '화면의 약정금리');

  const 고름 = derive(입력({ product: { selectedVariantId: 'testfund-general' } }), POLICIES, { products: 상품문서 });
  assert.equal(고름.paymentRate.rate, 0.038, '상품 금리표의 3.8% 를 써야 한다');
  assert.equal(고름.paymentRate.source, '시험용 기금 일반 상품 금리표');
  // 「디딤돌 기준」이라 해놓고 화면의 약정금리로 계산하면 상담사가 틀린 금액을 부른다
  assert.notEqual(고름.payment.monthlyPayment, 기본.payment.monthlyPayment);
});

test('상품 만기가 더 짧으면 그 만기로 갚는다', () => {
  const 짧은상품 = [{
    ...상품문서[0],
    variants: [{ ...상품문서[0].variants[0], maxTermYears: 20,
      rateTable: { incomeBands: [null], termYears: [20], matrix: [[0.038]] } }],
  }];
  const r = derive(입력({ product: { selectedVariantId: 'testfund-general' } }), POLICIES, { products: 짧은상품 });
  assert.equal(r.paymentRate.termMonths, 240);
  assert.equal(r.limit.selectedProduct.termCapped, true);
});
