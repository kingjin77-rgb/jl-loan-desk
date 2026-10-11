/**
 * 분양전환 상담 화면 — 현장용.
 *
 * 상담사가 이미 쓰는 종이 「분양전환 상담일지」와 **같은 순서**로 한 화면에 둔다.
 *   ① 필요자금(A−B+C−D) → ② LH 검증 → ③ 납부 방법(일시납 / 분할납부) → ④ 대출 경로
 *
 * 왜 따로 만드는가:
 *  상세 계산 화면은 일반 주담대 계산기 위에 분양전환을 얹은 구조라, 분양전환 상담 한 건에
 *  화면 2.4장 아래의 접힌 패널을 열고, 분양가를 두 번 넣고, 결과 4.4장 아래까지 내려가야
 *  했다. 이 화면은 입력 7칸 → 바로 아래 결과다. 계산은 같은 derive() 를 쓴다.
 *
 * 입력은 rail 칸, 결과는 results 칸에 들어간다. 입력 중에는 rail 을 다시 그리지 않으므로
 * (main.js 의 keepRail) 커서·한글 조합이 유지된다.
 */

import { el, panel } from './dom.js';
import { moneyField, segField, checkbox, intField } from './fields.js';
import { formatKRW, formatPct } from '../core/money.js';
import { OPTIONS } from '../state/defaults.js';
import { amortize, METHODS } from '../core/amortize.js';

/* ───────────────────────── 입력 ───────────────────────── */

export function quickInputs({ store, ui, onToggle }) {
  const s = store.get();
  const c = s.conversion ?? {};
  const b = s.borrower ?? {};

  const 고객 = panel('고객 조건', [
    segField('타입', OPTIONS.전환타입.map((t) => ({ value: t, label: t })), c.타입,
      (v) => store.set('conversion.타입', v), { hint: '타입으로 기금승계 한도(5,500만 / 7,500만)와 최소 잔금유예금이 정해집니다' }),
    moneyField('분양가 (A)', c.분양가, (v) => store.set('conversion.분양가', v)),
    moneyField('납입보증금 (B)', c.납입보증금, (v) => store.set('conversion.납입보증금', v)),
    moneyField('보증금대출 (C)', c.보증금대출, (v) => store.set('conversion.보증금대출', v), {
      hint: '계약 시 갚아야 하는 기존 보증금대출. 없으면 비워 두세요',
    }),
    moneyField('본인준비금 (D)', c.본인준비금, (v) => store.set('conversion.본인준비금', v)),
    moneyField('부부합산 연소득', b.annualIncome, (v) => store.set('borrower.annualIncome', v)),
    segField('가구원수', OPTIONS.가구원수.map((n) => ({ value: String(n), label: `${n}인` })),
      c.가구원수 != null ? String(c.가구원수) : null,
      (v) => store.set('conversion.가구원수', v ? Number(v) : null)),
  ], { id: 'q-customer' });

  const lh = panel('LH 검증 · 자산', [
    moneyField('자산가액', c.자산가액, (v) => store.set('conversion.자산가액', v)),
    moneyField('자동차가액', c.자동차가액, (v) => store.set('conversion.자동차가액', v), {
      hint: '여러 대면 가장 비싼 1대 (보험개발원 기준)',
    }),
    moneyField('가구 월소득', c.월소득, (v) => store.set('conversion.월소득', v), {
      hint: '비워 두면 연소득 ÷ 12 로 봅니다. 다른 가구원 소득이 있으면 합쳐서 넣으세요',
    }),
    el('div.checks', {}, [
      checkbox('국가유공자 자격으로 공급', c.국가유공자, (v) => store.set('conversion.국가유공자', v)),
    ]),
  ], { id: 'q-lh', collapsible: true, collapsed: ui.collapsed['q-lh'] === true, onToggle: () => onToggle('q-lh') });

  const 정책 = panel('정책대출 자격 (디딤돌·보금자리)', [
    el('div.checks', {}, [
      checkbox('기금대출 승계 사용', c.기금승계사용 !== false, (v) => store.set('conversion.기금승계사용', v), {
        title: '끄면 디딤돌·보금자리·은행으로 계산합니다',
      }),
      checkbox('생애최초', b.isFirstTime, (v) => store.set('borrower.isFirstTime', v)),
      checkbox('신혼부부', b.isNewlywed, (v) => store.set('borrower.isNewlywed', v)),
    ]),
    intField('자녀 수', b.children, (v) => store.set('borrower.children', v || 0), { unit: '명' }),
    intField('만 나이', b.age, (v) => store.set('borrower.age', v), { unit: '세', hint: '보금자리론 40·50년 만기 판정' }),
    moneyField('순자산', b.netAssets, (v) => store.set('borrower.netAssets', v), { hint: '디딤돌 자산 기준(5.11억) 판정' }),
    segField('지역', [{ value: '수도권', label: '수도권' }, { value: '비수도권', label: '지방' }],
      b.stressRegion ?? '수도권', (v) => store.set('borrower.stressRegion', v), {
        hint: '수도권이면 생애최초도 LTV 70%, 지방이면 디딤돌 0.2%p 인하',
      }),
  ], { id: 'q-policy', collapsible: true, collapsed: ui.collapsed['q-policy'] !== false, onToggle: () => onToggle('q-policy', true) });

  return [고객, lh, 정책];
}

