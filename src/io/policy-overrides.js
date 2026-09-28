/**
 * 규제 수치 덮어쓰기.
 *
 * 규제 수치는 `data/policy/*.json` 에 있고, 그 파일은 **건드리지 않는다.**
 * 상담사가 원문에서 확인해 넣은 값은 이 브라우저에만 얹힌다.
 *
 * 왜 파일을 안 고치는가:
 *  - 배포본은 GitHub Pages 의 정적 파일이라 브라우저가 고칠 수 없다.
 *  - 파일을 손으로 고치게 하면 아무도 안 고친다(단지 입력에서 이미 겪었다).
 *  - 원본을 남겨야 "기본값이 무엇이었는지"와 "누가 무엇을 바꿨는지"가 남는다.
 *
 * ★ 덮어쓴 값이 조용히 끼면 어느 숫자가 어디서 왔는지 모르게 된다.
 *   그래서 적용된 문서마다 __overrides 에 바뀐 경로를 남기고, 화면이 그것을 표시한다.
 */

const KEY = 'jl-loan-desk.policy-overrides';
const VERSION = 1;

function safeGet() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function safeSet(v) {
  try { localStorage.setItem(KEY, v); return true; } catch { return false; }
}

export function emptyOverrides() {
  return { version: VERSION, updatedAt: null, policies: {} };
}

/** @returns {{version, updatedAt, policies: {[key:string]: {values:{[path]:any}, meta:object}}}} */
export function loadOverrides() {
  const raw = safeGet();
  if (!raw) return emptyOverrides();
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || !o.policies) return emptyOverrides();
    return { ...emptyOverrides(), ...o };
  } catch {
    // 깨진 저장값 때문에 앱이 멈추면 안 된다. 없는 것으로 본다.
    return emptyOverrides();
  }
}

export function saveOverrides(o) {
  const next = { ...o, version: VERSION, updatedAt: new Date().toISOString() };
  return safeSet(JSON.stringify(next)) ? next : null;
}

export function clearOverrides() {
  try { localStorage.removeItem(KEY); } catch { /* 이미 못 쓰는 저장소면 남은 것도 없다 */ }
}

/** 덮어쓴 값이 하나라도 있는가. */
export function hasOverrides(o) {
  return Object.values(o?.policies ?? {}).some((p) => Object.keys(p?.values ?? {}).length > 0);
}

export function countOverrides(o) {
  return Object.values(o?.policies ?? {}).reduce((n, p) => n + Object.keys(p?.values ?? {}).length, 0);
}

/* ── 점·대괄호 경로 ("rules[3].ltv", "limits.은행권") ── */

export function getPath(obj, path) {
  return tokens(path).reduce((n, k) => (n == null ? undefined : n[k]), obj);
}

export function setPath(obj, path, value) {
  const ks = tokens(path);
  let n = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    const k = ks[i];
    if (n[k] == null || typeof n[k] !== 'object') {
      // 다음 토큰이 숫자면 배열이어야 한다
      n[k] = /^\d+$/.test(String(ks[i + 1])) ? [] : {};
    }
    // 배열에 구멍(hole)을 남기지 않는다. 구멍이 있으면 JSON 왕복에서
    // undefined ↔ null 이 어긋나고, 길이만 늘어난 이상한 배열이 저장된다.
    if (Array.isArray(n[k])) {
      const idx = Number(ks[i + 1]);
      if (Number.isInteger(idx)) {
        for (let j = n[k].length; j < idx; j++) n[k][j] = null;
      }
    }
    n = n[k];
  }
  const last = ks[ks.length - 1];
  if (Array.isArray(n) && Number.isInteger(Number(last))) {
    for (let j = n.length; j < Number(last); j++) n[j] = null;
  }
  n[last] = value;
  return obj;
}

function tokens(path) {
  return String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s !== '');
}

/**
 * 설정 문서에 덮어쓴 값을 얹는다. 원본을 바꾸지 않고 **복사본**을 돌려준다.
 *
 * @param {object} doc      정책 문서 (ltv/dsr/...)
 * @param {object} entry    { values: {path: value}, meta: {출처, 출처URL, verified, 확인일} }
 */
