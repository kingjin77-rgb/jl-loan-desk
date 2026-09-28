/**
 * 상담용 도식.
 *
 * 규칙 (전부 지킨다):
 * - 색만으로 의미를 전달하지 않는다. 모든 구간에 직접 라벨이 붙고, 옆에는 항상 표가 있다.
 * - 축은 하나다. 서로 다른 단위를 한 그림에 겹치지 않는다.
 * - 색은 항목(entity)을 따라간다. 순위나 정렬 순서를 따라가지 않는다.
 * - 색 값은 assets/css/tokens.css 의 --viz-* 에만 있다. 여기에 hex 리터럴을 쓰지 않는다.
 *
 * 도식이 표를 대체하지 않는다. 표는 그대로 두고, 그 위에 "한눈에 보이는 층"을 얹는다.
 */

import { el } from './dom.js';
import { formatKRW, formatPct } from '../core/money.js';
import { daysBetween, formatKo, today } from '../core/dates.js';
import { josa } from '../core/hangul.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    n.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

/** 공용 툴팁 — 도식 하나마다 만들지 않고 문서에 하나만 둔다. */
let tip = null;
function tooltip() {
  if (!tip) {
    tip = el('div.viz-tip', { role: 'status' });
    document.body.append(tip);
  }
  return tip;
}
function showTip(evt, html) {
  const t = tooltip();
  t.innerHTML = html;
  t.classList.add('on');
  const pad = 12;
  const r = t.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
  t.style.transform = `translate(${x}px, ${y}px)`;
}
function hideTip() { tip?.classList.remove('on'); }

/** 마크에 호버 툴팁을 단다. 히트 영역은 마크보다 크게 잡는다. */
function hoverable(node, html) {
  node.addEventListener('mousemove', (e) => showTip(e, html));
  node.addEventListener('mouseleave', hideTip);
  node.setAttribute('tabindex', '0');
  node.addEventListener('focus', (e) => {
    const r = node.getBoundingClientRect();
    showTip({ clientX: r.left + r.width / 2, clientY: r.bottom }, html);
  });
  node.addEventListener('blur', hideTip);
  return node;
}

function figure(caption, svg, note = null) {
  return el('figure.viz', {}, [
    svg,
    caption ? el('figcaption', {}, [caption, note ? el('span.viz-note.tiny.faint', { text: ` · ${note}` }) : null]) : null,
  ].filter(Boolean));
}

// ════════════════════════ 1. 한도 상한 비교 ════════════════════════
/**
 * 상담사가 가장 먼저 봐야 하는 그림. "무엇이 한도를 막고 있는가"가 한눈에 보인다.
 *
 * 측정값은 하나(금액)이므로 계열은 하나다 → 범례가 필요 없다. 막대 색은 단일 색이고,
 * **물린 상한만** 진한 단계로 올린 뒤 "막힘" 칩을 붙인다(색 단독으로 표시하지 않는다).
 */
