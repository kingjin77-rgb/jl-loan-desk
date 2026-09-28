/**
 * DSR / DTI 한도.
 *
 * 구조는 언제나 같다:
 *   연간 상환가능액 = 연소득 × 한도율 − 기존부채 연원리금
 *   한도 = 그 상환가능액을 (스트레스금리, 산정만기) 로 역산한 원금
 *
 * ★ DSR 산정만기 상한을 반드시 적용한다. 실제 만기가 40년이어도 규정상 산정만기가
 *   30년이면 30년으로 역산해야 한다. 이걸 빠뜨리면 한도가 눈에 안 띄게 부풀려진다.
 */

import { won, formatKRW, formatPct } from './money.js';
import { makeCap, inapplicableCap, CAP_IDS } from './cap.js';
import { principalFromAnnualPayment, existingDebtAnnualPayment } from './invert.js';
import { METHODS } from './amortize.js';

/**
 * @param {object} p
 * @param {number} p.annualIncome   연소득(부부합산 여부는 호출자가 이미 처리)
 * @param {Array}  p.existingDebts  [{kind, balance, rate, limitAmount?, remainingMonths?}]
 * @param {object} p.newLoan        { stressedRate, termMonths, method, graceMonths }
 * @param {string} [p.tier]         '은행권'|'제2금융권'
 * @param {number} [p.requestedAmount] 소액 면제 판정용
 * @param {object} config           policy/dsr.json
 */
export function dsrCap({ annualIncome, existingDebts = [], newLoan, tier = '은행권', requestedAmount = null }, config) {
  const source = sourceOf(config);
  const income = won(annualIncome);

  const limitRate = config?.limits?.[tier];
  if (limitRate == null) {
    return inapplicableCap({
      id: CAP_IDS.DSR,
      label: 'DSR 한도',
      reason: `DSR 한도율(${tier})이 설정되지 않았습니다 — 이 상태의 한도는 과대계상입니다`,
      source,
    });
  }

  // 소액 면제 등 적용제외
  const exemption = findExemption(config?.exemptions, { requestedAmount });
  if (exemption) {
    return inapplicableCap({
      id: CAP_IDS.DSR,
      label: 'DSR 한도',
      reason: `DSR 적용 제외: ${exemption.label}`,
      source,
    });
  }

  if (income <= 0) {
    return makeCap({
      id: CAP_IDS.DSR, label: 'DSR 한도', amount: 0,
      formula: '연소득이 입력되지 않아 DSR 한도를 산출할 수 없습니다',
      inputs: { 연소득: 0 }, source,
    });
  }

  const existing = existingDebtAnnualPayment(existingDebts, config?.existingDebtRules || {});
  const allowable = income * limitRate - existing.total;

  if (allowable <= 0) {
    return makeCap({
      id: CAP_IDS.DSR, label: 'DSR 한도', amount: 0,
      formula:
        `연소득 ${formatKRW(income)} × ${formatPct(limitRate, 0)} = ${formatKRW(income * limitRate)}, ` +
        `기존부채 연원리금 ${formatKRW(existing.total)} → 여력 없음`,
      inputs: { 연소득: income, 한도율: limitRate, 기존부채연원리금: existing.total, 여력: 0 },
      note: '기존 부채의 연간 원리금이 이미 DSR 한도를 넘습니다. 기존 대출 상환이 선행되어야 합니다.',
      source,
      ...{ dsrDetail: { existing } },
    });
  }

  // 산정만기 상한 적용
  const capMonths = config?.dsrMaturityCapMonths?.['주택담보대출'];
  const termMonths = capMonths != null
    ? Math.min(newLoan.termMonths, capMonths)
    : newLoan.termMonths;
  const capApplied = capMonths != null && newLoan.termMonths > capMonths;

  const amount = principalFromAnnualPayment({
    annualPayment: allowable,
    annualRate: newLoan.stressedRate,
    termMonths,
    method: newLoan.method ?? METHODS.EQUAL_TOTAL,
    graceMonths: newLoan.graceMonths ?? 0,
  });

  const cap = makeCap({
    id: CAP_IDS.DSR,
    label: 'DSR 한도',
    amount,
    formula:
      `(연소득 ${formatKRW(income)} × ${formatPct(limitRate, 0)}` +
      (existing.total ? ` − 기존부채 ${formatKRW(existing.total)}` : '') +
      `) = 연 ${formatKRW(allowable)} 을 ` +
      `스트레스금리 ${formatPct(newLoan.stressedRate)} · ${Math.round(termMonths / 12)}년으로 역산`,
    inputs: {
      연소득: income,
      한도율: limitRate,
      기존부채연원리금: existing.total,
      연간상환가능액: won(allowable),
      월상환가능액: won(allowable / 12),
      스트레스금리: newLoan.stressedRate,
      산정만기개월: termMonths,
      실제만기개월: newLoan.termMonths,
      산정만기상한적용: capApplied,
      상환방식: newLoan.method,
    },
    note: capApplied
      ? `실제 만기 ${Math.round(newLoan.termMonths / 12)}년이지만 DSR 산정만기 상한 ${Math.round(capMonths / 12)}년으로 계산했습니다.`
      : '',
    source,
  });

  cap.dsrDetail = { existing, allowableAnnual: won(allowable), headroomMonthly: won(allowable / 12) };
  return cap;
}

