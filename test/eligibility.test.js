import { test, assert, assertClose } from './env.js';
import { evaluate, summarizeFailure, readPath } from '../src/core/eligibility.js';

const CTX = {
  borrower: {
    annualIncomeCombined: 70_000_000,
    netAssets: 520_000_000,
    ownedHouses: 0,
    isNewlywed: true,
    newbornWithinMonths: 30,
    hasSubscriptionAccount: true,
    children: 1,
  },
  house: { price: 480_000_000, areaSqm: 84.97 },
};

test('단일 조건: 통과', () => {
  const r = evaluate({ path: 'borrower.ownedHouses', op: 'eq', value: 0, label: '무주택' }, CTX);
  assert.equal(r.eligible, true);
  assert.equal(r.checks.length, 1);
  assert.equal(r.checks[0].pass, true);
});

test('단일 조건: 탈락하면 얼마나 초과했는지 계산한다', () => {
  const r = evaluate(
    { path: 'borrower.netAssets', op: 'lte', value: 488_000_000, label: '순자산', unit: '원' }, CTX
  );
  assert.equal(r.eligible, false);
  assertClose(r.failed[0].shortBy, 32_000_000, 1, '초과분');
  assert.ok(r.failed[0].message.includes('3,200만원 초과'), r.failed[0].message);
});

test('gte 탈락은 부족분으로 표현한다', () => {
  const r = evaluate(
    { path: 'borrower.children', op: 'gte', value: 3, label: '자녀수', unit: '명' }, CTX
  );
  assert.equal(r.failed[0].shortBy, 2);
  assert.ok(r.failed[0].message.includes('부족'), r.failed[0].message);
});

test('and: 전부 통과해야 적격', () => {
  const rules = { and: [
    { path: 'borrower.ownedHouses', op: 'eq', value: 0, label: '무주택' },
    { path: 'house.areaSqm', op: 'lte', value: 85, label: '전용면적', unit: '㎡' },
  ] };
  assert.equal(evaluate(rules, CTX).eligible, true);
});

test('and: 하나라도 실패하면 부적격이고, 실패한 것만 failed 에 담긴다', () => {
  const rules = { and: [
    { path: 'borrower.ownedHouses', op: 'eq', value: 0, label: '무주택' },
    { path: 'house.price', op: 'lte', value: 400_000_000, label: '주택가격', unit: '원' },
  ] };
  const r = evaluate(rules, CTX);
  assert.equal(r.eligible, false);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].label, '주택가격');
  assert.equal(r.checks.length, 2, '통과한 조건도 checks 에는 남는다');
});

test('or: 하나만 통과하면 적격', () => {
  const rules = { or: [
    { path: 'borrower.isNewlywed', op: 'eq', value: true, label: '신혼부부' },
    { path: 'borrower.children', op: 'gte', value: 3, label: '다자녀' },
  ] };
  const r = evaluate(rules, CTX);
  assert.equal(r.eligible, true);
});

test('or: 통과한 가지가 있으면 다른 가지의 실패는 탈락 사유가 아니다', () => {
  const rules = { or: [
    { path: 'borrower.isNewlywed', op: 'eq', value: true, label: '신혼부부' },
    { path: 'borrower.children', op: 'gte', value: 3, label: '다자녀' },
  ] };
  const r = evaluate(rules, CTX);
  assert.equal(r.failed.length, 0, '충족된 or 안의 실패는 사유로 올리지 않는다');
  assert.ok(r.checks.some((c) => c.inSatisfiedOr), '표시용 플래그는 남는다');
});

test('or: 전부 실패하면 부적격', () => {
  const rules = { or: [
    { path: 'borrower.children', op: 'gte', value: 3, label: '다자녀' },
    { path: 'borrower.ownedHouses', op: 'gte', value: 2, label: '다주택' },
  ] };
  assert.equal(evaluate(rules, CTX).eligible, false);
});

test('not', () => {
  assert.equal(
    evaluate({ not: { path: 'borrower.ownedHouses', op: 'gte', value: 1, label: '유주택' } }, CTX).eligible,
    true
  );
});

