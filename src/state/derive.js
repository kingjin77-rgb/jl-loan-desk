/**
 * 계산의 유일한 진입점.
 *
 * UI 는 core/* 를 직접 부르지 않는다. 전부 여기를 거친다. 그래야
 *  (a) 스트레스 금리와 약정금리가 섞이는 사고를 한 곳에서 막을 수 있고
 *  (b) 계산 순서가 한 파일 안에 다 보인다.
 *
 * ★ 금리 두 개의 용도 구분 (이 앱에서 가장 위험한 지점)
 *    - 약정금리(contractRate)  → 실제 월 상환액·총이자·상환스케줄
 *    - 스트레스금리(forDsrOnly) → DSR/DTI 한도 역산에만
 *   아래에서 amortize() 에 넘기는 것은 언제나 약정금리다.
 */

import { ltvCap, LtvRuleNotFoundError } from '../core/ltv.js';
import { bangongjeDeduction, BangongjeRegionError } from '../core/bangongje.js';
import { stressedRate } from '../core/stress.js';
import { dsrCap, dtiCap } from '../core/dsr.js';
import { computeLimit, evaluateLevers } from '../core/limit.js';
import { makeCap, CAP_IDS } from '../core/cap.js';
import { amortize, byYear, METHODS } from '../core/amortize.js';
import { buildNarrative, paymentNarrative } from '../core/narrative.js';
import { buildTimeline } from '../core/timeline.js';
import { jungdogeumPlan } from '../core/jungdogeum.js';
import { janggeumPlan } from '../core/janggeum.js';
import { won, formatKRW } from '../core/money.js';
import { flattenProducts } from '../core/products.js';
import { compareProducts, bestPick } from '../core/compare.js';

/**
 * @param {object} input     store 의 평탄화된 입력값
 * @param {object} policies  loadAll().policies
 * @param {object} [opts]
 * @param {boolean} [opts.skipLevers]  개선 레버 계산 생략.
 *   레버는 derive 를 다시 돌려 차액을 재기 때문에, 그 내부 호출에서는 반드시
 *   생략해야 한다. 생략하지 않으면 무한 재귀가 된다.
 * @returns {object}         화면이 그대로 그릴 수 있는 결과 묶음
 */
