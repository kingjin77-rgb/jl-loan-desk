/**
 * 「분양전환 상담일지」 양식 그리기 — 종이 앞·뒷면과 같은 배치.
 *
 * editable=true  : 현장 상담 화면. 빈칸이 입력칸이다.
 * editable=false : 고객에게 보내는 안내장. 같은 양식에 값이 채워져 보인다.
 *
 * 계산되는 칸(필요자금·잔금유예금·○✕ 표시 등)은 data-calc 로 표시해 두고,
 * 입력 중에는 양식을 다시 만들지 않고 그 칸만 고친다(refreshForm) — 커서가 튀지 않게.
 */

import { el } from './dom.js';
import { typingInput } from './fields.js';
import { parseKRW, formatKRW } from '../core/money.js';
import { toMillion, toManText } from '../core/sangdamilji.js';

const M = 1_000_000;

function parseUnit(raw, unit) {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  if (/[억만천]/.test(s)) return parseKRW(s);
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * unit) : 0;
}

/**
 * @param {object} p
 * @param {object} p.form   양식 파일
 * @param {object} p.values formValues()
 * @param {object} p.calc   formCalc()
 * @param {boolean} p.editable
 * @param {(key:string, value:any, opts?:{rerender?:boolean})=>void} [p.set]
 * @param {{동?:string,호?:string,날짜?:string}} [p.who]
 */