export function limitChart(r) {
  const caps = r.limit.caps.filter((c) => c.applicable && Number.isFinite(c.amount));
  if (!caps.length) return null;

  const W = 720;
  const rowH = 34;
  const gap = 8;
  const labelW = 132;
  const valueW = 116;
  const plotW = W - labelW - valueW;
  const H = caps.length * (rowH + gap) + 34;

  const max = Math.max(...caps.map((c) => c.amount), r.limit.requestedAmount ?? 0);
  const x = (v) => (max ? (v / max) * plotW : 0);

  const g = [];

  // 눈금 — 물러나 있어야 한다
  const ticks = niceTicks(max, 4);
  for (const t of ticks) {
    const px = labelW + x(t);
    g.push(svgEl('line', { x1: px, y1: 16, x2: px, y2: H - 18, stroke: 'var(--viz-grid)', 'stroke-width': 1 }));
    g.push(svgEl('text', {
      x: px, y: H - 6, 'text-anchor': 'middle',
      fill: 'var(--viz-ink-muted)', 'font-size': 10,
    }, [t === 0 ? '0' : formatKRW(t)]));
  }

  caps.forEach((c, i) => {
    const y = 16 + i * (rowH + gap);
    const bind = c === r.limit.binding;
    const w = Math.max(2, x(c.amount));

    g.push(svgEl('text', {
      x: labelW - 10, y: y + rowH / 2 + 4, 'text-anchor': 'end',
      fill: bind ? 'var(--viz-ink)' : 'var(--viz-ink-sub)',
      'font-size': 12.5, 'font-weight': bind ? 700 : 500,
    }, [c.label]));

    const bar = svgEl('rect', {
      x: labelW, y: y + 5, width: w, height: rowH - 10, rx: 4,
      fill: bind ? 'var(--viz-bar-bind)' : 'var(--viz-bar)',
    });
    hoverable(bar, `<b>${esc(c.label)}</b><br>${formatKRW(c.amount)}<br><span class="sub">${esc(c.formula)}</span>`);
    g.push(bar);

    g.push(svgEl('text', {
      x: labelW + plotW + 8, y: y + rowH / 2 + 4,
      fill: 'var(--viz-ink)', 'font-size': 12.5, 'font-weight': bind ? 800 : 600,
      'font-variant-numeric': 'tabular-nums',
    }, [formatKRW(c.amount)]));

    if (bind) {
      // 색이 아니라 글자로 알린다
      g.push(svgEl('text', {
        x: labelW + w + 8, y: y + rowH / 2 + 4,
        fill: 'var(--viz-bar-bind)', 'font-size': 11, 'font-weight': 800,
      }, ['← 여기서 막힘']));
    }
  });

  // 희망금액 기준선
  if (r.limit.requestedAmount) {
    const px = labelW + x(r.limit.requestedAmount);
    g.push(svgEl('line', {
      x1: px, y1: 10, x2: px, y2: H - 18,
      stroke: 'var(--viz-critical)', 'stroke-width': 2, 'stroke-dasharray': '4 3',
    }));
    g.push(svgEl('text', {
      x: px + 5, y: 12, fill: 'var(--viz-critical)', 'font-size': 10.5, 'font-weight': 700,
    }, [`희망 ${formatKRW(r.limit.requestedAmount)}`]));
  }

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%',
    role: 'img',
    'aria-label': `한도 상한 비교. ${caps.map((c) => `${c.label} ${formatKRW(c.amount)}`).join(', ')}. ${r.limit.binding?.label}에서 막힘.`,
  }, g);

  return figure(
    `상한별 비교 — 가장 낮은 ${josa(r.limit.binding?.label ?? '상한', '이/가')} 최종 한도를 정합니다`,
    svg,
    '막대에 마우스를 올리면 산식이 나옵니다'
  );
}

// ════════════════════════ 2. DSR 여력 ════════════════════════
/**
 * "왜 이 금액인가"를 소득 한 줄로 설명한다.
 * 연소득 × DSR한도율 이라는 그릇에 기존부채가 얼마나 차 있고, 신규 대출이 얼마나
 * 들어갈 수 있는지를 보여준다. 상담에서 가장 설득력 있는 그림이다.
 */
