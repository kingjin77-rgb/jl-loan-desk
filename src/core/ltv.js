/**
 * LTV 상한.
 *
 * 규제지역·주택수·대출목적·생애최초 여부의 조합으로 비율을 찾고, 담보가액에 곱한다.
 * 비율표는 전부 config(policy/ltv.json)에서 온다 — 이 파일은 숫자를 하나도 모른다.
 *
 * ★ 규칙 매칭에 실패하면 기본값을 쓰지 않고 예외를 던진다.
 *   "모르면 70%" 같은 기본값은 상담 현장에서 조용히 틀린 한도를 만든다.
 *   에러가 떠서 상담이 멈추는 편이 낫다.
 */

import { won, formatKRW, formatPct } from './money.js';
import { makeCap, CAP_IDS, usesExample } from './cap.js';

export const APPRAISAL_BASIS = {
  분양가: '분양가',
  KB시세: 'KB시세',
  감정가: '감정가',
};

/**
 * @param {object} p
 * @param {{basis:string, amount:number}} p.appraisal  담보가액
 * @param {string} p.regionGrade   '투기과열'|'조정대상'|'비규제'
 * @param {number|string} p.ownedHouses  0 | 1 | '다주택'
 * @param {string} p.purpose       '구입'|'생활안정'|'전세반환'
 * @param {boolean} [p.isFirstTime] 생애최초
 * @param {Array} [p.deductions]   차감 항목(방공제 등)
 * @param {object} config          policy/ltv.json
 */
export function ltvCap({ appraisal, regionGrade, ownedHouses, purpose = '구입', isFirstTime = false, isMetro = null, deductions = [] }, config) {
  const source = sourceOf(config);
  const houseValue = won(appraisal?.amount);
  // isMetro: 수도권(서울·인천·경기) 여부. 6.27 대책은 **비규제라도 수도권이면**
  //   생애최초 LTV 를 80%→70% 로, 주담대를 최대 6억으로 묶었다. 규제지역 등급만으로는
  //   이걸 가를 수 없다 — 수도권 비규제 생애최초가 80% 로 나오던 원인이다.
  const ctx = { regionGrade, ownedHouses: normalizeHouses(ownedHouses), purpose, isFirstTime, isMetro };

  const rule = matchRule(config?.rules, ctx);
  if (!rule) {
    throw new LtvRuleNotFoundError(ctx, config?.rules || []);
  }
  if (rule.ltv == null) {
    throw new LtvRuleNotFoundError(ctx, config?.rules || [], `규칙 "${rule.id}" 에 ltv 값이 비어 있습니다`);
  }

  // 주택가격 구간별 차등이 있으면 적용 (예: 15억 이하 / 15~25억 / 25억 초과)
  // ★ 총액 상한(15억 이하 6억 등)은 **규제지역에만** 있다. regionGrades 가 적힌 구간은
  //   그 지역에서만 맞춘다 — 비규제에 6억 상한을 걸면 한도를 잘못 깎는다.
  const tier = matchTier(config?.priceTiers, houseValue, regionGrade, isMetro);
  // 이 규칙·구간이 예시로 메워진 칸이면 결과에 「예시」가 붙는다. 파일 전체가 아니라 이 칸 기준.
  source && (source.example = usesExample(config?.meta,
    `rules[${(config?.rules ?? []).indexOf(rule)}].ltv`,
    tier ? `priceTiers[${config.priceTiers.indexOf(tier)}]` : null));
  const rate = tier?.ltv != null ? Math.min(rule.ltv, tier.ltv) : rule.ltv;

  const gross = houseValue * rate;

  // 이 Cap 에 걸린 차감(방공제 등)을 뺀다.
  const mine = (deductions || []).filter((d) => d.appliesTo === CAP_IDS.LTV && !d.waived);
  const deducted = mine.reduce((s, d) => s + d.amount, 0);
  let amount = gross - deducted;

  // 금액 절대상한(예: 수도권 주담대 ○억원 제한)이 있으면 함께 적용.
  const absolute = pickAbsoluteCap(rule, tier);
  let absoluteApplied = false;
  if (absolute != null && amount > absolute) {
    amount = absolute;
    absoluteApplied = true;
  }

  const parts = [`${appraisal?.basis ?? '담보가액'} ${formatKRW(houseValue)} × ${formatPct(rate, 0)}`];
  if (deducted) parts.push(`− 차감 ${formatKRW(deducted)}`);
  let formula = parts.join(' ');
  if (absoluteApplied) formula += ` → 금액상한 ${formatKRW(absolute)} 적용`;

  return makeCap({
    id: CAP_IDS.LTV,
    label: 'LTV 한도',
    amount,
    formula,
    inputs: {
      담보가액: houseValue,
      시세기준: appraisal?.basis,
      규제지역: regionGrade,
      주택수: ctx.ownedHouses,
      대출목적: purpose,
      생애최초: isFirstTime,
      적용LTV: rate,
      적용규칙: rule.id,
      가격구간: tier?.label ?? null,
      차감액: deducted,
      금액상한: absolute ?? null,
    },
    source,
    note: rule.note || tier?.note || '',
  });
}

