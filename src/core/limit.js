/**
 * 한도 합성 — 이 앱의 중심.
 *
 * 한도는 언제나 "여러 상한의 최솟값"이다. 각 상한을 Cap 으로 만들어 넘기면
 * 여기서 최솟값을 고르고, **어느 상한이 물렸는지(binding)** 와 2순위와의
 * 격차(slack)를 돌려준다.
 *
 * 상담사가 화면을 보고 그대로 읽을 수 있어야 한다:
 *   "LTV는 4억 2천까지 나오는데 DSR에서 3억 8천으로 막혔습니다.
 *    신용대출을 정리하시면 4천만원이 늘어납니다."
 *
 * 합성 순서 (UI 와 이 주석이 같은 문구를 쓴다):
 *   1) 담보가액 확정 → 2) 규제 판정 → 3) LTV 상한 → 4) 방공제 차감
 *   → 5) DSR 상한 → 6) DTI 상한 → 7) 상품 상한 → 8) min → 9) binding
 */

import { floorTo, won } from './money.js';

/** 한도는 통상 만원 단위 절사. */
export const LIMIT_ROUNDING_UNIT = 10_000;

/**
 * @param {object} p
 * @param {Array} p.caps          Cap[]
 * @param {Array} [p.deductions]  Deduction[] (이미 각 Cap 에 반영된 것. 표시용)
 * @param {number} [p.requestedAmount] 고객 희망 금액
 * @param {number} [p.roundingUnit]
 */
export function computeLimit({ caps = [], deductions = [], requestedAmount = null, roundingUnit = LIMIT_ROUNDING_UNIT }) {
  const active = caps.filter((c) => c && c.applicable && Number.isFinite(c.amount));
  const inactive = caps.filter((c) => c && (!c.applicable || !Number.isFinite(c.amount)));

  const warnings = [];
  for (const c of caps) {
    if (c?.source && c.source.verified === false) {
      warnings.push(`${c.label}: 미검증 설정값(${c.source.file}) 사용 중 — 실제 금액과 다를 수 있습니다`);
    }
    if (c?.note && /설정되지 않았|미입력|과대계상/.test(c.note)) warnings.push(`${c.label}: ${c.note}`);
    if (!c?.applicable && /설정되지 않았|과대계상/.test(c?.formula ?? '')) warnings.push(`${c.label}: ${c.formula}`);
  }

  if (!active.length) {
    return {
      finalAmount: 0,
      binding: null,
      runnerUp: null,
      slack: 0,
      caps: [...inactive],
      deductions,
      requestedAmount,
      requestedGap: requestedAmount ? -requestedAmount : 0,
      isSufficient: false,
      warnings: [...warnings, '적용 가능한 상한이 하나도 없습니다. 입력값을 확인하세요.'],
    };
  }

  const sorted = [...active].sort((a, b) => a.amount - b.amount);
  const binding = sorted[0];
  const runnerUp = sorted[1] ?? null;
  const finalAmount = floorTo(binding.amount, roundingUnit);
  const slack = runnerUp ? won(runnerUp.amount - binding.amount) : Infinity;

  // 근소차 경고: 1순위와 2순위가 아주 가까우면 조건이 조금만 바뀌어도 물리는 상한이 뒤바뀐다.
  if (runnerUp && slack >= 0 && slack < finalAmount * 0.02) {
    warnings.push(
      `${binding.label}과 ${runnerUp.label}의 차이가 ${(slack / 10000).toLocaleString('ko-KR')}만원에 불과합니다. ` +
      `조건이 조금만 달라져도 물리는 조건이 바뀝니다.`
    );
  }

  return {
    finalAmount,
    binding,
    runnerUp,
    slack,
    caps: [...sorted, ...inactive],
    deductions,
    requestedAmount,
    requestedGap: requestedAmount != null ? won(finalAmount - requestedAmount) : null,
    isSufficient: requestedAmount != null ? finalAmount >= requestedAmount : null,
    warnings,
  };
}

/**
 * 개선 레버 — "무엇을 바꾸면 한도가 얼마나 늘어나는가".
 *
 * 하드코딩된 조언이 아니라 **실제 재계산 결과**다. 각 레버를 하나씩 적용한
 * 상태로 recompute 를 다시 돌려 차액을 잰다.
 *
 * @param {object} baseResult   computeLimit 결과
 * @param {Array} levers        [{ id, label, apply(ctx) -> ctx', hint }]
 * @param {Function} recompute  (ctx) => computeLimit 결과
 * @param {object} ctx          현재 입력 컨텍스트
 */
export function evaluateLevers(baseResult, levers, recompute, ctx) {
  const out = [];
  for (const lever of levers) {
    let after;
    try {
      after = recompute(lever.apply(ctx));
    } catch (e) {
      // 레버를 적용하면 설정에 없는 조합이 되는 경우(예: 규칙 없는 지역)는 건너뛴다.
      // 그 외의 예외는 프로그램 오류이므로 삼키지 않는다 — 삼키면 레버가 조용히
      // 사라지고 원인을 찾을 수 없게 된다.
      if (e instanceof RangeError || e instanceof TypeError || e instanceof ReferenceError) throw e;
      continue;
    }
    const delta = after.finalAmount - baseResult.finalAmount;
    if (!Number.isFinite(delta) || delta <= 0) continue;
    out.push({
      id: lever.id,
      label: lever.label,
      hint: lever.hint ?? '',
      delta: won(delta),
      after: after.finalAmount,
      newBinding: after.binding?.label ?? null,
    });
  }
  return out.sort((a, b) => b.delta - a.delta);
}
