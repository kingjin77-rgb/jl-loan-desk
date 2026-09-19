/**
 * node:test ↔ 브라우저 러너 분기 shim.
 *
 * 테스트 파일은 자기가 어느 환경에서 도는지 몰라야 한다. 여기서만 분기한다.
 *   - node:  `node --test test/`
 *   - 브라우저: /test/index.html  (개발환경 없는 사무실에서도 URL 하나로 확인)
 */

const isNode = typeof process !== 'undefined' && process.versions?.node;

let test, assert;

if (isNode) {
  ({ test } = await import('node:test'));
  assert = (await import('node:assert/strict')).default;
} else {
  const runner = await import('./runner.js');
  test = runner.test;
  assert = runner.assert;
}

export { test, assert };

/** 금액 비교. 부동소수 잔돈 때문에 정확히 같기를 요구하지 않는다(기본 1원 허용). */
export function assertClose(actual, expected, tolerance = 1, message = '') {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message || '값 불일치'}: 실제 ${Math.round(actual).toLocaleString()} / 기대 ${Math.round(expected).toLocaleString()} (차이 ${Math.round(diff).toLocaleString()}, 허용 ${tolerance})`
  );
}
