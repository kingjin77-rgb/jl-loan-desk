/**
 * 분양전환 (민간임대 → 분양전환) 상담 계산.
 *
 * 법무법인 제이엘 「분양전환 상담일지」의 계산 구조를 그대로 옮긴 것이다.
 * 일반 매매 상담과 다른 점이 셋 있다:
 *
 *  1. **필요자금 = 분양가 − 납입보증금 + 보증금대출 − 본인준비금**
 *     이미 낸 보증금은 빼고, 기존 보증금대출은 계약 시 상환해야 하므로 **더한다**.
 *     이 부호를 틀리면 필요자금이 보증금대출의 두 배만큼 빗나간다.
 *
 *  2. **잔금유예(분할납부)** — 남은 잔금을 10년(또는 청산일) 뒤로 미룬다.
 *     원금은 만기에 한 번에, 이자는 **매년 12월 일할계산 연납**이다.
 *     월 상환액이 아니라 「해마다 12월에 얼마」가 상담의 답이므로 amortize 를 쓸 수 없다.
 *
 *  3. **최소 잔금유예금** — 타입마다 반드시 남겨야 하는 금액이 있고, 그만큼만 남기면
 *     일부상환이 막히고 일괄상환만 된다. 주택가격이 낮으면 분할납부 한도에 못 미친다.
 *
 * 순수 함수. 규제·단지 수치를 모른다 — 전부 인자로 받는다.
 */

import { won, formatKRW } from './money.js';

/**
 * 필요자금. 상담일지 첫 표 그대로.
 *
 * @param {object} p
 * @param {number} p.분양가            A — 분양전환 가격
 * @param {number} p.납입보증금        B — 이미 낸 보증금
 * @param {number} p.보증금대출        C — 기존 보증금대출(계약 시 상환해야 하므로 가산)
 * @param {number} p.본인준비금        D — 자기자금
 * @returns {{필요자금:number, 내역:Array<{항목:string, 부호:1|-1, 금액:number}>}}
 */
export function fundsNeeded({ 분양가 = 0, 납입보증금 = 0, 보증금대출 = 0, 본인준비금 = 0 } = {}) {
  const 내역 = [
    { 항목: '분양가', 기호: 'A', 부호: 1, 금액: won(분양가) },
    { 항목: '납입보증금', 기호: 'B', 부호: -1, 금액: won(납입보증금) },
    { 항목: '보증금대출', 기호: 'C', 부호: 1, 금액: won(보증금대출), 비고: '계약 시 상환해야 하므로 더합니다' },
    { 항목: '본인준비금', 기호: 'D', 부호: -1, 금액: won(본인준비금) },
  ];
  const 필요자금 = 내역.reduce((s, r) => s + r.부호 * r.금액, 0);
  return { 필요자금: won(필요자금), 내역, 식: 'A − B + C − D' };
}

/**
 * 분할납부(잔금유예) 가능액.
 *
 * 상한은 둘 중 작은 쪽이다:
 *   ① 제도상 총액 상한(상담일지 기준 2억)
 *   ② 주택가격 − 최소잔금유예금  ← 주택가격이 낮으면 여기서 막힌다
 *
 * 상담일지의 두 숫자로 검산된다:
 *   51·59타입: 2억5천5백만 − 5,500만 = 2억  → 이 미만이면 2억이 안 된다 ✓
 *   74·84타입: 2억7천5백만 − 7,500만 = 2억  → 같은 관계 ✓
 *
 * @returns {{최대분할납부액, 최소잔금유예금, 상한사유, 총액상한미달:boolean, 최소주택가격, warnings:string[]}}
 */
export function installmentCap({ 주택가격 = 0, 최소잔금유예금 = null, 총액상한 = null } = {}) {
  const warnings = [];
  if (최소잔금유예금 == null) {
    return {
      최대분할납부액: null, 최소잔금유예금: null, 상한사유: null,
      총액상한미달: false, 최소주택가격: null,
      warnings: ['타입별 최소 잔금유예금이 설정되지 않아 분할납부 한도를 계산할 수 없습니다'],
    };
  }

  const 가격기준 = won(주택가격) - won(최소잔금유예금);
  const 후보 = [];
  if (총액상한 != null) 후보.push({ amount: won(총액상한), why: `제도상 총액 상한 ${formatKRW(총액상한)}` });
  후보.push({ amount: Math.max(0, 가격기준), why: `주택가격 ${formatKRW(주택가격)} − 최소 잔금유예금 ${formatKRW(최소잔금유예금)}` });

  const min = 후보.reduce((a, b) => (a.amount <= b.amount ? a : b));
  const 총액상한미달 = 총액상한 != null && 가격기준 < won(총액상한);
  const 최소주택가격 = 총액상한 != null ? won(총액상한) + won(최소잔금유예금) : null;

  if (총액상한미달) {
    warnings.push(
      `주택가격이 ${formatKRW(최소주택가격)} 미만이므로 분할납부 금액이 ${formatKRW(총액상한)}에 못 미칩니다 ` +
      `(가능액 ${formatKRW(Math.max(0, 가격기준))}).`
    );
  }
  return { 최대분할납부액: min.amount, 최소잔금유예금: won(최소잔금유예금), 상한사유: min.why, 총액상한미달, 최소주택가격, warnings };
}

