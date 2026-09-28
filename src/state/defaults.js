/**
 * 빈 상담의 초기값.
 *
 * 규제 수치는 하나도 들어 있지 않다. 여기 있는 것은 "상담사가 보통 이 값에서
 * 시작한다"는 작업 편의 기본값뿐이다(금리·만기 등). 규제값은 전부 data/policy 에서 온다.
 */

import { today } from '../core/dates.js';

export function defaultInput() {
  return {
    consultation: {
      consultant: '',
      clientAlias: '',
      date: today(),
      memo: '',
    },

    borrower: {
      annualIncome: 0,
      spouseIncome: 0,
      combineSpouse: false,
      ownedHouses: 0,
      isFirstTime: false,
      regionGrade: '비규제',
      stressRegion: '수도권',
      existingDebts: [],

      // ── 정책자금 자격판정용. 일반 주담대 상담에서는 건드릴 일이 없으므로
      //    화면에서는 접힌 패널에 둔다.
      netAssets: 0,
      age: null,
      isNewlywed: false,
      newbornWithinMonths: null,
      hasSubscriptionAccount: false,
      children: 0,
    },

    collateral: {
      basis: '분양가',
      amount: 0,
      bangongjeRegion: '그밖의지역',
      roomCount: 1,
      mci: false,
      mcg: false,
      areaSqm: null,
    },

    product: {
      purpose: '구입',
      loanKind: '주택담보',   // 주택담보 | 전세 — 상품 후보를 가르는 축
      lenderTier: '은행권',
      annualRate: 0.042,
      rateType: '변동',
      termMonths: 360,
      method: '원리금균등',
      graceMonths: 0,
      requestedAmount: null,
      useRequestedForPayment: false,
      // 비교표에서 「이 상품으로 계산」을 누른 상품. 고르면 그 상품의 한도·LTV·DTI 가
      // 최종 한도에 들어간다. 규제 LTV 가 비어 있어도 이 경로로는 한도가 나온다.
      selectedVariantId: null,
      manualCap: null,
      manualCapNote: '',
      firstPaymentDate: null,
      scenarioDeltas: [0, 0.005, 0.01, 0.015],
    },

    // 전세자금대출은 담보가 아니라 임차보증금 기준으로 한도를 잡는다.
    lease: {
      deposit: 0,
      areaSqm: null,
    },

    // ── 분양전환 (민간임대 → 분양전환).
    //    일반 매매와 계산 구조가 다르다: 필요자금 = 분양가 − 납입보증금 + 보증금대출 − 본인준비금,
    //    그리고 남은 잔금을 10년 뒤로 미루는 「잔금유예(분할납부)」가 있다.
    conversion: {
      enabled: false,
      분양가: 0,
      납입보증금: 0,
      보증금대출: 0,
      본인준비금: 0,
      타입: null,              // '51' | '59' | '74' | '84' — 최소 잔금유예금·기금승계 한도가 갈린다
      기금승계사용: true,      // 타입을 고르면 기금승계를 기본 제안. 끄면 다른 상품으로.
      계약일: today(),
      청산일: null,
      분할납부액: null,        // null = 가능한 최대
      잔금유예금리: null,      // 정책 파일에 없으면 상담사가 확인해 입력
      일부상환: [],            // [{ date, amount }] — 100만원 단위
      // LH 저소득층 검증 요건
      가구원수: null,
      월소득: 0,
      자산가액: 0,
      자동차가액: 0,
      국가유공자: false,
    },

    schedule: {
      enabled: false,
      complexId: null,
      complexName: null,
      typeId: null,
      floorBand: null,
      includeExpansion: true,
      includeOptions: true,
      salePrice: 0,
      totalPrice: 0,
      paymentSchedule: null,
      conversionDate: null,
      moveIn: null,
      jungdogeumRatio: 0.6,
      jungdogeumRatioCap: 0.6,
      jungdogeumRate: 0.045,
      interestMode: '후불제',
      ownFunds: 0,
      extras: { 취득세율: null, '중개·법무비추정': 0, 선수관리비: 0, 기타: 0 },
    },
  };
}

export const OPTIONS = {
  regionGrade: ['투기과열', '조정대상', '비규제'],
  ownedHouses: [
    { value: '0', label: '무주택' },
    { value: '1', label: '1주택' },
    { value: '다주택', label: '다주택' },
  ],
  purpose: ['구입', '생활안정', '전세반환'],
  lenderTier: ['은행권', '제2금융권'],
  rateType: ['변동', '혼합', '주기형', '고정'],
  method: ['원리금균등', '원금균등'],
  basis: ['분양가', 'KB시세', '감정가'],
  stressRegion: ['수도권', '비수도권'],
  interestMode: ['후불제', '이자납부', '무이자'],
  debtKind: ['신용대출', '마이너스통장', '주택담보대출', '전세자금대출', '기타담보대출'],
  loanKind: [
    { value: '주택담보', label: '주택 구입·담보' },
    { value: '전세', label: '전세자금' },
  ],
  termYears: [10, 15, 20, 30, 35, 40, 50],
  전환타입: ['51', '59', '74', '84'],
  가구원수: [3, 4, 5, 6],
};

/** 상품 종류 — 전세는 담보 대신 보증금 경로를 탄다. */
export const PRODUCT_KINDS = { 주택담보: '주택담보', 전세: '전세' };
