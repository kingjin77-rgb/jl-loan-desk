/**
 * 역산 — "월(또는 연) 상환 가능액이 이만큼일 때 원금은 얼마까지 되는가".
 *
 * DSR/DTI 한도 산출의 핵심. 한도는 언제나 이 역산의 결과다.
 * 순수 함수. 규제 수치를 모른다.
 */

import { amortize, METHODS, pmt } from './amortize.js';
import { won, safeDiv } from './money.js';

/**
 * 월 상환가능액 → 대출 가능 원금.
 *
 * 원리금균등·원금균등은 닫힌 해가 있어 바로 계산한다.
 * 그 외(거치 포함 등)는 amortize 를 목적함수로 쓰는 이분탐색.
 * 상환액은 원금에 대해 단조증가이므로 이분탐색이 항상 수렴한다.
 *
 * DSR 판정은 "매 회차 중 최대 상환액" 기준이므로, 원금균등처럼 첫 회차가
 * 가장 큰 방식은 첫 회차를 기준으로 삼는다. 거치기간이 있으면 거치 종료 후
 * 최대 상환액을 기준으로 한다(거치 중 이자만 내는 낮은 금액으로 한도를
 * 부풀리면 실제 심사와 어긋난다).
 */
export function principalFromPayment({
  monthlyPayment,
  annualRate,
  termMonths,
  method = METHODS.EQUAL_TOTAL,
  graceMonths = 0,
}) {
  const PMT = Number(monthlyPayment) || 0;
  const i = (Number(annualRate) || 0) / 12;
  const n = Math.max(0, Math.round(termMonths) || 0);
  const g = Math.min(Math.max(0, Math.round(graceMonths) || 0), n);
  const amortMonths = n - g;

  if (PMT <= 0 || n <= 0 || amortMonths <= 0) return 0;

  // 거치 없음 + 원리금균등 → P = PMT·(1-(1+i)^-n)/i
  if (g === 0 && method === METHODS.EQUAL_TOTAL) {
    if (!i) return won(PMT * n);
    return won(safeDiv(PMT * (1 - Math.pow(1 + i, -n)), i, 0));
  }

  // 거치 없음 + 원금균등 → 첫 회차가 최대: PMT = P/n + P·i
  if (g === 0 && method === METHODS.EQUAL_PRINCIPAL) {
    return won(safeDiv(PMT, 1 / n + i, 0));
  }

  // 거치 + 원리금균등 → 거치 후 균등액이 PMT 가 되는 원금
  if (method === METHODS.EQUAL_TOTAL) {
    if (!i) return won(PMT * amortMonths);
    return won(safeDiv(PMT * (1 - Math.pow(1 + i, -amortMonths)), i, 0));
  }

  // 그 외: 이분탐색
  return bisect((P) => maxPaymentOf(P, { annualRate, termMonths: n, method, graceMonths: g }), PMT);
}

/** 연 상환가능액 → 원금. DSR 은 연 단위로 규정되어 있어 이 진입점을 쓴다. */
export function principalFromAnnualPayment({ annualPayment, ...rest }) {
  return principalFromPayment({ monthlyPayment: (Number(annualPayment) || 0) / 12, ...rest });
}

function maxPaymentOf(principal, opts) {
  const r = amortize({ principal, ...opts });
  // 거치기간이 있으면 거치 이후 최대 상환액이 심사 기준이다.
  return opts.graceMonths > 0 ? r.maxPaymentAfterGrace : r.maxPayment;
}

/** f(P)=target 을 만족하는 P. f 는 P 에 대해 단조증가여야 한다. */
function bisect(f, target, { maxIter = 80, tol = 1 } = {}) {
  if (target <= 0) return 0;
  let lo = 0;
  let hi = 1_000_000;
  // 상한을 target 을 넘길 때까지 두 배씩 확장 (최대 1조원)
  while (f(hi) < target && hi < 1e12) hi *= 2;
  for (let k = 0; k < maxIter; k++) {
    const mid = (lo + hi) / 2;
    const v = f(mid);
    if (Math.abs(v - target) <= tol) return won(mid);
    if (v < target) lo = mid;
    else hi = mid;
  }
  return won(lo);
}

/**
 * 기존 부채의 연간 원리금 상환액 산정.
 *
 * DSR 분모가 아니라 "이미 나가고 있는 돈"을 계산하는 쪽. 부채 종류별 규정이
 * 다르므로 규칙을 config(`existingDebtRules`)에서 데이터로 받는다.
 *
 * @param {Array} debts [{ kind, balance, rate, remainingMonths?, annualPayment?, limitAmount? }]
 * @param {object} rules  policy/dsr.json 의 existingDebtRules — { [kind]: {mode, maturityMonths} }
 *   mode: 'actual'          실제 상환액을 그대로 (annualPayment 필요)
 *         'amortized'       잔액을 maturityMonths 로 분할 + 이자
 *         'limitAmortized'  한도금액(limitAmount)을 maturityMonths 로 분할 + 이자 (마이너스통장)
 *         'interestOnly'    이자만
 * @returns {{ total:number, items:Array }}
 */
export function existingDebtAnnualPayment(debts = [], rules = {}) {
  const items = (debts || []).map((d) => {
    const balance = won(d.balance);
    const rate = Number(d.rate) || 0;
    const rule = rules[d.kind] || rules.default || { mode: 'amortized', maturityMonths: 120 };
    const base = rule.mode === 'limitAmortized' ? won(d.limitAmount ?? d.balance) : balance;

    let annual;
    let basis;
    if (d.annualPayment != null && rule.mode === 'actual') {
      annual = won(d.annualPayment);
      basis = '실제 상환액 입력값';
    } else if (rule.mode === 'interestOnly') {
      annual = won(base * rate);
      basis = `이자만 (${base.toLocaleString('ko-KR')} × ${(rate * 100).toFixed(2)}%)`;
    } else {
      const months = Math.max(1, rule.maturityMonths || 120);
      const useMonths = rule.mode === 'amortized' && d.remainingMonths
        ? Math.min(d.remainingMonths, months)
        : months;
      annual = won(base * (12 / useMonths) + base * rate);
      basis = `원금 ${useMonths}개월 분할 + 이자`;
    }
    return { ...d, kind: d.kind, annualPayment: annual, basis, rule: rule.mode };
  });

  return { total: won(items.reduce((s, x) => s + x.annualPayment, 0)), items };
}

export { pmt };
