/**
 * 날짜 유틸 — 중도금 회차·후불이자 일할계산의 기준.
 *
 * 모든 날짜는 "YYYY-MM-DD" 문자열로 주고받는다. Date 객체를 앱 상태에 넣지 않는다
 * (타임존 때문에 하루가 밀리는 사고를 원천 차단).
 * 내부 계산은 UTC 정오 기준 Date 로 변환해 DST·타임존 영향을 없앤다.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" → Date(UTC 정오). 잘못된 값이면 null. */
export function toDate(iso) {
  if (iso instanceof Date) return new Date(Date.UTC(iso.getFullYear(), iso.getMonth(), iso.getDate(), 12));
  if (typeof iso !== 'string') return null;
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → "YYYY-MM-DD" */
export function toISO(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isValidISO(iso) {
  return toDate(iso) !== null;
}

/** 실제 경과일수(ACT). 후불이자 일할계산의 기준. b가 a보다 이르면 음수. */
export function daysBetween(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / DAY_MS);
}

/** 개월 가산. 말일 처리: 1/31 + 1개월 = 2/28(윤년 2/29). */
export function addMonths(iso, months) {
  const d = toDate(iso);
  if (!d) return null;
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toISO(target);
}

export function addDays(iso, days) {
  const d = toDate(iso);
  if (!d) return null;
  return toISO(new Date(d.getTime() + days * DAY_MS));
}

/** 두 날짜 사이의 완전한 개월 수. */
export function monthsBetween(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return 0;
  let m = (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
  if (db.getUTCDate() < da.getUTCDate()) m -= 1;
  return m;
}

/** a < b ? -1 : a > b ? 1 : 0 */
export function compareISO(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return 0;
  return da < db ? -1 : da > db ? 1 : 0;
}

/** 오늘(로컬 기준) "YYYY-MM-DD". */
export function today() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/** "2028-06" 같은 연월을 그 달 1일로 확장. 이미 완전한 날짜면 그대로. */
export function expandYearMonth(value, { endOfMonth = false } = {}) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  if (!endOfMonth) return `${m[1]}-${m[2]}-01`;
  const last = new Date(Date.UTC(+m[1], +m[2], 0, 12)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`;
}

/** 두 날짜의 중간 지점. 입주지정기간 start/중간/end 토글에 쓴다. */
export function midpoint(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return a ?? b ?? null;
  return toISO(new Date((da.getTime() + db.getTime()) / 2));
}

/** 사람이 읽는 표기: "2028-06-01" → "2028년 6월 1일" */
export function formatKo(iso, { withDay = true } = {}) {
  const d = toDate(iso);
  if (!d) return '-';
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return withDay ? `${y}년 ${m}월 ${d.getUTCDate()}일` : `${y}년 ${m}월`;
}
