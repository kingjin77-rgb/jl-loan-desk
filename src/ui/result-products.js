/**
 * 정책자금 자격 매트릭스 + 비교표.
 *
 * 상담사가 "이 고객에게 가능한 상품"을 한 눈에 보고, 안 되는 상품은
 * **왜 안 되는지 그 자리에서 설명**할 수 있어야 한다.
 * 그래서 부적격 상품도 숨기지 않고 사유와 함께 아래에 둔다.
 */

import { el, panel, table } from './dom.js';
import { formatKRW, formatPct } from '../core/money.js';
import { josa } from '../core/hangul.js';

export function productsPanel(r, { store = null } = {}) {
  if (!r.products?.rows?.length) return null;
  const { rows, best } = r.products;
  const ok = rows.filter((x) => x.eligible);
  const no = rows.filter((x) => !x.eligible);

  const body = [];

  // ★ 규제 한도가 비어 있으면 아래 「한도」는 상품 자체 한도일 뿐이다.
  //   이걸 밝히지 않으면 상담사가 LTV·DSR 이 반영된 최종 한도로 오해한다.
  if (r.limitBlocked) {
    body.push(el('div.callout.danger', {}, [
      el('div.script', {}, [
        el('p', {}, [el('b', { text: '아래 「한도」는 상품 자체 한도일 뿐입니다 — 최종 한도가 아닙니다.' })]),
        el('p', { text: 'LTV·DSR 등 규제 수치가 아직 채워지지 않아 규제 상한이 적용되지 않았습니다. '
          + '금리·자격 판정은 상품 설정값으로 정상 계산됩니다.' }),
      ]),
    ]));
  }

  // ── 추천 한 줄
  if (best) {
    const b = best.row;
    body.push(el('div.callout.ok', {}, [
      el('div.script', {}, [
        el('p', {}, [
          el('b', { text: r.limitBlocked
            ? `${josa(b.name, '이/가')} 금리가 가장 낮습니다 — ${formatPct(b.rate)}`
            : `${josa(b.name, '이/가')} 가장 유리합니다 — 금리 ${formatPct(b.rate)}, 한도 ${formatKRW(b.amount)}` }),
        ]),
        best.runnerUp && best.monthlyGap
          ? el('p', { text:
              `2순위 ${best.runnerUp.name}(${formatPct(best.runnerUp.rate)})보다 ` +
              `월 ${formatKRW(Math.abs(best.monthlyGap))} 적게 냅니다.` })
          : null,
      ].filter(Boolean)),
    ]));
  } else {
    body.push(el('div.callout.warn', {
      text: '입력하신 조건으로 적격한 정책자금 상품이 없습니다. 아래에서 각 상품의 탈락 사유를 확인하십시오.',
    }));
  }

  // ── 적격 상품
  if (ok.length) {
    body.push(el('h3', { text: `적격 ${ok.length}건`, style: 'margin:12px 0 6px' }));
    body.push(el('div.table-scroll', {}, [table([
      { key: 'name', label: '상품', render: (x) => el('div', {}, [
        el('div', {}, [el('b', { text: x.name })]),
        el('div.tiny.faint', { text: `${x.category}${x.kind === '전세' ? ' · 전세' : ''}` }),
        pickButton(x, r, store),
      ].filter(Boolean)) },
      { key: 'rate', label: '금리', num: true, render: (x) => x.rate != null ? el('div', {}, rateNotes(x)) : '—' },
      { key: 'amount', label: '한도', num: true, render: (x) => el('div', {}, [
        el('div', { text: formatKRW(x.amount) }),
        x.binding ? el('div.tiny.faint', { text: `${x.binding.label}에서 막힘` }) : null,
      ].filter(Boolean)) },
      { key: 'monthlyPayment', label: '월 상환액', num: true, render: (x) => el('div', {}, [
        el('div', { text: x.monthlyPayment != null ? formatKRW(x.monthlyPayment) : '—' }),
        x.balloonPayment
          ? el('div.tiny.faint', { text: `만기 일시 ${formatKRW(x.balloonPayment)}` })
          : x.methodSwapped ? el('div.tiny.faint', { text: x.method }) : null,
      ].filter(Boolean)) },
      { key: 'totalInterest', label: '총 이자', num: true,
        render: (x) => x.totalInterest != null ? formatKRW(x.totalInterest) : '—' },
      { key: 'termMonths', label: '기간', num: true, render: (x) => el('div', {}, [
        el('div', { text: `${Math.round(x.termMonths / 12)}년` }),
        x.termCapped ? el('div.tiny.faint', { text: termNote(x) }) : null,
      ].filter(Boolean)) },
    ], ok, { rowClass: (x) => (best && x === best.row ? 'bind' : '') })]));
  }

  // ── 부적격 상품 — 사유가 핵심이다
  if (no.length) {
    body.push(el('h3', { text: `부적격 ${no.length}건`, style: 'margin:16px 0 6px' }));
    body.push(el('div.rows', {}, no.map((x) => el('div.callout', {}, [
      el('div', { style: 'display:flex;gap:8px;align-items:baseline;flex-wrap:wrap' }, [
        el('b', { text: x.name }),
        el('span.tiny.faint', { text: x.category }),
      ]),
      el('div.small', { style: 'color:var(--danger);margin-top:2px', text: x.failureSummary }),
      // 어느 요건을 통과하고 어느 요건에서 걸렸는지 전부 보여준다
      el('details', { style: 'margin-top:6px' }, [
        el('summary.tiny.faint', { text: '요건 전체 보기' }),
        el('div', { style: 'margin-top:6px' }, x.eligibility.checks.map((c) => el('div.tiny', {
          style: `color:${c.pass ? 'var(--ok)' : c.unknown ? 'var(--ink-faint)' : 'var(--danger)'}`,
          text: `${c.pass ? '✓' : c.unknown ? '?' : '✕'} ${c.message ?? `${c.label} 충족`}`,
        }))),
      ]),
    ]))));
  }

  // ── 판정 불가 안내 (값 미입력)
  const undetermined = rows.filter((x) => x.undetermined);
  if (undetermined.length) {
    body.push(el('div.callout.warn', { style: 'margin-top:12px' }, [
      el('div', {}, [el('b', { text: '일부 요건을 판정하지 못했습니다.' })]),
      el('div.tiny', { text:
        `${undetermined.map((x) => x.name).join(', ')} — 요건 값이 아직 설정 파일에 채워지지 않았습니다. ` +
        `그 요건은 판정에서 빠졌으므로, 위 결과는 실제 자격과 다를 수 있습니다.` }),
    ]));
  }

  body.push(el('p.tiny.faint', { style: 'margin-top:10px', text:
    '정책자금 상품은 취급 기관의 심사 기준과 예산 소진 여부에 따라 실제 취급이 달라질 수 있습니다.' }));

  return panel('정책자금 비교', body.filter(Boolean), { id: 'result-products' });
}


