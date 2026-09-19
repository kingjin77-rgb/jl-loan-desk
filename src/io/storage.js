/**
 * 상담기록 저장 (브라우저 로컬).
 *
 * 서버가 없다. 저장된 것은 이 PC의 이 브라우저에만 남는다.
 * ★ 사무실 공용 PC 를 전제로 만든다 — 전체 삭제 버튼이 반드시 있어야 하고,
 *   고객 실명을 넣지 말라는 안내가 화면에 있어야 한다.
 */

const KEY = 'jl-loan-desk.records.v1';
const MAX_RECORDS = 200;

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    // 용량 초과 등. 조용히 실패하면 상담사는 저장된 줄 안다.
    throw new Error(`상담기록을 저장하지 못했습니다. 브라우저 저장공간이 가득 찼을 수 있습니다.\n오래된 기록을 삭제한 뒤 다시 시도하십시오.\n(${e.name})`);
  }
}

export function isAvailable() {
  try {
    const k = '__jl_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function list() {
  return readAll().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export function save(record) {
  const all = readAll();
  const now = new Date().toISOString();
  const i = all.findIndex((r) => r.recordId === record.recordId);
  const next = { ...record, updatedAt: now, createdAt: record.createdAt ?? now };
  if (i >= 0) all[i] = next;
  else all.unshift(next);
  writeAll(all.slice(0, MAX_RECORDS));
  return next;
}

export function get(recordId) {
  return readAll().find((r) => r.recordId === recordId) ?? null;
}

export function remove(recordId) {
  writeAll(readAll().filter((r) => r.recordId !== recordId));
}

/** 공용 PC 정리용. 되돌릴 수 없다 — 호출 전에 반드시 확인을 받는다. */
export function clearAll() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* 저장소가 막혀 있으면 이미 남은 것도 없다 */ }
}

export function count() {
  return readAll().length;
}
