/**
 * 현장 접수 — 예약 명단 읽기 · 예약자 찾기 · 현황 · 저소득층 불가 판정.
 *
 * 명단 파일은 **가짜**(test/fixtures/sheets, 번호 전부 010-0000-xxxx)다.
 * 실제 명단은 저장소에 넣지 않는다 — 공개 저장소이고 연락처가 들어 있다.
 * 가짜 파일은 실제 명단과 같은 열 구조(순번·동·호수·연락처·상담 참석신청일)로 만들었고,
 * 같은 세대·번호의 중복 신청 1건을 일부러 넣었다.
 */
import { test, assert } from './env.js';
import { readSheet, parseCsv } from '../src/io/sheet-reader.js';
import {
  fromRows, search, slotKey, maskPhone, bySlot, totals, toCsv, smsHref, nextTicket, STATUS,
} from '../src/core/reservations.js';
import { lh불가 } from '../src/core/lh-gate.js';

const isNode = typeof process !== 'undefined' && process.versions?.node;

async function fixture(name) {
  const url = new URL(`./fixtures/sheets/${name}`, import.meta.url);
  if (isNode) {
    const { readFileSync } = await import('node:fs');
    return new Uint8Array(readFileSync(url));
  }
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

const FILES = ['reservations-fake.xls', 'reservations-fake.xlsx', 'reservations-fake.csv', 'reservations-fake-cp949.csv'];

for (const f of FILES) {
  test(`명단 읽기: ${f} — 5행 → 4세대(중복 1건 합침), 시간순 정렬`, async () => {
    const { sheets } = await readSheet(await fixture(f), f);
    const r = fromRows(sheets[0].rows);
    assert.equal(r.list.length, 4);
    assert.equal(r.duplicates, 1);
    assert.deepEqual(r.list.map((x) => `${x.동}-${x.호}`), ['301-101', '301-1203', '302-302', '308-1503']);
    assert.equal(r.list[0].phone, '01000000001');
    assert.equal(r.list[0].일시, '2026년 10월 17일(토) 오후 1시');
    assert.equal(r.list.find((x) => x.호 === '302').중복, 1);
  });
}

test('명단 읽기: 제목 칸이 없으면 이유를 말하고 멈춘다', () => {
  assert.throws(() => fromRows([['a', 'b'], ['1', '2']]), /동.*호수/);
});

test('CSV: 따옴표·쉼표·줄바꿈이 든 칸', () => {
  assert.deepEqual(parseCsv('a,"b,c","d""e"\r\n1,2,3\n'), [['a', 'b,c', 'd"e'], ['1', '2', '3']]);
});

test('시간 정렬: 오후 1시 < 오후 6시 < 다음날 오전 10시 < 오전 11시 < 12시', () => {
  const s = ['2026년 10월 18일(일) 오전 12시', '2026년 10월 17일(토) 오후 6시', '2026년 10월 18일(일) 오전 10시',
    '2026년 10월 17일(토) 오후 1시', '2026년 10월 18일(일) 오전 11시'];
  assert.deepEqual(s.map(slotKey).sort(), [
    '2026-10-17 13:00', '2026-10-17 18:00', '2026-10-18 10:00', '2026-10-18 11:00', '2026-10-18 12:00',
  ]);
});

const LIST = [
  { id: 'a', 동: '301', 호: '101', phone: '01000000001', 일시: '2026년 10월 17일(토) 오후 1시' },
  { id: 'b', 동: '301', 호: '1503', phone: '01000001503', 일시: '2026년 10월 17일(토) 오후 1시' },
  { id: 'c', 동: '308', 호: '1503', phone: '01000000004', 일시: '2026년 10월 17일(토) 오후 2시' },
];

test('찾기: 동·호 / 호수만 / 연락처 뒷자리', () => {
  assert.deepEqual(search(LIST, '308 1503').map((x) => x.id), ['c']);
  assert.deepEqual(search(LIST, '308동 1503호').map((x) => x.id), ['c']);
  assert.deepEqual(search(LIST, '301-101').map((x) => x.id), ['a']);
  assert.deepEqual(search(LIST, '1503').map((x) => x.id), ['b', 'c']);   // 호수 1503 두 세대 (b 는 번호 뒷자리도 1503)
  assert.deepEqual(search(LIST, '0004').map((x) => x.id), ['c']);
  assert.deepEqual(search(LIST, '999 999'), []);
  assert.equal(search(LIST, '').length, 3);
});

test('연락처는 화면에서 가린다', () => {
  assert.equal(maskPhone('010-1234-5678'), '010-****-5678');
  assert.equal(maskPhone(''), '');
});

test('현황: 시간대별·전체 집계, 대기번호', () => {
  const states = { a: { status: STATUS.완료, smsAt: 'x', ticket: '3' }, b: { status: STATUS.확인, ticket: '7' }, c: { status: STATUS.예약 } };
  const g = bySlot(LIST, states);
  assert.deepEqual(g.map((x) => [x.전체, x.확인, x.완료]), [[2, 2, 1], [1, 0, 0]]);
  const t = totals(LIST, states);
  assert.equal(t.확인, 2); assert.equal(t.완료, 1); assert.equal(t.문자, 1);
  assert.equal(nextTicket(states), 8);
});

test('현황 CSV: 번호는 가려서 내보낸다', () => {
  const csv = toCsv(LIST, { a: { status: STATUS.완료 } });
  assert.ok(csv.includes('010-****-0001'));
  assert.ok(!csv.includes('01000000001'));
  assert.ok(csv.split('\r\n')[1].includes('완료'));
});

test('문자 링크: iOS 는 &body, 그 외 ?body', () => {
  assert.equal(smsHref('010-0000-0001', '안녕 하세요'), 'sms:01000000001?body=%EC%95%88%EB%85%95%20%ED%95%98%EC%84%B8%EC%9A%94');
  assert.ok(smsHref('01000000001', 'a', { ios: true }).startsWith('sms:01000000001&body='));
});

test('저소득층 불가: 요건 하나라도 초과면 불가, 국가유공자·입력 부족은 불가 아님', () => {
  assert.equal(lh불가({ 실패: [{ label: '자산가액' }], 국가유공자예외: false }), true);
  assert.equal(lh불가({ 실패: [{ label: '자산가액' }], 국가유공자예외: true }), false);
  assert.equal(lh불가({ 실패: [], 미확정: true }), false);
  assert.equal(lh불가(null), false);
});
