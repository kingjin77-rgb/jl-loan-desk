/**
 * 내가 만든 단지 보관함 (브라우저 로컬).
 *
 * 저장소나 사이트에 올리지 않는다 — 공개되면 분양가·취급은행이 노출된다.
 * 이 기기의 이 브라우저에만 남고, 동료와는 JSON 내보내기로 주고받는다.
 */

const KEY = 'jl-loan-desk.complexes.v1';
const MAX = 100;

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    throw new Error(
      `단지를 저장하지 못했습니다. 브라우저 저장공간이 가득 찼을 수 있습니다.\n` +
      `쓰지 않는 단지를 지운 뒤 다시 시도하십시오. (${e.name})`
    );
  }
}

export function isAvailable() {
  try {
    localStorage.setItem('__jl_t__', '1');
    localStorage.removeItem('__jl_t__');
    return true;
  } catch {
    return false;
  }
}

/** 목록 — 화면 셀렉트에 바로 쓸 수 있는 모양. */
export function list() {
  return readAll()
    .sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''))
    .map((r) => ({
      complexId: r.doc.complexId,
      name: r.doc.name,
      sigungu: [r.doc.location?.sido, r.doc.location?.sigungu].filter(Boolean).join(' '),
      입주예정: r.doc.moveIn?.예정시기 ?? r.doc.moveIn?.입주지정기간?.start ?? '',
      savedAt: r.savedAt,
      mine: true,
    }));
}

export function get(complexId) {
  return readAll().find((r) => r.doc.complexId === complexId)?.doc ?? null;
}

/** 같은 complexId 가 있으면 덮어쓴다(수정). */
export function save(doc) {
  const all = readAll();
  const i = all.findIndex((r) => r.doc.complexId === doc.complexId);
  const rec = { doc, savedAt: new Date().toISOString() };
  if (i >= 0) all[i] = rec;
  else all.unshift(rec);
  writeAll(all.slice(0, MAX));
  return doc;
}

export function remove(complexId) {
  writeAll(readAll().filter((r) => r.doc.complexId !== complexId));
}

export function count() {
  return readAll().length;
}

/** 공용 PC 정리용. 되돌릴 수 없다. */
export function clearAll() {
  try { localStorage.removeItem(KEY); } catch { /* 이미 못 쓰는 저장소면 남은 것도 없다 */ }
}

/** 동료에게 넘길 묶음. */
export function exportAll() {
  return { kind: 'jl-loan-desk.complexes', version: 1, exportedAt: new Date().toISOString(), complexes: readAll().map((r) => r.doc) };
}

/**
 * 묶음 또는 단일 단지 파일을 받아들인다.
 * @returns {{added:number, replaced:number, names:string[]}}
 */
export function importBundle(parsed) {
  const docs = Array.isArray(parsed?.complexes) ? parsed.complexes
    : parsed?.complexId ? [parsed]
    : null;
  if (!docs) throw new Error('단지 파일이 아닙니다. 단지 하나 또는 내보내기 묶음을 넣어 주십시오.');

  let added = 0;
  let replaced = 0;
  const names = [];
  for (const d of docs) {
    if (!d?.complexId) continue;
    const exists = get(d.complexId) != null;
    save(d);
    if (exists) replaced++; else added++;
    names.push(d.name ?? d.complexId);
  }
  return { added, replaced, names };
}
