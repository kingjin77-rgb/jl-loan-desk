/**
 * Cap — 모든 한도 상한의 공통 형태.
 *
 * LTV든 DSR이든 상품한도든 전부 이 모양으로 만든다. 그래야 합성이 min() 한 번으로
 * 끝나고, 화면은 어느 상한이든 같은 표로 그릴 수 있다.
 *
 * amount 가 Infinity 인 것은 "이 상한은 이 건에 적용되지 않는다"는 뜻이다.
 * null 로 두면 min 계산마다 분기가 생긴다. Infinity 면 Math.min 이 알아서 무시한다.
 */

import { won } from './money.js';

export const CAP_IDS = {
  LTV: 'LTV',
  DSR: 'DSR',
  DTI: 'DTI',
  PRODUCT: 'PRODUCT',
  JUNGDOGEUM_RATIO: 'JUNGDOGEUM_RATIO',
  MCI: 'MCI',
  MANUAL: 'MANUAL',
};

/**
 * @param {object} p
 * @param {string} p.id        CAP_IDS 중 하나
 * @param {string} p.label     화면 표기명 ("LTV 한도")
 * @param {number} p.amount    상한 금액(원). 미적용이면 Infinity
 * @param {boolean} [p.applicable]
 * @param {string} p.formula   상담사가 읽을 산식 문자열
 * @param {object} [p.inputs]  재현에 필요한 값 전부
 * @param {object} [p.source]  { file, 기준일, verified }
 * @param {string} [p.note]
 */
export function makeCap({ id, label, amount, applicable = true, formula = '', inputs = {}, source = null, note = '' }) {
  const amt = amount === Infinity ? Infinity : Math.max(0, won(amount));
  return {
    id,
    label,
    amount: applicable ? amt : Infinity,
    applicable,
    formula,
    inputs,
    source,
    note,
  };
}

/** 적용되지 않는 상한. 화면에는 회색으로 "미적용"과 사유를 보여준다. */
export function inapplicableCap({ id, label, reason, source = null }) {
  return makeCap({ id, label, amount: Infinity, applicable: false, formula: reason, note: reason, source });
}

/** 차감 항목(방공제 등). Cap 과 달리 상한이 아니라 특정 Cap 에서 빼는 금액이다. */
export function makeDeduction({ id, label, amount, appliesTo, formula = '', waived = false, reason = '', source = null }) {
  return { id, label, amount: waived ? 0 : won(amount), appliesTo, formula, waived, reason, source };
}