export function dsrChart(r) {
  const dsr = r.limit.caps.find((c) => c.id === 'DSR' && c.applicable && c.dsrDetail);
  if (!dsr) return null;
  const d = dsr.dsrDetail;
  const income = dsr.inputs.연소득;
  const rate = dsr.inputs.한도율;
  const bucket = income * rate;
  if (bucket <= 0) return null;

  const existing = d.existing.total;
  const fresh = Math.max(0, d.allowableAnnual);

  const W = 720;
  const H = 108;
  const barY = 30;
  const barH = 30;
  const x = (v) => (v / bucket) * W;

  const segs = [
    { label: '기존부채 원리금', v: existing, fill: 'var(--viz-c2)' },
    { label: '신규 대출 여력', v: fresh, fill: 'var(--viz-bar-bind)' },
  ].filter((s) => s.v > 0);

  const g = [];
  g.push(svgEl('rect', { x: 0, y: barY, width: W, height: barH, rx: 4, fill: 'var(--viz-neutral)' }));

  let cx = 0;
  for (const s of segs) {
    const w = Math.max(0, x(s.v));
    const rect = svgEl('rect', {
      x: cx, y: barY, width: Math.max(0, w - 2), height: barH, rx: 4, fill: s.fill,
    });
    hoverable(rect, `<b>${esc(s.label)}</b><br>연 ${formatKRW(s.v)}<br>월 ${formatKRW(s.v / 12)}`);
    g.push(rect);
    // 폭이 좁으면 라벨을 막대 위로 뺀다 (겹침 방지)
    const inside = w > 130;
    g.push(svgEl('text', {
      x: inside ? cx + 10 : cx, y: inside ? barY + barH / 2 + 4 : barY - 7,
      fill: inside ? 'var(--viz-on-bar)' : 'var(--viz-ink-sub)',
      'font-size': 11.5, 'font-weight': 700,
    }, [`${s.label} ${formatKRW(s.v)}`]));
    cx += w;
  }

  g.push(svgEl('text', { x: 0, y: 16, fill: 'var(--viz-ink-sub)', 'font-size': 11.5 }, [
    `연소득 ${formatKRW(income)} × DSR ${formatPct(rate, 0)} = 연 ${formatKRW(bucket)} 이 한 해에 갚을 수 있는 최대치`,
  ]));
  g.push(svgEl('text', { x: 0, y: H - 6, fill: 'var(--viz-ink-muted)', 'font-size': 11 }, [
    `남은 여력 연 ${formatKRW(fresh)} (월 ${formatKRW(fresh / 12)}) 을 스트레스금리 ${formatPct(dsr.inputs.스트레스금리)} · ${Math.round(dsr.inputs.산정만기개월 / 12)}년으로 되돌리면 ${formatKRW(dsr.amount)}`,
  ]));

  return figure('DSR 여력 — 소득으로 감당 가능한 연간 상환액',
    svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
      'aria-label': `연소득 ${formatKRW(income)}의 DSR ${formatPct(rate, 0)}인 연 ${formatKRW(bucket)} 중 기존부채가 ${formatKRW(existing)}, 신규 여력이 ${formatKRW(fresh)}입니다.`,
    }, g));
}

// ════════════════════════ 3. 입주 시 자금수지 ════════════════════════
/**
 * 필요자금이 무엇으로 이루어져 있고, 조달로 어디까지 덮이며, 얼마가 비는지.
 * 두 막대를 같은 축에 놓고 길이를 직접 비교하게 한다(축은 하나다).
 */
