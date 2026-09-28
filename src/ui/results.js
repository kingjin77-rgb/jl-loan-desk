/**
 * 우측 결과 영역.
 *
 * 설계 원칙 하나: **모든 숫자 옆에 그 숫자가 나온 산식을 붙인다.**
 * 상담사가 고객 앞에서 "왜요?"라는 질문을 받았을 때 화면만 보고 답할 수 있어야 한다.
 */

import { el, panel, table, replace } from './dom.js';
import { formatKRW, formatPct, formatNumber } from '../core/money.js';
import { formatKo } from '../core/dates.js';
import { limitChart, dsrChart, fundsChart, timelineChart, scenarioChart, conversionChart } from './charts.js';

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
    el('div.k', { text: r.isExample ? '예상 한도 (예시)' : '예상 한도' }),
    el('div.v.accent', { text: formatKRW(r.limit.finalAmount) }),
    el('div.note', { text: r.limit.binding ? `${r.limit.binding.label}에서 막힘` : '산출 불가' }),
  ]));

  const monthly = r.payment.monthlyPayment ?? r.payment.firstPayment;
  cells.push(el('div.cell', {}, [
    el('div.k', { text: r.payment.monthlyPayment != null ? '월 상환액' : '첫 회차 상환액' }),
    el('div.v', { text: formatKRW(monthly) }),
    // 상품을 골랐으면 그 상품 금리로 계산한 것이다. 화면의 약정금리를 적어 두면
    // 상담사가 다른 금액을 불러 주게 된다.
    el('div.note', {
      text: `${formatPct(r.paymentRate?.rate ?? r.input.product.annualRate)}`
        + ` · ${Math.round((r.paymentRate?.termMonths ?? r.input.product.termMonths) / 12)}년 ${r.input.product.method}`,
      title: r.paymentRate?.source ?? '',
    }),
    r.paymentRate && r.paymentRate.source !== '화면의 약정금리'
      ? el('div.note.tiny.faint', { text: r.paymentRate.source + (r.paymentRate.graceMonths ? ` · ${r.paymentRate.graceMonths / 12}년 거치 기준` : '') })
      : null,
  ].filter(Boolean)));

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
  // 단지를 안 넣었을 때 "이 앱은 단지 전용인가?" 하는 오해가 생긴다.
  // 지금 결과가 온전하다는 것과, 단지를 넣으면 무엇이 더 나오는지 한 줄로 밝힌다.
  const noComplex = !r.janggeum;
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

  if (noComplex) {
    body.push(el('p.tiny.faint', { style: 'margin-top:10px', text:
      '분양 단지 상담이라면 「단지」를 추가하면 중도금 후불이자와 입주 시 필요자금까지 계산됩니다. ' +
      '기존 주택 매매·전세라면 이대로 쓰시면 됩니다.' }));
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
    // ★ 상품 기준 한도라는 사실을 맨 위에 밝힌다.
    //   규제 LTV·DSR 이 빠진 채 나온 숫자이므로, 실제 승인액보다 클 수 있다.
    //   이걸 숨기면 상담사가 규제 반영된 최종 한도로 오해한다.
    r.limit.selectedProduct?.auto
      ? el('div.callout', { style: 'margin-bottom:8px' }, [
          el('b', { text: `${r.limit.selectedProduct.name} — 타입에 따른 기본 제안입니다. ` }),
          '쓰지 않으려면 분양전환 패널의 「기금대출 승계 사용」을 끄십시오.',
        ])
      : null,
    r.isExample
      ? el('div.callout.warn', {}, [
          el('div.script', {}, [
            el('p', {}, [el('b', { text: '예시 규제값으로 계산한 가이드입니다.' })]),
            el('p', { text: `${r.exampleCaps.join(' · ')}은(는) 설명용 예시 수치입니다. 실행일·현장·은행마다 다릅니다 — 정확한 조건은 상담사 문의. `
              + '실제값을 넣으면(메뉴 → 규제 수치) 그 항목은 예시를 쓰지 않습니다.' }),
          ]),
        ])
      : null,
    r.limit.basis === '상품 기준'
      ? el('div.callout.warn', {}, [
          el('div.script', {}, [
            el('p', {}, [el('b', {
              text: `${r.limit.selectedProduct?.name ?? '고른 상품'} 기준으로 계산했습니다 — 규제 상한이 빠진 숫자입니다.`,
            })]),
            el('p', { text:
              `아직 채우지 못한 것: ${r.limit.missingRegulation.join(' · ')}. ` +
              '이 값들을 넣으면 한도가 더 내려갈 수 있습니다. 실제 승인액은 취급 기관 심사 결과에 따릅니다.' }),
          ]),
        ])
      : null,
    // 거치는 고객 본인이 고른다. 우리는 "거치할 수 있다"까지만 말한다.
    // 숫자를 거치별로 늘어놓으면 우리가 정해 주는 것처럼 읽힌다.
    r.graceScenarios
      ? el('p.tiny.faint', { style: 'margin:0 0 10px', text:
          `거치: ${r.graceScenarios.map((g) => g.label).join(' 또는 ')} 중 고객이 선택합니다. ` +
          `위 월 상환액은 ${r.graceScenarios.find((g) => g.current)?.label ?? ''} 기준입니다.` })
      : null,
    // 도식이 먼저, 표가 그다음. 표는 그대로 남는다 — 도식이 표를 대체하지 않는다.
    limitChart(r),
    dsrChart(r),
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

  return panel('한도 산출 내역', body.filter(Boolean), { id: 'result-limit' });
}

