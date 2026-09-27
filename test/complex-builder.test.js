import { test, assert, assertClose } from './env.js';
import { emptyForm, expandRounds, ratioCheck, buildComplexDoc, docToForm, slugify } from '../src/core/complex-builder.js';
import { validateComplex } from '../src/data/validate.js';
import { buildTimeline } from '../src/core/timeline.js';

const CTX = {
  bangongjeKeys: ['서울특별시', '과밀억제권역', '광역시등', '그밖의지역'],
  regionGrades: ['투기과열', '조정대상', '비규제'],
};

function filled(over = {}) {
  return {
    ...emptyForm(),
    name: '테스트 아파트',
    sido: '경기도', sigungu: '양주시',
    moveInStart: '2028-06-01', moveInEnd: '2028-08-31',
    types: [{ typeId: '84A', areaSqm: 84.97, units: 210, price: 500_000_000, expansion: 18_000_000, option: 12_000_000 }],
    contractDate: '2026-03-20',
    firstRoundDate: '2026-09-20',
    ...over,
  };
}

test('회차 펼치기: 1회차 날짜 + 간격으로 6회를 만든다', () => {
  const r = expandRounds({ roundCount: 6, roundRatio: 0.1, firstRoundDate: '2026-09-20', roundIntervalMonths: 4 });
  assert.equal(r.length, 6);
  assert.equal(r[0].date, '2026-09-20');
  assert.equal(r[1].date, '2027-01-20');
  assert.equal(r[5].date, '2028-05-20', '1회차 + 5×4개월');
  assert.equal(r[5].seq, 6);
});

test('회차 펼치기: 날짜를 안 넣으면 null 로 두고 회차만 만든다', () => {
  const r = expandRounds({ roundCount: 3, roundRatio: 0.1, firstRoundDate: '', roundIntervalMonths: 4 });
  assert.equal(r.length, 3);
  assert.equal(r[0].date, null);
});

test('비율 점검: 10 + 6×10 + 30 = 100%', () => {
  const c = ratioCheck(filled());
  assert.equal(c.ok, true);
  assert.ok(c.message.includes('100%'));
});

test('비율 점검: 틀리면 무엇이 얼마인지 알려준다', () => {
  const c = ratioCheck(filled({ balanceRatio: 0.2 }));
  assert.equal(c.ok, false);
  assert.ok(c.message.includes('90.0%'), c.message);
  assert.ok(c.message.includes('계약금 10%'), c.message);
});

test('★ 폼으로 만든 단지가 검증을 통과한다', () => {
  const doc = buildComplexDoc(filled());
  // 통과하지 못하면 예외를 던진다
  validateComplex(doc, '직접입력', CTX);
  assert.equal(doc.complexId, '테스트-아파트');
  assert.equal(doc.meta.직접입력, true);
  assert.equal(doc.meta.verified, false, '직접 입력한 값은 검수 전이다');
});

test('만든 단지로 타임라인이 계산된다', () => {
  const doc = buildComplexDoc(filled());
  const total = 500_000_000 + 18_000_000 + 12_000_000;
  const t = buildTimeline({
    totalPrice: total,
    paymentSchedule: doc.paymentSchedule,
    conversionDate: doc.moveIn.입주지정기간.start,
    jungdogeumRatio: 0.6,
  });
  assert.equal(t.warnings.length, 0, t.warnings.join(' / '));
  assertClose(t.totals.비율합계, 1, 1e-9);
  assertClose(t.totals.계약금, total * 0.1, 1);
  assertClose(t.totals.중도금, total * 0.6, 1);
  assertClose(t.totals.잔금, total * 0.3, 1);
});

test('타입이 여러 개면 전부 들어간다', () => {
  const doc = buildComplexDoc(filled({ types: [
    { typeId: '59A', areaSqm: 59.94, price: 380_000_000, expansion: 14_000_000, option: 8_000_000 },
    { typeId: '84A', areaSqm: 84.97, price: 500_000_000, expansion: 18_000_000, option: 12_000_000 },
  ] }));
  assert.equal(doc.unitTypes.length, 2);
  assert.equal(doc.unitTypes[0].typeId, '59A');
  validateComplex(doc, '직접입력', CTX);
});

test('분양가가 없는 타입은 버린다 (빈 줄을 남겨도 되게)', () => {
  const doc = buildComplexDoc(filled({ types: [
    { typeId: '84A', areaSqm: 84.97, price: 500_000_000 },
    { typeId: '', areaSqm: null, price: 0 },
  ] }));
  assert.equal(doc.unitTypes.length, 1);
});

test('입주 종료일을 비우면 개시일과 같게 둔다', () => {
  const doc = buildComplexDoc(filled({ moveInEnd: '' }));
  assert.equal(doc.moveIn.입주지정기간.end, doc.moveIn.입주지정기간.start);
  validateComplex(doc, '직접입력', CTX);
});

test('연월만 넣어도 날짜로 펼쳐진다', () => {
  const doc = buildComplexDoc(filled({ moveInStart: '2028-06', moveInEnd: '2028-08' }));
  assert.equal(doc.moveIn.입주지정기간.start, '2028-06-01');
  assert.equal(doc.moveIn.입주지정기간.end, '2028-08-31');
});

test('★ 왕복: 만든 단지를 다시 폼으로 열면 값이 보존된다', () => {
  const form = filled();
  const doc = buildComplexDoc(form);
  const back = docToForm(doc);

  assert.equal(back.name, form.name);
  assert.equal(back.regionGrade, form.regionGrade);
  assert.equal(back.bangongjeRegion, form.bangongjeRegion);
  assertClose(back.contractRatio, form.contractRatio, 1e-9);
  assert.equal(back.roundCount, form.roundCount);
  assertClose(back.roundRatio, form.roundRatio, 1e-9);
  assert.equal(back.firstRoundDate, form.firstRoundDate);
  assert.equal(back.roundIntervalMonths, form.roundIntervalMonths, '간격을 회차 날짜에서 되읽는다');
  assertClose(back.balanceRatio, form.balanceRatio, 1e-9);
  assertClose(back.jungdogeumRate, form.jungdogeumRate, 1e-9);
  assert.equal(back.types[0].price, form.types[0].price);
  assert.equal(back.moveInStart, form.moveInStart);
});

test('왕복 후 다시 만들어도 검증을 통과한다', () => {
  const doc1 = buildComplexDoc(filled());
  const doc2 = buildComplexDoc(docToForm(doc1));
  validateComplex(doc2, '직접입력', CTX);
  assert.equal(doc2.paymentSchedule.중도금.rounds.length, 6);
});

test('단지명 정리: 파일명에 못 쓰는 기호를 뺀다', () => {
  assert.equal(slugify('양주 백석 모아엘가'), '양주-백석-모아엘가');
  assert.equal(slugify('A/B:C'), 'ABC');
  assert.equal(slugify(''), '');
});

test('이름이 없어도 id 는 만들어진다', () => {
  const doc = buildComplexDoc(filled({ name: '' }));
  assert.ok(doc.complexId.startsWith('danji-'));
});