export function fundsChart(r) {
  if (!r.janggeum) return null;
  const g0 = r.janggeum;
  const need = g0.requiredAtMoveIn;
  if (need <= 0) return null;

  const PALETTE = ['var(--viz-c1)', 'var(--viz-c2)', 'var(--viz-c3)', 'var(--viz-c4)', 'var(--viz-c5)'];

  const W = 720;
  const barH = 34;
  const H = 168;
  const total = Math.max(need, g0.balanceLoanAmount + g0.ownFunds);
  const x = (v) => (v / total) * W;

  const g = [];
  const legend = [];

  // ── 필요자금
  g.push(svgEl('text', { x: 0, y: 14, fill: 'var(--viz-ink-sub)', 'font-size': 11.5, 'font-weight': 700 },
    [`필요자금 ${formatKRW(need)}`]));

  let cx = 0;
  g0.소요항목.forEach((item, i) => {
    const fill = PALETTE[i % PALETTE.length];
    const w = x(item.amount);
    const rect = svgEl('rect', { x: cx, y: 22, width: Math.max(0, w - 2), height: barH, rx: 3, fill });
    hoverable(rect, `<b>${esc(item.label)}</b><br>${formatKRW(item.amount)} · 전체의 ${((item.amount / need) * 100).toFixed(1)}%${item.hint ? `<br><span class="sub">${esc(item.hint)}</span>` : ''}`);
    g.push(rect);
    // 넓은 구간만 안에 라벨을 넣는다 — 좁은 칸에 글자를 욱여넣지 않는다
    if (w > 92) {
      g.push(svgEl('text', { x: cx + 8, y: 43, fill: 'var(--viz-on-cat)', 'font-size': 11, 'font-weight': 700 }, [formatKRW(item.amount)]));
    }
    legend.push({ label: item.label, fill, amount: item.amount });
    cx += w;
  });

  // ── 조달
  g.push(svgEl('text', { x: 0, y: 84, fill: 'var(--viz-ink-sub)', 'font-size': 11.5, 'font-weight': 700 },
    [`조달 ${formatKRW(g0.balanceLoanAmount + g0.ownFunds)}`]));

  cx = 0;
  for (const item of g0.조달항목) {
    const w = x(item.amount);
    const rect = svgEl('rect', {
      x: cx, y: 92, width: Math.max(0, w - 2), height: barH, rx: 3,
      fill: 'var(--viz-bar-bind)', opacity: item.label === '보유현금' ? 0.55 : 1,
    });
    hoverable(rect, `<b>${esc(item.label)}</b><br>${formatKRW(item.amount)}${item.hint ? `<br><span class="sub">${esc(item.hint)}</span>` : ''}`);
    g.push(rect);
    if (w > 92) g.push(svgEl('text', { x: cx + 8, y: 113, fill: 'var(--viz-on-bar)', 'font-size': 11, 'font-weight': 700 }, [`${item.label} ${formatKRW(item.amount)}`]));
    cx += w;
  }

  // ── 부족분 — 조달 막대가 끝난 자리에서 필요자금 끝까지
  if (g0.shortfall > 0) {
    const w = x(g0.shortfall);
    const rect = svgEl('rect', {
      x: cx, y: 92, width: Math.max(2, w - 2), height: barH, rx: 3,
      fill: 'var(--viz-critical)',
    });
    hoverable(rect, `<b>부족자금</b><br>${formatKRW(g0.shortfall)}<br><span class="sub">입주 때 추가로 필요한 현금</span>`);
    g.push(rect);
    g.push(svgEl('text', {
      x: Math.min(cx + 6, W - 150), y: H - 16,
      fill: 'var(--viz-critical)', 'font-size': 12, 'font-weight': 800,
    }, [`▲ 부족 ${formatKRW(g0.shortfall)}`]));
    // 부족 구간 시작점을 선으로 짚어 준다
    g.push(svgEl('line', { x1: cx, y1: 22, x2: cx, y2: H - 28, stroke: 'var(--viz-critical)', 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }));
  } else {
    g.push(svgEl('text', { x: 0, y: H - 16, fill: 'var(--viz-good)', 'font-size': 12, 'font-weight': 800 },
      ['✓ 조달로 전액 충당됩니다']));
  }

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
    'aria-label': `입주 시 필요자금 ${formatKRW(need)}, 조달 ${formatKRW(g0.balanceLoanAmount + g0.ownFunds)}, ${g0.shortfall > 0 ? `부족 ${formatKRW(g0.shortfall)}` : '부족 없음'}.`,
  }, g);

  // 범례 — 2계열 이상이므로 항상 둔다
  const legendEl = el('div.viz-legend', {}, legend.map((l) => el('span.viz-key', {}, [
    el('i', { style: `background:${l.fill}` }),
    `${l.label} ${formatKRW(l.amount)}`,
  ])));

  return figure('입주 시 자금수지', el('div', {}, [svg, legendEl]));
}

// ════════════════════════ 4. 납부 타임라인 ════════════════════════
/**
 * 계약금 → 중도금 회차 → 잔금을 실제 시간축 위에 놓는다.
 * 회차 간격이 균등하지 않다는 사실 자체가 중요한 정보다(후불이자가 회차마다 다르다).
 */
