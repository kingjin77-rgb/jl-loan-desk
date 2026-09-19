/**
 * 잔금 시점 자금수지 — 이 앱의 최종 출력.
 *
 * 상담사가 고객에게 해야 하는 마지막 한 문장은 언제나 이것이다:
 *   "입주 때 현금 ○○○만원이 더 필요합니다."
 *
 * 소요 = 잔금 + 중도금대출 상환 + 후불이자 + 취득세 + 부대비용
 * 조달 = 잔금대출 한도 + 보유현금
 * 부족 = 소요 − 조달
 */

import { won, formatKRW } from './money.js';

/**
 * @param {object} p
 * @param {object} p.timeline      buildTimeline 결과
 * @param {object} p.jungdogeum    jungdogeumPlan 결과
 * @param {number} p.balanceLoanLimit  잔금대출 한도(computeLimit 결과)
 * @param {number} p.ownFunds      입주 시점 보유현금
 * @param {object} [p.extras]      { 취득세율, 중개·법무비추정, 선수관리비, 기타 }
 * @param {number} [p.taxBase]     취득세 과세표준(보통 분양가). 없으면 총분양대금
 */
export function janggeumPlan({ timeline, jungdogeum, balanceLoanLimit, ownFunds = 0, extras = {}, taxBase = null }) {
  const 잔금 = timeline?.totals?.잔금 ?? 0;
  const 중도금상환 = jungdogeum?.totalDrawn ?? 0;
  const 후불이자 = jungdogeum?.totalAccruedInterest ?? 0;

  const base = won(taxBase ?? timeline?.totals?.총분양대금 ?? 0);
  const 취득세 = extras.취득세율 != null ? won(base * extras.취득세율) : won(extras.취득세 ?? 0);
  const 부대비용 = won((extras['중개·법무비추정'] ?? extras.법무비 ?? 0) + (extras.선수관리비 ?? 0) + (extras.기타 ?? 0));

  const 소요항목 = [
    { label: '잔금', amount: 잔금, sign: +1 },
    { label: '중도금대출 상환', amount: 중도금상환, sign: +1 },
    { label: '중도금 후불이자', amount: 후불이자, sign: +1, hint: jungdogeum?.interestMode },
    { label: '취득세', amount: 취득세, sign: +1, hint: extras.취득세율 ? `과세표준 ${formatKRW(base)} × ${(extras.취득세율 * 100).toFixed(2)}%` : '' },
    { label: '부대비용(법무·중개·선수관리비)', amount: 부대비용, sign: +1 },
  ].filter((x) => x.amount > 0);

  const requiredAtMoveIn = won(소요항목.reduce((s, x) => s + x.amount, 0));

  const limit = won(balanceLoanLimit ?? 0);
  const cash = won(ownFunds);
  // 대출은 필요한 만큼만 받는다. 한도가 남아도 필요액을 넘겨 받지 않는다.
  const balanceLoanAmount = Math.min(limit, Math.max(0, requiredAtMoveIn - cash));
  const 조달항목 = [
    { label: '잔금대출', amount: balanceLoanAmount, sign: -1, hint: limit > balanceLoanAmount ? `한도 ${formatKRW(limit)} 중 필요분만` : '한도 전액' },
    { label: '보유현금', amount: cash, sign: -1 },
  ].filter((x) => x.amount > 0);

  const shortfall = won(requiredAtMoveIn - balanceLoanAmount - cash);

  const warnings = [];
  if (shortfall > 0) {
    warnings.push(`입주 시점에 ${formatKRW(shortfall)}이 부족합니다.`);
    if (limit > 0 && balanceLoanAmount >= limit) {
      warnings.push('잔금대출 한도를 전액 사용해도 부족합니다. 추가 자금 계획이 필요합니다.');
    }
  }
  if (후불이자 > 0) {
    warnings.push(`위 금액에는 중도금 후불이자 ${formatKRW(후불이자)}이 포함되어 있습니다. 놓치기 쉬운 항목입니다.`);
  }

  return {
    requiredAtMoveIn,
    balanceLoanLimit: limit,
    balanceLoanAmount,
    ownFunds: cash,
    shortfall,
    unusedLimit: won(Math.max(0, limit - balanceLoanAmount)),
    breakdown: [...소요항목, ...조달항목],
    소요항목,
    조달항목,
    warnings,
    /** 상담사가 그대로 읽는 결론 문장 */
    headline: headlineOf({ shortfall, requiredAtMoveIn, balanceLoanAmount, cash, limit }),
  };
}

/**
 * 결론 문장. 상담사가 고객에게 그대로 읽는다.
 * "부족하다 / 딱 맞다 / 남는다"가 아니라 **무엇으로 충당되는지**를 말해야 상담이 된다.
 */
function headlineOf({ shortfall, requiredAtMoveIn, balanceLoanAmount, cash, limit }) {
  if (shortfall > 0) return `입주 때 현금 ${formatKRW(shortfall)}이 더 필요합니다.`;
  if (shortfall < 0) return `입주 자금이 충족되고 ${formatKRW(-shortfall)}이 남습니다.`;

  // 부족액 0 — 무엇으로 메웠는지 밝힌다.
  const parts = [];
  if (balanceLoanAmount > 0) parts.push(`잔금대출 ${formatKRW(balanceLoanAmount)}`);
  if (cash > 0) parts.push(`보유현금 ${formatKRW(cash)}`);
  const by = parts.length ? parts.join(' + ') : '보유 자금';
  const spare = limit - balanceLoanAmount;
  return `입주 시 필요자금 ${formatKRW(requiredAtMoveIn)}은 ${by}으로 충당됩니다` +
    (spare > 0 ? ` (잔금대출 한도 ${formatKRW(spare)} 여유).` : '.');
}
