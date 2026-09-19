import { test, assert, assertClose } from './env.js';
import { POLICIES, baseInput, LTV, BANGONGJE, STRESS, DSR } from './fixtures/policies.js';
import { derive } from '../src/state/derive.js';
import { ltvCap, LtvRuleNotFoundError } from '../src/core/ltv.js';
import { bangongjeDeduction, BangongjeRegionError } from '../src/core/bangongje.js';
import { stressedRate } from '../src/core/stress.js';
import { computeLimit } from '../src/core/limit.js';
import { makeCap, CAP_IDS } from '../src/core/cap.js';

// ─────────────────────────────── LTV ───────────────────────────────

test('LTV: 담보가액 × 비율 − 방공제', () => {
  const ded = bangongjeDeduction({ regionKey: '그밖의지역' }, BANGONGJE);
  const cap = ltvCap({
    appraisal: { basis: '분양가', amount: 700_000_000 },
    regionGrade: '비규제', ownedHouses: 0, purpose: '구입',
    deductions: [ded],
  }, LTV);
  // 7억 × 70% = 4.9억, − 방공제 2,500만 = 4.65억
  assertClose(cap.amount, 465_000_000, 1);
  assert.equal(cap.inputs.적용LTV, 0.7);
});

test('LTV: 생애최초 규칙이 일반 규칙보다 우선한다 (조건이 더 구체적)', () => {
  const cap = ltvCap({
    appraisal: { basis: '분양가', amount: 700_000_000 },
    regionGrade: '비규제', ownedHouses: 0, purpose: '구입', isFirstTime: true,
  }, LTV);
  assert.equal(cap.inputs.적용LTV, 0.8, '생애최초 80% 가 적용되어야 한다');
});

test('LTV: 금액 절대상한이 비율 산출액보다 낮으면 상한이 이긴다', () => {
  const cap = ltvCap({
    appraisal: { basis: 'KB시세', amount: 2_000_000_000 },
    regionGrade: '투기과열', ownedHouses: 0, purpose: '구입',
  }, LTV);
  // 20억 × 40% = 8억 이지만 절대상한 6억
  assert.equal(cap.amount, 600_000_000);
  assert.ok(cap.formula.includes('금액상한'));
});

test('LTV: 규칙이 없으면 기본값을 쓰지 않고 예외를 던진다', () => {
  assert.throws(
    () => ltvCap({
      appraisal: { basis: '분양가', amount: 5e8 },
      regionGrade: '조정대상', ownedHouses: 0, purpose: '구입',
    }, LTV),
    LtvRuleNotFoundError,
    '모르는 조합에 조용히 기본값을 쓰면 안 된다'
  );
});

// ────────────────────────────── 방공제 ──────────────────────────────

test('방공제: MCI 가입 시 면제되고 면제 사유가 남는다', () => {
  const d = bangongjeDeduction({ regionKey: '서울특별시', mci: true }, BANGONGJE);
  assert.equal(d.amount, 0);
  assert.equal(d.waived, true);
  assert.ok(d.formula.includes('MCI'));
  assert.ok(d.formula.includes('5,500만원'), '면제 안 했을 때 금액도 보여줘야 한다');
});

test('방공제: 방 수만큼 차감', () => {
  const d = bangongjeDeduction({ regionKey: '그밖의지역', roomCount: 3 }, BANGONGJE);
  assertClose(d.amount, 75_000_000, 1);
});

test('방공제: 모르는 지역이면 0원으로 넘어가지 않고 예외', () => {
  assert.throws(() => bangongjeDeduction({ regionKey: '화성특별시' }, BANGONGJE), BangongjeRegionError);
});

// ───────────────────────── 스트레스 금리 ─────────────────────────

test('스트레스: 3단계 변동금리는 가산폭 100% 적용', () => {
  const s = stressedRate({ contractRate: 0.042, rateType: '변동', region: '수도권' }, STRESS);
  assertClose(s.forDsrOnly, 0.042 + 0.015, 1e-9);
});

