/**
 * 상환 스케줄 계산.
 *
 * 순수 함수. 규제 수치를 전혀 모른다 — 원금·금리·기간·상환방식만 받는다.
 *
 * 금리 관행: 월이율 = 연이율 / 12 (명목금리 단순분할). 은행 여신 실무의 관행이며
 * 실효금리 환산((1+r)^(1/12)-1)이 아니다. 이 선택을 바꾸면 은행 산출값과 어긋난다.
 */

import { won, safeDiv } from './money.js';
import { addMonths } from './dates.js';

export const METHODS = {
  EQUAL_TOTAL: '원리금균등',
  EQUAL_PRINCIPAL: '원금균등',
  BULLET: '만기일시',
};

/** 원리금균등의 월 납입액. i=0 분기 처리. */
export function pmt(principal, monthlyRate, months) {
  if (months <= 0) return 0;
  if (!monthlyRate) return principal / months;
  const f = Math.pow(1 + monthlyRate, -months);
  return safeDiv(principal * monthlyRate, 1 - f, 0);
}

/**
 * @param {object} p
 * @param {number} p.principal      대출 원금(원)
 * @param {number} p.annualRate     연이율(0.045 = 4.5%)
 * @param {number} p.termMonths     총 대출기간(개월). 거치기간을 포함한 값.
 * @param {string} p.method         METHODS 중 하나
 * @param {number} [p.graceMonths]  거치기간(개월) — 이 기간에는 이자만 낸다
 * @param {string} [p.startDate]    첫 납입일("YYYY-MM-DD"). 있으면 각 회차에 date 부여
 * @returns {{
 *   monthlyPayment:number|null, firstPayment:number, lastPayment:number, maxPayment:number,
 *   totalInterest:number, totalPayment:number, amortMonths:number,
 *   schedule:Array<{n:number,date:string|null,opening:number,payment:number,interest:number,principal:number,closing:number,isGrace:boolean}>
 * }}
 */
export function amortize({
  principal,
  annualRate,
  termMonths,
  method = METHODS.EQUAL_TOTAL,
  graceMonths = 0,
  startDate = null,
}) {
  const P = won(principal);
  const i = (Number(annualRate) || 0) / 12;
  const n = Math.max(0, Math.round(termMonths) || 0);
  const g = Math.min(Math.max(0, Math.round(graceMonths) || 0), n);
  const amortMonths = n - g;

  const empty = {
    monthlyPayment: null, firstPayment: 0, lastPayment: 0, maxPayment: 0,
    totalInterest: 0, totalPayment: 0, amortMonths, schedule: [],
  };
  if (P <= 0 || n <= 0) return empty;

  const schedule = [];
  let balance = P;
  let totalInterest = 0;

  // 원리금균등 / 만기일시는 거치 후 균등액이 확정된다.
  const level = method === METHODS.EQUAL_TOTAL && amortMonths > 0 ? pmt(P, i, amortMonths) : null;
  const flatPrincipal = method === METHODS.EQUAL_PRINCIPAL && amortMonths > 0 ? P / amortMonths : 0;

  for (let k = 1; k <= n; k++) {
    const opening = balance;
    const interest = opening * i;
    const isGrace = k <= g;
    let principalPart;

    if (isGrace) {
      principalPart = 0;
    } else if (method === METHODS.BULLET) {
      principalPart = k === n ? opening : 0;
    } else if (method === METHODS.EQUAL_PRINCIPAL) {
      principalPart = flatPrincipal;
    } else {
      principalPart = level - interest;
    }

    // 마지막 회차는 잔액을 강제로 0으로 맞춘다. 부동소수 잔돈이 남지 않게.
    if (k === n) principalPart = opening;
    if (principalPart > opening) principalPart = opening;
    if (principalPart < 0) principalPart = 0;

    balance = opening - principalPart;
    totalInterest += interest;

    schedule.push({
      n: k,
      date: startDate ? addMonths(startDate, k - 1) : null,
      opening: won(opening),
      payment: won(principalPart + interest),
      interest: won(interest),
      principal: won(principalPart),
      closing: won(balance),
      isGrace,
    });
  }

  const payments = schedule.map((r) => r.payment);
  const postGrace = schedule.filter((r) => !r.isGrace).map((r) => r.payment);

  return {
    // 원리금균등일 때만 "월 상환액"이라는 단일 값이 의미를 가진다.
    monthlyPayment: method === METHODS.EQUAL_TOTAL && level != null ? won(level) : null,
    firstPayment: payments[0] ?? 0,
    lastPayment: payments[payments.length - 1] ?? 0,
    maxPayment: payments.length ? Math.max(...payments) : 0,
    // 거치 이후 최대 상환액. "거치 끝나면 얼마가 되나요"에 답한다.
    maxPaymentAfterGrace: postGrace.length ? Math.max(...postGrace) : 0,
    totalInterest: won(totalInterest),
    totalPayment: won(P + totalInterest),
    amortMonths,
    schedule,
  };
}

/** 상환스케줄을 연 단위로 접는다. 인쇄 기본 표시(360행 → 30행). */
export function byYear(schedule) {
  const years = [];
  for (let k = 0; k < schedule.length; k += 12) {
    const chunk = schedule.slice(k, k + 12);
    years.push({
      year: Math.floor(k / 12) + 1,
      fromN: chunk[0].n,
      toN: chunk[chunk.length - 1].n,
      fromDate: chunk[0].date,
      toDate: chunk[chunk.length - 1].date,
      payment: won(chunk.reduce((s, r) => s + r.payment, 0)),
      interest: won(chunk.reduce((s, r) => s + r.interest, 0)),
      principal: won(chunk.reduce((s, r) => s + r.principal, 0)),
      closing: chunk[chunk.length - 1].closing,
    });
  }
  return years;
}