/**
 * 잔금유예 잔금(남기는 금액)과 일괄상환 제약.
 *
 * 최소 잔금유예금만 남겼을 때는 일부상환이 막히고 일괄상환만 가능하다.
 */
export function deferredBalance({ 주택가격 = 0, 분할납부액 = 0, 최소잔금유예금 = null } = {}) {
  const 잔금유예금 = Math.max(0, won(주택가격) - won(분할납부액));
  const 여유 = 최소잔금유예금 == null ? null : 잔금유예금 - won(최소잔금유예금);
  const 일괄상환만 = 여유 != null && 여유 <= 0;
  const warnings = [];
  if (여유 != null && 여유 < 0) {
    warnings.push(`잔금유예금이 최소 ${formatKRW(최소잔금유예금)}보다 ${formatKRW(-여유)} 부족합니다 — 이 분할납부액은 불가능합니다.`);
  } else if (일괄상환만) {
    warnings.push(`최소 잔금유예금(${formatKRW(최소잔금유예금)})만 남았습니다 — 이후에는 일부상환 없이 일괄상환만 가능합니다.`);
  }
  return { 잔금유예금, 최소여유: 여유, 일괄상환만, warnings };
}

/**
 * 잔금유예 이자 — **매년 12월 일할계산, 연납**.
 *
 * 월 상환액이 없다. 해마다 12월에 「그 해에 대출이 살아 있던 일수」만큼의 이자를 낸다.
 * 상담사가 "올해 12월에 얼마 내면 되나"를 답해야 하므로 연도별로 쪼개 돌려준다.
 *
 * 일부상환(100만원 단위, 수수료 없음)을 반영한다 — 상환한 날 이후로는 줄어든 원금에
 * 이자가 붙으므로, 구간을 나누어 일할 계산한다.
 *
 * @param {object} p
 * @param {number} p.원금
 * @param {number|null} p.annualRate   연 이자율. 모르면 null → 이자 null 로 돌려준다.
 * @param {string} p.계약일            'YYYY-MM-DD'
 * @param {string|null} p.청산일       'YYYY-MM-DD' — 있으면 만기는 계약일+만기년과 비교해 **빠른 날**
 * @param {number} p.만기년            기본 10
 * @param {Array<{date:string, amount:number}>} p.일부상환
 * @param {number} p.일수기준          365 (일할계산 분모)
 */
export function deferredInterest({
  원금 = 0, annualRate = null, 계약일 = null, 청산일 = null,
  만기년 = 10, 일부상환 = [], 일수기준 = 365,
} = {}) {
  if (!계약일) {
    return { 만기일: null, 연도별: [], 총이자: null, 총원금: won(원금), reason: '계약일이 없습니다' };
  }
  const start = day(계약일);
  const byTerm = addYears(start, 만기년);
  const settle = 청산일 ? day(청산일) : null;
  // "계약일로부터 10년 or 청산일 중 더 빠른날짜"
  const end = settle && settle < byTerm ? settle : byTerm;
  const 만기근거 = settle && settle < byTerm ? '청산일' : `계약일 + ${만기년}년`;

  if (annualRate == null) {
    return {
      만기일: iso(end), 만기근거, 연도별: [], 총이자: null, 총원금: won(원금),
      reason: '잔금유예 적용금리가 설정되지 않았습니다 — 상담일지에 금리가 적혀 있지 않습니다',
    };
  }

  // 원금 변동표: 시작 원금 + 일부상환 시점
  const events = (일부상환 ?? [])
    .filter((r) => r && r.date && r.amount > 0)
    .map((r) => ({ d: day(r.date), amount: won(r.amount) }))
    .filter((r) => r.d > start && r.d <= end)
    .sort((a, b) => a.d - b.d);

  // 일수는 **반열린구간 [from, to)** 로 센다. 이렇게 하지 않으면 해가 바뀌는 날과
  // 일부상환한 날의 이자가 두 번 계산되어, 10년이면 열흘치가 더 붙는다.
  // 전체 일수의 합은 정확히 dayDiff(계약일, 만기일) 이 되어야 한다 — 테스트가 이를 검사한다.
  const 연도별 = [];
  let balance = won(원금);
  let ei = 0;
  let 총이자 = 0;

  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
    const yStart = new Date(Date.UTC(y, 0, 1));
    const yNext = new Date(Date.UTC(y + 1, 0, 1));
    let from = start > yStart ? start : yStart;
    const to = end < yNext ? end : yNext;   // 배타적 끝
    if (from >= to) continue;

    const 구간 = [];
    let 이자 = 0;
    let 일수합 = 0;

    const accrue = (a, b) => {
      const days = dayDiff(a, b);
      if (days <= 0) return;
      const i = balance * annualRate * days / 일수기준;
      구간.push({ 시작: iso(a), 종료: iso(b), 일수: days, 원금: balance, 이자: won(i) });
      이자 += i; 일수합 += days;
    };

    while (ei < events.length && events[ei].d < to) {
      const e = events[ei];
      accrue(from, e.d);
      balance = Math.max(0, balance - e.amount);
      구간.push({ 일부상환: e.amount, 일자: iso(e.d), 잔액: balance });
      from = e.d;
      ei++;
    }
    accrue(from, to);

    총이자 += 이자;
    연도별.push({
      연도: y,
      납부일: `${y}-12-31`,
      일수: 일수합,
      기말원금: balance,
      이자: won(이자),
      구간,
      만기해: to.getTime() === end.getTime(),
    });
  }

  return {
    만기일: iso(end), 만기근거, annualRate, 일수기준,
    연도별, 총이자: won(총이자), 총원금: balance,
    만기납부액: won(balance + (연도별.at(-1)?.이자 ?? 0)),
    비고: '원금은 만기에 일괄 납부하고, 이자는 매년 12월에 일할계산하여 연납합니다.',
  };
}

