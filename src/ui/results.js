/**
 * 우측 결과 영역.
 *
 * 설계 원칙 하나: **모든 숫자 옆에 그 숫자가 나온 산식을 붙인다.**
 * 상담사가 고객 앞에서 "왜요?"라는 질문을 받았을 때 화면만 보고 답할 수 있어야 한다.
 */

import { el, panel, table, replace } from './dom.js';
import { formatKRW, formatPct, formatNumber } from '../core/money.js';
import { formatKo } from '../core/dates.js';

// ───────────────────────── 상단 요약 ─────────────────────────

export function summaryStrip(r) {
  const cells = [];

  // 머리글에는 결론 한 문장만 둔다. 개별 수치는 아래 셀에서 따로 보여주므로
  // 여기서 같은 값을 반복하면 읽는 눈이 두 번 일한다.
  if (r.janggeum) {
    cells.push(el('div.cell.headline', {}, [
      el('div.k', { text: '입주 시 자금' }),
      el('div.v', { class: r.janggeum.shortfall > 0 ? 'danger' : 'ok', text: r.janggeum.headline }),
    ]));
  }

  cells.push(el('div.cell', {}, [
    el('div.k', { text: '예상 한도' }),
    el('div.v.accent', { text: formatKRW(r.limit.finalAmount) }),
    el('div.note', { text: r.limit.binding ? `${r.limit.binding.label}에서 막힘` : '산출 불가' }),
  ]));

  const monthly = r.payment.monthlyPayment ?? r.payment.firstPayment;
  cells.push(el('div.cell', {}, [
    el('div.k', { text: r.payment.monthlyPayment != null ? '월 상환액' : '첫 회차 상환액' }),
    el('div.v', { text: formatKRW(monthly) }),
    el('div.note', { text: `약정 ${formatPct(r.input.product.annualRate)} · ${Math.round(r.input.product.termMonths / 12)}년 ${r.input.product.method}` }),
  ]));

  cells.push(el('div.cell', {}, [
    el('div.k', { text: '총 이자' }),
    el('div.v', { text: formatKRW(r.payment.totalInterest) }),
    el('div.note', { text: `총 상환 ${formatKRW(r.payment.totalPayment)}` }),
  ]));

  if (r.limit.requestedAmount != null) {
    cells.push(el('div.cell', {}, [
      el('div.k', { text: '희망액 대비' }),
      el('div.v', { class: r.limit.isSufficient ? 'ok' : 'danger', text: (r.limit.requestedGap >= 0 ? '여유 ' : '부족 ') + formatKRW(Math.abs(r.limit.requestedGap)) }),
      el('div.note', { text: `희망 ${formatKRW(r.limit.requestedAmount)}` }),
    ]));
  }

  return el('div.summary', {}, cells);
}

// ───────────────────────── 상담 스크립트 ─────────────────────────

export function scriptPanel(r) {
  const n = r.narrative;
  const body = [
    el('div.callout.bind', {}, [el('div.script', {}, [
      el('p', {}, [el('b', { text: n.bindingLine })]),
      n.slackLine ? el('p', { text: n.slackLine }) : null,
      n.requestLine ? el('p', { text: n.requestLine }) : null,
      el('p', { text: r.paymentLine }),
    ].filter(Boolean))]),
  ];

  if (r.levers.length) {
    body.push(el('h3', { text: '한도를 늘리려면', style: 'margin:12px 0 6px' }));
    body.push(el('ul.levers', {}, r.levers.map((l) => el('li', {}, [
      el('span.delta', { text: `+${formatKRW(l.delta)}` }),
      el('span', {}, [
        l.label,
        el('span.tiny.faint', { text: ` → ${formatKRW(l.after)}${l.newBinding ? ` (그다음 ${l.newBinding})` : ''}` }),
        l.hint ? el('div.tiny.faint', { text: l.hint }) : null,
      ]),
    ]))));
    body.push(el('p.tiny.faint', { text: '위 금액은 각 조건을 실제로 바꿔 다시 계산한 결과입니다.', style: 'margin-top:6px' }));
  }

  return panel('상담 스크립트', body, { id: 'result-script' });
}

// ───────────────────────── 한도 산출 내역 ─────────────────────────

