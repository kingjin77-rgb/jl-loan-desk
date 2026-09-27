/**
 * 입력 폼 값 → 단지 JSON.
 *
 * 상담사가 입주자모집공고를 보면서 **보이는 대로 치면** 단지 데이터가 만들어져야 한다.
 * 회차 날짜를 여섯 번 일일이 찍게 하지 않고 "1회차 날짜 + 간격 개월"로 펼친다.
 *
 * 순수 함수. 저장·화면과 무관하며, 결과는 validateComplex 를 통과해야 한다.
 */

import { addMonths, expandYearMonth, today } from './dates.js';
import { won } from './money.js';

/** 폼 기본값. 흔한 조건(계약금 10 / 중도금 6회 60 / 잔금 30)을 미리 넣어 둔다. */
export function emptyForm() {
  return {
    name: '',
    sido: '',
    sigungu: '',
    address: '',
    regionGrade: '비규제',
    bangongjeRegion: '그밖의지역',

    moveInStart: '',
    moveInEnd: '',

    types: [{ typeId: '84A', areaSqm: 84.97, price: 0, expansion: 0, option: 0 }],

    contractRatio: 0.10,
    contractDate: '',

    roundCount: 6,
    roundRatio: 0.10,
    firstRoundDate: '',
    roundIntervalMonths: 4,

    balanceRatio: 0.30,

    jungdogeumRatio: 0.60,
    jungdogeumRate: 0.045,
    interestMode: '후불제',
    jungdogeumBank: '',

    acquisitionTaxRate: 0.011,
    legalFee: 0,
    prepaidMgmt: 0,

    note: '',
    author: '',
    sourceDoc: '',
  };
}

/** 중도금 회차를 날짜까지 펼친다. */
export function expandRounds({ roundCount, roundRatio, firstRoundDate, roundIntervalMonths }) {
  const n = Math.max(0, Math.round(roundCount) || 0);
  const rounds = [];
  for (let i = 0; i < n; i++) {
    rounds.push({
      seq: i + 1,
      ratio: Number(roundRatio) || 0,
      date: firstRoundDate ? addMonths(firstRoundDate, i * (Number(roundIntervalMonths) || 0)) : null,
    });
  }
  return rounds;
}

/** 비율 합계 점검. 폼에서 즉시 보여 주기 위한 것. */
export function ratioCheck(form) {
  const 계약 = Number(form.contractRatio) || 0;
  const 중도 = (Number(form.roundRatio) || 0) * (Math.round(form.roundCount) || 0);
  const 잔금 = Number(form.balanceRatio) || 0;
  const total = 계약 + 중도 + 잔금;
  return {
    계약, 중도, 잔금, total,
    ok: Math.abs(total - 1) <= 0.001,
    message: Math.abs(total - 1) <= 0.001
      ? `합계 100% ✓`
      : `합계 ${(total * 100).toFixed(1)}% — 계약금 ${(계약 * 100).toFixed(0)}% + 중도금 ${(중도 * 100).toFixed(0)}% + 잔금 ${(잔금 * 100).toFixed(0)}%`,
  };
}

