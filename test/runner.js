/**
 * 브라우저용 최소 테스트 러너.
 *
 * 개발환경이 없는 사무실 PC에서도 /test/ 주소만 열면 "계산 엔진이 정상인지"
 * 확인할 수 있어야 한다. node:test 와 같은 모양의 test/assert 를 내보낸다.
 */

const queue = [];
let running = false;

export function test(name, fn) {
  queue.push({ name, fn });
  if (!running) {
    running = true;
    queueMicrotask(run);
  }
}

export const assert = Object.assign(
  function assert(v, msg) { if (!v) throw new AssertionError(msg || '값이 참이 아닙니다'); },
  {
    ok(v, msg) { if (!v) throw new AssertionError(msg || '값이 참이 아닙니다'); },
    equal(a, b, msg) {
      if (!Object.is(a, b)) throw new AssertionError(msg || `${fmt(a)} !== ${fmt(b)}`);
    },
    notEqual(a, b, msg) {
      if (Object.is(a, b)) throw new AssertionError(msg || `${fmt(a)} 이(가) 같습니다`);
    },
    deepEqual(a, b, msg) {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new AssertionError(msg || `${fmt(a)} !== ${fmt(b)}`);
    },
    throws(fn, expected, msg) {
      let threw = null;
      try { fn(); } catch (e) { threw = e; }
      if (!threw) throw new AssertionError(msg || '예외가 발생하지 않았습니다');
      if (typeof expected === 'function' && !(threw instanceof expected)) {
        throw new AssertionError(msg || `예외 종류가 다릅니다: ${threw.name}`);
      }
    },
    // node:assert 와 같은 모양을 유지해야 한다. 여기 없는 메서드를 테스트가 쓰면
    // node 에서는 통과하고 브라우저에서만 "is not a function" 으로 터진다.
    match(value, re, msg) {
      if (!re.test(String(value))) {
        throw new AssertionError(msg || `${fmt(value)} 이(가) ${re} 와 일치하지 않습니다`);
      }
    },
    doesNotMatch(value, re, msg) {
      if (re.test(String(value))) {
        throw new AssertionError(msg || `${fmt(value)} 이(가) ${re} 와 일치합니다`);
      }
    },
    notDeepEqual(a, b, msg) {
      if (JSON.stringify(a) === JSON.stringify(b)) throw new AssertionError(msg || `${fmt(a)} 이(가) 같습니다`);
    },
    deepStrictEqual(a, b, msg) {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new AssertionError(msg || `${fmt(a)} !== ${fmt(b)}`);
    },
    strictEqual(a, b, msg) {
      if (!Object.is(a, b)) throw new AssertionError(msg || `${fmt(a)} !== ${fmt(b)}`);
    },
    fail(msg) { throw new AssertionError(msg || '실패'); },
  }
);

class AssertionError extends Error {
  constructor(m) { super(m); this.name = 'AssertionError'; }
}

function fmt(v) {
  if (typeof v === 'number') return v.toLocaleString('ko-KR');
  try { return JSON.stringify(v); } catch { return String(v); }
}

async function run() {
  // 모든 테스트 파일의 import 가 끝날 때까지 한 틱 더 기다린다.
  await new Promise((r) => setTimeout(r, 0));
  const out = document.getElementById('results');
  const summary = document.getElementById('summary');
  let pass = 0;
  let fail = 0;

  for (const { name, fn } of queue) {
    const row = document.createElement('tr');
    try {
      await fn();
      pass++;
      row.className = 'pass';
      row.innerHTML = `<td class="mark">통과</td><td>${escapeHtml(name)}</td><td></td>`;
    } catch (e) {
      fail++;
      row.className = 'fail';
      row.innerHTML = `<td class="mark">실패</td><td>${escapeHtml(name)}</td><td><code>${escapeHtml(e.message)}</code></td>`;
    }
    out.append(row);
  }

  summary.textContent = `${queue.length}건 중 ${pass}건 통과, ${fail}건 실패`;
  summary.className = fail ? 'fail' : 'pass';
  document.title = `${fail ? '실패' : '통과'} · JL 대출데스크 테스트`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
