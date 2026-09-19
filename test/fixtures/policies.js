/**
 * 테스트 전용 고정 설정.
 *
 * ★ data/ 의 실제 설정을 테스트에 쓰지 않는다. 규제 수치가 갱신될 때마다
 *   테스트가 깨지면 아무도 테스트를 안 믿게 된다. 여기 숫자는 계산 검증을
 *   쉽게 하려고 고른 **가상값**이며 어떤 규정과도 무관하다.
 */

const meta = (id) => ({ id, 기준일: '2026-01-01', 출처: '테스트 픽스처', verified: true });

export const LTV = {
  meta: meta('ltv-fixture'),
  rules: [
    { id: '비규제-무주택-구입', when: { regionGrade: '비규제', ownedHouses: 0, purpose: '구입' }, ltv: 0.7 },
    { id: '비규제-무주택-생애최초-구입', when: { regionGrade: '비규제', ownedHouses: 0, isFirstTime: true, purpose: '구입' }, ltv: 0.8 },
    { id: '투기과열-무주택-구입', when: { regionGrade: '투기과열', ownedHouses: 0, purpose: '구입' }, ltv: 0.4, absoluteCap: 600_000_000 },
    { id: '비규제-1주택-구입', when: { regionGrade: '비규제', ownedHouses: 1, purpose: '구입' }, ltv: 0.6 },
  ],
  priceTiers: [],
};

export const BANGONGJE = {
  meta: meta('bangongje-fixture'),
  regions: [
    { key: '서울특별시', 보증금기준: 165_000_000, 최우선변제금: 55_000_000 },
    { key: '그밖의지역', 보증금기준: 75_000_000, 최우선변제금: 25_000_000 },
  ],
  waiverProducts: ['MCI', 'MCG'],
};

export const STRESS = {
  meta: meta('stress-fixture'),
  currentStage: '3단계',
  baseAddOn: 0.015,
  floor: 0.015,
  ceiling: 0.03,
  byRegion: { 수도권: 0.015, 비수도권: 0.0075 },
  appliedRatio: { '1단계': 0.25, '2단계': 0.5, '3단계': 1.0 },
  byRateType: { 변동: 1.0, 혼합: 0.6, 주기형: 0.3, 고정: 0 },
  scope: ['주택담보대출'],
};

export const DSR = {
  meta: meta('dsr-fixture'),
  limits: { 은행권: 0.4, 제2금융권: 0.5 },
  dtiLimits: { 투기과열: 0.4, 조정대상: 0.5, 비규제: null },
  dsrMaturityCapMonths: { 주택담보대출: 360, 신용대출: 120, 기타담보: 120 },
  exemptions: [],
  existingDebtRules: {
    default: { mode: 'amortized', maturityMonths: 120 },
    신용대출: { mode: 'amortized', maturityMonths: 120 },
    마이너스통장: { mode: 'limitAmortized', maturityMonths: 120 },
  },
};

export const REGIONS = { meta: meta('regions-fixture'), grades: ['투기과열', '조정대상', '비규제'] };
export const MCI = { meta: meta('mci-fixture'), MCI: { 세대당건수: 2 }, MCG: { 세대당건수: 2 } };

export const POLICIES = { ltv: LTV, bangongje: BANGONGJE, stress: STRESS, dsr: DSR, regions: REGIONS, mci: MCI };

/** 기본 입력. 테스트마다 필요한 부분만 덮어쓴다. */
export function baseInput(overrides = {}) {
  return deepMerge({
    borrower: {
      annualIncome: 60_000_000,
      spouseIncome: 0,
      combineSpouse: false,
      ownedHouses: 0,
      isFirstTime: false,
      regionGrade: '비규제',
      stressRegion: '수도권',
      existingDebts: [],
    },
    collateral: {
      basis: '분양가',
      amount: 700_000_000,
      bangongjeRegion: '그밖의지역',
      roomCount: 1,
      mci: false,
      mcg: false,
    },
    product: {
      purpose: '구입',
      annualRate: 0.042,
      rateType: '변동',
      termMonths: 360,
      method: '원리금균등',
      graceMonths: 0,
      lenderTier: '은행권',
      requestedAmount: null,
      manualCap: null,
      scenarioDeltas: [0, 0.01],
    },
    schedule: { enabled: false },
  }, overrides);
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])
      ? deepMerge(a[k], v)
      : v;
  }
  return out;
}
