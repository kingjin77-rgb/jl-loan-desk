/**
 * 우대금리 합계 상한 · 상한 밖 조정 · 만기별 요건.
 *
 * 상담일지 「디딤돌」의 세 줄에서 나온 규칙이다:
 *   "대상주택이 지방 소재인 경우 연 0.2%인하 (우대금리와 별개)"
 *   "우대금리 : 상한 0.5% , 다자녀 0.7%"
 * 상한을 빼먹으면 우대항목을 많이 체크한 고객의 금리가 실제보다 낮게 나온다.
 */
import { test, assert } from './env.js';
import { productRate, termLimit } from '../src/core/products.js';

const 디딤돌 = {
  name: '디딤돌 일반',
  rateTable: {
    incomeBands: [20_000_000, 40_000_000, 70_000_000, 85_000_000],
    termYears: [10, 15, 20, 30],
    matrix: [
      [0.0285, 0.0295, 0.0305, 0.0310],
      [0.0320, 0.0330, 0.0340, 0.0345],
      [0.0355, 0.0365, 0.0375, 0.0380],
      [0.0390, 0.0400, 0.0410, 0.0415],
    ],
  },
  rateDiscounts: [
    { id: 'a', label: '청약통장', value: 0.002, condition: { path: 'borrower.hasSubscriptionAccount', op: 'eq', value: true } },
    { id: 'b', label: '생애최초', value: 0.002, condition: { path: 'borrower.isFirstTime', op: 'eq', value: true } },
    { id: 'c', label: '다자녀', value: 0.003, condition: { path: 'borrower.children', op: 'gte', value: 2 } },
    { id: 'd', label: '신혼', value: 0.002, condition: { path: 'borrower.isNewlywed', op: 'eq', value: true } },
  ],
  discountCap: 0.005,
  discountCapWhen: [{ label: '다자녀 상한', value: 0.007, condition: { path: 'borrower.children', op: 'gte', value: 2 } }],
  rateAdjustments: [
    { id: 'nonmetro', label: '지방 소재', value: -0.002, condition: { path: 'house.isMetro', op: 'eq', value: false } },
  ],
};

const ctx = (borrower = {}, house = {}, termMonths = 360) => ({
  borrower: { annualIncomeCombined: 50_000_000, ...borrower },
  house: { isMetro: true, ...house },
  product: { termMonths },
});

test('★ 상담일지 금리표를 그대로 조회한다 (4천~7천, 30년 → 3.80%)', () => {
  const r = productRate(디딤돌, ctx());
  assert.equal(r.base, 0.0380);
  assert.equal(r.final, 0.0380);   // 우대 없음
});

test('금리표 조회: 소득구간과 만기가 모두 반영된다', () => {
  assert.equal(productRate(디딤돌, ctx({ annualIncomeCombined: 18_000_000 }, {}, 120)).base, 0.0285);
  assert.equal(productRate(디딤돌, ctx({ annualIncomeCombined: 80_000_000 }, {}, 360)).base, 0.0415);
  assert.equal(productRate(디딤돌, ctx({ annualIncomeCombined: 30_000_000 }, {}, 240)).base, 0.0340);
});

test('★ 우대금리 합계가 상한(0.5%p)을 넘으면 상한까지만 깎인다', () => {
  // 청약 0.2 + 생애최초 0.2 + 신혼 0.2 = 0.6%p → 0.5%p 로 잘린다
  const r = productRate(디딤돌, ctx({ hasSubscriptionAccount: true, isFirstTime: true, isNewlywed: true }));
  assert.equal(r.rawDiscount, 0.006);
  assert.equal(r.appliedDiscount, 0.005);
  assert.equal(r.discountCapApplied, true);
  assert.equal(r.final, 0.0330);              // 3.80 − 0.50
  // 상한을 빼먹으면 3.20% 가 되어 월 상환액을 과소 안내한다
  assert.notEqual(r.final, 0.0320);
});

test('우대 합계가 상한 안이면 그대로 깎인다', () => {
  const r = productRate(디딤돌, ctx({ hasSubscriptionAccount: true }));
  assert.equal(r.appliedDiscount, 0.002);
  assert.equal(r.discountCapApplied, false);
  assert.equal(r.final, 0.0360);
});