export function applyOverride(doc, entry) {
  if (!doc || !entry || !Object.keys(entry.values ?? {}).length) return doc;

  const next = structuredClone(doc);
  const applied = [];
  for (const [path, value] of Object.entries(entry.values)) {
    if (value === undefined) continue;
    setPath(next, path, value);
    applied.push(path);
  }

  next.__overrides = applied;
  next.meta = {
    ...next.meta,
    출처: entry.meta?.출처 || next.meta?.출처 || '상담사 직접 입력',
    출처URL: entry.meta?.출처URL || next.meta?.출처URL || '',
    // 상담사가 "원문에서 확인했다"고 표시한 경우에만 검수완료로 본다.
    // 값을 넣었다는 사실만으로 verified 를 올리지 않는다 — 그건 확인이 아니다.
    verified: Boolean(entry.meta?.verified),
    확인일: entry.meta?.확인일 || null,
    직접입력: true,
  };
  return next;
}

/** 프로파일 전체에 적용. loader 가 마지막에 부른다. */
export function applyAll(policies, overrides) {
  const o = overrides ?? loadOverrides();
  const out = {};
  for (const [key, doc] of Object.entries(policies ?? {})) {
    const entry = o.policies?.[key];
    out[key] = entry ? applyOverride(doc, entry) : doc;
  }
  return out;
}

/**
 * 예시 수치로 **빈 칸만** 메운다.
 *
 * 규제 파일 전체를 예시로 바꾸면, 상담사가 확인해 넣은 값(규제지역 40% 등)까지
 * 버려진다. 실제로 그랬다 — 6개 규칙을 채웠는데 1주택 규칙이 비었다는 이유로
 * 파일이 통째로 예시가 됐다. 그래서 null 인 칸에만 예시값을 넣고, 어느 칸을 메웠는지
 * meta.exampleFilled 에 경로로 남긴다. 각 계산 모듈은 자기가 **실제로 쓴 칸**이
 * 예시인지 그 목록으로 판단한다.
 *
 * @returns {{doc:object, filled:string[]}}  원본을 바꾸지 않는다.
 */
export function fillFromExample(real, example) {
  if (!real || !example) return { doc: real, filled: [] };
  const doc = structuredClone(real);
  const filled = [];
  walk(doc, example, '');
  return { doc, filled };

  function walk(dst, src, prefix) {
    if (dst == null || src == null || typeof src !== 'object') return;
    for (const [k, sv] of Object.entries(src)) {
      if (k === 'meta' || k.startsWith('_') || k.startsWith('__')) continue;
      const path = Array.isArray(dst) ? `${prefix}[${k}]` : (prefix ? `${prefix}.${k}` : k);
      const dv = dst[k];
      if (dv === null || dv === undefined) {
        if (sv !== null && sv !== undefined && typeof sv !== 'object') {
          dst[k] = sv;
          filled.push(path);
        }
        continue;
      }
      if (typeof dv === 'object' && typeof sv === 'object') walk(dv, sv, path);
    }
  }
}

/** 예시로 메운 칸 목록에서, 주어진 경로(또는 접두어)가 예시인지. */
export function isExampleFilled(meta, ...paths) {
  const list = meta?.exampleFilled ?? [];
  return paths.some((p) => list.some((f) => f === p || f.startsWith(p + '.') || f.startsWith(p + '[')));
}

/* ── 파일로 주고받기 ── */

export function toFile(o) {
  return JSON.stringify({
    _설명: [
      'JL 대출데스크 — 규제 수치 직접 입력값입니다.',
      '「규제 수치」 화면의 「가져오기」로 다른 PC에 옮길 수 있습니다.',
      '고객 정보는 들어 있지 않습니다.',
    ],
    ...o,
  }, null, 2);
}

export function fromFile(text) {
  const o = JSON.parse(text);
  if (!o || typeof o !== 'object' || !o.policies) {
    throw new Error('규제 수치 파일이 아닙니다 (policies 블록이 없습니다).');
  }
  return { ...emptyOverrides(), ...o, version: VERSION };
}