test('스트레스: 고정금리는 가산이 없다', () => {
  const s = stressedRate({ contractRate: 0.042, rateType: '고정' }, STRESS);
  assertClose(s.forDsrOnly, 0.042, 1e-9);
  assert.equal(s.applied, false);
});

test('스트레스: 혼합형은 부분 적용', () => {
  const s = stressedRate({ contractRate: 0.042, rateType: '혼합' }, STRESS);
  assertClose(s.addOn, 0.015 * 0.6, 1e-9);
});

test('스트레스: 적용범위 밖의 대출은 가산 없음', () => {
  const s = stressedRate({ contractRate: 0.05, loanType: '신용대출' }, STRESS);
  assert.equal(s.applied, false);
  assertClose(s.forDsrOnly, 0.05, 1e-9);
});

// ─────────────────────────── 합성 ───────────────────────────

test('합성: 최솟값이 선택되고 binding 이 지목된다', () => {
  const r = computeLimit({
    caps: [
      makeCap({ id: CAP_IDS.LTV, label: 'LTV 한도', amount: 465_000_000 }),
      makeCap({ id: CAP_IDS.DSR, label: 'DSR 한도', amount: 380_712_345 }),
    ],
  });
  assert.equal(r.binding.id, CAP_IDS.DSR);
  assert.equal(r.runnerUp.id, CAP_IDS.LTV);
  assert.equal(r.finalAmount, 380_710_000, '만원 단위 절사');
  assertClose(r.slack, 465_000_000 - 380_712_345, 1);
});

test('합성: 미적용 상한(Infinity)은 최솟값 계산에 끼어들지 않는다', () => {
  const r = computeLimit({
    caps: [
      makeCap({ id: CAP_IDS.LTV, label: 'LTV', amount: 400_000_000 }),
      makeCap({ id: CAP_IDS.DTI, label: 'DTI', amount: Infinity, applicable: false }),
    ],
  });
  assert.equal(r.binding.id, CAP_IDS.LTV);
  assert.equal(r.runnerUp, null);
});

test('합성: 적용 가능한 상한이 없으면 0 과 경고', () => {
  const r = computeLimit({ caps: [makeCap({ id: 'X', label: 'X', amount: Infinity, applicable: false })] });
  assert.equal(r.finalAmount, 0);
  assert.ok(r.warnings.length);
});

test('합성: 희망금액과의 차이를 계산한다', () => {
  const r = computeLimit({
    caps: [makeCap({ id: CAP_IDS.LTV, label: 'LTV', amount: 300_000_000 })],
    requestedAmount: 350_000_000,
  });
  assert.equal(r.isSufficient, false);
  assert.equal(r.requestedGap, -50_000_000);
});

test('합성: 1·2순위가 근소하면 경고한다', () => {
  const r = computeLimit({
    caps: [
      makeCap({ id: CAP_IDS.LTV, label: 'LTV', amount: 400_000_000 }),
      makeCap({ id: CAP_IDS.DSR, label: 'DSR', amount: 399_000_000 }),
    ],
  });
  assert.ok(r.warnings.some((w) => w.includes('조건이 바뀝니다')));
});

// ─────────────────────── derive 통합 ───────────────────────

test('derive: 소득이 낮으면 DSR 이 물리고, 높으면 LTV 가 물린다', () => {
  const low = derive(baseInput({ borrower: { annualIncome: 50_000_000 } }), POLICIES);
  assert.equal(low.limit.binding.id, 'DSR');

  const high = derive(baseInput({ borrower: { annualIncome: 300_000_000 } }), POLICIES);
  assert.equal(high.limit.binding.id, 'LTV');
});

