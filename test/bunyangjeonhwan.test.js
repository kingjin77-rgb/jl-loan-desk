/**
 * 분양전환 계산 — 「분양전환 상담일지」의 숫자로 검증한다.
 *
 * 이 테스트의 기대값은 내 기억이 아니라 **상담일지에 적힌 숫자**이거나,
 * 상담일지의 서로 다른 두 숫자가 맞아떨어지는지를 보는 것이다.
 */
import { test, assert } from './env.js';
import {
  fundsNeeded, installmentCap, deferredBalance, deferredInterest,
  checkPrepayUnit, lhVerification,
} from '../src/core/bunyangjeonhwan.js';

test('필요자금: 보증금대출은 더한다 (계약 시 상환해야 하므로)', () => {
  const r = fundsNeeded({ 분양가: 275_000_000, 납입보증금: 170_000_000, 보증금대출: 80_000_000, 본인준비금: 30_000_000 });
  assert.equal(r.필요자금, 155_000_000);
  assert.equal(r.식, 'A − B + C − D');
  // 부호를 뒤집는 실수를 잡는다: 보증금대출을 빼면 -5,000,000 이 된다.
  assert.equal(r.내역.find((x) => x.항목 === '보증금대출').부호, 1);
});

test('필요자금: 보증금대출이 없으면 분양가 − 보증금 − 준비금', () => {
  const r = fundsNeeded({ 분양가: 255_000_000, 납입보증금: 170_000_000, 본인준비금: 0 });
  assert.equal(r.필요자금, 85_000_000);
});

test('★ 분할납부 상한: 상담일지의 두 숫자가 서로 맞아떨어진다', () => {
  // 상담일지: "주택가격이 2억5천5백만원(51,59타입) 또는 2억7천5백만원(74,84타입) 미만일 경우
  //            분할납부 금액이 2억이 되지 않음"
  //           "최소 잔금유예금은 55,000,000원(51,59타입) 또는 75,000,000원(74,84타입)"
  // → 두 문장은 같은 규칙의 다른 표현이어야 한다: 최소주택가격 = 2억 + 최소잔금유예금
  for (const [주택가격, 최소] of [[255_000_000, 55_000_000], [275_000_000, 75_000_000]]) {
    const c = installmentCap({ 주택가격, 최소잔금유예금: 최소, 총액상한: 200_000_000 });
    assert.equal(c.최대분할납부액, 200_000_000, `${주택가격} 에서 2억이 나와야 한다`);
    assert.equal(c.총액상한미달, false);
    assert.equal(c.최소주택가격, 주택가격, '상담일지의 기준 주택가격과 일치해야 한다');
  }
});

test('분할납부: 주택가격이 기준 미만이면 2억에 못 미치고 경고가 붙는다', () => {
  const c = installmentCap({ 주택가격: 240_000_000, 최소잔금유예금: 55_000_000, 총액상한: 200_000_000 });
  assert.equal(c.최대분할납부액, 185_000_000);
  assert.equal(c.총액상한미달, true);
  assert.match(c.warnings[0], /2억/);
});

test('분할납부: 최소 잔금유예금을 모르면 계산하지 않고 그 사실을 알린다', () => {
  const c = installmentCap({ 주택가격: 300_000_000, 최소잔금유예금: null, 총액상한: 200_000_000 });
  assert.equal(c.최대분할납부액, null);
  assert.match(c.warnings[0], /최소 잔금유예금/);
});

test('잔금유예: 최소액만 남기면 일괄상환만 가능하다고 알린다', () => {
  const b = deferredBalance({ 주택가격: 255_000_000, 분할납부액: 200_000_000, 최소잔금유예금: 55_000_000 });
  assert.equal(b.잔금유예금, 55_000_000);
  assert.equal(b.일괄상환만, true);
  assert.match(b.warnings[0], /일괄상환/);
});

test('잔금유예: 최소액에 못 미치는 분할납부는 불가능하다고 한다', () => {
  const b = deferredBalance({ 주택가격: 240_000_000, 분할납부액: 200_000_000, 최소잔금유예금: 55_000_000 });
  assert.equal(b.최소여유, -15_000_000);
  assert.match(b.warnings[0], /부족/);
});