export function timelineChart(r) {
  if (!r.timeline?.events?.length) return null;
  const events = r.timeline.events.filter((e) => e.date);
  if (events.length < 2) return null;

  const t0 = events[0].date;
  const t1 = events[events.length - 1].date;
  const span = Math.max(1, daysBetween(t0, t1));

  const W = 720;
  const H = 172;
  const padL = 12;
  const padR = 12;
  const plotW = W - padL - padR;
  const axisY = 118;
  const x = (d) => padL + (daysBetween(t0, d) / span) * plotW;

  const total = r.timeline.totals.총분양대금 || 1;
  const maxCum = Math.max(...events.map((e) => e.cumulative));
  const yCum = (v) => axisY - 8 - (v / maxCum) * 72;

  const g = [];

  // 누적 납부 면적 — 시간에 따른 변화이므로 면적이 맞다
  const pts = events.map((e) => `${x(e.date)},${yCum(e.cumulative)}`);
  g.push(svgEl('path', {
    d: `M ${padL},${axisY - 8} L ${pts.join(' L ')} L ${x(t1)},${axisY - 8} Z`,
    fill: 'var(--viz-bar)', opacity: 0.28,
  }));
  g.push(svgEl('polyline', {
    points: pts.join(' '), fill: 'none',
    stroke: 'var(--viz-bar-bind)', 'stroke-width': 2, 'stroke-linejoin': 'round',
  }));

  // 축
  g.push(svgEl('line', { x1: padL, y1: axisY, x2: W - padR, y2: axisY, stroke: 'var(--viz-axis)', 'stroke-width': 1 }));

  // 오늘
  const now = today();
  if (daysBetween(t0, now) > 0 && daysBetween(now, t1) > 0) {
    const nx = x(now);
    g.push(svgEl('line', { x1: nx, y1: 16, x2: nx, y2: axisY + 6, stroke: 'var(--viz-critical)', 'stroke-width': 1.5 }));
    g.push(svgEl('text', { x: nx + 4, y: 24, fill: 'var(--viz-critical)', 'font-size': 10.5, 'font-weight': 700 }, ['오늘']));
  }

  // 회차 마커 — 크기는 금액에 비례(최소 8px 지름)
  const KIND_FILL = { 계약금: 'var(--viz-c5)', 중도금: 'var(--viz-c2)', 잔금: 'var(--viz-c1)' };
  for (const e of events) {
    const px = x(e.date);
    const rad = Math.max(4, Math.min(11, 4 + (e.amount / total) * 26));
    const done = e.status === '납부완료';

    g.push(svgEl('line', { x1: px, y1: yCum(e.cumulative), x2: px, y2: axisY, stroke: 'var(--viz-grid)', 'stroke-width': 1 }));

    const dot = svgEl('circle', {
      cx: px, cy: axisY, r: rad,
      fill: done ? KIND_FILL[e.kind] : 'var(--viz-surface)',
      stroke: KIND_FILL[e.kind] ?? 'var(--viz-bar-bind)',
      'stroke-width': 2,
    });
    const loan = e.loanAmount ? `<br>중도금대출 ${formatKRW(e.loanAmount)} · 자납 ${formatKRW(e.selfAmount)}` : '';
    const interest = (r.jungdogeum?.drawdowns ?? []).find((d) => d.round === e.round);
    hoverable(dot,
      `<b>${esc(e.kind)}${e.round ? ` ${e.round}회차` : ''}</b><br>${formatKo(e.date)} · ${done ? '납부완료' : '예정'}` +
      `<br>${formatKRW(e.amount)} (${formatPct(e.ratio, 0)})${loan}` +
      (interest?.accruedInterest ? `<br>후불이자 ${formatKRW(interest.accruedInterest)} (${interest.days}일)` : '') +
      `<br><span class="sub">누적 ${formatKRW(e.cumulative)}</span>`
    );
    g.push(dot);
  }

  // 시간축 라벨 — 처음·끝·잔금만. 전 회차에 날짜를 붙이면 겹친다.
  g.push(svgEl('text', { x: padL, y: axisY + 22, fill: 'var(--viz-ink-muted)', 'font-size': 10.5 }, [formatKo(t0, { withDay: false })]));
  g.push(svgEl('text', { x: W - padR, y: axisY + 22, 'text-anchor': 'end', fill: 'var(--viz-ink-muted)', 'font-size': 10.5 },
    [`잔금 ${formatKo(t1, { withDay: false })}`]));
  g.push(svgEl('text', { x: padL, y: axisY + 40, fill: 'var(--viz-ink-sub)', 'font-size': 11 },
    [`누적 납부 ${formatKRW(maxCum)} · 세로선 높이는 그 시점까지 낸 누계입니다`]));

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
    'aria-label': `납부 타임라인. ${formatKo(t0)}부터 ${formatKo(t1)}까지 ${events.length}회, 누적 ${formatKRW(maxCum)}.`,
  }, g);

  const legendEl = el('div.viz-legend', {}, [
    el('span.viz-key', {}, [el('i', { style: 'background:var(--viz-c5)' }), '계약금']),
    el('span.viz-key', {}, [el('i', { style: 'background:var(--viz-c2)' }), '중도금']),
    el('span.viz-key', {}, [el('i', { style: 'background:var(--viz-c1)' }), '잔금']),
    el('span.viz-key', {}, [el('i', { class: 'ring' }), '아직 납부 전']),
  ]);

  return figure('납부 타임라인', el('div', {}, [svg, legendEl]), '점에 마우스를 올리면 회차별 내역이 나옵니다');
}

