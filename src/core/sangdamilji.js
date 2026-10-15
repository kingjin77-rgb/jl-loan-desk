/**
 * 「분양전환 상담일지」(전주, 앞·뒷면) — 칸 계산과 안내장 링크.
 *
 * 앱의 현장 상담 화면과 고객에게 보내는 안내장이 **같은 양식**을 쓴다.
 * 이 파일은 양식의 빈칸에 들어갈 값만 계산한다(DOM 없음).
 *
 * 단위: 양식 위쪽 표와 분할납부(일반) 표는 「백만원」, LH 칸은 「만원」 표기다.
 * 값은 전부 원 단위로 다루고 화면에 그릴 때만 바꾼다.
 */

import { lhVerification } from './bunyangjeonhwan.js';
import { lh불가 } from './lh-gate.js';

/** store 입력 → 양식 값 (원 단위). */
export function formValues(input = {}) {
  const c = input.conversion ?? {};
  const b = input.borrower ?? {};
  return {
    A: c.분양가 || 0,
    B: c.납입보증금 || 0,
    C: c.보증금대출 || 0,
    D: c.본인준비금 || 0,
    I: b.annualIncome || 0,
    자산: c.자산가액 || 0,
    차: c.자동차가액 || 0,
    월소득: c.월소득 || 0,
    가구원수: c.가구원수 ?? null,
    유공자: Boolean(c.국가유공자),
    전세필요: c.전세자금대출필요액 ?? null,
  };
}

/** 양식 값 → store 경로. 안내장 링크를 열었을 때 같은 입력을 다시 만든다. */
export const VALUE_PATHS = {
  A: 'conversion.분양가', B: 'conversion.납입보증금', C: 'conversion.보증금대출', D: 'conversion.본인준비금',
  I: 'borrower.annualIncome', 자산: 'conversion.자산가액', 차: 'conversion.자동차가액', 월소득: 'conversion.월소득',
  가구원수: 'conversion.가구원수', 유공자: 'conversion.국가유공자', 전세필요: 'conversion.전세자금대출필요액',
};

const M = 1_000_000;

/**
 * 빈칸 계산.
 * @param {object} v     formValues()
 * @param {object} form  양식 파일 (sangdamilji)
 * @param {object} rules 분양전환 파일 (bunyangjeonhwan)
 * @param {{동?:string}} who
 */
export function formCalc(v, form, rules = {}, who = {}) {
  const 입력됨 = v.A > 0;
  const 필요자금 = 입력됨 ? v.A - v.B + v.C - v.D : null;

  // 3. 월소득 — 따로 안 적었으면 부부합산 연소득 ÷ 12
  const 월소득자동 = !v.월소득 && v.I > 0;
  const 월소득 = v.월소득 || (v.I > 0 ? Math.round(v.I / 12) : null);
  const lh = lhVerification({
    자산가액: v.자산 || null,
    자동차가액: v.차 || null,
    월소득,
    가구원수: v.가구원수,
    국가유공자: v.유공자,
  }, rules.LH검증 ?? {});
  const 불가 = lh불가(lh);
  const mark = (label) => {
    const c = lh.checks.find((x) => x.label.startsWith(label));
    return c?.pass === true ? 'ok' : c?.pass === false ? 'bad' : null;
  };

  // 저소득층: 현재보증금을 제외한 남은 잔금이 모두 잔금유예
  const 저소득잔금유예 = 입력됨 ? Math.max(0, v.A - v.B) : null;

  // 일반: 계약금 + 납입보증금(= 2억)을 뺀 나머지가 잔금유예
  const g = form?.앞면?.일반 ?? {};
  const 분할납부총액 = ((g.계약금 ?? 30) + (g.납입보증금 ?? 170)) * M;
  const 일반잔금유예 = 입력됨 ? Math.max(0, v.A - 분할납부총액) : null;
  const 최소 = (g.최소잔금유예금 ?? 75) * M;
  const 일반최소미달 = 입력됨 && 일반잔금유예 < 최소;

  // 전세자금대출 필요금액 — 상담일지에 산식이 없다. 비워 두면 기존 보증금대출(C)을 제안한다
  // (기존 보증금대출은 분할납부 계약 전 상환해야 하므로 그만큼 새 전세자금대출이 필요).
  const 전세필요자동 = v.전세필요 == null;
  const 전세필요 = 전세필요자동 ? (v.C > 0 ? v.C : null) : v.전세필요;
  const 버팀목상한 = g.버팀목?.소득상한 ?? 50_000_000;
  const 버팀목 = v.I > 0 ? v.I <= 버팀목상한 : null;

  // 뒷면: 기금대출 승계 후 남는 돈, 이 동의 취급 지점, 디딤돌 금리 행
  const 기금한도 = form?.뒷면?.기금?.한도 ?? 75_000_000;
  const 기금후 = 입력됨 ? Math.max(0, 필요자금 - 기금한도) : null;
  const 동 = Number(who.동);
  const 지점 = (form?.뒷면?.기금?.취급지점 ?? []).findIndex((x) => 동 >= x.동[0] && 동 <= x.동[1]);
  const 디딤돌행 = v.I > 0 ? (form?.뒷면?.디딤돌?.금리표?.행 ?? []).findIndex((r) => v.I <= r.상한) : -1;

  return {
    입력됨, 필요자금, lh, 불가, 월소득, 월소득자동,
    lhMark: { 자산: mark('자산'), 차: mark('자동차'), 월소득: mark('월소득') },
    저소득잔금유예, 일반잔금유예, 일반최소미달, 전세필요, 전세필요자동, 버팀목,
    기금한도, 기금후, 지점, 디딤돌행,
  };
}