/* ───────────────────────── 결과 ───────────────────────── */

export function quickResults(r, { ctx, onAdvanced }) {
  const c = r.conversion;
  if (!c) return [];

  const out = [];
  const A = c.funds.내역;
  const 값 = (기호) => A.find((x) => x.기호 === 기호)?.금액 ?? 0;
  const 입력됨 = 값('A') > 0;

  // ① 필요자금
  out.push(card('q-funds', '① 필요자금', [
    big(입력됨 ? formatKRW(c.funds.필요자금) : '분양가를 넣으세요'),
    입력됨 ? el('div.q-formula', { text:
      `분양가 ${formatKRW(값('A'))} − 납입보증금 ${formatKRW(값('B'))}`
      + (값('C') ? ` + 보증금대출 ${formatKRW(값('C'))}` : '')
      + (값('D') ? ` − 본인준비금 ${formatKRW(값('D'))}` : '') }) : null,
  ]));

  // ② LH 검증
  out.push(lhCard(c.lh));

  // ③ 납부 방법 — 일시납 / 분할납부
  if (입력됨) out.push(payCard(r, c));

  // ④ 다른 주담대 (일시납 때 기금승계 다음)
  if (입력됨) out.push(otherLoansCard(r, c));

  // ⑤ 분할납부 시 전세자금대출 경로
  if (입력됨) out.push(jeonseCard(r, ctx));

  // 확인할 것 (최소 잔금유예금, 2억 미달 등)
  const warns = [...(c.warnings ?? [])];
  if (warns.length) {
    out.push(card('q-warn', '확인할 것', warns.map((w) => el('div.q-warn', { text: w }))));
  }

  // 출처 한 줄 + 상세 계산
  out.push(el('div.q-foot', {}, [
    el('p.tiny.faint', { text: footSources(ctx, r) }),
    el('p.tiny.faint', { text: '본 산출은 상담 가이드입니다. 정확한 한도·금리·조건은 취급기관 및 상담사 확인이 필요합니다.' }),
    el('button.btn', { type: 'button', text: '상세 계산 보기 ▸', onClick: onAdvanced }),
  ]));

  return out;
}