// ════════════════════════ 5. 금리 시나리오 ════════════════════════
/** 금리가 오르면 월 상환액이 얼마나 오르는지. 막대 하나로 충분하다. */
export function scenarioChart(r) {
  if (!r.scenarios?.length) return null;
  const W = 720;
  const rowH = 30;
  const labelW = 74;
  const valueW = 150;
  const plotW = W - labelW - valueW;
  const H = r.scenarios.length * rowH + 14;
  const max = Math.max(...r.scenarios.map((s) => s.monthlyPayment));
  if (!max) return null;

  const g = [];
  r.scenarios.forEach((s, i) => {
    const y = 6 + i * rowH;
    const base = i === 0;
    const w = (s.monthlyPayment / max) * plotW;

    g.push(svgEl('text', {
      x: labelW - 10, y: y + rowH / 2 + 3, 'text-anchor': 'end',
      fill: 'var(--viz-ink-sub)', 'font-size': 11.5, 'font-weight': base ? 700 : 500,
    }, [s.label]));

    const bar = svgEl('rect', {
      x: labelW, y: y + 4, width: Math.max(2, w), height: rowH - 12, rx: 4,
      fill: base ? 'var(--viz-bar-bind)' : 'var(--viz-bar)',
    });
    hoverable(bar, `<b>${esc(s.label)} · ${formatPct(s.rate)}</b><br>월 ${formatKRW(s.monthlyPayment)}<br>총이자 ${formatKRW(s.totalInterest)}`);
    g.push(bar);

    g.push(svgEl('text', {
      x: labelW + plotW + 8, y: y + rowH / 2 + 3,
      fill: 'var(--viz-ink)', 'font-size': 11.5, 'font-weight': base ? 800 : 600,
      'font-variant-numeric': 'tabular-nums',
    }, [formatKRW(s.monthlyPayment) + (s.deltaMonthly ? `  (+${formatKRW(s.deltaMonthly)})` : '')]));
  });

  return figure('금리가 오르면 월 상환액은',
    svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
      'aria-label': r.scenarios.map((s) => `${s.label} ${formatPct(s.rate)} 월 ${formatKRW(s.monthlyPayment)}`).join(', '),
    }, g),
    '대출금액은 고정하고 금리만 바꾼 비교입니다');
}

// ════════════════════════ 보조 ════════════════════════