export function limitPanel(r) {
  const rows = r.limit.caps;

  const t = table([
    { key: 'label', label: '상한' },
    { key: 'amount', label: '금액', num: true, render: (c) => (c.applicable && Number.isFinite(c.amount) ? formatKRW(c.amount) : '미적용') },
    { key: 'formula', label: '산식', render: (c) => el('span.small.muted', { text: c.formula || '-' }) },
  ], rows, {
    rowClass: (c) => (c === r.limit.binding ? 'bind' : !c.applicable ? 'inapplicable' : ''),
  });

  const body = [
    el('div.table-scroll', {}, [t]),
    el('div.callout', { style: 'margin-top:12px' }, [
      el('div', {}, [
        el('b', { text: '최종 한도 ' }),
        el('span.num', { text: formatKRW(r.limit.finalAmount) }),
        el('span.tiny.faint', { text: ' (만원 단위 절사)' }),
      ]),
      r.limit.binding ? el('div.tiny.muted', { text: `가장 낮은 상한: ${r.limit.binding.label}` }) : null,
    ]),
  ];

  if (r.deductions.length) {
    body.push(el('h3', { text: '차감 항목', style: 'margin:12px 0 6px' }));
    body.push(table([
      { key: 'label', label: '항목' },
      { key: 'amount', label: '금액', num: true, render: (d) => (d.waived ? '면제' : formatKRW(d.amount)) },
      { key: 'formula', label: '내역', render: (d) => el('span.small.muted', { text: d.formula }) },
    ], r.deductions));
  }

  // 스트레스 금리는 따로 보여준다 — 상담사가 가장 자주 설명해야 하는 항목
  body.push(el('div.callout', { class: r.stress.applied ? '' : 'warn', style: 'margin-top:12px' }, [
    el('div', {}, [el('b', { text: 'DSR 산정 금리 ' }), el('span.num', { text: formatPct(r.stress.forDsrOnly) })]),
    el('div.tiny.muted', { text: r.stress.explanation }),
    el('div.tiny.faint', { text: '이 금리는 한도 산정에만 쓰입니다. 실제 내시는 이자는 약정금리 기준입니다.' }),
  ]));

  return panel('한도 산출 내역', body, { id: 'result-limit' });
}

// ───────────────────────── 금리 시나리오 ─────────────────────────

export function scenarioPanel(r) {
  return panel('금리 시나리오', [
    table([
      { key: 'label', label: '시나리오' },
      { key: 'rate', label: '금리', num: true, render: (s) => formatPct(s.rate) },
      { key: 'monthlyPayment', label: '월 상환액', num: true, render: (s) => formatKRW(s.monthlyPayment) },
      { key: 'deltaMonthly', label: '증가', num: true, render: (s) => (s.deltaMonthly ? `+${formatKRW(s.deltaMonthly)}` : '—') },
      { key: 'totalInterest', label: '총 이자', num: true, render: (s) => formatKRW(s.totalInterest) },
    ], r.scenarios, { rowClass: (s) => (s.label === '기준' ? 'bind' : '') }),
    el('p.tiny.faint', { text: '대출금액은 고정하고 금리만 바꾼 비교입니다.', style: 'margin-top:8px' }),
  ], { id: 'result-scenarios' });
}

// ───────────────────────── 상환 스케줄 ─────────────────────────

export function schedulePanelResult(r, { monthly = false, onToggle }) {
  const yearCols = [
    { key: 'year', label: '연차', num: true },
    { key: 'payment', label: '연 상환액', num: true, render: (y) => formatKRW(y.payment) },
    { key: 'principal', label: '원금', num: true, render: (y) => formatKRW(y.principal) },
    { key: 'interest', label: '이자', num: true, render: (y) => formatKRW(y.interest) },
    { key: 'closing', label: '잔액', num: true, render: (y) => formatKRW(y.closing) },
  ];
  const monthCols = [
    { key: 'n', label: '회차', num: true },
    { key: 'payment', label: '상환액', num: true, render: (m) => formatKRW(m.payment) },
    { key: 'principal', label: '원금', num: true, render: (m) => formatKRW(m.principal) },
    { key: 'interest', label: '이자', num: true, render: (m) => formatKRW(m.interest) },
    { key: 'closing', label: '잔액', num: true, render: (m) => formatKRW(m.closing) },
  ];

  const toggle = el('div.seg', {}, [
    el('button', { type: 'button', text: '연 단위', 'aria-pressed': String(!monthly), onClick: () => onToggle(false) }),
    el('button', { type: 'button', text: '월 단위', 'aria-pressed': String(monthly), onClick: () => onToggle(true) }),
  ]);

  const rows = monthly ? r.payment.schedule : r.paymentByYear;
  const cols = monthly ? monthCols : yearCols;

  return panel('상환 스케줄', [
    el('div.table-wrap', { class: monthly ? 'print-monthly-schedule' : '' }, [
      table(cols, rows, { rowClass: (x) => (x.isGrace ? 'inapplicable' : '') }),
    ]),
    el('p.tiny.faint', { text: `총 ${r.payment.schedule.length}회차 · 총 이자 ${formatKRW(r.payment.totalInterest)}`, style: 'margin-top:8px' }),
  ], { id: 'result-schedule', actions: toggle });
}