test('만기: 계약일+10년과 청산일 중 빠른 날', () => {
  const a = deferredInterest({ 원금: 100_000_000, annualRate: 0.03, 계약일: '2026-11-15', 만기년: 10 });
  assert.equal(a.만기일, '2036-11-15');
  assert.equal(a.만기근거, '계약일 + 10년');

  const b = deferredInterest({ 원금: 100_000_000, annualRate: 0.03, 계약일: '2026-11-15', 청산일: '2031-06-30', 만기년: 10 });
  assert.equal(b.만기일, '2031-06-30');
  assert.equal(b.만기근거, '청산일');

  // 청산일이 10년보다 늦으면 10년이 이긴다
  const c = deferredInterest({ 원금: 100_000_000, annualRate: 0.03, 계약일: '2026-11-15', 청산일: '2040-01-01', 만기년: 10 });
  assert.equal(c.만기일, '2036-11-15');
});

test('★ 연납 이자: 일수 합이 계약일~만기일과 정확히 같다 (경계일 이중계산 방지)', () => {
  const r = deferredInterest({ 원금: 200_000_000, annualRate: 0.03, 계약일: '2026-11-15', 만기년: 10 });
  const 일수합 = r.연도별.reduce((s, y) => s + y.일수, 0);
  const 기대 = Math.round((Date.UTC(2036, 10, 15) - Date.UTC(2026, 10, 15)) / 86400000);
  assert.equal(일수합, 기대, '해가 바뀌는 날을 두 번 세면 여기서 어긋난다');
  assert.equal(일수합, 3653);
});

test('연납 이자: 온전한 한 해는 원금 × 금리 그대로', () => {
  const r = deferredInterest({ 원금: 200_000_000, annualRate: 0.03, 계약일: '2026-11-15', 만기년: 10 });
  const y2027 = r.연도별.find((y) => y.연도 === 2027);
  assert.equal(y2027.일수, 365);
  assert.equal(y2027.이자, 6_000_000);   // 2억 × 3%
});

test('연납 이자: 첫해는 계약일부터 일할계산', () => {
  const r = deferredInterest({ 원금: 200_000_000, annualRate: 0.03, 계약일: '2026-11-15', 만기년: 10 });
  const y2026 = r.연도별[0];
  assert.equal(y2026.일수, 47);          // 11/15 ~ 12/31
  assert.equal(y2026.이자, Math.round(200_000_000 * 0.03 * 47 / 365));
});

test('연납 이자: 일부상환 이후에는 줄어든 원금에만 붙는다', () => {
  const r = deferredInterest({
    원금: 200_000_000, annualRate: 0.03, 계약일: '2026-11-15', 만기년: 10,
    일부상환: [{ date: '2028-07-01', amount: 50_000_000 }],
  });
  const y2029 = r.연도별.find((y) => y.연도 === 2029);
  assert.equal(y2029.이자, 4_500_000);   // 1.5억 × 3%
  assert.equal(y2029.기말원금, 150_000_000);
  // 상환한 해는 두 구간으로 쪼개진다
  const y2028 = r.연도별.find((y) => y.연도 === 2028);
  assert.equal(y2028.일수, 366);          // 2028 윤년
  assert.equal(y2028.기말원금, 150_000_000);
});

test('금리를 모르면 이자를 내지 않고 이유를 말한다', () => {
  const r = deferredInterest({ 원금: 200_000_000, annualRate: null, 계약일: '2026-11-15' });
  assert.equal(r.총이자, null);
  assert.equal(r.만기일, '2036-11-15');   // 만기는 금리 없이도 나온다
  assert.match(r.reason, /금리/);
});

test('일부상환은 100만원 단위', () => {
  assert.equal(checkPrepayUnit(5_000_000).ok, true);
  const bad = checkPrepayUnit(5_500_500);
  assert.equal(bad.ok, false);
  assert.equal(bad.adjusted, 5_000_000);
  assert.match(bad.message, /100만원/);
});

const LH = {
  자산가액: 345_000_000,
  자동차가액: 45_420_000,
  월소득: { 3: 5_270_000, 4: 6_160_000, 5: 6_520_000, 6: 6_930_000 },
};

