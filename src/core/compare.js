/**
 * 상품 비교 — "이 고객에게 가능한 상품"을 한 표로.
 *
 * 적격 상품은 금리 낮은 순. 부적격은 아래로 내리되 **왜 떨어졌는지**를 달고 간다.
 * 상담사가 "이 상품은 순자산이 3,200만원 초과라 안 됩니다"라고 바로 말할 수 있어야 한다.
 */

import { evaluate, summarizeFailure } from './eligibility.js';
import { productRate, productCap, termLimit } from './products.js';
import { amortize, METHODS } from './amortize.js';
import { won } from './money.js';

/**
 * @param {Array} candidates  flattenProducts() 결과
 * @param {object} ctx        판정·금리 산출용 컨텍스트
 * @param {object} opts       { houseValue, termMonths, method, graceMonths, otherCaps }
 * @returns {Array} 비교 행. 적격 먼저(금리 오름차순), 그다음 부적격.
 */
export function compareProducts(candidates, ctx, opts = {}) {
  const {
    houseValue = 0,
    termMonths = 360,
    method = METHODS.EQUAL_TOTAL,
    graceMonths = 0,
    otherCaps = [],
  } = opts;

  const rows = (candidates ?? []).map((v) => {
    const elig = evaluate(v.eligibility, ctx);
    const cap = productCap(v, ctx, { houseValue });

    // 상품 한도만이 아니라 다른 상한(LTV·DSR 등)과 함께 min 을 취해야
    // "이 상품을 고르면 실제로 얼마"가 나온다.
    const applicable = [cap, ...otherCaps].filter((c) => c?.applicable && Number.isFinite(c.amount));
    const amount = applicable.length ? Math.min(...applicable.map((c) => c.amount)) : 0;
    const binding = applicable.find((c) => c.amount === amount) ?? null;

    // 상품이 정한 최대 만기가 더 짧으면 그쪽을 따른다.
    // 만기별 요건(보금자리론 40·50년의 나이 제한)이 있으면 이 고객이 실제로
    // 쓸 수 있는 만기까지만 줄인다 — 못 쓰는 만기로 계산하면 금리도 월상환액도 틀린다.
    const tl = termLimit(v, ctx);
    const maxTerm = tl.maxYears != null ? tl.maxYears * 12 : termMonths;
    const term = Math.min(termMonths, maxTerm);

    // ★ 금리표는 (소득구간 × 만기) 격자다. 만기가 줄었으면 **줄어든 만기로** 조회해야
    //   한다. 30년 금리로 20년 대출을 계산하면 금리가 높게 나온다.
    const rate = productRate(v, { ...ctx, product: { ...(ctx.product ?? {}), termMonths: term } });

    // 상환방식: 화면에서 고른 방식을 그 상품이 지원하면 그대로, 아니면 **그 상품이
    // 지원하는 첫 방식**을 쓴다. 원리금균등으로 떨어뜨리면 만기일시 상품(전세자금)의
    // 이자가 절반 가까이 과소계상된다.
    const supported = v.repaymentMethods ?? [];
    const usedMethod = supported.length
      ? (supported.includes(method) ? method : supported[0])
      : METHODS.EQUAL_TOTAL;

    let payment = null;
    if (rate.final != null && amount > 0) {
      payment = amortize({
        principal: amount, annualRate: rate.final, termMonths: term,
        method: usedMethod,
        // 만기일시에는 거치 개념이 없다
        graceMonths: usedMethod === METHODS.BULLET ? 0 : graceMonths,
      });
    }

    return {
      productId: v.productId,
      variantId: v.variantId,
      name: v.name,
      productName: v.productName,
      category: v.category,
      kind: v.kind,
      eligible: elig.eligible,
      eligibility: elig,
      failureSummary: summarizeFailure(elig),
      undetermined: elig.unknown.length > 0,
      rate: rate.final,
      rateDetail: rate,
      cap,
      amount: won(amount),
      binding,
      termMonths: term,
      termCapped: term < termMonths,
      termBlocked: tl.blocked,
      method: usedMethod,
      methodSwapped: supported.length > 0 && !supported.includes(method),
      monthlyPayment: payment ? monthlyOf(payment, usedMethod) : null,
      // 만기일시는 만기에 원금을 통째로 갚는다. 이걸 "월 상환액"에 섞으면
      // 전세 상담에서 월 27만원이 1억 2,027만원으로 보인다.
      balloonPayment: payment && usedMethod === METHODS.BULLET ? payment.lastPayment : null,
      totalInterest: payment ? payment.totalInterest : null,
      source: v.__source,
    };
  });

  return rows.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    // 금리를 모르는 상품(값 미설정)은 뒤로 — 앞에 오면 "제일 싼 상품"으로 오해한다.
    if ((a.rate == null) !== (b.rate == null)) return a.rate == null ? 1 : -1;
    if (a.rate != null && b.rate != null && a.rate !== b.rate) return a.rate - b.rate;
    return b.amount - a.amount;
  });
}

/**
 * 표에 쓸 "월 상환액" 한 값.
 * 방식마다 의미가 다르다 — 만기일시의 마지막 회차(원금 일시상환)를 월 상환액으로
 * 내보내면 안 된다.
 */
function monthlyOf(payment, method) {
  if (method === METHODS.BULLET) return payment.firstPayment;        // 매달 이자만
  if (method === METHODS.EQUAL_PRINCIPAL) return payment.maxPayment;  // 첫 회차가 최대
  return payment.monthlyPayment ?? payment.maxPaymentAfterGrace ?? payment.firstPayment;
}

/** 비교 결과에서 상담사에게 권할 한 줄. */
export function bestPick(rows) {
  const ok = rows.filter((r) => r.eligible && r.rate != null && r.amount > 0);
  if (!ok.length) return null;
  const best = ok[0];
  const next = ok[1];
  return {
    row: best,
    runnerUp: next ?? null,
    rateGap: next ? next.rate - best.rate : null,
    monthlyGap: next && next.monthlyPayment != null && best.monthlyPayment != null
      ? next.monthlyPayment - best.monthlyPayment
      : null,
  };
}