// ───────────────────────── 중도금 → 잔금 ─────────────────────────

export function timelinePanel(r) {
  if (!r.timeline) return null;
  const total = r.timeline.totals.총분양대금 || 1;

  const rows = r.timeline.events.map((e) => ({
    ...e,
    _pct: e.cumulative / total,
    _loan: r.jungdogeum?.drawdowns.find((d) => d.round === e.round && e.kind === '중도금'),
  }));

  return panel('납부 타임라인', [
    el('div.table-scroll', {}, [table([
      { key: 'kind', label: '구분', render: (e) => `${e.kind}${e.round ? ` ${e.round}회` : ''}` },
      { key: 'date', label: '일자', render: (e) => el('span.small', { text: e.date ?? '-' }) },
      { key: 'ratio', label: '비율', num: true, render: (e) => formatPct(e.ratio, 0) },
      { key: 'amount', label: '금액', num: true, render: (e) => formatKRW(e.amount) },
      { key: 'loan', label: '대출', num: true, render: (e) => (e.loanAmount ? formatKRW(e.loanAmount) : e.kind === '잔금' ? '잔금대출' : '—') },
      { key: 'self', label: '자납', num: true, render: (e) => (e.kind === '중도금' ? formatKRW(e.selfAmount) : e.funding === '자납' ? formatKRW(e.amount) : '—') },
      { key: 'interest', label: '후불이자', num: true, render: (e) => (e._loan?.accruedInterest ? formatKRW(e._loan.accruedInterest) : '—') },
      { key: 'cum', label: '누적', num: true, render: (e) => el('div', {}, [
        el('div', { text: formatKRW(e.cumulative) }),
        el('div.bar', {}, [el('span', { style: `width:${Math.min(100, e._pct * 100).toFixed(1)}%` })]),
      ]) },
      { key: 'status', label: '상태', render: (e) => el('span.chip', { text: e.status }) },
    ], rows)]),
    r.jungdogeum ? el('p.tiny.faint', {
      text: `중도금대출 ${formatKRW(r.jungdogeum.totalDrawn)} · 후불이자 합계 ${formatKRW(r.jungdogeum.totalAccruedInterest)} (${r.jungdogeum.interestMode}, 잔금 기표일 ${formatKo(r.timeline.conversionDate)})`,
      style: 'margin-top:8px',
    }) : null,
  ].filter(Boolean), { id: 'result-timeline' });
}

export function fundsPanel(r) {
  if (!r.janggeum) return null;
  const g = r.janggeum;

  const rows = [
    ...g.소요항목.map((x) => ({ ...x, group: '필요자금' })),
    ...g.조달항목.map((x) => ({ ...x, group: '조달' })),
  ];

  return panel('입주 시 자금수지', [
    el('div.callout', { class: g.shortfall > 0 ? 'danger' : 'ok' }, [
      el('div.script', {}, [el('p', {}, [el('b', { text: g.headline })])]),
    ]),
    table([
      { key: 'group', label: '구분' },
      { key: 'label', label: '항목' },
      { key: 'amount', label: '금액', num: true, render: (x) => (x.sign > 0 ? '' : '−') + formatKRW(x.amount) },
      { key: 'hint', label: '비고', render: (x) => el('span.tiny.faint', { text: x.hint ?? '' }) },
    ], rows, {
      foot: { group: '', label: g.shortfall > 0 ? '부족자금' : '여유자금', amount: formatKRW(Math.abs(g.shortfall)), hint: '' },
      rowClass: (x) => (x.sign < 0 ? 'inapplicable' : ''),
    }),
    g.unusedLimit > 0
      ? el('p.tiny.faint', { text: `잔금대출 한도 ${formatKRW(g.balanceLoanLimit)} 중 ${formatKRW(g.balanceLoanAmount)}만 사용 (여유 ${formatKRW(g.unusedLimit)})`, style: 'margin-top:8px' })
      : null,
  ].filter(Boolean), { id: 'result-funds' });
}

// ───────────────────────── 경고 · 면책 ─────────────────────────

export function warningsPanel(r) {
  if (!r.warnings.length) return null;
  return panel('확인사항', [
    el('div', {}, r.warnings.map((w) => el('div.callout.warn', { text: w }))),
  ], { id: 'result-warnings' });
}

export function errorsPanel(errors) {
  if (!errors.length) return null;
  return panel('계산을 진행할 수 없습니다', [
    el('div', {}, errors.map((e) => el('div.callout.danger', {}, [
      el('div.script', {}, e.message.split('\n').map((line) => el('p', { text: line }))),
    ]))),
  ], { id: 'result-errors' });
}