/** when 조건이 전부 맞는 첫 규칙. 조건이 더 많이 명시된 규칙이 우선(구체성 우선). */
function matchRule(rules, ctx) {
  if (!Array.isArray(rules)) return null;
  const matches = rules.filter((r) => whenMatches(r.when, ctx));
  if (!matches.length) return null;
  return matches.sort((a, b) => Object.keys(b.when || {}).length - Object.keys(a.when || {}).length)[0];
}

function whenMatches(when, ctx) {
  if (!when) return true;
  return Object.entries(when).every(([k, expected]) => {
    const actual = ctx[k];
    if (Array.isArray(expected)) return expected.some((e) => eq(e, actual));
    return eq(expected, actual);
  });
}

function eq(a, b) {
  if (a === '*' || a == null) return true;
  return String(a) === String(b);
}

function matchTier(tiers, houseValue, regionGrade = null, isMetro = null) {
  if (!Array.isArray(tiers) || !tiers.length) return null;
  // regionGrades 가 있으면 그 등급에서만, metro 가 있으면 수도권 여부가 맞을 때만.
  const mine = tiers.filter((t) =>
    (!Array.isArray(t.regionGrades) || t.regionGrades.includes(regionGrade))
    && (t.metro == null || t.metro === isMetro));
  if (!mine.length) return null;
  for (const t of mine) {
    if (t.upTo == null || houseValue <= t.upTo) return t;
  }
  return mine[mine.length - 1];
}

function pickAbsoluteCap(rule, tier) {
  const vals = [rule?.absoluteCap, tier?.absoluteCap].filter((v) => v != null && Number.isFinite(v));
  return vals.length ? Math.min(...vals) : null;
}

function normalizeHouses(v) {
  if (v === 0 || v === '0') return 0;
  if (v === 1 || v === '1') return 1;
  return '다주택';
}

export class LtvRuleNotFoundError extends Error {
  constructor(ctx, rules, extra = '') {
    const desc = `${ctx.regionGrade} / ${ctx.ownedHouses === 0 ? '무주택' : ctx.ownedHouses === 1 ? '1주택' : '다주택'} / ${ctx.purpose}${ctx.isFirstTime ? ' / 생애최초' : ''}`;
    super(
      `LTV 규칙을 찾을 수 없습니다: ${desc}. ${extra}\n` +
      `설정에 이 조합의 규칙을 추가해야 합니다 (policy/ltv.*.json). ` +
      `현재 규칙 ${rules.length}건: ${rules.map((r) => r.id).join(', ') || '(없음)'}`
    );
    this.name = 'LtvRuleNotFoundError';
    this.ctx = ctx;
  }
}

function sourceOf(config) {
  if (!config?.meta) return null;
  return { file: config.meta.id, 기준일: config.meta.기준일, verified: Boolean(config.meta.verified), example: Boolean(config.meta.example) };
}
