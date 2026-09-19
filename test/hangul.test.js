import { test, assert } from './env.js';
import { josa, hasFinalConsonant } from '../src/core/hangul.js';

test('조사: 받침 있는 한글 뒤', () => {
  assert.equal(josa('잔금', '이/가'), '잔금이');
  assert.equal(josa('방공제', '을/를'), '방공제를');
  assert.equal(josa('중도금', '은/는'), '중도금은');
});

test('조사: 받침 없는 한글 뒤', () => {
  assert.equal(josa('한도', '이/가'), '한도가');
  assert.equal(josa('LTV 한도', '이/가'), 'LTV 한도가');
  assert.equal(josa('DSR 한도', '이/가'), 'DSR 한도가');
  assert.equal(josa('담보', '은/는'), '담보는');
});

test('조사: 영문으로 끝나면 읽는 소리로 판단한다', () => {
  assert.equal(josa('LTV', '이/가'), 'LTV가', 'V 는 브이 — 받침 없음');
  assert.equal(josa('DSR', '이/가'), 'DSR이', 'R 은 알 — 받침 있음');
  assert.equal(josa('MCI', '을/를'), 'MCI를');
  assert.equal(josa('MCG', '이/가'), 'MCG가');
});

test('조사: 숫자로 끝나면 읽는 소리로 판단한다', () => {
  assert.equal(josa('1', '이/가'), '1이', '일 — 받침 있음');
  assert.equal(josa('2', '이/가'), '2가', '이 — 받침 없음');
  assert.equal(josa('3', '이/가'), '3이', '삼 — 받침 있음');
  assert.equal(josa('5', '이/가'), '5가', '오 — 받침 없음');
});

test('조사: 으로/로', () => {
  assert.equal(josa('잔금대출', '으로/로'), '잔금대출로');
  assert.equal(josa('현금', '으로/로'), '현금으로');
});

test('조사: 뒤에 붙은 기호는 무시하고 읽는 글자를 본다', () => {
  assert.equal(josa('한도(원)', '이/가'), '한도(원)이', '원 — 받침 있음');
  assert.equal(josa('DSR 한도.', '이/가'), 'DSR 한도.가');
});

test('조사: 판단 불가면 둘 다 적는다 (틀린 조사보다 낫다)', () => {
  assert.equal(josa('※', '이/가'), '※이(가)');
  assert.equal(hasFinalConsonant('※'), null);
});

test('받침 판정', () => {
  assert.equal(hasFinalConsonant('강'), true);
  assert.equal(hasFinalConsonant('가'), false);
  assert.equal(hasFinalConsonant(''), null);
  assert.equal(hasFinalConsonant(null), null);
});
