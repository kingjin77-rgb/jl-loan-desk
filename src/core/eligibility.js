/**
 * 정책자금 자격판정.
 *
 * ★ 자격요건을 코드에 넣지 않는다. JSON 규칙으로 기술하고 여기서 해석한다.
 *   상품이 늘거나 요건이 바뀌어도 코드는 그대로다 — data/products/*.json 만 고친다.
 *
 * ★ 탈락도 정보다. "부적격"만 알려주면 상담이 끊긴다. **무엇이 얼마나 모자라서**
 *   떨어졌는지까지 돌려준다. 그래야 상담사가 "자산을 3,200만원만 줄이시면 됩니다"
 *   같은 말을 할 수 있다.
 *
 * 규칙 모양:
 *   { "and": [ {path, op, value, label}, { "or": [...] } ] }
 * 지원 연산자: lte gte lt gt eq neq in nin between exists
 */

import { formatKRW, formatPct } from './money.js';

const OPS = {
  lte: (a, b) => a <= b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  gt: (a, b) => a > b,
  eq: (a, b) => String(a) === String(b),
  neq: (a, b) => String(a) !== String(b),
  in: (a, b) => Array.isArray(b) && b.some((x) => String(x) === String(a)),
  nin: (a, b) => Array.isArray(b) && !b.some((x) => String(x) === String(a)),
  between: (a, b) => Array.isArray(b) && a >= b[0] && a <= b[1],
  exists: (a, b) => (b === false ? a == null : a != null),
};

/** ctx 에서 "borrower.annualIncome" 같은 경로를 읽는다. */
export function readPath(ctx, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((n, k) => (n == null ? undefined : n[k]), ctx);
}

/**
 * @param {object} rules  JSON 규칙 (and/or/not 또는 단일 조건)
 * @param {object} ctx    판정 대상 값들
 * @returns {{eligible:boolean, checks:Array, failed:Array, unknown:Array}}
 *   checks[i] = { label, path, op, required, actual, pass, unknown, shortBy, message }
 */
export function evaluate(rules, ctx) {
  const checks = [];
  const eligible = walk(rules, ctx, checks);
  return {
    eligible,
    checks,
    // 충족된 or 안에서 실패한 가지는 탈락 사유가 아니다.
    // ("신혼부부 또는 다자녀" 에서 신혼으로 통과했다면 다자녀 미달은 사유가 아니다)
    failed: checks.filter((c) => !c.pass && !c.unknown && !c.inSatisfiedOr),
    unknown: checks.filter((c) => c.unknown && !c.inSatisfiedOr),
    // 입력이 없어 판정하지 못한 항목. failed 에도 들어가지만, 호출부가
    // "모르는 것"과 "안 되는 것"을 구분해야 할 때가 있다(만기별 나이요건 등).
    notApplicable: checks.filter((c) => c.notApplicable && !c.inSatisfiedOr),
  };
}

function walk(node, ctx, checks) {
  if (!node) return true;

  if (Array.isArray(node.and)) return node.and.map((n) => walk(n, ctx, checks)).every(Boolean);

  if (Array.isArray(node.or)) {
    // or 는 가지별로 따로 기록한 뒤 하나라도 통과하면 참.
    // 통과한 가지가 있으면 나머지 가지의 실패는 탈락 사유가 아니므로 표시에서 뺀다.
    const before = checks.length;
    const results = node.or.map((n) => walk(n, ctx, checks));
    if (results.some(Boolean)) {
      for (let i = before; i < checks.length; i++) checks[i].inSatisfiedOr = true;
      return true;
    }
    return false;
  }

  if (node.not) return !walk(node.not, ctx, checks);

  return check(node, ctx, checks);
}

