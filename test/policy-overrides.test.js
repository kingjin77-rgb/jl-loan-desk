/**
 * 규제 수치 덮어쓰기.
 *
 * 설정 파일은 GitHub Pages 의 정적 파일이라 브라우저가 못 고친다. 그렇다고 JSON 을
 * 손으로 쓰게 하면 아무도 안 쓴다(단지 입력에서 이미 겪었다). 그래서 파일 위에
 * 얹는다. 원본을 바꾸지 않는 것이 이 모듈의 전제다.
 */
import { test, assert } from './env.js';
import {
  applyOverride, applyAll, getPath, setPath,
  hasOverrides, countOverrides, emptyOverrides, toFile, fromFile,
} from '../src/io/policy-overrides.js';

const 문서 = () => ({
  meta: { id: 'ltv', 기준일: '2026-09-19', 출처: '', verified: false },
  rules: [{ id: 'a', ltv: null }, { id: 'b', ltv: null }],
  limits: { 은행권: null, 제2금융권: null },
});

test('경로 읽기·쓰기 — 배열 인덱스를 포함한다', () => {
  const o = { rules: [{ ltv: 1 }, { ltv: 2 }], a: { b: 3 } };
  assert.equal(getPath(o, 'rules[1].ltv'), 2);
  assert.equal(getPath(o, 'a.b'), 3);
  assert.equal(getPath(o, '없는.경로'), undefined);
  assert.deepEqual(setPath({}, 'x.y[1].z', 9), { x: { y: [null, { z: 9 }] } });
});

test('★ 원본을 바꾸지 않는다 — 파일값이 무엇이었는지 남아야 한다', () => {
  const d = 문서();
  const out = applyOverride(d, { values: { 'rules[0].ltv': 0.5 }, meta: {} });
  assert.equal(out.rules[0].ltv, 0.5);
  assert.equal(d.rules[0].ltv, null, '원본은 그대로여야 한다');
});

test('덮어쓴 경로를 __overrides 에 남긴다 — 어느 숫자가 직접 입력인지 알아야 한다', () => {
  const out = applyOverride(문서(), { values: { 'rules[0].ltv': 0.5, 'limits.은행권': 0.4 }, meta: {} });
  assert.deepEqual(out.__overrides.sort(), ['limits.은행권', 'rules[0].ltv']);
  assert.equal(out.meta.직접입력, true);
});

test('★ 값을 넣었다는 사실만으로 검수완료가 되지 않는다', () => {
  const 값만 = applyOverride(문서(), { values: { 'rules[0].ltv': 0.5 }, meta: {} });
  assert.equal(값만.meta.verified, false, '확인 체크를 안 했으면 미검증이다');

  const 확인함 = applyOverride(문서(), { values: { 'rules[0].ltv': 0.5 }, meta: { verified: true, 확인일: '2026-09-28' } });
  assert.equal(확인함.meta.verified, true);
  assert.equal(확인함.meta.확인일, '2026-09-28');
});

test('덮어쓴 값이 없으면 문서를 그대로 돌려준다 (불필요한 복사 없음)', () => {
  const d = 문서();
  assert.equal(applyOverride(d, { values: {}, meta: {} }), d);
  assert.equal(applyOverride(d, null), d);
});

test('applyAll — 해당 키만 얹는다', () => {
  const policies = { ltv: 문서(), dsr: { meta: { id: 'dsr' }, limits: { 은행권: null } } };
  const out = applyAll(policies, { policies: { dsr: { values: { 'limits.은행권': 0.4 }, meta: {} } } });
  assert.equal(out.dsr.limits.은행권, 0.4);
  assert.equal(out.ltv, policies.ltv, '건드리지 않은 키는 같은 객체');
});

test('세기', () => {
  const o = { policies: { ltv: { values: { a: 1, b: 2 } }, dsr: { values: { c: 3 } } } };
  assert.equal(countOverrides(o), 3);
  assert.equal(hasOverrides(o), true);
  assert.equal(hasOverrides(emptyOverrides()), false);
});

test('파일 왕복 — 고객 정보가 섞이지 않는다', () => {
  const o = { ...emptyOverrides(), policies: { ltv: { values: { 'rules[0].ltv': 0.5 }, meta: { 출처: '보도자료' } } } };
  const back = fromFile(toFile(o));
  assert.deepEqual(back.policies, o.policies);
  // 규제 수치만 담긴다 — 상담 내용이 들어갈 자리가 없다
  assert.deepEqual(Object.keys(back.policies.ltv).sort(), ['meta', 'values']);
});

test('엉뚱한 파일은 이유를 말하고 거부한다', () => {
  assert.throws(() => fromFile(JSON.stringify({ hello: 'world' })), Error);
  try { fromFile(JSON.stringify({ hello: 'world' })); } catch (e) {
    assert.match(e.message, /policies/);
  }
});