/** 원 → 백만원 표기 ("275", "0.5", "1,050"). 0·빈값은 빈칸. */
export function toMillion(won) {
  if (won == null || won === 0) return '';
  return (won / M).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

/** 원 → 만원 표기. */
export function toManText(won) {
  if (won == null || won === 0) return '';
  return Math.round(won / 10_000).toLocaleString('ko-KR');
}

/* ───────────────── 안내장 링크 ─────────────────
 * 값은 주소의 # 뒤에 담는다. # 뒤는 서버로 전송되지 않으므로 고객 정보가
 * 호스팅 서버 기록에 남지 않는다. 연락처는 넣지 않는다.
 */

const KEYS = [['A', 'a'], ['B', 'b'], ['C', 'c'], ['D', 'd'], ['I', 'i'], ['자산', 's'], ['차', 'k'], ['월소득', 'm'], ['전세필요', 'j']];

export function encodeNotice({ values, 동, 호, 날짜 }) {
  const o = { v: 1, 동: String(동 ?? ''), 호: String(호 ?? ''), t: 날짜 ?? '' };
  for (const [k, s] of KEYS) if (values[k] != null && values[k] !== 0) o[s] = Math.round(values[k] / 10_000);
  if (values.가구원수 != null) o.n = values.가구원수;
  if (values.유공자) o.y = 1;
  const json = JSON.stringify(o);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeNotice(code) {
  const b64 = String(code).replace(/^#/, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  if (o.v !== 1) throw new Error('안내장 주소 형식이 맞지 않습니다.');
  const won = (s, empty = 0) => (o[s] != null ? o[s] * 10_000 : empty);
  // formValues() 와 같은 모양·순서로 돌려준다.
  const values = {
    A: won('a'), B: won('b'), C: won('c'), D: won('d'), I: won('i'),
    자산: won('s'), 차: won('k'), 월소득: won('m'),
    가구원수: o.n ?? null, 유공자: Boolean(o.y), 전세필요: won('j', null),
  };
  return { values, 동: o.동, 호: o.호, 날짜: o.t };
}

/** 안내장 문자 문구. 양식 자체는 링크로 보낸다(문자에는 표를 담을 수 없다). */
export function noticeMessage({ 동, 호, url, 보내는곳 = '법무법인 제이엘' }) {
  return [
    `[${보내는곳}] ${동}동 ${호}호 분양전환 상담일지`,
    '오늘 상담하신 내용(앞·뒷면)을 보내 드립니다.',
    url,
    '※ 상담 가이드이며, 정확한 한도·금리·조건은 취급기관 확인이 필요합니다.',
  ].join('\n');
}
