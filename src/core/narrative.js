/**
 * 상담사가 고객에게 그대로 읽어줄 수 있는 문장 생성.
 *
 * 숫자만 있는 화면은 상담 도구가 아니다. "왜 이 금액인지"를 상담사가 즉석에서
 * 설명할 수 있어야 상담이 된다.
 */

import { formatKRW, formatPct } from './money.js';
import { josa } from './hangul.js';

/**
 * @param {object} limitResult  computeLimit 결과
 * @param {object} [extra]      { levers, payment, shortfall }
 */
export function buildNarrative(limitResult, extra = {}) {
  const { finalAmount, binding, runnerUp, slack, requestedAmount, requestedGap, warnings } = limitResult;

  if (!binding) {
    return {
      headline: '한도를 산출할 수 없습니다',
      bindingLine: (warnings && warnings[0]) || '입력값을 확인하세요.',
      slackLine: '', actions: [], caveats: warnings ?? [],
    };
  }

  const headline = `예상 한도 ${formatKRW(finalAmount)}`;

  // 무엇이 막고 있는가
  let bindingLine = `지금 한도를 결정하는 것은 ${binding.label}입니다. ${binding.formula}.`;
  if (binding.note) bindingLine += ` ${binding.note}`;

  // DSR이 물렸으면 여력을 금액으로 풀어준다
  if (binding.dsrDetail) {
    const d = binding.dsrDetail;
    bindingLine += ` 월 기준으로 ${formatKRW(d.headroomMonthly)}까지 상환 여력이 있다는 뜻입니다.`;
  }

  // 여유는 얼마나
  let slackLine = '';
  if (runnerUp && Number.isFinite(slack)) {
    slackLine =
      `다음으로 낮은 상한은 ${runnerUp.label} ${formatKRW(runnerUp.amount)}입니다. ` +
      `${josa(binding.label, '이/가')} 풀리면 ${formatKRW(slack)}까지 더 늘어날 수 있습니다.`;
  } else if (!runnerUp) {
    slackLine = `다른 상한은 이 건에 적용되지 않아 ${josa(binding.label, '이/가')} 단독으로 한도를 결정합니다.`;
  }

  // 희망 금액 대비
  let requestLine = '';
  if (requestedAmount != null) {
    requestLine = requestedGap >= 0
      ? `희망하신 ${formatKRW(requestedAmount)}는 한도 안에 들어옵니다 (여유 ${formatKRW(requestedGap)}).`
      : `희망하신 ${formatKRW(requestedAmount)}에는 ${formatKRW(-requestedGap)}이 모자랍니다.`;
  }

  // 개선 레버 — 계산된 값만 문장으로
  const actions = (extra.levers ?? []).map(
    (l) => `${l.label} 시 +${formatKRW(l.delta)} (→ ${formatKRW(l.after)}${l.newBinding && l.newBinding !== binding.label ? `, 그다음은 ${l.newBinding}에서 막힘` : ''})`
  );

  // 상한별 한 줄 요약 (상담사가 표 없이도 설명 가능하도록)
  const capLines = limitResult.caps
    .filter((c) => c.applicable && Number.isFinite(c.amount))
    .map((c) => `${c.label} ${formatKRW(c.amount)}${c === binding ? ' ← 물림' : ''}`);

  const caveats = [...(warnings ?? [])];
  caveats.push('본 산출액은 참고용 추정치이며, 실제 승인 여부와 조건은 취급 금융기관의 심사 결과에 따릅니다.');

  return { headline, bindingLine, slackLine, requestLine, capLines, actions, caveats };
}

/** 월 상환액 설명. 거치기간이 있으면 "거치 끝나면 얼마가 되는지"를 반드시 말한다. */
export function paymentNarrative(amortResult, { annualRate, termMonths, method, graceMonths = 0 }) {
  if (!amortResult || !amortResult.schedule.length) return '';
  const years = Math.round(termMonths / 12);

  if (method === '원리금균등' && !graceMonths) {
    return `연 ${formatPct(annualRate)} · ${years}년 원리금균등이면 매달 ${formatKRW(amortResult.monthlyPayment)}씩, ` +
      `총 이자는 ${formatKRW(amortResult.totalInterest)}입니다.`;
  }
  if (graceMonths) {
    return `거치 ${graceMonths}개월 동안은 이자만 ${formatKRW(amortResult.firstPayment)}, ` +
      `거치가 끝나면 ${formatKRW(amortResult.maxPaymentAfterGrace)}까지 올라갑니다. ` +
      `총 이자는 ${formatKRW(amortResult.totalInterest)}입니다.`;
  }
  return `첫 회차 ${formatKRW(amortResult.firstPayment)}에서 시작해 마지막 회차 ${formatKRW(amortResult.lastPayment)}까지 ` +
    `점점 줄어듭니다. 총 이자는 ${formatKRW(amortResult.totalInterest)}입니다.`;
}