test('중첩: and 안의 or', () => {
  const rules = { and: [
    { path: 'borrower.ownedHouses', op: 'eq', value: 0, label: '무주택' },
    { or: [
      { path: 'borrower.newbornWithinMonths', op: 'lte', value: 24, label: '신생아 2년 이내' },
      { path: 'borrower.isNewlywed', op: 'eq', value: true, label: '신혼부부' },
    ] },
  ] };
  assert.equal(evaluate(rules, CTX).eligible, true, '신생아는 30개월로 탈락이지만 신혼으로 통과');
});

test('in / between', () => {
  assert.equal(evaluate({ path: 'borrower.children', op: 'in', value: [1, 2, 3] }, CTX).eligible, true);
  assert.equal(evaluate({ path: 'house.areaSqm', op: 'between', value: [60, 85] }, CTX).eligible, true);
  assert.equal(evaluate({ path: 'house.areaSqm', op: 'between', value: [40, 60] }, CTX).eligible, false);
});

// ────────── 값이 비어 있을 때 (이 앱의 현재 상태) ──────────

test('★ 요건 값이 설정되지 않았으면 탈락이 아니라 판정 불가다', () => {
  // data/products 의 실무 프로파일은 값이 전부 null 이다.
  // 이걸 탈락으로 처리하면 모든 상품이 부적격으로 보여 화면이 쓸모없어진다.
  const r = evaluate({ path: 'borrower.netAssets', op: 'lte', value: null, label: '순자산' }, CTX);
  assert.equal(r.eligible, true);
  assert.equal(r.unknown.length, 1);
  assert.ok(r.unknown[0].message.includes('설정되지 않아'));
});

test('입력값이 없으면 "해당 없음"으로 부적격 처리한다', () => {
  // 신생아·나이처럼 해당 사항이 없어 비어 있는 경우가 대부분이다.
  // "판정 불가"가 아니라 "해당 없음"으로 읽혀야 상담사가 설명할 수 있다.
  const r = evaluate({ path: 'borrower.없는필드', op: 'lte', value: 24, label: '출산 후 경과' }, CTX);
  assert.equal(r.eligible, false);
  assert.equal(r.failed.length, 1, '판정 불가가 아니라 탈락 사유로 잡힌다');
  assert.equal(r.failed[0].notApplicable, true);
  assert.equal(r.failed[0].message, '출산 후 경과: 해당 없음');
  assert.equal(r.unknown.length, 0);
});

test('알 수 없는 연산자는 조용히 통과시키지 않는다', () => {
  const r = evaluate({ path: 'borrower.children', op: 'approximately', value: 1 }, CTX);
  assert.equal(r.eligible, false);
  assert.ok(r.unknown[0].message.includes('알 수 없는 조건 연산자'));
});

test('규칙이 없으면 제한 없음으로 본다', () => {
  assert.equal(evaluate(null, CTX).eligible, true);
  assert.equal(evaluate(undefined, CTX).eligible, true);
});

// ────────── 요약 ──────────

test('탈락 요약은 격차가 큰 것부터', () => {
  const rules = { and: [
    { path: 'borrower.children', op: 'gte', value: 3, label: '자녀수', unit: '명' },
    { path: 'borrower.netAssets', op: 'lte', value: 300_000_000, label: '순자산', unit: '원' },
  ] };
  const r = evaluate(rules, CTX);
  const s = summarizeFailure(r);
  assert.ok(s.includes('순자산'), `가장 큰 격차가 앞에 와야 한다: ${s}`);
  assert.ok(s.includes('외 1건'), s);
});

test('적격이면 요약은 빈 문자열', () => {
  const r = evaluate({ path: 'borrower.ownedHouses', op: 'eq', value: 0 }, CTX);
  assert.equal(summarizeFailure(r), '');
});

test('경로 읽기', () => {
  assert.equal(readPath(CTX, 'house.price'), 480_000_000);
  assert.equal(readPath(CTX, 'house.없음'), undefined);
  assert.equal(readPath(CTX, 'a.b.c'), undefined);
});