/** 폼 → 단지 JSON. */
export function buildComplexDoc(form) {
  const id = slugify(form.name) || `danji-${Date.now().toString(36)}`;
  const start = expandYearMonth(form.moveInStart);
  const end = form.moveInEnd ? expandYearMonth(form.moveInEnd, { endOfMonth: true }) : null;

  const unitTypes = (form.types ?? [])
    .filter((t) => t.typeId && Number(t.price) > 0)
    .map((t) => ({
      typeId: String(t.typeId).trim(),
      전용면적: Number(t.areaSqm) || null,
      세대수: Number(t.units) || 0,
      priceByFloor: [{
        floorBand: '기준층',
        분양가: won(t.price),
        발코니확장: won(t.expansion),
        옵션: won(t.option),
      }],
    }));

  const rounds = expandRounds(form);

  return {
    schemaVersion: 1,
    meta: {
      기준일: today(),
      출처: form.sourceDoc || '앱에서 직접 입력',
      출처URL: '',
      작성자: form.author || '',
      verified: false,
      비고: form.note || '',
      직접입력: true,
    },
    complexId: id,
    name: form.name,
    location: {
      sido: form.sido || '',
      sigungu: form.sigungu || '',
      address: form.address || [form.sido, form.sigungu].filter(Boolean).join(' '),
      regionGrade: form.regionGrade,
      bangongjeRegion: form.bangongjeRegion,
    },
    developer: { 시행사: '', 시공사: '', 신탁사: '' },
    groupLoanBanks: [
      {
        kind: '중도금',
        bank: form.jungdogeumBank || '',
        ratio: Number(form.jungdogeumRatio) || 0,
        rate: { type: '변동', annualRate: Number(form.jungdogeumRate) || 0 },
        interestMode: form.interestMode,
      },
    ],
    moveIn: {
      예정시기: form.moveInStart || '',
      입주지정기간: { start, end: end ?? start },
    },
    unitTypes,
    paymentSchedule: {
      계약금: { ratio: Number(form.contractRatio) || 0, date: form.contractDate || null },
      중도금: {
        회차수: rounds.length,
        ratioPerRound: Number(form.roundRatio) || 0,
        loanEligible: true,
        interestMode: form.interestMode,
        rounds,
      },
      잔금: { ratio: Number(form.balanceRatio) || 0, date: null, note: '입주지정기간 내 납부' },
    },
    extras: {
      취득세율: Number(form.acquisitionTaxRate) || null,
      '중개·법무비추정': won(form.legalFee),
      선수관리비: won(form.prepaidMgmt),
      기타: 0,
    },
    분양전환: null,
  };
}

/** 저장된 단지 JSON → 폼 (수정용). */
export function docToForm(doc) {
  const f = emptyForm();
  const 중 = doc.paymentSchedule?.중도금 ?? {};
  const rounds = 중.rounds ?? [];
  const bank = (doc.groupLoanBanks ?? []).find((b) => b.kind === '중도금') ?? {};

  return {
    ...f,
    name: doc.name ?? '',
    sido: doc.location?.sido ?? '',
    sigungu: doc.location?.sigungu ?? '',
    address: doc.location?.address ?? '',
    regionGrade: doc.location?.regionGrade ?? '비규제',
    bangongjeRegion: doc.location?.bangongjeRegion ?? '그밖의지역',
    moveInStart: doc.moveIn?.입주지정기간?.start ?? doc.moveIn?.예정시기 ?? '',
    moveInEnd: doc.moveIn?.입주지정기간?.end ?? '',
    types: (doc.unitTypes ?? []).map((t) => {
      const p = t.priceByFloor?.[0] ?? {};
      return {
        typeId: t.typeId, areaSqm: t.전용면적, units: t.세대수,
        price: p.분양가 ?? 0, expansion: p.발코니확장 ?? 0, option: p.옵션 ?? 0,
      };
    }),
    contractRatio: doc.paymentSchedule?.계약금?.ratio ?? 0.1,
    contractDate: doc.paymentSchedule?.계약금?.date ?? '',
    roundCount: rounds.length || 중.회차수 || 0,
    roundRatio: 중.ratioPerRound ?? rounds[0]?.ratio ?? 0.1,
    firstRoundDate: rounds[0]?.date ?? '',
    roundIntervalMonths: guessInterval(rounds),
    balanceRatio: doc.paymentSchedule?.잔금?.ratio ?? 0.3,
    jungdogeumRatio: bank.ratio ?? 0.6,
    jungdogeumRate: bank.rate?.annualRate ?? 0.045,
    interestMode: 중.interestMode ?? bank.interestMode ?? '후불제',
    jungdogeumBank: bank.bank ?? '',
    acquisitionTaxRate: doc.extras?.취득세율 ?? null,
    legalFee: doc.extras?.['중개·법무비추정'] ?? 0,
    prepaidMgmt: doc.extras?.선수관리비 ?? 0,
    note: doc.meta?.비고 ?? '',
    author: doc.meta?.작성자 ?? '',
    sourceDoc: doc.meta?.출처 ?? '',
    __complexId: doc.complexId,
  };
}

function guessInterval(rounds) {
  if (!rounds || rounds.length < 2 || !rounds[0].date || !rounds[1].date) return 4;
  const a = new Date(rounds[0].date + 'T12:00:00Z');
  const b = new Date(rounds[1].date + 'T12:00:00Z');
  const m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  return m > 0 ? m : 4;
}

/** 한글 단지명을 파일·id 로 쓸 수 있게. 한글은 그대로 두되 공백·기호만 정리한다. */
export function slugify(name) {
  return String(name ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
}