/**
 * DTI 한도. 구조는 DSR 과 같고, 분자에서 **기타대출은 이자만** 잡는다는 점이 다르다.
 * 적용 대상이 아니면 미적용 Cap 을 돌려준다.
 */
/**
 * @param {number} [p.rateOverride] 상품이 정한 DTI 한도율(예: 디딤돌 60%).
 *   정책자금은 규제지역과 무관하게 상품 자체의 DTI 를 쓴다. 이 값이 오면
 *   지역별 dtiLimits 대신 이것을 쓰고, 산식에 출처를 적어 둔다.
 * @param {string} [p.rateLabel] 그 출처 이름(상품명).
 */
export function dtiCap({ annualIncome, existingDebts = [], newLoan, regionGrade, rateOverride = null, rateLabel = null }, config) {
  const source = sourceOf(config);
  const limitRate = rateOverride ?? config?.dtiLimits?.[regionGrade];
  const label = rateOverride != null && rateLabel ? `DTI 한도 (${rateLabel})` : 'DTI 한도';

  if (limitRate == null) {
    return inapplicableCap({
      id: CAP_IDS.DTI,
      label: 'DTI 한도',
      reason: `${regionGrade} 지역은 DTI 적용 대상이 아닙니다`,
      source,
    });
  }

  const income = won(annualIncome);
  if (income <= 0) {
    return makeCap({ id: CAP_IDS.DTI, label, amount: 0, formula: '연소득 미입력', source });
  }

  // DTI: 주담대는 원리금, 기타대출은 이자만.
  const dtiRules = {};
  for (const [kind, rule] of Object.entries(config?.existingDebtRules || {})) {
    dtiRules[kind] = kind.includes('주택담보') ? rule : { ...rule, mode: 'interestOnly' };
  }
  const existing = existingDebtAnnualPayment(existingDebts, dtiRules);
  const allowable = income * limitRate - existing.total;

  if (allowable <= 0) {
    return makeCap({
      id: CAP_IDS.DTI, label, amount: 0,
      formula: `연소득 ${formatKRW(income)} × ${formatPct(limitRate, 0)} − 기존부채 ${formatKRW(existing.total)} → 여력 없음`,
      source,
    });
  }

  const capMonths = config?.dtiMaturityCapMonths?.['주택담보대출'] ?? config?.dsrMaturityCapMonths?.['주택담보대출'];
  const termMonths = capMonths != null ? Math.min(newLoan.termMonths, capMonths) : newLoan.termMonths;

  const amount = principalFromAnnualPayment({
    annualPayment: allowable,
    annualRate: newLoan.stressedRate,
    termMonths,
    method: newLoan.method ?? METHODS.EQUAL_TOTAL,
    graceMonths: newLoan.graceMonths ?? 0,
  });

  return makeCap({
    id: CAP_IDS.DTI,
    label,
    amount,
    formula:
      `(연소득 ${formatKRW(income)} × ${formatPct(limitRate, 0)}` +
      (existing.total ? ` − 기존부채 이자 ${formatKRW(existing.total)}` : '') +
      `) = 연 ${formatKRW(allowable)} 역산`,
    inputs: { 연소득: income, 한도율: limitRate, 한도율출처: rateLabel ?? `${regionGrade} 지역 규제`, 규제지역: regionGrade, 기존부채연이자: existing.total },
    source,
  });
}

function findExemption(exemptions, { requestedAmount }) {
  if (!Array.isArray(exemptions)) return null;
  return exemptions.find((e) => {
    if (e.threshold != null && requestedAmount != null) return requestedAmount <= e.threshold;
    return false;
  }) || null;
}

function sourceOf(config) {
  if (!config?.meta) return null;
  return { file: config.meta.id, 기준일: config.meta.기준일, verified: Boolean(config.meta.verified) };
}