// ───────────────────────── 금리 시나리오 ─────────────────────────

export function scenarioPanel(r, fold = {}) {
  return panel('금리 시나리오', [
    scenarioChart(r),
    table([
      { key: 'label', label: '시나리오' },
      { key: 'rate', label: '금리', num: true, render: (s) => formatPct(s.rate) },
      { key: 'monthlyPayment', label: '월 상환액', num: true, render: (s) => formatKRW(s.monthlyPayment) },
      { key: 'deltaMonthly', label: '증가', num: true, render: (s) => (s.deltaMonthly ? `+${formatKRW(s.deltaMonthly)}` : '—') },
      { key: 'totalInterest', label: '총 이자', num: true, render: (s) => formatKRW(s.totalInterest) },
    ], r.scenarios, { rowClass: (s) => (s.label === '기준' ? 'bind' : '') }),
  ].filter(Boolean), { id: 'result-scenarios', ...fold });
}

// ───────────────────────── 상환 스케줄 ─────────────────────────

export function schedulePanelResult(r, { monthly = false, onToggle, fold = {} }) {
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
  ], { id: 'result-schedule', actions: toggle, ...fold });
}

// ───────────────────────── 중도금 → 잔금 ─────────────────────────

export function timelinePanel(r, fold = {}) {
  if (!r.timeline) return null;
  const total = r.timeline.totals.총분양대금 || 1;

  const rows = r.timeline.events.map((e) => ({
    ...e,
    _pct: e.cumulative / total,
    _loan: r.jungdogeum?.drawdowns.find((d) => d.round === e.round && e.kind === '중도금'),
  }));

  return panel('납부 타임라인', [
    timelineChart(r),
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
  ].filter(Boolean), { id: 'result-timeline', ...fold });
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
    fundsChart(r),
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

// ───────────────────────── 분양전환 ─────────────────────────

/**
 * 분양전환 결과 — 상담일지의 세 표를 그대로.
 *
 * 결론 한 줄은 「지금 얼마를 마련해야 하고, 해마다 12월에 얼마를 내는가」다.
 * 잔금유예는 대출이 아니라 매도인에 대한 미납 잔금이므로 월 상환액이 없다.
 */
export function conversionPanel(r, fold = {}) {
  const c = r.conversion;
  if (!c) return null;

  const 이자없음 = c.interest.총이자 == null;
  const 첫해 = c.interest.연도별[0] ?? null;
  const 온전한해 = c.interest.연도별.find((y) => y.일수 >= 365) ?? 첫해;

  const 결론 = 이자없음
    ? `분할납부로 가면 지금 ${formatKRW(c.분할납부시필요액)}을 마련하고 ` +
      `잔금 ${formatKRW(c.balance.잔금유예금)}을 ${c.interest.만기일}(${c.interest.만기근거})까지 미룹니다. ` +
      `금리를 확인해야 연납 이자가 나옵니다.`
    : `분할납부로 가면 지금 ${formatKRW(c.분할납부시필요액)}을 마련하고, ` +
      `미룬 잔금 ${formatKRW(c.balance.잔금유예금)}에 대해 해마다 12월에 약 ${formatKRW(온전한해?.이자 ?? 0)}씩 냅니다. ` +
      `${c.interest.만기일}(${c.interest.만기근거})에 원금 ${formatKRW(c.interest.총원금)}을 일괄 납부합니다. ` +
      `일시납으로 가면 지금 ${formatKRW(c.일시납필요액)}이 필요합니다.`;

  const children = [
    el('div.callout', { class: 이자없음 ? 'warn' : 'ok' }, [
      el('div.script', {}, [el('p', {}, [el('b', { text: 결론 })])]),
    ]),

    // ① 필요자금
    el('h3.sub', { text: '① 필요자금' }),
    table([
      { key: '기호', label: '' },
      { key: '항목', label: '항목' },
      { key: '금액', label: '금액', num: true, render: (x) => (x.부호 > 0 ? '' : '−') + formatKRW(x.금액) },
      { key: '비고', label: '비고', render: (x) => el('span.tiny.faint', { text: x.비고 ?? '' }) },
    ], c.funds.내역, {
      foot: { 기호: '', 항목: `필요자금 (${c.funds.식})`, 금액: formatKRW(c.funds.필요자금), 비고: '' },
      rowClass: (x) => (x.부호 < 0 ? 'inapplicable' : ''),
    }),

    // ② 분할납부 · 잔금유예
    el('h3.sub', { text: '② 분할납부 (잔금유예)' }),
    table([
      { key: 'k', label: '항목' },
      { key: 'v', label: '금액', num: true },
      { key: 'note', label: '비고', render: (x) => el('span.tiny.faint', { text: x.note ?? '' }) },
    ], [
      { k: '최대 분할납부액', v: formatKRW(c.cap.최대분할납부액 ?? 0), note: c.cap.상한사유 ?? '' },
      { k: '적용 분할납부액', v: formatKRW(c.분할납부액), note: c.분할납부액자동 ? '가능한 최대로 계산' : '상담사 입력' },
      { k: '잔금유예금', v: formatKRW(c.balance.잔금유예금), note: c.최소잔금유예금 != null ? `최소 ${formatKRW(c.최소잔금유예금)}` : '최소액 미설정' },
      { k: '분할납부 시 지금 필요액', v: formatKRW(c.분할납부시필요액), note: '분할납부액 − 납입보증금 + 보증금대출 − 본인준비금' },
      { k: '일시납 시 지금 필요액', v: formatKRW(c.일시납필요액), note: '필요자금 전액 (A − B + C − D)' },
      ...(r.limit.selectedProduct?.productId === 'gigeum-seunggye'
        ? [
            { k: '기금승계로 조달', v: formatKRW(Math.min(r.limit.finalAmount, c.일시납필요액)), note: `${r.limit.selectedProduct.name} 한도 ${formatKRW(r.limit.finalAmount)}` },
            { k: '그다음 마련할 금액', v: formatKRW(Math.max(0, c.일시납필요액 - r.limit.finalAmount)), note: '디딤돌·보금자리·은행·자기자금 — 중복 가능 여부는 취급점 확인' },
          ]
        : []),
    ]),
  ];

  // ③ 연납 이자
  if (이자없음) {
    children.push(
      el('h3.sub', { text: '③ 잔금유예 이자' }),
      el('div.callout.warn', { text: c.interest.reason ?? '금리가 설정되지 않았습니다' }),
      el('p.tiny.faint', { text: `만기: ${c.interest.만기일} (${c.interest.만기근거}) — 금리 없이도 만기는 확정됩니다.` }),
    );
  } else {
    children.push(
      el('h3.sub', { text: '③ 잔금유예 이자 — 매년 12월 일할계산, 연납' }),
      el('p.tiny.faint', { text: `이자는 미룬 잔금 ${formatKRW(c.balance.잔금유예금)}에 붙습니다 (분할납부액이 아닙니다).` }),
      conversionChart(r),
      el('p.tiny.faint', {
        text: `금리 ${formatPct(c.interest.annualRate)} (${c.금리출처}) · ${c.interest.일수기준}일 기준 · ` +
              `만기 ${c.interest.만기일} (${c.interest.만기근거}) · 총이자 ${formatKRW(c.interest.총이자)}`,
      }),
      table([
        { key: '연도', label: '연도', render: (x) => `${x.연도}년` },
        { key: '일수', label: '일수', num: true, render: (x) => `${x.일수}일` },
        { key: '기말원금', label: '잔여원금', num: true, render: (x) => formatKRW(x.기말원금) },
        { key: '이자', label: '12월 납부 이자', num: true, render: (x) => formatKRW(x.이자) },
        { key: '만기해', label: '', render: (x) => (x.만기해 ? el('span.tiny', { text: '＋원금 일괄' }) : '') },
      ], c.interest.연도별),
      el('p.tiny.faint', { text: '일부상환은 100만원 단위로 언제든 가능하고 중도상환수수료가 없습니다. 상환한 다음 날부터 줄어든 원금에 이자가 붙습니다.' }),
    );
  }

  // ④ LH 검증
  children.push(
    el('h3.sub', { text: '④ LH 저소득층 검증 요건' }),
    el('div.callout', { class: c.lh.pass ? 'ok' : c.lh.미확정 ? 'warn' : 'danger', text: c.lh.결론 }),
    table([
      { key: 'label', label: '요건' },
      { key: 'limit', label: '기준', num: true, render: (x) => (x.limit == null ? '—' : formatKRW(x.limit)) },
      { key: 'actual', label: '고객', num: true, render: (x) => (x.actual == null ? '—' : formatKRW(x.actual)) },
      { key: 'pass', label: '판정', render: (x) => x.pass === true ? el('span.chip.ok', { text: '충족' })
          : x.pass === false ? el('span.chip.bad', { text: `${formatKRW(x.초과액)} 초과` })
          : el('span.tiny.faint', { text: x.message ?? '판정 불가' }) },
    ], c.lh.checks, { rowClass: (x) => (x.pass === false ? 'bad' : '') }),
    el('p.tiny.faint', { text: '자동차는 2대·3대 상관없이 가장 높은 차량가액 1대로 산정합니다(보험개발원 확인). 국가유공자 자격으로 공급받은 경우에는 요건과 무관하게 신청 가능합니다.' }),
  );

  if (c.warnings.length) {
    children.push(el('div', { style: 'margin-top:10px' }, c.warnings.map((w) => el('div.callout.warn', { text: w }))));
  }
  if (c.source) {
    children.push(el('p.tiny.faint', {
      text: `설정: ${c.source.file} (기준일 ${c.source.기준일})` +
            (c.source.demo ? ' — ⚠ 데모 가상값' : c.source.verified ? '' : ' — 미검수'),
      style: 'margin-top:8px',
    }));
  }

  return panel('분양전환 상담일지', children, { id: 'result-conversion', collapsible: true, collapsed: fold['result-conversion'] === true });
}