test('derive: ★ 월 상환액은 약정금리로, DSR 한도는 스트레스금리로 계산된다', () => {
  const r = derive(baseInput(), POLICIES);
  // 스트레스금리가 약정금리보다 높아야 한다
  assert.ok(r.stress.forDsrOnly > 0.042);
  // 월 상환액은 약정금리 4.2% 기준이어야 한다 (스트레스 5.7% 가 아니라)
  const expectedAtContract = (r.loanAmount * (0.042 / 12)) / (1 - Math.pow(1 + 0.042 / 12, -360));
  assertClose(r.payment.monthlyPayment, expectedAtContract, 2, '월 상환액에 스트레스금리가 섞이면 안 된다');
});

test('derive: 기존 신용대출이 DSR 한도를 줄인다', () => {
  const without = derive(baseInput(), POLICIES);
  const with_ = derive(baseInput({
    borrower: { existingDebts: [{ kind: '신용대출', balance: 50_000_000, rate: 0.06 }] },
  }), POLICIES);
  assert.ok(with_.limit.finalAmount < without.limit.finalAmount);
  assert.equal(with_.limit.binding.id, 'DSR');
});

test('derive: 개선 레버는 실제 재계산 결과다 (기존대출 상환 차액이 맞는다)', () => {
  const input = baseInput({
    borrower: { existingDebts: [{ kind: '신용대출', balance: 50_000_000, rate: 0.06 }] },
  });
  const r = derive(input, POLICIES);
  const lever = r.levers.find((l) => l.id === 'clear-debts');
  assert.ok(lever, '기존대출 상환 레버가 있어야 한다');

  const cleared = derive(baseInput(), POLICIES);
  assertClose(lever.after, cleared.limit.finalAmount, 1, '레버의 after 는 실제 재계산값과 같아야 한다');
  assertClose(lever.delta, cleared.limit.finalAmount - r.limit.finalAmount, 1);
});

test('derive: MCI 레버는 방공제 면제만큼 한도를 늘린다', () => {
  // LTV 가 물리도록 소득을 크게 잡는다
  const input = baseInput({ borrower: { annualIncome: 300_000_000 } });
  const r = derive(input, POLICIES);
  assert.equal(r.limit.binding.id, 'LTV');
  const mci = r.levers.find((l) => l.id === 'mci');
  assert.ok(mci, 'MCI 레버가 있어야 한다');
  assertClose(mci.delta, 25_000_000, 10_000, '방공제 2,500만원만큼');
});

test('derive: 규칙 없는 조합은 계산을 멈추고 errors 에 사유를 남긴다', () => {
  const r = derive(baseInput({ borrower: { regionGrade: '조정대상' } }), POLICIES);
  assert.ok(r.errors.some((e) => e.field === 'ltv'));
  assert.ok(r.errors[0].message.includes('LTV 규칙을 찾을 수 없습니다'));
});

test('derive: 부부합산 소득이 반영된다', () => {
  const single = derive(baseInput({ borrower: { annualIncome: 50_000_000 } }), POLICIES);
  const couple = derive(baseInput({
    borrower: { annualIncome: 50_000_000, spouseIncome: 40_000_000, combineSpouse: true },
  }), POLICIES);
  assert.ok(couple.limit.finalAmount > single.limit.finalAmount);
});

test('derive: 금리 시나리오는 기준 대비 증가분을 낸다', () => {
  const r = derive(baseInput(), POLICIES);
  assert.equal(r.scenarios[0].deltaMonthly, 0);
  assert.ok(r.scenarios[1].deltaMonthly > 0, '+1%p 면 월 상환액이 늘어야 한다');
});

test('derive: 상담사가 읽을 문장이 생성된다', () => {
  const r = derive(baseInput(), POLICIES);
  assert.ok(r.narrative.headline.includes('예상 한도'));
  assert.ok(r.narrative.bindingLine.includes(r.limit.binding.label));
  assert.ok(r.narrative.caveats.some((c) => c.includes('참고용 추정치')));
});
