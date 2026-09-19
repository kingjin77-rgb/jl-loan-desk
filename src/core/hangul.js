/**
 * 한국어 조사 처리.
 *
 * 화면 문장을 변수로 조립하다 보면 "LTV 한도이 막고 있습니다" 같은 문장이 나온다.
 * 상담사가 고객 앞에서 읽는 화면이므로 이런 게 남아 있으면 안 된다.
 *
 * 받침 유무로 고른다. 한글 음절은 (코드 - 0xAC00) % 28 로 종성을 알 수 있고,
 * 숫자·영문으로 끝나면 읽는 소리를 기준으로 판단한다.
 */

const PAIRS = {
  '이/가': ['이', '가'],
  '은/는': ['은', '는'],
  '을/를': ['을', '를'],
  '과/와': ['과', '와'],
  '으로/로': ['으로', '로'],
  '이나/나': ['이나', '나'],
  '이라/라': ['이라', '라'],
};

/** 숫자를 한국어로 읽었을 때의 끝소리에 받침이 있는가. (0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔) */
const DIGIT_HAS_FINAL = { 0: true, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: true, 8: true, 9: false };

/** 영문 알파벳 한 글자를 읽었을 때 받침이 있는가. (L 엘, M 엠, N 엔, R 알, ...) */
const ALPHA_HAS_FINAL = {
  a: false, b: false, c: false, d: false, e: false, f: true, g: false, h: false,
  i: false, j: false, k: false, l: true, m: true, n: true, o: false, p: false,
  q: false, r: true, s: true, t: false, u: false, v: false, w: false, x: true,
  y: false, z: false,
};

/**
 * 마지막 글자에 받침이 있는가.
 * @returns {boolean|null} 판단할 수 없으면 null
 */
export function hasFinalConsonant(word) {
  const s = String(word ?? '').trim();
  if (!s) return null;

  // 괄호 등 뒤에 붙은 기호는 무시하고 실제 읽는 글자를 찾는다
  const m = s.match(/[가-힣A-Za-z0-9](?=[^가-힣A-Za-z0-9]*$)/);
  const ch = m ? m[0] : s[s.length - 1];

  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (ch >= '0' && ch <= '9') return DIGIT_HAS_FINAL[ch];
  const lower = ch.toLowerCase();
  if (lower in ALPHA_HAS_FINAL) return ALPHA_HAS_FINAL[lower];
  return null;
}

/**
 * 조사를 골라 붙인다.
 *   josa('LTV 한도', '이/가')  → 'LTV 한도가'
 *   josa('DSR 한도', '이/가')  → 'DSR 한도가'
 *   josa('방공제', '을/를')    → '방공제를'
 *   josa('잔금대출', '으로/로') → '잔금대출로'
 *
 * 판단할 수 없으면 "이(가)" 형태로 둘 다 적는다 — 틀린 조사보다 낫다.
 */
export function josa(word, pair) {
  const [withFinal, withoutFinal] = PAIRS[pair] ?? pair.split('/');
  const has = hasFinalConsonant(word);
  if (has === null) return `${word}${withFinal}(${withoutFinal})`;

  // '으로/로'만 예외다: 받침이 ㄹ이면 받침이 없는 것처럼 '로'를 쓴다.
  // (잔금대출으로 ✗ → 잔금대출로 ✓)
  if (pair === '으로/로' && has && endsWithRieul(word)) return `${word}${withoutFinal}`;

  return `${word}${has ? withFinal : withoutFinal}`;
}

/** 마지막 글자의 종성이 ㄹ인가. */
function endsWithRieul(word) {
  const m = String(word ?? '').match(/[가-힣](?=[^가-힣A-Za-z0-9]*$)/);
  if (!m) return false;
  return (m[0].charCodeAt(0) - 0xac00) % 28 === 8;
}