/**
 * 금리 칸의 부연. 상담사가 "왜 이 금리인가"를 그 자리에서 말할 수 있어야 한다.
 *
 * 특히 **우대 상한에 걸렸다**는 사실이 보여야 한다. 안 보이면 고객이
 * "우대항목을 더 채우면 더 내려가나요?" 라고 물을 때 답을 못 한다 — 안 내려간다.
 */
function rateNotes(x) {
  const d = x.rateDetail ?? {};
  const out = [el('div', { text: formatPct(x.rate) })];

  if (d.appliedDiscount) {
    out.push(el('div.tiny.faint', { text: `우대 −${formatPct(d.appliedDiscount)}` }));
  }
  if (d.discountCapApplied) {
    out.push(el('div.tiny.warn', {
      text: `우대 상한 ${formatPct(d.discountCap)} 적용 (합계 ${formatPct(d.rawDiscount)})`,
      title: '우대항목을 더 채워도 이 상한 아래로는 내려가지 않습니다',
    }));
  }
  for (const a of d.adjustments ?? []) {
    if (!a.applied) continue;
    out.push(el('div.tiny.faint', {
      text: `${a.label} ${a.value < 0 ? '−' : '+'}${formatPct(Math.abs(a.value))}`,
      title: '우대금리 합계 상한과 별개로 적용됩니다',
    }));
  }
  if (d.floorApplied) out.push(el('div.tiny.faint', { text: `금리 하한 ${formatPct(d.floor)}` }));
  if (d.manual) out.push(el('div.tiny.faint', { text: '화면의 약정금리' }));
  const 미설정 = (d.discounts ?? []).filter((u) => u.unknown);
  if (미설정.length) {
    out.push(el('div.tiny.faint', {
      text: `우대폭 미설정 ${미설정.length}건`,
      title: 미설정.map((u) => u.label).join(', ') + ' — 우대폭이 확인되면 금리가 더 내려갈 수 있습니다',
    }));
  }
  return out;
}

/** 기간이 줄어든 이유. 나이 때문에 막힌 것이면 그렇게 말한다. */
function termNote(x) {
  const blocked = x.termBlocked ?? [];
  if (!blocked.length) return '상품 상한';
  const 최장 = blocked.reduce((a, b) => (a.maxYears >= b.maxYears ? a : b));
  return `${최장.label} 불가 — ${최장.reason}`;
}


/**
 * 「이 상품으로 계산」.
 *
 * 누르면 그 상품의 한도·LTV·DTI 가 최종 한도에 들어간다.
 * 규제 LTV 표가 비어 있어도 이 경로로는 한도가 나온다 — 분양전환 상담에서 쓰는
 * 상품들은 상담일지에서 확인된 자기 LTV 를 갖고 있기 때문이다.
 */
function pickButton(row, r, store) {
  if (!store) return null;
  const 고른것 = r.limit?.selectedProduct?.variantId ?? null;
  const 고름 = 고른것 === row.variantId;
  return el(고름 ? 'button.chip.picked' : 'button.btn.sm.pick', {
    type: 'button',
    text: 고름 ? '✓ 이 상품으로 계산 중 (해제)' : '이 상품으로 계산',
    title: 고름
      ? '누르면 해제하고 규제 기준 한도로 돌아갑니다'
      : '이 상품의 한도·LTV·DTI 를 최종 한도에 반영합니다',
    onClick: () => store.set('product.selectedVariantId', 고름 ? null : row.variantId),
  });
}