test('★ 다자녀 가구는 상한이 0.7%p 로 올라간다', () => {
  const b = { hasSubscriptionAccount: true, isFirstTime: true, isNewlywed: true, children: 2 };
  const r = productRate(디딤돌, ctx(b));
  assert.equal(r.rawDiscount, 0.009);         // 0.2+0.2+0.3+0.2
  assert.equal(r.appliedDiscount, 0.007);     // 다자녀 상한
  assert.equal(r.discountCap, 0.007);
  assert.equal(r.final, 0.0310);              // 3.80 − 0.70
});

test('★ 지방 소재 0.2%p 인하는 우대금리 상한과 별개로 적용된다', () => {
  const b = { hasSubscriptionAccount: true, isFirstTime: true, isNewlywed: true };  // 상한에 걸림
  const 수도권 = productRate(디딤돌, ctx(b, { isMetro: true }));
  const 지방 = productRate(디딤돌, ctx(b, { isMetro: false }));
  assert.equal(수도권.final, 0.0330);
  assert.equal(지방.final, 0.0310);            // 상한에 걸려 있어도 0.2%p 더 내려간다
  assert.equal(지방.adjustmentTotal, -0.002);
  // 상한 안에 흡수되어 버리면 두 값이 같아진다 — 그게 이 테스트가 막는 것이다
  assert.notEqual(지방.final, 수도권.final);
});

test('우대폭이 비어 있으면 적용하지 않고 그 사실을 남긴다', () => {
  const v = { ...디딤돌, rateDiscounts: [{ id: 'x', label: '청약통장', value: null, condition: { path: 'borrower.hasSubscriptionAccount', op: 'eq', value: true } }] };
  const r = productRate(v, ctx({ hasSubscriptionAccount: true }));
  assert.equal(r.final, 0.0380);
  assert.equal(r.discounts[0].unknown, true);
});

/* ── 만기별 요건 (보금자리론 40·50년) ── */

const 보금자리 = {
  name: '보금자리론',
  maxTermYears: 50,
  termRules: [
    { maxYears: 30, label: '30년 만기' },
    { maxYears: 40, label: '40년 만기', eligibility: { or: [
      { path: 'borrower.age', op: 'lte', value: 39, label: '만 39세 이하' },
      { and: [
        { path: 'borrower.isNewlywed', op: 'eq', value: true, label: '신혼가구' },
        { path: 'borrower.age', op: 'lte', value: 49, label: '만 49세 이하' },
      ] },
    ] } },
    { maxYears: 50, label: '50년 만기', eligibility: { or: [
      { path: 'borrower.age', op: 'lte', value: 34, label: '만 34세 이하' },
      { and: [
        { path: 'borrower.isNewlywed', op: 'eq', value: true, label: '신혼가구' },
        { path: 'borrower.age', op: 'lte', value: 39, label: '만 39세 이하' },
      ] },
    ] } },
  ],
};

test('★ 만기별 나이요건: 만 30세는 50년까지, 만 45세는 30년까지', () => {
  assert.equal(termLimit(보금자리, { borrower: { age: 30 } }).maxYears, 50);
  assert.equal(termLimit(보금자리, { borrower: { age: 37 } }).maxYears, 40);
  assert.equal(termLimit(보금자리, { borrower: { age: 45 } }).maxYears, 30);
});

test('만기별 나이요건: 신혼가구는 한 칸 넓어진다', () => {
  assert.equal(termLimit(보금자리, { borrower: { age: 37, isNewlywed: true } }).maxYears, 50);
  assert.equal(termLimit(보금자리, { borrower: { age: 45, isNewlywed: true } }).maxYears, 40);
});

test('막힌 만기는 이유를 달고 나온다', () => {
  const r = termLimit(보금자리, { borrower: { age: 45 } });
  assert.equal(r.maxYears, 30);
  assert.equal(r.blocked.length, 2);
  assert.match(r.blocked[0].reason, /세/);
});