export function renderForm({ form, values, calc, editable, set, who = {} }) {
  const f = form;
  const F = f.앞면;
  const B = f.뒷면;

  // 값 칸: 편집이면 입력칸, 아니면 글자
  const cell = (key, unit, { placeholder = '' } = {}) => {
    const shown = unit === M ? toMillion(values[key]) : toManText(values[key]);
    if (!editable) return el('span.f-val', { text: shown });
    return typingInput({
      class: 'f-in', type: 'text', inputmode: 'decimal', value: shown, placeholder,
      'aria-label': key, dataset: { key },
    }, (raw) => set(key, parseUnit(raw, unit)));
  };
  const calcCell = (key) => el('span.f-calc', { dataset: { calc: key } });

  const 앞 = el('section.f-page.f-front', {}, [
    el('div.f-titlebar', {}, [
      el('div.f-who', { text: [who.동 && `${who.동}동 ${who.호}호`, who.날짜].filter(Boolean).join(' · ') }),
      el('h1.f-title', { text: f.제목 }),
      el('div.f-head-red', { text: F.머리 }),
    ]),

    // 위쪽 표 — 분양가·보증금 / 보증금대출·본인준비금 / 필요자금·부부합산연소득
    el('div.f-grid.f-top', {}, [
      lab('분양가', '(A)'), el('div.f-v', {}, [cell('A', M)]),
      lab('보증금', '(B)'), el('div.f-v', {}, [cell('B', M)]),
      lab('보증금대출', '(C)'), el('div.f-v', {}, [cell('C', M)]),
      lab('본인준비금', '(D)'), el('div.f-v', {}, [cell('D', M)]),
      lab('필요자금', '(A−B+C−D)'), el('div.f-v', {}, [calcCell('need')]),
      lab('부부합산', '연소득'), el('div.f-v', {}, [cell('I', M)]),
    ]),
    el('div.f-unit', { text: F.단위.replace(/[<>]/g, (c) => (c === '<' ? '〈' : '〉')) }),

    // 저소득층 분할납부
    el('h2.f-sec', {}, [el('span.f-red', { text: F.저소득층.제목 })]),
    el('div.f-grid.f-lh', {}, [
      el('div.f-c.f-lh-asset', {}, [
        el('div', { text: F.저소득층.자산 }), el('div', { text: F.저소득층.자산부가 }),
        lhFill('자산', 'mk-asset'),
      ]),
      el('div.f-c.f-lh-car', {}, [
        el('div', { text: F.저소득층.자동차 }),
        lhFill('차', 'mk-car'),
      ]),
      el('div.f-c.f-lh-info', {}, [
        ...F.저소득층.안내.map((t) => el('div.f-red.f-b', { text: t })),
        el('div.f-b', { text: F.저소득층.검증일 }),
        el('div.f-stamp', { dataset: { calc: 'lh-stamp' } }),
      ]),
      el('div.f-c.f-lh-mi-l', { text: F.저소득층.월소득 }),
      el('div.f-c.f-lh-mi', {}, [
        ...F.저소득층.월소득칸.map((g) => incomeGroup(g)),
        mark('mk-income'),
        el('div.f-note', { dataset: { calc: 'mi-auto' } }),
      ]),
    ]),
    el('ul.f-notes', {}, F.저소득층.주석.map((n) => el('li', { class: n.red ? 'f-red' : '' }, [
      n.t,
      n.유공자 && editable ? el('label.f-yu', {}, [
        el('input', { type: 'checkbox', checked: values.유공자, onChange: (e) => set('유공자', e.target.checked, { rerender: true }) }),
        ' 국가유공자 자격으로 공급',
      ]) : null,
      n.유공자 && !editable && values.유공자 ? el('b.f-fillt', { text: '  ✓ 국가유공자' }) : null,
    ]))),
    el('div.f-filled', { dataset: { calc: 'low-defer' } }),

    // 분할납부 (일반)
    el('h2.f-sec', {}, [el('span.f-red', { text: F.일반.제목 }), ` ${F.일반.제목부가}`]),
    el('div.f-grid.f-gen', {}, [
      el('div.f-l', { text: '계약금' }), el('div.f-v.f-fixed', { text: String(F.일반.계약금) }),
      el('div.f-l', { text: '납입보증금' }), el('div.f-v.f-fixed', { text: String(F.일반.납입보증금) }),
      el('div.f-l', { text: '잔금유예금' }), el('div.f-v', {}, [calcCell('gen-defer')]),
      el('div.f-l.f-gen-js', {}, ['전세자금대출', el('br'), '필요금액']),
      el('div.f-v.f-gen-jsv', {}, [
        editable
          ? typingInput({
              class: 'f-in', type: 'text', inputmode: 'decimal', value: values.전세필요 != null ? toMillion(values.전세필요) : '',
              'aria-label': '전세자금대출 필요금액', dataset: { key: '전세필요' },
            }, (raw) => set('전세필요', String(raw).trim() === '' ? null : parseUnit(raw, M)))
          : null,
        el('span.f-calc', { dataset: { calc: 'jeonse' } }),
      ]),
    ]),
    el('div.f-loans', {}, [
      el('span', { dataset: { calc: 'beotimmok' } }, [`${F.일반.버팀목.이름} (  ${F.일반.버팀목.조건}  )`]),
      el('span', { dataset: { calc: 'bankjs' } }, [`${F.일반.은행전세.이름}(  ${F.일반.은행전세.조건}  )`]),
    ]),
    el('ul.f-notes', {}, F.일반.주석.map((n) => el('li', { class: n.red ? 'f-red' : '', text: n.t }))),
  ]);

  const 뒤 = el('section.f-page.f-back', {}, [
    el('div.f-titlebar.f-back-bar', {}, [
      el('h2.f-sec.f-inline', {}, [el('span.f-red', { text: B.기금.제목 })]),
      el('div.f-head-red', { text: B.기금.머리 }),
    ]),
    el('div.f-box', {}, [
      ...B.기금.줄.map(([k, v]) => k === '취급 지점' ? branchLine(k, B.기금.취급지점) : kv(k, v)),
      el('div.f-line', { text: B.기금.끝줄 }),
      el('div.f-filled', { dataset: { calc: 'gigeum-after' } }),
    ]),
    el('div.f-back-mid', {}, [
      el('div.f-didim', {}, [
        el('h2.f-sec', {}, [el('span.f-red', { text: B.디딤돌.제목 })]),
        el('div.f-box', {}, B.디딤돌.줄.map(([k, v]) => kv(k, v))),
      ]),
      table(B.신청시기.머리, B.신청시기.행, 'f-sched'),
    ]),
    table(B.디딤돌.금리표.머리, B.디딤돌.금리표.행.map((r) => [r.구분, ...r.값]), 'f-rate', (i) => ({ calc: `didim-${i}` })),
    el('div.f-small', {}, B.디딤돌.주.map((t) => el('div', { text: t }))),

    el('h2.f-sec', {}, [el('span.f-red', { text: B.보금자리.제목 })]),
    el('div.f-bogeum', {}, [
      el('div.f-box', {}, [...B.보금자리.줄앞.map(([k, v]) => kv(k, v)), ...B.보금자리.줄.map(([k, v]) => kv(k, v))]),
      table(B.보금자리.우대금리표.머리, B.보금자리.우대금리표.행, 'f-pref'),
    ]),
    table(B.보금자리.금리표.머리, B.보금자리.금리표.행, 'f-rate'),

    el('h2.f-sec', {}, [el('span.f-red', { text: B.은행.제목 })]),
    el('div.f-box', {}, B.은행.줄.map((t) => el('div.f-line', { text: t }))),
  ]);

  const root = el('div.f-form', { class: editable ? 'is-edit' : 'is-view' }, [앞, 뒤]);
  refreshForm(root, calc, values);
  return root;

  function lhFill(key, mk) {
    if (!editable && !values[key]) return el('div.f-fill', {}, [mark(mk)]);
    return el('div.f-fill', {}, ['( ', cell(key, 1e4, { placeholder: '0' }), ' 만원 )', mark(mk)]);
  }

  function incomeGroup(g) {
    const on = values.가구원수 === g.가구원수;
    const inner = on
      ? (editable
          ? typingInput({
              class: 'f-in f-in-mi', type: 'text', inputmode: 'decimal', value: toManText(values.월소득),
              placeholder: '만원', 'aria-label': `${g.가구원수}인 월소득`, dataset: { key: '월소득' },
            }, (raw) => set('월소득', parseUnit(raw, 1e4)))
          : el('b.f-fillt', { text: values.월소득 ? `${toManText(values.월소득)}` : '✓' }))
      : el('span.f-blank', { text: '    ' });
    const children = [g.표기, '(', inner, ')'];
    if (!editable) return el('span.f-mi', { class: on ? 'on' : '' }, children);
    return el('span.f-mi', {
      class: on ? 'on' : '', role: 'button', tabindex: on ? null : '0', title: `${g.가구원수}인 가구로 선택`,
      onClick: (e) => {
        if (on || e.target.closest('input')) return;
        set('가구원수', g.가구원수, { rerender: true });
        document.querySelector('.f-in-mi')?.focus();
      },
      onKeyDown: (e) => { if (!on && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } },
    }, children);
  }
}