/**
 * 일부상환 단위 검사. 100만원 단위가 아니면 접수되지 않는다.
 */
export function checkPrepayUnit(amount, unit = 1_000_000) {
  const a = won(amount);
  if (!unit) return { ok: true, adjusted: a };
  const ok = a > 0 && a % unit === 0;
  return {
    ok,
    adjusted: Math.floor(a / unit) * unit,
    message: ok ? null : `일부상환은 ${formatKRW(unit)} 단위로만 가능합니다 — ${formatKRW(Math.floor(a / unit) * unit)} 또는 ${formatKRW(Math.ceil(a / unit) * unit)}`,
  };
}

/**
 * LH 저소득층 검증 요건. 1·2·3 을 모두 충족하면 LH검증신청서를 제출한다.
 *
 * 자동차는 여러 대여도 **가장 높은 차량가액 1대**로 본다(보험개발원 확인).
 * 국가유공자 자격으로 공급받은 경우에는 요건과 무관하게 신청 가능하다.
 */
export function lhVerification(input = {}, rules = {}) {
  const { 자산가액, 자동차가액, 월소득, 가구원수, 국가유공자 = false } = input;
  const checks = [];

  const add = (label, actual, limit, unit = '원') => {
    if (limit == null) { checks.push({ label, actual, limit: null, unknown: true, message: '기준이 설정되지 않았습니다' }); return; }
    if (actual == null) { checks.push({ label, actual: null, limit, notApplicable: true, message: '해당 없음' }); return; }
    const pass = won(actual) <= won(limit);
    checks.push({
      label, actual: won(actual), limit: won(limit), unit, pass,
      초과액: pass ? 0 : won(actual) - won(limit),
    });
  };

  add('자산가액', 자산가액, rules.자산가액);
  add('자동차가액', 자동차가액, rules.자동차가액);

  const 소득기준 = 가구원수 != null ? rules.월소득?.[String(가구원수)] ?? null : null;
  if (가구원수 == null) {
    checks.push({ label: '월소득', actual: 월소득 ?? null, limit: null, notApplicable: true, message: '가구원수를 입력해야 기준이 정해집니다' });
  } else {
    add(`월소득 (${가구원수}인)`, 월소득, 소득기준);
  }

  const 판정가능 = checks.filter((c) => !c.unknown && !c.notApplicable);
  const 실패 = 판정가능.filter((c) => c.pass === false);
  const 미확정 = checks.filter((c) => c.unknown || c.notApplicable);

  return {
    checks,
    국가유공자예외: Boolean(국가유공자),
    pass: 국가유공자 ? true : (판정가능.length > 0 && 실패.length === 0 && 미확정.length === 0),
    미확정: 미확정.length > 0,
    실패,
    결론: 국가유공자
      ? '국가유공자 자격으로 공급받은 경우 요건과 무관하게 신청 가능합니다.'
      : 실패.length
        ? `${실패.map((c) => `${c.label} ${formatKRW(c.초과액)} 초과`).join(', ')} — LH검증 요건 미충족`
        : 미확정.length
          ? '입력이 부족해 판정할 수 없습니다'
          : '1·2·3 요건 충족 — LH검증신청서 제출 대상',
  };
}

/* ── 날짜 헬퍼. UTC 로만 다룬다(시간대에 따라 하루가 밀리는 것을 막는다). ── */
function day(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function iso(d) {
  return d.toISOString().slice(0, 10);
}
function addYears(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()));
}
function dayDiff(a, b) {
  return Math.round((b - a) / 86400000);
}
