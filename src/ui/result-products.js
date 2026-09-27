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

export function productsPanel(r) {
  if (!r.products?.rows?.length) return null;
  const { rows, best } = r.products;
  const ok = rows.filter((x) => x.eligible);
  const no = rows.filter((x) => !x.eligible);

  const body = [];

  // ── 추천 한 줄
  if (best) {
    const b = best.row;
    body.push(el('div.callout.ok', {}, [
      el('div.script', {}, [
        el('p', {}, [
          el('b', { text: `${josa(b.name, '이/가')} 가장 유리합니다 — 금리 ${formatPct(b.rate)}, 한도 ${formatKRW(b.amount)}` }),
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
      ]) },
      { key: 'rate', label: '금리', num: true, render: (x) => x.rate != null ? el('div', {}, [
        el('div', { text: formatPct(x.rate) }),
        x.rateDetail?.totalDiscount ? el('div.tiny.faint', { text: `우대 −${formatPct(x.rateDetail.totalDiscount)}` }) : null,
      ].filter(Boolean)) : '—' },
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
        x.termCapped ? el('div.tiny.faint', { text: '상품 상한' }) : null,
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