export function derive(input, policies, opts = {}) {
  // products 는 두 번째 인자로 같이 오거나(ctx 전체) policies 만 올 수 있다.
  const productDocs = opts.products ?? [];
  const errors = [];
  const result = { errors, input };

  // ── 1) 담보가액
  const houseValue = won(input.collateral.amount);
  const appraisal = { basis: input.collateral.basis, amount: houseValue };

  // ── 2) 방공제 (LTV 에서 차감)
  let deduction = null;
  try {
    deduction = bangongjeDeduction(
      {
        regionKey: input.collateral.bangongjeRegion,
        roomCount: input.collateral.roomCount ?? 1,
        mci: input.collateral.mci,
        mcg: input.collateral.mcg,
      },
      policies.bangongje
    );
  } catch (e) {
    if (e instanceof BangongjeRegionError) errors.push({ field: 'bangongjeRegion', message: e.message });
    else throw e;
  }
  const deductions = deduction ? [deduction] : [];

  // ── 3) 스트레스 금리 (DSR 전용)
  const stress = stressedRate(
    {
      contractRate: input.product.annualRate,
      rateType: input.product.rateType,
      region: input.borrower.stressRegion ?? '수도권',
      loanType: '주택담보대출',
    },
    policies.stress
  );

  // ── 4) 상한들
  const caps = [];

  try {
    caps.push(ltvCap({
      appraisal,
      regionGrade: input.borrower.regionGrade,
      ownedHouses: input.borrower.ownedHouses,
      purpose: input.product.purpose,
      isFirstTime: input.borrower.isFirstTime,
      deductions,
    }, policies.ltv));
  } catch (e) {
    if (e instanceof LtvRuleNotFoundError) errors.push({ field: 'ltv', message: e.message });
    else throw e;
  }

  const newLoanForDsr = {
    stressedRate: stress.forDsrOnly,      // ← DSR 전용 금리
    termMonths: input.product.termMonths,
    method: input.product.method,
    graceMonths: input.product.graceMonths,
  };

  caps.push(dsrCap({
    annualIncome: totalIncome(input.borrower),
    existingDebts: input.borrower.existingDebts ?? [],
    newLoan: newLoanForDsr,
    tier: input.product.lenderTier ?? '은행권',
    requestedAmount: input.product.requestedAmount,
  }, policies.dsr));

  caps.push(dtiCap({
    annualIncome: totalIncome(input.borrower),
    existingDebts: input.borrower.existingDebts ?? [],
    newLoan: newLoanForDsr,
    regionGrade: input.borrower.regionGrade,
  }, policies.dsr));

  // 상담사가 손으로 거는 상한(은행이 알려준 내부 한도 등)
  if (input.product.manualCap) {
    caps.push(makeCap({
      id: CAP_IDS.MANUAL,
      label: '수기 입력 상한',
      amount: input.product.manualCap,
      formula: input.product.manualCapNote || '상담사가 직접 입력한 상한',
    }));
  }

  // ── 5) 합성
  const limit = computeLimit({
    caps,
    deductions,
    requestedAmount: input.product.requestedAmount || null,
  });

  // ── 6) 개선 레버 — 하드코딩이 아니라 실제 재계산
  const levers = errors.length || opts.skipLevers ? [] : evaluateLevers(
    limit,
    leverSet(input, deduction),
    // evaluateLevers 는 computeLimit 모양의 객체를 기대한다. derive 의 전체 결과가
    // 아니라 그 안의 limit 을 돌려줘야 한다.
    (ctx) => derive(ctx, policies, { skipLevers: true, products: productDocs }).limit,
    input
  );

  // ── 7) 실제 상환 계산 — 여기서는 **약정금리**를 쓴다
  const loanAmount = input.product.useRequestedForPayment && input.product.requestedAmount
    ? Math.min(input.product.requestedAmount, limit.finalAmount)
    : limit.finalAmount;

  const amortInput = {
    principal: loanAmount,
    annualRate: input.product.annualRate,   // ← 약정금리. stress.forDsrOnly 가 아니다.
    termMonths: input.product.termMonths,
    method: input.product.method ?? METHODS.EQUAL_TOTAL,
    graceMonths: input.product.graceMonths ?? 0,
    startDate: input.product.firstPaymentDate ?? null,
  };
  const payment = amortize(amortInput);

  // ── 8) 금리 시나리오
  const scenarios = (input.product.scenarioDeltas ?? [0, 0.005, 0.01, 0.015]).map((d) => {
    const r = amortize({ ...amortInput, annualRate: input.product.annualRate + d });
    return {
      label: d === 0 ? '기준' : `+${(d * 100).toFixed(1)}%p`,
      rate: input.product.annualRate + d,
      monthlyPayment: r.monthlyPayment ?? r.maxPaymentAfterGrace ?? r.firstPayment,
      firstPayment: r.firstPayment,
      totalInterest: r.totalInterest,
      deltaMonthly: 0,
    };
  });
  const baseMonthly = scenarios[0]?.monthlyPayment ?? 0;
  scenarios.forEach((s) => { s.deltaMonthly = s.monthlyPayment - baseMonthly; });

  // ── 9) 중도금 → 잔금 (단지가 있을 때만)
  let timeline = null;
  let jungdogeum = null;
  let janggeum = null;

  if (input.schedule?.enabled && input.schedule.paymentSchedule) {
    timeline = buildTimeline({
      totalPrice: input.schedule.totalPrice,
      paymentSchedule: input.schedule.paymentSchedule,
      conversionDate: input.schedule.conversionDate,
      jungdogeumRatio: input.schedule.jungdogeumRatio ?? 1,
    });

    jungdogeum = jungdogeumPlan({
      events: timeline.events,
      annualRate: input.schedule.jungdogeumRate ?? 0,
      conversionDate: input.schedule.conversionDate,
      interestMode: input.schedule.interestMode,
      salePrice: input.schedule.salePrice ?? input.schedule.totalPrice,
      ratioCap: input.schedule.jungdogeumRatioCap ?? null,
    });

    janggeum = janggeumPlan({
      timeline,
      jungdogeum,
      balanceLoanLimit: limit.finalAmount,
      ownFunds: input.schedule.ownFunds ?? 0,
      extras: input.schedule.extras ?? {},
      taxBase: input.schedule.salePrice ?? null,
    });
  }

  // ── 10) 정책자금 비교
  //    상품 한도는 또 하나의 상한일 뿐이므로, 이미 만든 caps 와 함께 min 을 취한다.
  let products = null;
  if (productDocs.length && !opts.skipLevers) {
    const eligibilityCtx = {
      borrower: {
        ...input.borrower,
        annualIncomeCombined: totalIncome(input.borrower),
      },
      house: {
        price: houseValue,
        areaSqm: input.collateral.areaSqm,
      },
      lease: input.lease ?? {},
      product: input.product,
    };
    // 구입 상담에 전세대출이 후보로 끼면 엉뚱한 상품이 1순위로 추천된다.
    // 대출 종류가 맞는 상품만 비교한다.
    const kind = input.product.loanKind ?? '주택담보';
    const candidates = flattenProducts(productDocs).filter((v) => (v.kind ?? '주택담보') === kind);

    const rows = compareProducts(candidates, eligibilityCtx, {
      houseValue,
      termMonths: input.product.termMonths,
      method: input.product.method,
      graceMonths: input.product.graceMonths,
      // 상품 한도 외의 상한. 전세 상품은 LTV 가 무의미하므로 화면에서 구분해 보여준다.
      otherCaps: caps.filter((c) => c.id !== CAP_IDS.MANUAL),
    });
    // 일반 주담대는 금리표가 없다 — 화면의 약정금리를 그대로 쓰고,
    // 금리가 정해졌으니 월 상환액도 여기서 다시 계산한다(안 하면 표에 "—" 로 남는다).
    for (const r of rows) {
      const isManual = productDocs.some((d) =>
        (d.variants ?? []).some((v) => v.variantId === r.variantId && v.useManualRate));
      if (r.rate == null && isManual) {
        r.rate = input.product.annualRate;
        r.rateDetail = { ...r.rateDetail, final: r.rate, manual: true };
        if (r.amount > 0) {
          const pay = amortize({
            principal: r.amount,
            annualRate: r.rate,
            termMonths: r.termMonths,
            method: input.product.method ?? METHODS.EQUAL_TOTAL,
            graceMonths: input.product.graceMonths ?? 0,
          });
          r.monthlyPayment = pay.monthlyPayment ?? pay.maxPaymentAfterGrace ?? pay.firstPayment;
          r.totalInterest = pay.totalInterest;
        }
      }
    }
    products = { rows, best: bestPick(rows) };
  }

  // ── 11) 문장
  const narrative = buildNarrative(limit, { levers });
  const paymentLine = paymentNarrative(payment, amortInput);

  result.appraisal = appraisal;
  result.stress = stress;
  result.deductions = deductions;
  result.limit = limit;
  result.levers = levers;
  result.loanAmount = loanAmount;
  result.payment = payment;
  result.paymentByYear = byYear(payment.schedule);
  result.scenarios = scenarios;
  result.timeline = timeline;
  result.jungdogeum = jungdogeum;
  result.janggeum = janggeum;
  result.products = products;
  result.narrative = narrative;
  result.paymentLine = paymentLine;
  result.headline = janggeum ? janggeum.headline : `${narrative.headline} · 월 ${formatKRW(payment.monthlyPayment ?? payment.firstPayment)}`;
  result.warnings = [
    ...limit.warnings,
    ...(timeline?.warnings ?? []),
    ...(jungdogeum?.warnings ?? []),
    ...(janggeum?.warnings ?? []),
  ];

  return result;
}