/** 계산 칸만 다시 채운다. */
export function refreshForm(root, calc, values) {
  const put = (key, text, cls) => {
    for (const n of root.querySelectorAll(`[data-calc="${key}"]`)) {
      if (text != null) n.textContent = text;
      if (cls !== undefined) n.dataset.state = cls ?? '';
    }
  };
  put('need', calc.필요자금 == null ? '' : toMillion(calc.필요자금) || '0');

  const sym = { ok: '○', bad: '✕' };
  put('mk-asset', sym[calc.lhMark.자산] ?? '', calc.lhMark.자산);
  put('mk-car', sym[calc.lhMark.차] ?? '', calc.lhMark.차);
  put('mk-income', sym[calc.lhMark.월소득] ?? '', calc.lhMark.월소득);
  put('mi-auto', calc.월소득자동 && values.가구원수 != null
    ? `월소득 미기재 → 연소득 ÷ 12 = ${toManText(calc.월소득)}만으로 판정` : '');

  const lh = calc.lh;
  put('lh-stamp',
    calc.불가 ? '불가' : lh.국가유공자예외 ? '국가유공자 — 신청 가능' : lh.pass ? '충족 → LH검증신청서 제출' : '',
    calc.불가 ? 'bad' : lh.pass ? 'ok' : '');

  put('low-defer', calc.불가
    ? `▶ 저소득층 분할납부 불가: ${lh.실패.map((x) => `${x.label} ${formatKRW(x.초과액)} 초과`).join(', ')}`
    : calc.저소득잔금유예 != null && (lh.pass)
      ? `▶ 잔금유예(분양가 − 현재보증금) ${toMillion(calc.저소득잔금유예)}백만원 — ${formatKRW(calc.저소득잔금유예)}`
      : '', calc.불가 ? 'bad' : '');

  put('gen-defer', calc.일반잔금유예 == null ? '' : toMillion(calc.일반잔금유예) || '0', calc.일반최소미달 ? 'bad' : '');
  put('jeonse', calc.전세필요자동 && calc.전세필요 != null
    ? `${toMillion(calc.전세필요)} (기존 보증금대출 상환분)` : '', calc.전세필요자동 ? 'auto' : '');
  put('beotimmok', null, calc.버팀목 === true ? 'on' : '');
  put('bankjs', null, calc.버팀목 === false ? 'on' : '');

  put('gigeum-after', calc.기금후 == null ? ''
    : `▶ 필요자금 ${formatKRW(calc.필요자금)} − 기금대출 ${formatKRW(calc.기금한도)} = ${calc.기금후 > 0 ? `추가 마련 ${formatKRW(calc.기금후)}` : '기금대출로 충당'}`);
  root.querySelectorAll('[data-calc^="branch-"]').forEach((n) => { n.dataset.state = n.dataset.calc === `branch-${calc.지점}` ? 'on' : ''; });
  root.querySelectorAll('[data-calc^="didim-"]').forEach((n) => { n.dataset.state = n.dataset.calc === `didim-${calc.디딤돌행}` ? 'on' : ''; });
}

/* ── 조각 ── */

function lab(a, b) {
  return el('div.f-l', {}, [a, el('br'), b]);
}

function mark(key) {
  return el('b.f-mark', { dataset: { calc: key } });
}

function kv(k, v) {
  return el('div.f-line', {}, [k ? el('b', { text: `${k}: ` }) : el('span.f-indent'), v]);
}

/** 취급 지점 줄 — 이 동의 지점에 표시. 문구는 양식 그대로. */
function branchLine(k, list) {
  return el('div.f-line', {}, [
    el('b', { text: `${k}: ` }),
    ...list.flatMap((x, i) => [
      i ? ', ' : '',
      el('span.f-branch', { dataset: { calc: `branch-${i}` }, text: `${x.지점}(${x.동[0]}~${x.동[1]}동)` }),
    ]),
  ]);
}

function table(head, rows, cls, rowAttr = null) {
  return el(`table.f-table.${cls}`, {}, [
    el('thead', {}, [el('tr', {}, head.map((h) => el('th', { text: h })))]),
    el('tbody', {}, rows.map((r, i) => el('tr', rowAttr ? { dataset: rowAttr(i) } : {}, r.map((c) => el('td', { text: c }))))),
  ]);
}