test('LH검증: 1·2·3 모두 충족하면 제출 대상', () => {
  const r = lhVerification({ 자산가액: 300_000_000, 자동차가액: 30_000_000, 월소득: 6_000_000, 가구원수: 4 }, LH);
  assert.equal(r.pass, true);
  assert.match(r.결론, /제출 대상/);
});

test('LH검증: 탈락하면 얼마 초과인지 말한다', () => {
  const r = lhVerification({ 자산가액: 360_000_000, 자동차가액: 30_000_000, 월소득: 6_000_000, 가구원수: 4 }, LH);
  assert.equal(r.pass, false);
  assert.equal(r.실패[0].초과액, 15_000_000);
  assert.match(r.결론, /1,500만원 초과/);
});

test('LH검증: 가구원수에 따라 월소득 기준이 달라진다', () => {
  const 소득 = 6_500_000;
  assert.equal(lhVerification({ 자산가액: 1, 자동차가액: 1, 월소득: 소득, 가구원수: 4 }, LH).pass, false); // 616만 < 650만
  assert.equal(lhVerification({ 자산가액: 1, 자동차가액: 1, 월소득: 소득, 가구원수: 5 }, LH).pass, true);  // 652만 > 650만
});

test('LH검증: 가구원수를 모르면 판정하지 않는다 (탈락이 아니다)', () => {
  const r = lhVerification({ 자산가액: 300_000_000, 자동차가액: 30_000_000, 월소득: 6_000_000 }, LH);
  assert.equal(r.pass, false);
  assert.equal(r.미확정, true);
  assert.match(r.결론, /판정할 수 없습니다/);
});

test('LH검증: 국가유공자는 요건과 무관하게 신청 가능', () => {
  const r = lhVerification({ 자산가액: 900_000_000, 자동차가액: 99_000_000, 월소득: 20_000_000, 가구원수: 4, 국가유공자: true }, LH);
  assert.equal(r.pass, true);
  assert.match(r.결론, /국가유공자/);
});

/**
 * ★ 상담일지 84타입 예시 전체 재현.
 *
 * 상담일지에 적힌 두 문장이 서로 맞아떨어지는지를 보는 것이다:
 *   "계약금 3천만원 + 전세보증금 1억7천만원으로 이루어져있음. (총2억)"
 *   "최소 잔금유예금은 ... 75,000,000원(74,84타입)"
 * 분양가 2억7,500만 · 납입보증금 1억7,000만 · 분할납부 2억이면
 * 지금 낼 현금이 정확히 계약금 3,000만원이 되어야 하고, 미루는 잔금이 7,500만원이어야 한다.
 */
test('★ 상담일지 84타입: 지금 낼 현금 = 계약금 3,000만원, 미루는 잔금 = 7,500만원', () => {
  const 분양가 = 275_000_000;
  const 납입보증금 = 170_000_000;
  const 최소잔금유예금 = 75_000_000;

  const cap = installmentCap({ 주택가격: 분양가, 최소잔금유예금, 총액상한: 200_000_000 });
  assert.equal(cap.최대분할납부액, 200_000_000);

  const bal = deferredBalance({ 주택가격: 분양가, 분할납부액: cap.최대분할납부액, 최소잔금유예금 });
  assert.equal(bal.잔금유예금, 75_000_000, '상담일지의 최소 잔금유예금과 같아야 한다');

  // 지금 마련할 현금 = 분할납부액 − 납입보증금 (+보증금대출 −본인준비금, 여기서는 0)
  const 지금필요 = cap.최대분할납부액 - 납입보증금;
  assert.equal(지금필요, 30_000_000, '상담일지의 「계약금 3천만원」과 같아야 한다');

  // 이자는 미룬 잔금에 붙는다 — 분할납부액에 붙이면 2.7배가 된다
  const i = deferredInterest({ 원금: bal.잔금유예금, annualRate: 0.03, 계약일: '2026-11-15', 만기년: 10 });
  const 온전한해 = i.연도별.find((y) => y.일수 === 365);
  assert.equal(온전한해.이자, 2_250_000);                    // 7,500만 × 3%
  assert.notEqual(온전한해.이자, 6_000_000);                 // 2억에 붙이면 이 값이 된다
});