/** 상단 고정 요약 — 고객이 제일 먼저 묻는 세 숫자. */
export function quickSummary(r) {
  const c = r.conversion;
  if (!c || !(c.funds.필요자금 > 0 || c.funds.내역[0].금액 > 0)) return null;
  const sp = r.limit?.selectedProduct;
  const 기금 = sp?.productId === 'gigeum-seunggye' ? Math.min(r.limit.finalAmount, c.일시납필요액) : 0;
  const cell = (k, v, note) => el('div.cell', {}, [
    el('div.k', { text: k }), el('div.v', { text: v }), note ? el('div.note', { text: note }) : null,
  ].filter(Boolean));
  return el('div.summary.q-summary', {}, [
    cell('필요자금', formatKRW(c.funds.필요자금)),
    cell('일시납 · 기금 후', formatKRW(Math.max(0, c.일시납필요액 - 기금)), 기금 ? `기금승계 ${formatKRW(기금)}` : '기금승계 없음'),
    cell('분할납부 · 지금', formatKRW(c.분할납부시필요액), `잔금유예 ${formatKRW(c.balance.잔금유예금)}`),
  ]);
}

/* ───────────────────────── 카드들 ───────────────────────── */

function lhCard(lh) {
  const 상태 = lh.국가유공자예외 ? 'ok' : lh.pass ? 'ok' : lh.미확정 ? 'wait' : 'bad';
  const 머리 = { ok: '✓ LH 검증 대상', bad: '✗ LH 검증 요건 미충족', wait: '입력이 더 필요합니다' }[상태];
  const rows = lh.checks.map((x) => el('div.q-row', {}, [
    el('span', { text: x.label }),
    el('span.num', { text: x.actual == null ? '—' : formatKRW(x.actual) }),
    el('span.tiny', {
      class: x.pass === true ? 'ok' : x.pass === false ? 'bad' : 'faint',
      text: x.pass === true ? `기준 ${formatKRW(x.limit)} 이하 ✓`
        : x.pass === false ? `${formatKRW(x.초과액)} 초과`
        : (x.message ?? '판정 불가'),
    }),
  ]));
  return card('q-lh-result', '② LH 검증 (저소득층 대상 여부)', [
    el('div.q-verdict', { class: 상태, text: 머리 }),
    lh.국가유공자예외 ? el('p.tiny', { text: '국가유공자 자격으로 공급받은 경우 요건과 무관하게 신청 가능합니다.' }) : null,
    ...rows,
    lh.월소득자동 ? el('p.tiny.faint', { text: '월소득은 연소득 ÷ 12 로 계산했습니다. 다른 가구원 소득이 있으면 「가구 월소득」에 직접 넣으세요.' }) : null,
  ]);
}