function totalIncome(borrower) {
  const self = won(borrower.annualIncome);
  const spouse = borrower.combineSpouse ? won(borrower.spouseIncome) : 0;
  return self + spouse;
}

/**
 * 개선 레버 정의. apply 는 입력을 **복사해서** 바꾼다(원본 불변).
 * 각 레버는 derive 를 다시 돌려 실제 차액을 잰다.
 */
function leverSet(input, deduction) {
  const levers = [];

  if ((input.borrower.existingDebts ?? []).length) {
    levers.push({
      id: 'clear-debts',
      label: '기존 대출 전액 상환',
      hint: '기존부채 연원리금이 DSR 여력을 잡아먹고 있을 때',
      apply: (ctx) => ({ ...ctx, borrower: { ...ctx.borrower, existingDebts: [] } }),
    });
  }

  if (deduction && !deduction.waived && deduction.amount > 0) {
    levers.push({
      id: 'mci',
      label: `MCI 가입 (방공제 ${formatKRW(deduction.amount)} 면제)`,
      hint: '취급은행의 MCI 취급 여부를 확인해야 합니다',
      apply: (ctx) => ({ ...ctx, collateral: { ...ctx.collateral, mci: true } }),
    });
  }

  if (input.product.graceMonths > 0) {
    levers.push({
      id: 'no-grace',
      label: '거치기간 없이 (원금 즉시 상환)',
      hint: '거치가 있으면 DSR 산정이 불리해질 수 있습니다',
      apply: (ctx) => ({ ...ctx, product: { ...ctx.product, graceMonths: 0 } }),
    });
  }

  if (input.product.method !== METHODS.EQUAL_TOTAL) {
    levers.push({
      id: 'equal-total',
      label: '원리금균등으로 변경',
      hint: '원금균등은 첫 회차 상환액이 커서 DSR 한도가 줄어듭니다',
      apply: (ctx) => ({ ...ctx, product: { ...ctx.product, method: METHODS.EQUAL_TOTAL } }),
    });
  }

  return levers;
}
