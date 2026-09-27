/**
 * 금액 취급 규칙 (JL 대출데스크)
 *
 * - 모든 금액은 **정수 원(KRW)** 단위 Number 로 다룬다. 수백억도 2^53 안전범위 안이다.
 * - 비율만 실수(0.7 = 70%).
 * - 반올림·절사는 이 파일의 함수로만 한다. 산술 중간에 절대 반올림하지 않는다.
 *   (중간 반올림이 섞이면 은행 산출값과 몇 만원씩 어긋나고 원인을 못 찾는다.)
 */

/** 안전한 정수 원 단위로 정규화. Infinity 는 그대로 통과시킨다(미적용 상한 표현). */
export function won(value) {
  if (value === Infinity || value === -Infinity) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/** unit 단위로 내림. 한도는 통상 만원 단위 절사. floorTo(38_712_345, 10_000) → 38_710_000 */
export function floorTo(amount, unit) {
  if (amount === Infinity) return Infinity;
  if (!Number.isFinite(amount) || !unit) return won(amount);
  return Math.floor(amount / unit) * unit;
}

/** unit 단위로 올림. */
export function ceilTo(amount, unit) {
  if (amount === Infinity) return Infinity;
  if (!Number.isFinite(amount) || !unit) return won(amount);
  return Math.ceil(amount / unit) * unit;
}

/** unit 단위로 반올림. */
export function roundTo(amount, unit) {
  if (amount === Infinity) return Infinity;
  if (!Number.isFinite(amount) || !unit) return won(amount);
  return Math.round(amount / unit) * unit;
}

/** 0 나눗셈에서 NaN/Infinity 가 조용히 퍼지는 것을 막는다. */
export function safeDiv(numerator, denominator, fallback = 0) {
  if (!denominator) return fallback;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : fallback;
}

const 억 = 100_000_000;
const 만 = 10_000;

/**
 * 한국식 금액 표기.
 *   formatKRW(380_000_000)            → "3억 8,000만원"
 *   formatKRW(1_820_000)              → "182만원"
 *   formatKRW(38_712_345, {exact:true}) → "38,712,345원"
 * 미적용 상한(Infinity)은 "제한 없음".
 */
export function formatKRW(amount, { exact = false, sign = false } = {}) {
  if (amount === Infinity) return '제한 없음';
  if (amount === -Infinity) return '-제한 없음';
  if (!Number.isFinite(amount)) return '-';

  const neg = amount < 0;
  const v = Math.abs(Math.round(amount));
  const prefix = neg ? '-' : sign && v !== 0 ? '+' : '';

  if (exact) return `${prefix}${v.toLocaleString('ko-KR')}원`;
  if (v === 0) return '0원';

  const eok = Math.floor(v / 억);
  const man = Math.floor((v % 억) / 만);
  const rest = v % 만;

  const parts = [];
  if (eok) parts.push(`${eok.toLocaleString('ko-KR')}억`);
  if (man) parts.push(`${man.toLocaleString('ko-KR')}만`);
  // 억·만 단위가 하나도 없을 때만 원 단위를 노출한다(1억 3원 같은 표기를 피한다).
  if (!parts.length) return `${prefix}${rest.toLocaleString('ko-KR')}원`;
  return `${prefix}${parts.join(' ')}원`;
}

/** 천단위 구분 기호만. 입력 필드 표시용. */
export function formatNumber(amount) {
  if (!Number.isFinite(amount)) return '';
  return Math.round(amount).toLocaleString('ko-KR');
}

/** 비율 → 퍼센트 문자열. formatPct(0.0485, 2) → "4.85%" */
export function formatPct(ratio, digits = 2) {
  if (!Number.isFinite(ratio)) return '-';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/**
 * 사람이 친 금액 문자열을 원 단위 숫자로.
 * 허용: "380000000", "3억8000만", "3억 8,000만원", "38,000만", "5천만", "3.5억"
 * 단위 표기가 전혀 없으면 숫자를 그대로 원으로 본다.
 */
export function parseKRW(input) {
  if (typeof input === 'number') return won(input);
  if (input == null) return 0;

  const s = String(input).replace(/[\s,원]/g, '');
  if (!s) return 0;
  if (/^-?\d+(\.\d+)?$/.test(s)) return won(Number(s));

  const re = /(-?\d+(?:\.\d+)?)\s*(억|천만|백만|만|천|백)/g;
  let total = 0;
  let matched = false;
  let seenEok = false;   // 억이 먼저 나왔는가
  let m;
  while ((m = re.exec(s)) !== null) {
    matched = true;
    const n = Number(m[1]);
    switch (m[2]) {
      case '억': total += n * 억; seenEok = true; break;
      case '천만': total += n * 1000 * 만; break;
      case '백만': total += n * 100 * 만; break;
      case '만': total += n * 만; break;
      // "3억8천" 의 8천은 8,000원이 아니라 8천만원이다.
      // 억이 앞에 나왔으면 뒤따르는 천·백은 만 단위로 읽는다.
      case '천': total += seenEok ? n * 1000 * 만 : n * 1000; break;
      case '백': total += seenEok ? n * 100 * 만 : n * 100; break;
    }
  }
  if (!matched) {
    const bare = s.match(/-?\d+(\.\d+)?/);
    return bare ? won(Number(bare[0])) : 0;
  }
  // "3억8000만원" 뒤에 단위 없는 꼬리가 붙은 경우(예: "3억8000만500") 무시한다.
  return won(total);
}

/** 퍼센트 입력("4.85", "4.85%", 0.0485) → 비율(0.0485). */
export function parsePct(input) {
  if (typeof input === 'number') {
    // 1 이상이면 퍼센트로 친 것으로 본다(4.85 → 0.0485). 0.0485 는 그대로.
    return input >= 1 ? input / 100 : input;
  }
  if (input == null) return 0;
  const s = String(input).replace(/[\s%]/g, '');
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n >= 1 ? n / 100 : n;
}


/** 만원 단위 표시값. 380,000,000원 → 38000 */
export function toManwon(won) {
  if (!Number.isFinite(won)) return '';
  return Math.round(won / 10_000);
}

/**
 * 만원 단위 입력 해석.
 *
 * 상담사가 "5억" 처럼 단위를 붙여 치는 습관도 그대로 받아야 한다.
 *   "38000"      → 38,000만원 = 380,000,000원
 *   "3억8천"      → 380,000,000원   (단위를 쓰면 절대금액으로 본다)
 *   "3억 8,000만" → 380,000,000원
 */
export function parseManwon(input) {
  if (typeof input === 'number') return won(input * 10_000);
  const s = String(input ?? '').replace(/[\s,]/g, '');
  if (!s) return 0;

  // 억·만·천 같은 단위가 붙어 있으면 절대금액으로 읽는다
  if (/[억만천]/.test(s)) return parseKRW(s);

  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? won(n * 10_000) : 0;
}