test('나이를 모르면 막지 않는다 — 모른다고 상담을 멈추면 안 된다', () => {
  const r = termLimit(보금자리, { borrower: {} });
  assert.equal(r.maxYears, 50);
  assert.equal(r.blocked.length, 0);
});

test('만기규칙이 없으면 maxTermYears 를 쓴다', () => {
  assert.equal(termLimit({ maxTermYears: 30 }, {}).maxYears, 30);
});

/**
 * 전세자금대출 경로 — 담보가 아니라 보증금 기준이다.
 *
 * 담보가액이 0인 전세 상담에서 LTV 상한을 같이 min 에 넣으면 한도가 0원이 되고,
 * 화면에 「버팀목 0원 — LTV 한도에서 막힘」이 뜬다. 실제로 그렇게 나왔다.
 */
test('★ 전세 상품에는 LTV 상한을 적용하지 않는다', async () => {
  const { compareProducts } = await import('../src/core/compare.js');
  const { makeCap, CAP_IDS } = await import('../src/core/cap.js');

  const 버팀목 = {
    variantId: 'beotimmok-general', name: '버팀목 일반', kind: '전세',
    eligibility: { and: [{ path: 'borrower.ownedHouses', op: 'eq', value: 0, label: '무주택' }] },
    limit: { max: 200_000_000, depositRatio: 0.8 },
    rateTable: { incomeBands: [null], termYears: [10], matrix: [[0.027]] },
    repaymentMethods: ['만기일시'], maxTermYears: 10,
  };
  const ctx = { borrower: { ownedHouses: 0, annualIncomeCombined: 45_000_000 }, lease: { deposit: 250_000_000 }, product: { termMonths: 120 } };

  // 담보가액 0 → LTV 상한 0원. 이것이 섞이면 한도가 0이 된다.
  const ltv0 = makeCap({ id: CAP_IDS.LTV, label: 'LTV 한도', amount: 0, formula: '담보 없음' });
  const dsr = makeCap({ id: CAP_IDS.DSR, label: 'DSR 한도', amount: 300_000_000, formula: 'DSR' });

  const 잘못 = compareProducts([버팀목], ctx, { houseValue: 0, termMonths: 120, otherCaps: [ltv0, dsr] });
  assert.equal(잘못[0].amount, 0, '이 상태가 버그였다 — LTV 를 섞으면 0원이 된다');

  const 맞음 = compareProducts([버팀목], ctx, { houseValue: 0, termMonths: 120, otherCaps: [dsr] });
  assert.equal(맞음[0].amount, 200_000_000, '보증금 2.5억 × 80% = 2억 과 상품한도 2억 중 최소');
  assert.equal(맞음[0].binding.id, 'PRODUCT');
});

/* ── 생애최초 LTV 는 무조건 80% 가 아니다 ── */
import { resolveLtv } from '../src/core/products.js';

const 생초 = {
  limit: { ltvOverride: 0.8, ltvOverrideWhen: [
    { condition: { or: [
      { path: 'borrower.stressRegion', op: 'eq', value: '수도권' },
      { path: 'borrower.regionGrade', op: 'in', value: ['투기과열', '조정대상'] },
    ] }, value: 0.7, label: '수도권·규제지역' },
  ] },
};

test('★ 생애최초 LTV: 지방·비규제는 80%, 수도권이면 70%, 지방이라도 규제지역이면 70%', () => {
  assert.equal(resolveLtv(생초, { borrower: { stressRegion: '비수도권', regionGrade: '비규제' } }).value, 0.8);
  assert.equal(resolveLtv(생초, { borrower: { stressRegion: '수도권', regionGrade: '비규제' } }).value, 0.7);
  assert.equal(resolveLtv(생초, { borrower: { stressRegion: '비수도권', regionGrade: '조정대상' } }).value, 0.7);
  assert.equal(resolveLtv(생초, { borrower: { stressRegion: '수도권', regionGrade: '비규제' } }).label, '수도권·규제지역');
});

test('조건부 규칙이 없으면 기본 ltvOverride', () => {
  assert.equal(resolveLtv({ limit: { ltvOverride: 0.7 } }, { borrower: {} }).value, 0.7);
  assert.equal(resolveLtv({ limit: {} }, { borrower: {} }).value, null);
});

