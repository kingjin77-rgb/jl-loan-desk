/**
 * 「분양전환 상담일지」(전주 앞·뒷면) — 빈칸 계산과 고객 안내장 링크.
 *
 * 양식 파일과 분양전환 파일은 **실제 data/ 파일**을 읽는다. 상담일지 문구의 기준 숫자
 * (자산 3.45억·자동차 4,542만·월소득)와 판정에 쓰는 숫자가 어긋나면 여기서 깨진다.
 */
import { test, assert } from './env.js';
import { formValues, formCalc, encodeNotice, decodeNotice, noticeMessage, VALUE_PATHS } from '../src/core/sangdamilji.js';
import form from '../data/policy/sangdamilji-jeonju.2026-10-15.json' with { type: 'json' };
import rules from '../data/policy/bunyangjeonhwan.2026-10-15.json' with { type: 'json' };

const 억 = 100_000_000;
const 만 = 10_000;

const base = (patch = {}) => ({
  A: 2.75 * 억, B: 1.7 * 억, C: 0, D: 0, I: 6000 * 만,
  자산: 30000 * 만, 차: 2500 * 만, 월소득: 0, 가구원수: 4, 유공자: false, 전세필요: null, ...patch,
});

test('양식 문구의 LH 기준 = 판정 기준 (자산 3.45억 · 자동차 4,542만 · 월소득 527/616/652/693만)', () => {
  const L = form.앞면.저소득층;
  assert.ok(L.자산.includes('3.45억') && rules.LH검증.자산가액 === 345_000_000);
  assert.ok(L.자동차.includes('4542만') && rules.LH검증.자동차가액 === 45_420_000);
  for (const g of L.월소득칸) {
    const 만원 = Number(g.표기.match(/(\d+)만/)[1]);
    assert.equal(rules.LH검증.월소득[String(g.가구원수)], 만원 * 만, `${g.표기}`);
  }
  assert.ok(L.안내.join(' ').includes(rules.LH검증.신청기한표기.slice(0, 5)));
});

test('앞면: 필요자금 A−B+C−D · 일반 잔금유예금 = 분양가 − (계약금 30 + 납입보증금 170)', () => {
  const c = formCalc(base({ C: 0.3 * 억, D: 0.1 * 억 }), form, rules, { 동: '301' });
  assert.equal(c.필요자금, 2.75 * 억 - 1.7 * 억 + 0.3 * 억 - 0.1 * 억);
  assert.equal(c.일반잔금유예, 0.75 * 억);
  assert.equal(c.일반최소미달, false);
  assert.equal(c.저소득잔금유예, 1.05 * 억);       // 현재보증금 제외한 남은 잔금 전부
  assert.equal(c.전세필요, 0.3 * 억);             // 비워 두면 기존 보증금대출 상환분
  assert.equal(c.전세필요자동, true);
});

test('앞면: 최소 잔금유예금(7,500만) 미달 표시', () => {
  assert.equal(formCalc(base({ A: 2.6 * 억 }), form, rules).일반최소미달, true);
});

test('저소득층: 셋 다 기준 이하면 충족(○○○), 하나라도 넘으면 불가', () => {
  const ok = formCalc(base({ 월소득: 600 * 만 }), form, rules);
  assert.equal(ok.lh.pass, true); assert.equal(ok.불가, false);
  assert.deepEqual(ok.lhMark, { 자산: 'ok', 차: 'ok', 월소득: 'ok' });
  const no = formCalc(base({ 차: 5000 * 만 }), form, rules);
  assert.equal(no.불가, true);
  assert.equal(no.lhMark.차, 'bad');
  assert.equal(formCalc(base({ 차: 5000 * 만, 유공자: true }), form, rules).불가, false);
});

test('저소득층: 월소득을 비우면 연소득 ÷ 12 로 판정 (4인 616만)', () => {
  const c = formCalc(base({ I: 7500 * 만 }), form, rules);   // 625만 > 616만
  assert.equal(c.월소득자동, true);
  assert.equal(c.불가, true);
  assert.equal(c.lhMark.월소득, 'bad');
});

test('저소득층: 가구원수를 안 고르면 불가가 아니라 판정 전', () => {
  const c = formCalc(base({ 가구원수: null }), form, rules);
  assert.equal(c.불가, false); assert.equal(c.lh.pass, false); assert.equal(c.lh.미확정, true);
});

test('버팀목: 부부합산 5천만원 이하면 버팀목, 넘으면 은행전세', () => {
  assert.equal(formCalc(base({ I: 5000 * 만 }), form, rules).버팀목, true);
  assert.equal(formCalc(base({ I: 5001 * 만 }), form, rules).버팀목, false);
});

test('뒷면: 동별 기금대출 취급 지점, 기금 7,500만 후 남는 돈, 디딤돌 금리 행', () => {
  const at = (동) => form.뒷면.기금.취급지점[formCalc(base(), form, rules, { 동 }).지점]?.지점;
  assert.equal(at('301'), '우리은행 전주중앙금융센터');
  assert.equal(at('304'), '우리은행 전주중앙금융센터');
  assert.equal(at('305'), '전주금융센터');
  assert.equal(at('309'), '국민연금공단금융센터');
  const c = formCalc(base(), form, rules, { 동: '308' });
  assert.equal(c.기금후, 1.05 * 억 - 0.75 * 억);
  assert.equal(c.디딤돌행, 2);                    // 6,000만 → 4천초과~7천 이하
  // 양식의 취급 지점 문구와 지점 표가 같은 내용인지
  const line = form.뒷면.기금.줄.find(([k]) => k === '취급 지점')[1];
  assert.equal(line, form.뒷면.기금.취급지점.map((x) => `${x.지점}(${x.동[0]}~${x.동[1]}동)`).join(', '));
});

test('안내장 링크: 값이 그대로 돌아오고, 연락처는 들어가지 않는다', () => {
  const values = base({ C: 0.3 * 억, 월소득: 600 * 만, 전세필요: 0.5 * 억, 유공자: true });
  const code = encodeNotice({ values, 동: '308', 호: '1503', 날짜: '2026-10-17' });
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const back = decodeNotice(code);
  assert.deepEqual(back.values, values);
  assert.equal(back.동, '308'); assert.equal(back.호, '1503'); assert.equal(back.날짜, '2026-10-17');
  assert.ok(!/01[016789]-?\d{3,4}-?\d{4}/.test(JSON.stringify(back)));
});

test('안내장 문구: 동·호와 링크', () => {
  const m = noticeMessage({ 동: '308', 호: '1503', url: 'https://x/notice.html#abc' });
  assert.ok(m.includes('308동 1503호 분양전환 상담일지'));
  assert.ok(m.includes('https://x/notice.html#abc'));
});

test('양식 값 ↔ store 경로가 빠짐없이 짝지어져 있다', () => {
  const v = formValues({});
  assert.deepEqual(Object.keys(v).sort(), Object.keys(VALUE_PATHS).sort());
});
