/**
 * 단일 상태 + 구독.
 *
 * ★ origin 추적: 단지에서 자동으로 채워진 값과 상담사가 직접 고친 값을 구분한다.
 *   단지·타입을 다시 고르면 'auto' 인 필드만 갱신하고 'manual' 은 보존한다.
 *   이게 없으면 상담사가 고친 값이 말없이 날아간다 — 현장 도구에서 가장 흔한 불만.
 */

import { defaultInput } from './defaults.js';

export function createStore(initial = null) {
  let state = structuredClone(initial ?? defaultInput());
  /** "collateral.amount" → 'auto' | 'manual' */
  let origins = {};
  const subs = new Set();

  function get() { return state; }
  function originOf(path) { return origins[path] ?? 'manual'; }
  function isEdited(path) { return origins[path] === 'manual' && path in origins; }

  function notify() { for (const fn of subs) fn(state); }

  /** 상담사의 직접 입력. 해당 경로를 manual 로 표시한다. */
  function set(path, value) {
    writePath(state, path, value);
    origins[path] = 'manual';
    notify();
  }

  /** 자동입력. 이미 manual 인 경로는 건드리지 않는다. */
  function setAuto(path, value) {
    if (origins[path] === 'manual') return false;
    writePath(state, path, value);
    origins[path] = 'auto';
    return true;
  }

  /** 여러 경로를 한 번에 자동입력하고 한 번만 알린다. */
  function applyAuto(entries) {
    const skipped = [];
    for (const [path, value] of Object.entries(entries)) {
      if (!setAuto(path, value)) skipped.push(path);
    }
    notify();
    return skipped;
  }

  /** 해당 경로를 단지값으로 되돌린다. */
  function revert(path, autoValue) {
    writePath(state, path, autoValue);
    origins[path] = 'auto';
    notify();
  }

  /** 상태 전체 교체 (상담기록 불러오기). */
  function load(next, nextOrigins = {}) {
    state = structuredClone(next);
    origins = { ...nextOrigins };
    notify();
  }

  function reset() {
    state = defaultInput();
    origins = {};
    notify();
  }

  function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

  return { get, set, setAuto, applyAuto, revert, load, reset, subscribe, originOf, isEdited,
    get origins() { return { ...origins }; } };
}

function writePath(obj, path, value) {
  const keys = path.split('.');
  let node = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (node[keys[i]] == null || typeof node[keys[i]] !== 'object') node[keys[i]] = {};
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
}

export function readPath(obj, path) {
  return path.split('.').reduce((n, k) => (n == null ? undefined : n[k]), obj);
}