function niceTicks(max, count) {
  if (!max) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out = [];
  for (let v = 0; v <= max + step * 0.01; v += step) out.push(v);
  return out;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ════════════════════ 6. 잔금유예 — 언제 얼마를 내는가 ════════════════════
/**
 * 분양전환의 잔금유예는 **월 상환액이 없다.** 해마다 12월에 이자만 내고,
 * 만기에 원금을 한 번에 갚는다. 상담사가 "그래서 언제 뭘 내느냐"를 한눈에 봐야 한다.
 *
 * 측정값은 하나(금액)이고 계열도 하나(잔여원금)다 → 범례가 필요 없다.
 * 시간 축 하나만 쓴다. 이자 막대와 잔여원금 선을 다른 눈금으로 겹치면 이중축이 되므로,
 * 잔여원금은 **선이 아니라 계단 면적**으로 같은 금액 축에 그린다.
 */
export function conversionChart(r) {
  const c = r.conversion;
  if (!c?.interest?.연도별?.length) return null;
  const years = c.interest.연도별;
  if (!c.interest.만기일) return null;

  const t0 = `${years[0].연도}-01-01`;
  const t1 = c.interest.만기일;
  const span = Math.max(1, daysBetween(t0, t1));

  const W = 720, H = 200;
  const padL = 12, padR = 12;
  const plotW = W - padL - padR;
  const axisY = 148;
  const x = (d) => padL + (daysBetween(t0, d) / span) * plotW;

  const 최대원금 = Math.max(...years.map((y) => y.기말원금), c.balance.잔금유예금 || 1);
  const yBal = (v) => axisY - 8 - (v / 최대원금) * 96;

  const g = [];

  // 잔여원금 — 계단 면적. 일부상환이 있으면 그 지점에서 내려간다.
  const step = [];
  let prev = c.balance.잔금유예금;
  step.push(`${padL},${yBal(prev)}`);
  for (const y of years) {
    const endX = x(`${y.연도}-12-31` > t1 ? t1 : `${y.연도}-12-31`);
    step.push(`${endX},${yBal(prev)}`);
    step.push(`${endX},${yBal(y.기말원금)}`);
    prev = y.기말원금;
  }
  g.push(svgEl('path', {
    d: `M ${padL},${axisY - 8} L ${step.join(' L ')} L ${x(t1)},${axisY - 8} Z`,
    fill: 'var(--viz-bar)', opacity: 0.28,
  }));
  g.push(svgEl('polyline', {
    points: step.join(' '), fill: 'none',
    stroke: 'var(--viz-bar-bind)', 'stroke-width': 2, 'stroke-linejoin': 'round',
  }));

  g.push(svgEl('line', { x1: padL, y1: axisY, x2: W - padR, y2: axisY, stroke: 'var(--viz-axis)', 'stroke-width': 1 }));

  // 해마다 12월 이자 납부점
  for (const y of years) {
    const d = `${y.연도}-12-31` > t1 ? t1 : `${y.연도}-12-31`;
    const px = x(d);
    const 만기해 = y.만기해;
    g.push(hoverable(svgEl('g', {}, [
      svgEl('line', { x1: px, y1: axisY - 6, x2: px, y2: axisY + 6, stroke: 'var(--viz-axis)', 'stroke-width': 1 }),
      svgEl('circle', {
        cx: px, cy: axisY, r: 만기해 ? 6 : 4,
        fill: 만기해 ? 'var(--viz-critical)' : 'var(--viz-c3)',
        stroke: 'var(--viz-surface)', 'stroke-width': 2,
      }),
    ]), `<b>${y.연도}년 12월</b><br>이자 ${formatKRW(y.이자)} (${y.일수}일)<br>잔여원금 ${formatKRW(y.기말원금)}`));
  }

  // 일부상환 지점 — 이자가 꺾이는 곳이므로 반드시 보여야 한다
  for (const y of years) {
    for (const seg of y.구간 ?? []) {
      if (seg.일부상환 == null) continue;
      const px = x(seg.일자);
      g.push(hoverable(svgEl('g', {}, [
        svgEl('line', { x1: px, y1: yBal(seg.잔액) - 6, x2: px, y2: axisY, stroke: 'var(--viz-c2)', 'stroke-width': 2, 'stroke-dasharray': '3 2' }),
        svgEl('circle', { cx: px, cy: yBal(seg.잔액), r: 5, fill: 'var(--viz-c2)', stroke: 'var(--viz-surface)', 'stroke-width': 2 }),
      ]), `<b>일부상환 ${seg.일자}</b><br>${formatKRW(seg.일부상환)}<br>잔액 ${formatKRW(seg.잔액)}`));
      g.push(svgEl('text', {
        x: px, y: yBal(seg.잔액) - 10, 'text-anchor': 'middle',
        fill: 'var(--viz-ink-sub)', 'font-size': 10, 'font-weight': 700,
      }, [`−${formatKRW(seg.일부상환)}`]));
    }
  }

  // 양 끝 직접 라벨 — 색만으로 의미를 전달하지 않는다
  g.push(svgEl('text', { x: padL, y: axisY + 20, fill: 'var(--viz-ink-sub)', 'font-size': 11 }, [`계약 ${years[0].연도}년`]));
  g.push(svgEl('text', { x: W - padR, y: axisY + 20, 'text-anchor': 'end', fill: 'var(--viz-ink)', 'font-size': 11, 'font-weight': 700 },
    [`만기 ${c.interest.만기일} · 원금 ${formatKRW(c.interest.총원금)} 일괄`]));
  const 온전한해 = years.find((y) => y.일수 >= 365) ?? years[0];
  g.push(svgEl('text', { x: padL, y: 18, fill: 'var(--viz-ink)', 'font-size': 12, 'font-weight': 700 },
    [`해마다 12월 약 ${formatKRW(온전한해.이자)} · 만기에 원금 ${formatKRW(c.interest.총원금)}`]));

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
    'aria-label': `잔금유예 일정. 계약 ${years[0].연도}년부터 ${c.interest.만기일}까지 해마다 12월 이자를 내고 만기에 원금 ${formatKRW(c.interest.총원금)}을 일괄 납부합니다.`,
  }, g);
  return figure('잔금유예 — 언제 얼마를 내는가', svg, '아래 표에 연도별 금액이 있습니다');
}