function payCard(r, c) {
  const sp = r.limit?.selectedProduct;
  const 기금 = sp?.productId === 'gigeum-seunggye';
  const 기금액 = 기금 ? Math.min(r.limit.finalAmount, c.일시납필요액) : 0;
  const 월 = r.payment?.maxPaymentAfterGrace ?? r.payment?.monthlyPayment;
  const 거치 = r.graceScenarios?.map((g) => g.label).join(' 또는 ');
  const 이자없음 = c.interest.총이자 == null;
  const 온전한해 = c.interest.연도별.find((y) => y.일수 >= 365) ?? c.interest.연도별[0];

  const 일시납 = el('div.q-col', {}, [
    el('div.q-col-h', { text: '일시납' }),
    el('div.q-kv', {}, [el('span', { text: '지금 필요' }), el('b', { text: formatKRW(c.일시납필요액) })]),
    기금
      ? el('div.q-kv', {}, [el('span', { text: '기금대출 승계' }), el('b', { text: `− ${formatKRW(기금액)}` })])
      : el('div.q-kv', {}, [el('span', { text: '기금대출 승계' }), el('span.faint', { text: '사용 안 함' })]),
    기금 ? el('p.tiny.faint', { text: `연 ${formatPct(r.paymentRate.rate)} · 20년 · 월 ${formatKRW(월)} (${거치?.split(' 또는 ')[0] ?? ''} 기준)` }) : null,
    기금 && 거치 ? el('p.tiny.faint', { text: `거치는 ${거치} 중 고객이 선택합니다.` }) : null,
    el('div.q-kv.total', {}, [el('span', { text: '그다음 마련할 돈' }), el('b', { text: formatKRW(Math.max(0, c.일시납필요액 - 기금액)) })]),
    el('p.tiny.faint', { text: '디딤돌·보금자리·은행 주담대 또는 자기자금 (아래 ④)' }),
  ]);

  const 분할 = el('div.q-col', {}, [
    el('div.q-col-h', { text: '분할납부 (잔금유예)' }),
    el('div.q-kv', {}, [el('span', { text: '지금 필요' }), el('b', { text: formatKRW(c.분할납부시필요액) })]),
    el('div.q-kv', {}, [el('span', { text: '미루는 잔금' }), el('b', { text: formatKRW(c.balance.잔금유예금) })]),
    el('p.tiny.faint', { text: `${c.interest.만기일}까지 (${c.interest.만기근거}) · 원금은 만기에 한 번에` }),
    el('div.q-kv.total', {}, [
      el('span', { text: '매년 12월 이자' }),
      이자없음 ? el('span.warn', { text: '이자율 미입력' }) : el('b', { text: `약 ${formatKRW(온전한해?.이자 ?? 0)}` }),
    ]),
    이자없음 ? el('p.tiny.faint', { text: '잔금유예 이자율을 넣어야 계산됩니다 (메뉴 → 규제 수치 → 분양전환).' }) : null,
    el('p.tiny.faint', { text: '100만원 단위로 언제든 일부상환 가능, 중도상환수수료 없음' }),
  ]);

  return card('q-pay', '③ 납부 방법', [el('div.q-cols', {}, [일시납, 분할])]);
}

function otherLoansCard(r, c) {
  const sp = r.limit?.selectedProduct;
  const 기금액 = sp?.productId === 'gigeum-seunggye' ? Math.min(r.limit.finalAmount, c.일시납필요액) : 0;
  const 필요 = Math.max(0, c.일시납필요액 - 기금액);
  const rows = (r.products?.rows ?? []).filter((x) => x.productId !== 'gigeum-seunggye');
  const ok = rows.filter((x) => x.eligible && x.rate != null);
  const no = rows.filter((x) => !x.eligible);

  // 상담에서 묻는 건 "남은 돈을 이걸로 빌리면 월 얼마"다. 상품 최대한도가 아니라
  // 필요액(한도 안에서)으로 월 상환액을 다시 낸다.
  const line = (x) => {
    const 빌릴돈 = Math.min(필요, x.amount);
    const 부족 = 필요 > x.amount;
    const pay = 빌릴돈 > 0 ? amortize({
      principal: 빌릴돈, annualRate: x.rate, termMonths: x.termMonths,
      method: x.method ?? METHODS.EQUAL_TOTAL, graceMonths: 0,
    }) : null;
    const 월 = pay ? (pay.monthlyPayment ?? pay.maxPayment ?? pay.firstPayment) : null;
    return el('div.q-row', {}, [
      el('span', {}, [x.name, x.productId === 'general-mortgage' ? el('span.chip.example', { text: '예시' }) : null].filter(Boolean)),
      el('span.num', { text: 월 != null ? `월 ${formatKRW(월)}` : '—' }),
      el('span.tiny', { class: 부족 ? 'bad' : 'faint', text:
        `${formatPct(x.rate)} · ${Math.round(x.termMonths / 12)}년 · 한도 ${formatKRW(x.amount)}`
        + (부족 ? ` — 필요액보다 ${formatKRW(필요 - x.amount)} 모자람` : '') }),
    ]);
  };

  return card('q-other', `④ 그다음 ${formatKRW(필요)} — 주담대로 빌리면`, [
    필요 === 0 ? el('p.tiny.faint', { text: '기금승계로 필요자금이 모두 해결됩니다.' }) : null,
    필요 > 0 && ok.length ? el('div', {}, ok.map(line)) : null,
    필요 > 0 && !ok.length ? el('p.tiny.faint', { text: '조건에 맞는 상품이 없습니다. 아래 사유를 확인하세요.' }) : null,
    no.length ? el('details.q-fail', {}, [
      el('summary', { text: `안 되는 상품 ${no.length}개 — 이유 보기` }),
      ...no.map((x) => el('div.q-row', {}, [el('span', { text: x.name }), el('span.tiny.faint', { text: x.failureSummary ?? '' })])),
    ]) : null,
    el('p.tiny.faint', { text: '기금승계와 함께 받을 수 있는지(중복 가능 여부)는 취급점에서 확인합니다. 은행 주담대는 규제값 예시 — 실행일·현장마다 다릅니다.' }),
  ]);
}

