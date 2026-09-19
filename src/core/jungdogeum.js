/**
 * 중도금대출.
 *
 * 회차별로 따로 실행되고, 이자후불제면 각 회차의 이자가 잔금 기표일까지
 * 따로따로 쌓인다. 회차마다 경과일수가 다르므로 한 덩어리로 계산할 수 없다.
 *
 * 후불이자ᵢ = 실행액ᵢ × 연이율 × 경과일수(실행일→기표일) / 365
 */

import { won, formatKRW, formatPct } from './money.js';
import { daysBetween } from './dates.js';
import { makeCap, CAP_IDS } from './cap.js';

export const INTEREST_MODES = {
  후불제: '후불제',     // 잔금 때 일괄 정산 — 입주 시 현금 부담이 커진다
  이자납부: '이자납부', // 매달 이자를 낸다 — 입주 시 부담은 없다
  무이자: '무이자',     // 시행사 부담
};

/**
 * @param {object} p
 * @param {Array} p.events          timeline.events 중 중도금 회차
 * @param {number} p.annualRate     중도금대출 금리
 * @param {string} p.conversionDate 잔금 기표일
 * @param {string} p.interestMode   INTEREST_MODES
 * @param {number} p.salePrice      분양가 (비율 상한 계산용)
 * @param {number} [p.ratioCap]     집단대출 비율 상한(예: 0.6)
 */
export function jungdogeumPlan({ events, annualRate, conversionDate, interestMode = INTEREST_MODES.후불제, salePrice, ratioCap = null }) {
  const rounds = (events || []).filter((e) => e.kind === '중도금');
  const rate = Number(annualRate) || 0;
  const charged = interestMode !== INTEREST_MODES.무이자;

  const drawdowns = rounds.map((e) => {
    const amount = won(e.loanAmount ?? 0);
    const days = Math.max(0, daysBetween(e.date, conversionDate));
    const accrued = charged && interestMode === INTEREST_MODES.후불제
      ? won(amount * rate * days / 365)
      : 0;
    const monthly = charged && interestMode === INTEREST_MODES.이자납부
      ? won(amount * rate / 12)
      : 0;
    return {
      round: e.round ?? e.seq,
      date: e.date,
      ratio: e.ratio,
      총액: e.amount,
      실행액: amount,
      자납액: won(e.selfAmount ?? e.amount - amount),
      days,
      accruedInterest: accrued,
      monthlyInterest: monthly,
      status: e.status,
    };
  });

  const totalDrawn = won(drawdowns.reduce((s, d) => s + d.실행액, 0));
  const totalAccrued = won(drawdowns.reduce((s, d) => s + d.accruedInterest, 0));
  const selfFunded = won(drawdowns.reduce((s, d) => s + d.자납액, 0));
  // 이자납부식일 때 매달 나가는 이자의 최대치(전 회차 실행 후)
  const peakMonthlyInterest = won(drawdowns.reduce((s, d) => s + d.monthlyInterest, 0));

  // 집단대출 비율 상한을 Cap 으로
  const capAmount = ratioCap != null && salePrice ? won(salePrice * ratioCap) : Infinity;
  const ratioCapObj = makeCap({
    id: CAP_IDS.JUNGDOGEUM_RATIO,
    label: '중도금대출 비율 상한',
    amount: capAmount,
    applicable: ratioCap != null,
    formula: ratioCap != null
      ? `분양가 ${formatKRW(salePrice)} × ${formatPct(ratioCap, 0)}`
      : '비율 상한이 설정되지 않았습니다',
    inputs: { 분양가: salePrice, 비율: ratioCap },
  });

  const warnings = [];
  if (ratioCap != null && totalDrawn > capAmount) {
    warnings.push(
      `중도금대출 실행액 합계 ${formatKRW(totalDrawn)}이 비율 상한 ${formatKRW(capAmount)}을 넘습니다. ` +
      `초과분 ${formatKRW(totalDrawn - capAmount)}은 자납해야 합니다.`
    );
  }
  if (interestMode === INTEREST_MODES.후불제 && totalAccrued > 0) {
    warnings.push(
      `이자후불제입니다. 잔금 때 ${formatKRW(totalAccrued)}의 이자를 한꺼번에 정산해야 합니다 — ` +
      `입주 시 필요자금에 포함되어 있습니다.`
    );
  }
  warnings.push(
    '중도금대출은 DSR 산정에서 제외되지만, 잔금대출로 전환되는 시점에는 DSR이 적용됩니다. ' +
    '지금 중도금이 나왔다고 해서 잔금대출이 같은 금액으로 나오지 않습니다.'
  );

  return {
    drawdowns,
    totalDrawn,
    totalAccruedInterest: totalAccrued,
    selfFunded,
    peakMonthlyInterest,
    interestMode,
    annualRate: rate,
    ratioCap: ratioCapObj,
    warnings,
  };
}
