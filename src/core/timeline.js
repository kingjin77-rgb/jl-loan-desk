/**
 * 분양 대금 납부 타임라인: 계약금 → 중도금 N회차 → 잔금.
 *
 * 단지 JSON 의 paymentSchedule 과 입주지정기간을 받아 실제 날짜가 붙은
 * 이벤트 배열로 만든다. 날짜가 비어 있는 잔금 회차는 입주지정기간 개시일로 해석한다.
 */

import { won } from './money.js';
import { compareISO, expandYearMonth, today } from './dates.js';

export const EVENT_KINDS = {
  계약금: '계약금',
  중도금: '중도금',
  잔금: '잔금',
};

/**
 * @param {object} p
 * @param {number} p.totalPrice        총 분양대금(분양가 + 확장 + 옵션 중 포함할 것)
 * @param {object} p.paymentSchedule   단지 JSON 의 paymentSchedule
 * @param {string} p.conversionDate    잔금 기표일(= 보통 입주지정기간 개시일)
 * @param {number} [p.jungdogeumRatio] 중도금대출 비율(0.6 = 회차 금액의 60%)
 * @param {string} [p.asOf]            '실행완료/미실행' 구분 기준일. 기본 오늘
 */
export function buildTimeline({ totalPrice, paymentSchedule, conversionDate, jungdogeumRatio = 1, asOf = null }) {
  const price = won(totalPrice);
  const ref = asOf || today();
  const events = [];
  const warnings = [];
  let seq = 0;

  // ── 계약금 (분납 가능)
  const 계약금 = paymentSchedule?.계약금;
  if (계약금) {
    const splits = 계약금.분납?.length ? 계약금.분납 : [{ ratio: 계약금.ratio, date: 계약금.date }];
    for (const s of splits) {
      events.push(mk(++seq, EVENT_KINDS.계약금, s.ratio, s.date, price, '자납', ref));
    }
  }

  // ── 중도금
  const 중도금 = paymentSchedule?.중도금;
  if (중도금) {
    const rounds = 중도금.rounds?.length
      ? 중도금.rounds
      : Array.from({ length: 중도금.회차수 || 0 }, (_, k) => ({ seq: k + 1, ratio: 중도금.ratioPerRound, date: null }));

    if (중도금.회차수 != null && 중도금.rounds?.length && 중도금.회차수 !== 중도금.rounds.length) {
      warnings.push(`중도금 회차수(${중도금.회차수})와 실제 회차 목록(${중도금.rounds.length}건)이 다릅니다.`);
    }

    for (const r of rounds) {
      const loanable = 중도금.loanEligible !== false && r.loanEligible !== false;
      const e = mk(++seq, EVENT_KINDS.중도금, r.ratio, r.date, price, loanable ? '중도금대출' : '자납', ref);
      e.round = r.seq;
      e.loanRatio = loanable ? jungdogeumRatio : 0;
      e.loanAmount = won(e.amount * e.loanRatio);
      e.selfAmount = won(e.amount - e.loanAmount);
      events.push(e);
    }
  }

  // ── 잔금 (날짜가 비어 있으면 잔금 기표일로)
  const 잔금 = paymentSchedule?.잔금;
  if (잔금) {
    const d = 잔금.date || conversionDate;
    events.push(mk(++seq, EVENT_KINDS.잔금, 잔금.ratio, d, price, '잔금대출', ref));
  }

  // ── 검증: 비율 합계
  const ratioSum = events.reduce((s, e) => s + (e.ratio || 0), 0);
  if (Math.abs(ratioSum - 1) > 0.001) {
    warnings.push(`납부 비율 합계가 ${(ratioSum * 100).toFixed(1)}% 입니다 (100%가 되어야 합니다).`);
  }

  // ── 누적
  let cum = 0;
  let cumSelf = 0;
  for (const e of events) {
    cum += e.amount;
    cumSelf += e.kind === EVENT_KINDS.중도금 ? e.selfAmount : e.funding === '자납' ? e.amount : 0;
    e.cumulative = won(cum);
    e.cumulativeSelfFunded = won(cumSelf);
  }

  events.sort((a, b) => compareISO(a.date, b.date) || a.seq - b.seq);

  return {
    events,
    totals: {
      총분양대금: price,
      계약금: sumOf(events, EVENT_KINDS.계약금),
      중도금: sumOf(events, EVENT_KINDS.중도금),
      잔금: sumOf(events, EVENT_KINDS.잔금),
      중도금대출대상: won(events.filter((e) => e.kind === EVENT_KINDS.중도금).reduce((s, e) => s + (e.loanAmount || 0), 0)),
      중도금자납: won(events.filter((e) => e.kind === EVENT_KINDS.중도금).reduce((s, e) => s + (e.selfAmount || 0), 0)),
      비율합계: ratioSum,
    },
    conversionDate,
    warnings,
  };
}

function mk(seq, kind, ratio, date, price, funding, ref) {
  const r = Number(ratio) || 0;
  return {
    seq,
    kind,
    ratio: r,
    date: date ? expandYearMonth(date) : null,
    amount: won(price * r),
    funding,
    status: date && compareISO(date, ref) <= 0 ? '납부완료' : '예정',
  };
}

function sumOf(events, kind) {
  return won(events.filter((e) => e.kind === kind).reduce((s, e) => s + e.amount, 0));
}

/**
 * 입주지정기간 안에서 잔금 기표일 후보 3개.
 * 입주 지연 시나리오 상담에 쓴다 — 하루만 밀려도 후불이자가 달라진다.
 */
export function conversionDateOptions(moveIn) {
  const start = expandYearMonth(moveIn?.입주지정기간?.start ?? moveIn?.예정시기);
  const end = expandYearMonth(moveIn?.입주지정기간?.end ?? moveIn?.예정시기, { endOfMonth: true });
  if (!start) return [];
  if (!end || start === end) return [{ label: '입주지정 개시', date: start }];
  const { midpoint } = { midpoint: midOf(start, end) };
  return [
    { label: '개시일 (가장 이름)', date: start },
    { label: '기간 중간', date: midpoint },
    { label: '종료일 (가장 늦음)', date: end },
  ];
}

function midOf(a, b) {
  const da = new Date(a + 'T12:00:00Z').getTime();
  const db = new Date(b + 'T12:00:00Z').getTime();
  const m = new Date((da + db) / 2);
  return m.toISOString().slice(0, 10);
}