function check(cond, ctx, checks) {
  const { path, op, value, label, unit } = cond;
  const fn = OPS[op];

  if (!fn) {
    checks.push({
      label: label ?? path, path, op, required: value, actual: undefined,
      pass: false, unknown: true,
      message: `알 수 없는 조건 연산자 "${op}" 입니다. 설정 파일을 확인하십시오.`,
    });
    return false;
  }

  const actual = readPath(ctx, path);

  // 요건 값이 아직 안 채워진 항목(_확인필요)은 "탈락"이 아니라 "판정 불가"다.
  // 이걸 탈락으로 처리하면 값을 안 채운 상품이 전부 부적격으로 보인다.
  if (value == null && op !== 'exists') {
    checks.push({
      label: label ?? path, path, op, required: null, actual,
      pass: true, unknown: true,
      message: `${label ?? path}: 요건 값이 설정되지 않아 판정할 수 없습니다`,
    });
    return true;
  }

  if (actual === undefined || actual === null) {
    // 값이 없다는 것은 대개 "해당 사항이 없다"는 뜻이다(신생아 없음, 나이 미입력 등).
    // 이건 프로그램이 판정을 못 한 것이 아니라 요건에 해당하지 않는 것이므로,
    // 부적격으로 두되 사유는 그렇게 읽히게 쓴다.
    checks.push({
      label: label ?? path, path, op, required: value, actual: null,
      pass: false, unknown: false, notApplicable: true,
      message: `${label ?? path}: 해당 없음`,
    });
    return false;
  }

  const pass = fn(actual, value);
  const entry = {
    label: label ?? path, path, op, required: value, actual, pass, unknown: false, unit,
  };

  if (!pass) {
    // 수치 조건이면 얼마나 모자라는지/넘는지 계산한다.
    entry.shortBy = shortfallOf(op, actual, value);
    entry.message = failMessage(entry);
  }

  checks.push(entry);
  return pass;
}

/** 초과분(양수) 또는 부족분(양수). 수치 조건이 아니면 null. */
function shortfallOf(op, actual, value) {
  if (typeof actual !== 'number') return null;
  if (op === 'lte' || op === 'lt') return typeof value === 'number' ? actual - value : null;
  if (op === 'gte' || op === 'gt') return typeof value === 'number' ? value - actual : null;
  if (op === 'between' && Array.isArray(value)) {
    if (actual < value[0]) return value[0] - actual;
    if (actual > value[1]) return actual - value[1];
  }
  return null;
}

function failMessage(e) {
  const fmt = (v) => {
    if (typeof v !== 'number') return Array.isArray(v) ? v.join(' ~ ') : String(v);
    if (e.unit === '%') return formatPct(v);
    if (e.unit === '원' || v >= 1_000_000) return formatKRW(v);
    return v.toLocaleString('ko-KR') + (e.unit ? e.unit : '');
  };

  const over = e.shortBy != null && e.shortBy > 0;
  switch (e.op) {
    case 'lte':
    case 'lt':
      return `${e.label} ${fmt(e.actual)} — 기준 ${fmt(e.required)}${over ? `, ${fmt(e.shortBy)} 초과` : ''}`;
    case 'gte':
    case 'gt':
      return `${e.label} ${fmt(e.actual)} — 기준 ${fmt(e.required)}${over ? `, ${fmt(e.shortBy)} 부족` : ''}`;
    case 'eq':
      return `${e.label}: ${fmt(e.actual)} (기준 ${fmt(e.required)})`;
    case 'in':
      return `${e.label}: ${fmt(e.actual)} — 해당 없음`;
    case 'between':
      return `${e.label} ${fmt(e.actual)} — 기준 ${fmt(e.required)}${over ? `, ${fmt(e.shortBy)} 벗어남` : ''}`;
    default:
      return `${e.label}: 요건 미충족`;
  }
}

/** 화면에 띄울 탈락 사유 한 줄. 여러 개면 가장 큰 격차부터. */
export function summarizeFailure(result) {
  if (result.eligible) return '';
  const fails = [...result.failed].sort((a, b) => (b.shortBy ?? 0) - (a.shortBy ?? 0));
  if (!fails.length) {
    const u = result.unknown.find((c) => !c.pass);
    return u ? u.message : '요건 미충족';
  }
  const head = fails[0].message;
  return fails.length > 1 ? `${head} 외 ${fails.length - 1}건` : head;
}