// ════════════════════ 7. 상품별 한도 비교 ════════════════════
/**
 * 적격 상품의 **한도만** 비교한다.
 *
 * 금리·월상환액을 같은 그림에 겹치면 눈금이 둘이 된다(이중축) — 하지 않는다.
 * 금리는 막대 끝 라벨로 붙이고, 자세한 값은 옆의 표가 가진다.
 */
export function productsChart(r) {
  const rows = (r.products?.rows ?? []).filter((x) => x.eligible && x.amount > 0);
  if (rows.length < 2) return null;

  const max = Math.max(...rows.map((x) => x.amount));
  const best = r.products?.best?.row ?? null;

  const rowH = 30;
  const W = 720;
  const H = rows.length * rowH + 16;
  const labelW = 190;
  const barW = W - labelW - 150;

  const g = rows.map((x, i) => {
    const y = i * rowH + 8;
    const w = Math.max(2, (x.amount / max) * barW);
    const 추천 = best && x.variantId === best.variantId;
    return hoverable(svgEl('g', {}, [
      svgEl('text', { x: labelW - 8, y: y + 14, 'text-anchor': 'end', fill: 'var(--viz-ink)', 'font-size': 12 },
        [x.name.length > 16 ? x.name.slice(0, 15) + '…' : x.name]),
      svgEl('rect', {
        x: labelW, y: y + 3, width: w, height: 16, rx: 4,
        fill: 추천 ? 'var(--viz-bar-bind)' : 'var(--viz-bar)',
      }),
      svgEl('text', { x: labelW + w + 8, y: y + 15, fill: 'var(--viz-ink)', 'font-size': 11, 'font-weight': 추천 ? 700 : 400 },
        [`${formatKRW(x.amount)} · ${formatPct(x.rate)}`]),
      // 추천을 색만으로 표시하지 않는다
      추천 ? svgEl('text', { x: labelW - 8 - measure(x.name), y: y + 14, fill: 'var(--viz-ink-muted)', 'font-size': 10 }, ['★']) : null,
    ].filter(Boolean)),
      `<b>${x.name}</b><br>한도 ${formatKRW(x.amount)}<br>금리 ${formatPct(x.rate)}`
      + (x.monthlyPayment != null ? `<br>월 ${formatKRW(x.monthlyPayment)}` : '')
      + (x.binding ? `<br>${x.binding.label}에서 막힘` : ''));
  });

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
    'aria-label': `상품별 한도 비교. ${rows.map((x) => `${x.name} ${formatKRW(x.amount)}`).join(', ')}.`,
  }, g);
  return figure('상품별 한도', svg, '★ 는 금리가 가장 낮은 상품입니다');
}

/** 글자 폭 어림 — ★ 를 이름 왼쪽에 붙일 자리를 잡는 용도. */
function measure(text) {
  return Math.min(16, text.length) * 6.2 + 6;
}