function jeonseCard(r, ctx) {
  const 소득 = (r.input?.borrower?.annualIncome ?? 0) + (r.input?.borrower?.combineSpouse ? (r.input?.borrower?.spouseIncome ?? 0) : 0);
  const 기준 = beotimmokIncomeCap(ctx) ?? 50_000_000;
  const 버팀목 = 소득 > 0 && 소득 <= 기준;
  const 경로 = ctx.policies?.bunyangjeonhwan?.전세자금경로 ?? {};
  return card('q-jeonse', '⑤ 분할납부 시 전세자금대출', [
    el('div.q-verdict', {
      class: 소득 === 0 ? 'wait' : 버팀목 ? 'ok' : 'bad',
      text: 소득 === 0 ? '연소득을 넣으세요'
        : 버팀목 ? `버팀목 대상 (부부합산 ${formatKRW(기준)} 이하)`
        : `버팀목 소득 초과 → 은행 전세자금대출`,
    }),
    el('p.tiny.faint', { text: 버팀목
      ? '버팀목은 소득 기준만 확인했습니다. 보증금·자산 요건은 취급은행에서 확인합니다.'
      : (경로.은행전세자금대출?.접수 ?? '지역 취급은행 또는 대출상담사 접수') + (경로.은행전세자금대출?.출장접수 ? ` · ${경로.은행전세자금대출.출장접수}` : '') }),
    el('p.tiny.faint', { text: '기존 보증금대출은 일시납·분할납부 계약 시 상환해야 합니다.' }),
  ]);
}

/* ───────────────────────── 보조 ───────────────────────── */

function card(id, title, children) {
  return el('section.q-card', { id }, [el('h2.q-h', { text: title }), ...children.filter(Boolean)]);
}

function big(text) {
  return el('div.q-big', { text });
}

/** 버팀목 일반의 소득 상한을 상품 파일에서 읽는다 — 숫자를 두 군데 두지 않는다. */
function beotimmokIncomeCap(ctx) {
  for (const d of ctx.products ?? []) {
    if (d.productId !== 'beotimmok') continue;
    const v = (d.variants ?? []).find((x) => x.variantId === 'beotimmok-general');
    const cond = (v?.eligibility?.and ?? []).find((x) => x.path === 'borrower.annualIncomeCombined');
    if (cond?.value != null) return cond.value;
  }
  return null;
}

function footSources(ctx, r) {
  const conv = ctx.policies?.bunyangjeonhwan?.meta;
  const sp = r.limit?.selectedProduct;
  const parts = [];
  if (conv) parts.push(`분양전환·LH: ${conv.출처 ?? ''} (${conv.기준일 ?? '-'})`);
  if (sp) parts.push(`${sp.name}: 상담일지 기준`);
  const st = ctx.policies?.stress?.meta;
  if (st) parts.push(`스트레스금리 ${st.기준일 ?? ''}${st.verified ? '' : ' 미검증'}`);
  return '출처 — ' + parts.join(' · ') + ' · 자세한 출처는 「상세 계산」 하단';
}
