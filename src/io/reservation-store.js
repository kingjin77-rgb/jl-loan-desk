/**
 * 예약자 명단·체크 상태 저장 (브라우저 로컬).
 *
 * 명단에는 연락처가 들어 있다. 이 기기의 이 브라우저에만 남고 서버로 보내지 않는다.
 * 행사가 끝나면 「명단 지우기」로 지운다 — 그 버튼이 화면에 늘 있어야 한다.
 * 체크 상태는 기기마다 따로다(상담사 두 명이 각자 폰으로 쓰면 서로의 체크가 안 보인다).
 */

const KEY = 'jl-loan-desk.reservations';

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && Array.isArray(v.list) ? { states: {}, ...v } : null;
  } catch {
    return null;
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* 저장소가 막혀 있으면 지울 것도 없다 */ }
}