/* ── 스트레스 금리: 지역별 가산폭과 적용비율이 따로 논다 ── */
import { stressedRate } from '../src/core/stress.js';

const STRESS_2026H2 = {
  meta: { id: 'stress', 기준일: '2026-07-01', verified: false },
  currentStage: '3단계', baseAddOn: 0.015, floor: 0.015, ceiling: 0.03,
  byRegion: { 수도권: 0.03, 비수도권: 0.015 },
  ratioByRegion: { 수도권: 1.0, 비수도권: 0.5 },
  appliedRatio: { '1단계': 0.25, '2단계': 0.5, '3단계': 1.0 },
  byRateType: { 변동: 1.0, 고정: 0 },
  scope: ['주택담보대출'],
};

test('★ 스트레스 DSR: 수도권 3.0%p×100%, 지방 1.5%p×50% (2026년 하반기)', () => {
  const 수도권 = stressedRate({ contractRate: 0.042, region: '수도권' }, STRESS_2026H2);
  const 지방 = stressedRate({ contractRate: 0.042, region: '비수도권' }, STRESS_2026H2);
  assert.equal(Math.round(수도권.forDsrOnly * 1e4) / 1e4, 0.072);    // 4.2 + 3.0
  assert.equal(Math.round(지방.forDsrOnly * 1e4) / 1e4, 0.0495);    // 4.2 + 1.5×50%
  // byRegion 을 적용비율로 잘못 읽으면 수도권에 100%p 가 붙는다 — 그 사고를 막는다
  assert.ok(수도권.addOn <= 0.03, '가산폭이 상한 3.0%p 를 넘을 수 없다');
});

test('스트레스 DSR: ratioByRegion 이 없으면 단계 비율을 쓴다 (기존 동작 유지)', () => {
  const c = { ...STRESS_2026H2, ratioByRegion: undefined };
  const r = stressedRate({ contractRate: 0.04, region: '비수도권' }, c);
  assert.equal(Math.round(r.forDsrOnly * 1e4) / 1e4, 0.055);   // 4.0 + 1.5×100%(3단계)
});

/* ── 규제지역 총액 상한은 규제지역에만 ── */
import { ltvCap } from '../src/core/ltv.js';

const LTV_1015 = {
  meta: { id: 'ltv', 기준일: '2026-09-28', verified: false },
  rules: [
    { id: '조정대상-무주택-구입', when: { regionGrade: '조정대상', ownedHouses: 0, purpose: '구입' }, ltv: 0.4 },
    { id: '비규제-무주택-구입', when: { regionGrade: '비규제', ownedHouses: 0, purpose: '구입' }, ltv: 0.7 },
  ],
  priceTiers: [
    { regionGrades: ['투기과열', '조정대상'], upTo: 1_500_000_000, absoluteCap: 600_000_000 },
    { regionGrades: ['투기과열', '조정대상'], upTo: 2_500_000_000, absoluteCap: 400_000_000 },
    { regionGrades: ['투기과열', '조정대상'], upTo: null, absoluteCap: 200_000_000 },
  ],
};
const 감정 = (v) => ({ amount: v, basis: '분양가' });

test('★ 규제지역 20억 주택: LTV 40% = 8억이지만 총액 상한 4억에 막힌다', () => {
  const c = ltvCap({ appraisal: 감정(2_000_000_000), regionGrade: '조정대상', ownedHouses: 0 }, LTV_1015);
  assert.equal(c.amount, 400_000_000);
});

test('★ 비규제 20억 주택: 총액 상한이 걸리지 않는다 (LTV 70% = 14억)', () => {
  const c = ltvCap({ appraisal: 감정(2_000_000_000), regionGrade: '비규제', ownedHouses: 0 }, LTV_1015);
  assert.equal(c.amount, 1_400_000_000);
});

test('규제지역 10억 주택: 상한 6억보다 LTV 40% = 4억이 먼저 막는다', () => {
  const c = ltvCap({ appraisal: 감정(1_000_000_000), regionGrade: '조정대상', ownedHouses: 0 }, LTV_1015);
  assert.equal(c.amount, 400_000_000);
});
