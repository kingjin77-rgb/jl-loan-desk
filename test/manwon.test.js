import { test, assert } from './env.js';
import { parseManwon, toManwon, formatKRW, parseKRW } from '../src/core/money.js';

test('만원 입력: 단위 없이 치면 만원으로 읽는다', () => {
  assert.equal(parseManwon('38000'), 380_000_000);
  assert.equal(parseManwon('6000'), 60_000_000);
  assert.equal(parseManwon('500'), 5_000_000);
  assert.equal(parseManwon('38,000'), 380_000_000, '천단위 쉼표 허용');
});

test('만원 입력: 단위를 붙이면 절대금액으로 읽는다 (기존 습관 유지)', () => {
  assert.equal(parseManwon('3억8천'), 380_000_000);
  assert.equal(parseManwon('3억 8,000만'), 380_000_000);
  assert.equal(parseManwon('5억'), 500_000_000);
  assert.equal(parseManwon('6000만'), 60_000_000);
});

test('만원 입력: 빈 값·쓰레기는 0', () => {
  assert.equal(parseManwon(''), 0);
  assert.equal(parseManwon(null), 0);
  assert.equal(parseManwon('abc'), 0);
});

test('만원 표시', () => {
  assert.equal(toManwon(380_000_000), 38000);
  assert.equal(toManwon(60_000_000), 6000);
  assert.equal(toManwon(0), 0);
});

test('왕복: 만원으로 치고 읽으면 같은 값', () => {
  for (const v of [60_000_000, 380_000_000, 1_250_000_000, 5_000_000]) {
    assert.equal(parseManwon(String(toManwon(v))), v, formatKRW(v));
  }
});

test('숫자를 그대로 주면 만원으로 본다', () => {
  assert.equal(parseManwon(6000), 60_000_000);
});

test('★ "3억8천"은 3억 8천만원이다 (8,000원이 아니다)', () => {
  assert.equal(parseManwon('3억8천'), 380_000_000);
  assert.equal(parseManwon('5억2천'), 520_000_000);
  assert.equal(parseManwon('1억5백'), 105_000_000, '억 뒤의 백은 백만');
});

test('억 없이 단독 "천"은 그대로 천원 (기존 동작 유지)', () => {

  assert.equal(parseKRW('3천'), 3_000);
});
