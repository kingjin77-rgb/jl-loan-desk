/**
 * 좌측 입력 레일의 패널들.
 *
 * 은행 상담사 프로그램의 밀도를 목표로 한다 — 한 화면에 조건이 다 보이고,
 * 무엇을 바꿔도 즉시 재계산된다.
 */

import { el, panel, select, segmented } from './dom.js';

/** 자주 쓰지 않는 입력을 접어 둔다. 기본은 닫힘. */
function details(children, label = '상세 설정') {
  return el('details.more', {}, [
    el('summary', { text: label }),
    el('div', { style: 'padding-top:8px' }, children.filter(Boolean)),
  ]);
}
import { moneyField, pctField, intField, textField, dateField, selectField, segField, checkbox, editedChip, autoChip, inlineMoney, inlinePct } from './fields.js';
import { OPTIONS } from '../state/defaults.js';
import { formatKRW, formatNumber } from '../core/money.js';
import { checkPrepayUnit } from '../core/bunyangjeonhwan.js';
import { regionKeys } from '../core/bangongje.js';

/** 자동입력된 경로면 칩을 붙인다. */
function chipFor(store, path, autoValues) {
  const origin = store.origins[path];
  if (origin === 'auto') return autoChip();
  if (origin === 'manual' && autoValues && path in autoValues) {
    return editedChip(() => store.revert(path, autoValues[path]));
  }
  return null;
}

// ────────────────────────── 단지 ──────────────────────────

export function complexPanel({ store, ctx, mine, onPickComplex, onImportComplex, onClearComplex, onTypeChange, onConversionPreset, onEditComplex, onExportComplexes, collapsible = false, collapsed = false, onToggle = null }) {
  const s = store.get().schedule;
  const listed = ctx.complexIndex?.complexes ?? [];

  // 내가 만든 단지를 먼저, 그다음 저장소 샘플.
  const mineOpts = (mine ?? []).map((c) => ({ value: c.complexId, label: c.name }));
  const sampleOpts = listed.map((c) => ({ value: c.complexId, label: `${c.name}${c.demo ? ' [샘플]' : ''}` }));

  const picker = el('div.field.field-wide', {}, [
    el('div.control', {}, [
      select(
        [
          { value: '', label: mineOpts.length ? '— 단지 선택 —' : '— 단지 없음 (아래에서 만드세요) —' },
          ...mineOpts,
          ...sampleOpts,
        ],
        s.complexId ?? '',
        (v) => (v ? onPickComplex(v) : onClearComplex()),
        { 'aria-label': '단지 선택' }
      ),
    ]),
  ]);

  const actionsRow = el('div.complex-actions', {}, [
    el('button.btn.sm.primary', { type: 'button', text: '+ 단지 만들기', onClick: () => onEditComplex(null) }),
    s.enabled && s.complexId && (mine ?? []).some((c) => c.complexId === s.complexId)
      ? el('button.btn.sm', { type: 'button', text: '수정', onClick: () => onEditComplex(s.complexId) })
      : null,
    el('label.btn.sm', { title: '동료가 보낸 단지 파일을 불러옵니다' }, [
      '파일 열기',
      el('input', {
        type: 'file', accept: '.json,application/json', class: 'sr-only',
        onChange: (e) => { const f = e.target.files?.[0]; if (f) onImportComplex(f); e.target.value = ''; },
      }),
    ]),
    (mine ?? []).length
      ? el('button.btn.sm', { type: 'button', text: '내보내기', title: '내가 만든 단지를 파일로 저장해 동료에게 보냅니다', onClick: onExportComplexes })
      : null,
  ].filter(Boolean));

  const body = [picker, actionsRow];

  if (!s.enabled) {
    body.push(el('div.callout', { style: 'margin-top:6px' }, [
      el('div.small', {}, [el('b', { text: '단지는 선택입니다.' })]),
      el('div.tiny.muted', { style: 'margin-top:2px', text:
        '지금도 한도·월 상환액·정책자금 비교는 다 계산됩니다. ' +
        '분양 단지 상담이라면 단지를 넣으십시오 — 중도금 회차별 후불이자와 ' +
        '「입주 때 현금이 얼마나 더 필요한지」가 추가로 나옵니다.' }),
      (mine ?? []).length
        ? null
        : el('div.tiny.faint', { style: 'margin-top:4px', text:
            '입주자모집공고를 보며 5분이면 입력합니다. 이 기기에만 저장되고 인터넷에 올라가지 않습니다.' }),
    ].filter(Boolean)));
    return panel('단지 (선택)', body, { id: 'panel-complex', collapsible, collapsed, onToggle });
  }

  const types = ctx.complexDoc?.unitTypes ?? [];
  const type = types.find((t) => t.typeId === s.typeId);
  const floors = type?.priceByFloor ?? [];

  body.push(el('div.field', {}, [
    el('label', { text: '타입 / 층' }),
    el('div.control', {}, [
      select(types.map((t) => ({ value: t.typeId, label: `${t.typeId} (${t.전용면적}㎡)` })), s.typeId, (v) => onTypeChange({ typeId: v })),
      select(floors.map((f) => ({ value: f.floorBand, label: f.floorBand })), s.floorBand, (v) => onTypeChange({ floorBand: v })),
    ]),
  ]));

  const floor = floors.find((f) => f.floorBand === s.floorBand);
  if (floor) {
    body.push(el('div.checks', {}, [
      checkbox(`발코니확장 ${formatKRW(floor.발코니확장 ?? 0)}`, s.includeExpansion, (v) => onTypeChange({ includeExpansion: v })),
      checkbox(`옵션 ${formatKRW(floor.옵션 ?? 0)}`, s.includeOptions, (v) => onTypeChange({ includeOptions: v })),
    ]));
    body.push(el('div.callout', {}, [
      el('div', {}, [el('b', { text: '분양가 ' }), formatKRW(floor.분양가)]),
      el('div.tiny.muted', { text: `총 납부대금 ${formatKRW(s.totalPrice)} (담보가액으로 사용)` }),
    ]));
  }

  // 잔금 기표일 — 입주 지연 시나리오
  if (s.moveIn?.입주지정기간) {
    const p = s.moveIn.입주지정기간;
    body.push(el('div.field', {}, [
      el('label', { text: '잔금 기표일' }),
      el('div.control', {}, [
        segmented(
          [{ value: p.start, label: '개시일' }, { value: midOf(p.start, p.end), label: '중간' }, { value: p.end, label: '종료일' }],
          s.conversionDate,
          onConversionPreset
        ),
      ]),
    ]));
    body.push(el('div.hint.tiny.faint', { text: `입주지정기간 ${p.start} ~ ${p.end} · 기표일이 늦어질수록 중도금 후불이자가 늘어납니다.` }));
  }
  body.push(dateField('', s.conversionDate, (v) => store.set('schedule.conversionDate', v), { hint: '직접 지정' }));

  return panel(`단지 — ${s.complexName ?? ''}`, body, {
    id: 'panel-complex', collapsible, collapsed, onToggle,
    actions: el('button.btn.sm', { type: 'button', text: '해제', onClick: onClearComplex }),
  });
}

function midOf(a, b) {
  if (!a || !b) return a ?? b;
  const m = new Date((Date.parse(a + 'T12:00:00Z') + Date.parse(b + 'T12:00:00Z')) / 2);
  return m.toISOString().slice(0, 10);
}

// ────────────────────────── 차주 ──────────────────────────

export function borrowerPanel({ store, errors, autoValues }) {
  const b = store.get().borrower;
  const err = (f) => errors.find((e) => e.field === f)?.message;

  const debts = el('div.rows', {}, (b.existingDebts ?? []).map((d, i) => el('div.row-item', {}, [
    select(OPTIONS.debtKind, d.kind, (v) => updateDebt(store, i, { kind: v })),
    // ★ 만원 단위. 다른 금액칸과 단위가 달라서는 안 된다.
    inlineMoney(d.balance, (v) => updateDebt(store, i, { balance: v }), {
      placeholder: '잔액(만원)',
      label: `기존부채 ${i + 1} 잔액(만원)`,
      title: '만원 단위입니다. 마이너스통장은 사용액이 아니라 한도금액을 넣으십시오.',
    }),
    inlinePct(d.rate, (v) => updateDebt(store, i, { rate: v }), {
      label: `기존부채 ${i + 1} 금리(%)`,
    }),
    el('button.x', { type: 'button', text: '×', title: '삭제', onClick: () => removeDebt(store, i) }),
  ])));

  return panel('차주', [
    moneyField('연소득', b.annualIncome, (v) => store.set('borrower.annualIncome', v)),
    el('div.checks', {}, [
      checkbox('배우자 소득 합산', b.combineSpouse, (v) => store.set('borrower.combineSpouse', v)),
      checkbox('생애최초', b.isFirstTime, (v) => store.set('borrower.isFirstTime', v)),
    ]),
    b.combineSpouse ? moneyField('배우자 연소득', b.spouseIncome, (v) => store.set('borrower.spouseIncome', v)) : null,

    segField('주택수', OPTIONS.ownedHouses, String(b.ownedHouses), (v) => store.set('borrower.ownedHouses', v === '0' ? 0 : v === '1' ? 1 : v)),
    segField('규제지역', OPTIONS.regionGrade, b.regionGrade, (v) => store.set('borrower.regionGrade', v), {
      chip: chipFor(store, 'borrower.regionGrade', autoValues),
      error: err('ltv'),
    }),
    details([
      segField('스트레스 적용', OPTIONS.stressRegion, b.stressRegion, (v) => store.set('borrower.stressRegion', v), {
        hint: '스트레스 DSR 가산폭의 수도권/비수도권 구분',
      }),
    ]),

    el('div.field.field-wide', {}, [
      el('label', {}, ['기존 부채 ', el('span.tiny.faint', { text: '(종류 / 잔액 / 금리)' })]),
    ]),
    debts,
    el('button.btn.sm', { type: 'button', text: '+ 부채 추가', onClick: () => addDebt(store) }),
  ].filter(Boolean), { id: 'panel-borrower' });
}

function addDebt(store) {
  const list = [...(store.get().borrower.existingDebts ?? []), { kind: '신용대출', balance: 0, rate: 0.06 }];
  store.set('borrower.existingDebts', list);
}
function updateDebt(store, i, patch) {
  const list = [...(store.get().borrower.existingDebts ?? [])];
  list[i] = { ...list[i], ...patch };
  store.set('borrower.existingDebts', list);
}
function removeDebt(store, i) {
  const list = [...(store.get().borrower.existingDebts ?? [])];
  list.splice(i, 1);
  store.set('borrower.existingDebts', list);
}

// ────────────────────────── 담보 ──────────────────────────

export function collateralPanel({ store, ctx, errors, autoValues }) {
  const c = store.get().collateral;
  const err = (f) => errors.find((e) => e.field === f)?.message;
  const keys = regionKeys(ctx.policies.bangongje);

  return panel('담보', [
    segField('시세기준', OPTIONS.basis, c.basis, (v) => store.set('collateral.basis', v), {
      chip: chipFor(store, 'collateral.basis', autoValues),
    }),
    moneyField('담보가액', c.amount, (v) => store.set('collateral.amount', v), {
      chip: chipFor(store, 'collateral.amount', autoValues),
    }),
    selectField('방공제 지역', keys.length ? keys : ['(설정 없음)'], c.bangongjeRegion, (v) => store.set('collateral.bangongjeRegion', v), {
      chip: chipFor(store, 'collateral.bangongjeRegion', autoValues),
      error: err('bangongjeRegion'),
      hint: '주택임대차보호법 시행령의 지역구분',
    }),
    el('div.checks', {}, [
      checkbox('MCI 가입', c.mci, (v) => store.set('collateral.mci', v), { title: '가입 시 방공제가 면제됩니다' }),
      checkbox('MCG 가입', c.mcg, (v) => store.set('collateral.mcg', v)),
    ]),
    c.roomCount > 1 || c.showRooms
      ? intField('방공제 건수', c.roomCount, (v) => store.set('collateral.roomCount', v || 1), { hint: '아파트는 통상 1건' })
      : null,
  ].filter(Boolean), { id: 'panel-collateral' });
}

// ────────────────────────── 대출조건 ──────────────────────────

export function productPanel({ store }) {
  const p = store.get().product;
  return panel('대출조건', [
    segField('종류', OPTIONS.loanKind, p.loanKind ?? '주택담보', (v) => store.set('product.loanKind', v), {
      hint: '정책자금 비교 후보가 이 종류로 걸러집니다',
    }),
    segField('목적', OPTIONS.purpose, p.purpose, (v) => store.set('product.purpose', v)),
    pctField('약정금리', p.annualRate, (v) => store.set('product.annualRate', v), {
      hint: '고객이 실제로 내는 금리. 스트레스 금리는 자동으로 별도 적용됩니다.',
    }),
    segField('금리유형', OPTIONS.rateType, p.rateType, (v) => store.set('product.rateType', v)),
    el('div.field', {}, [
      el('label', { text: '만기' }),
      el('div.control', {}, [
        select(OPTIONS.termYears.map((y) => ({ value: y * 12, label: `${y}년` })), p.termMonths, (v) => store.set('product.termMonths', Number(v))),
        select(OPTIONS.method, p.method, (v) => store.set('product.method', v)),
      ]),
    ]),
    intField('거치기간', p.graceMonths, (v) => store.set('product.graceMonths', v || 0), { unit: '개월' }),
    // 자주 건드리지 않는 것은 접어 둔다 — 모바일에서 화면이 길어지는 주범이다
    details([
      segField('금융권', OPTIONS.lenderTier, p.lenderTier, (v) => store.set('product.lenderTier', v)),
      moneyField('희망 대출금액', p.requestedAmount, (v) => store.set('product.requestedAmount', v || null), {
        hint: '입력하면 한도와 비교해 부족분을 알려줍니다', placeholder: '(선택)',
      }),
      moneyField('수기 상한', p.manualCap, (v) => store.set('product.manualCap', v || null), {
        hint: '은행이 알려준 내부 한도 등', placeholder: '(선택)',
      }),
    ]),
  ], { id: 'panel-product' });
}

// ────────────────────────── 중도금/잔금 ──────────────────────────

export function schedulePanel({ store }) {
  const s = store.get().schedule;
  if (!s.enabled) return null;

  const rounds = s.paymentSchedule?.중도금?.rounds ?? [];

  return panel('중도금 · 잔금 자금', [
    pctField('중도금대출 비율', s.jungdogeumRatio, (v) => store.set('schedule.jungdogeumRatio', v), {
      hint: '회차 금액 중 대출로 조달하는 비율', digits: 1,
    }),
    pctField('중도금 금리', s.jungdogeumRate, (v) => store.set('schedule.jungdogeumRate', v)),
    segField('이자방식', OPTIONS.interestMode, s.interestMode, (v) => store.set('schedule.interestMode', v), {
      hint: '후불제면 잔금 때 이자를 한꺼번에 냅니다',
    }),
    moneyField('입주 시 보유현금', s.ownFunds, (v) => store.set('schedule.ownFunds', v)),
    pctField('취득세율', s.extras?.취득세율, (v) => store.set('schedule.extras.취득세율', v), { digits: 2 }),
    moneyField('법무·중개비', s.extras?.['중개·법무비추정'], (v) => store.set('schedule.extras.중개·법무비추정', v)),
    moneyField('선수관리비', s.extras?.선수관리비, (v) => store.set('schedule.extras.선수관리비', v)),
    rounds.length
      ? el('p.tiny.faint', { text: `중도금 ${rounds.length}회차 (${rounds[0].date} ~ ${rounds[rounds.length - 1].date})` })
      : null,
  ].filter(Boolean), { id: 'panel-schedule' });
}

// ────────────────────────── 상담 정보 ──────────────────────────

export function consultationPanel({ store, collapsible = false, collapsed = false, onToggle = null }) {
  const c = store.get().consultation;
  return panel('상담 정보', [
    textField('상담사', c.consultant, (v) => store.set('consultation.consultant', v)),
    textField('고객', c.clientAlias, (v) => store.set('consultation.clientAlias', v), {
      placeholder: '김○○',
      hint: '공용 PC에 기록이 남습니다. 실명 대신 이니셜을 쓰십시오.',
    }),
    dateField('상담일', c.date, (v) => store.set('consultation.date', v)),
  ], { id: 'panel-consultation', collapsible, collapsed, onToggle });
}


// ────────────────────── 정책자금 자격 ──────────────────────

/**
 * 디딤돌·보금자리·버팀목 자격판정에 필요한 입력.
 *
 * 기본은 접혀 있다 — 일반 주담대 상담에서 입력칸이 늘어나면 안 된다.
 * 정책자금을 볼 때만 펼친다.
 */
export function eligibilityPanel({ store, open, onToggle }) {
  const b = store.get().borrower;
  const l = store.get().lease ?? {};

  const head = el('button.btn.sm', {
    type: 'button',
    text: open ? '접기' : '펼치기',
    onClick: () => onToggle(!open),
  });

  if (!open) {
    return panel('정책자금 자격', [
      el('p.tiny.faint', { text: '디딤돌·보금자리론·버팀목 자격을 판정하려면 순자산·신혼 여부 등이 필요합니다. 펼쳐서 입력하십시오.' }),
    ], { id: 'panel-eligibility', actions: head });
  }

  return panel('정책자금 자격', [
    moneyField('순자산', b.netAssets, (v) => store.set('borrower.netAssets', v), {
      hint: '부동산·금융자산에서 부채를 뺀 금액',
    }),
    intField('만 나이', b.age, (v) => store.set('borrower.age', v), { unit: '세', hint: '청년 상품 판정용' }),
    intField('전용면적', store.get().collateral.areaSqm, (v) => store.set('collateral.areaSqm', v), {
      unit: '㎡', step: 0.01,
      hint: '기금 상품의 85㎡ 요건 판정용. 단지를 고르면 자동으로 채워집니다.',
    }),
    intField('자녀 수', b.children, (v) => store.set('borrower.children', v || 0), { unit: '명' }),
    intField('출산 후 경과', b.newbornWithinMonths, (v) => store.set('borrower.newbornWithinMonths', v), {
      unit: '개월', hint: '신생아 특례 판정용. 해당 없으면 비워 두십시오.',
    }),
    el('div.checks', {}, [
      checkbox('신혼부부', b.isNewlywed, (v) => store.set('borrower.isNewlywed', v)),
      checkbox('청약통장 보유', b.hasSubscriptionAccount, (v) => store.set('borrower.hasSubscriptionAccount', v)),
    ]),

    el('div.field.field-wide', { style: 'margin-top:10px' }, [
      el('label', {}, ['전세자금대출 ', el('span.tiny.faint', { text: '(해당 시에만)' })]),
    ]),
    moneyField('임차보증금', l.deposit, (v) => store.set('lease.deposit', v), {
      hint: '전세 상품은 담보가 아니라 보증금 기준으로 한도를 잡습니다',
    }),
  ], { id: 'panel-eligibility', actions: head });
}

/**
 * 분양전환 (민간임대 → 분양전환).
 *
 * 일반 매매 상담에서는 쓰지 않으므로 기본은 접어 둔다. 켜면 상담일지 첫 표
 * (분양가 A / 납입보증금 B / 보증금대출 C / 본인준비금 D)를 그대로 입력받는다.
 */
export function conversionPanel({ store, open, onToggle }) {
  const c = store.get().conversion ?? {};
  const head = el('button.btn.sm', {
    type: 'button',
    text: open ? '접기' : '펼치기',
    onClick: () => onToggle(!open),
  });

  if (!open) {
    return panel('분양전환', [
      el('p.tiny.faint', {
        text: '민간임대 분양전환 상담입니다. 필요자금(A−B+C−D) · 분할납부(잔금유예) · LH 검증 요건을 계산합니다.',
      }),
    ], { id: 'panel-conversion', actions: head });
  }

  const on = Boolean(c.enabled);
  const body = [
    el('div.checks', {}, [
      checkbox('분양전환 상담으로 계산', on, (v) => store.set('conversion.enabled', v)),
    ]),
  ];

  if (on) {
    body.push(
      el('p.tiny.faint', { text: '① 필요자금 — 상담일지 첫 표', style: 'margin:10px 0 2px' }),
      moneyField('분양가 (A)', c.분양가, (v) => store.set('conversion.분양가', v)),
      moneyField('납입보증금 (B)', c.납입보증금, (v) => store.set('conversion.납입보증금', v), { hint: '이미 낸 보증금 — 차감됩니다' }),
      moneyField('보증금대출 (C)', c.보증금대출, (v) => store.set('conversion.보증금대출', v), { hint: '계약 시 상환해야 하므로 더합니다' }),
      moneyField('본인준비금 (D)', c.본인준비금, (v) => store.set('conversion.본인준비금', v)),

      el('p.tiny.faint', { text: '② 분할납부(잔금유예)', style: 'margin:12px 0 2px' }),
      segField('타입', OPTIONS.전환타입.map((t) => ({ value: t, label: `${t}㎡` })), c.타입, (v) => store.set('conversion.타입', v), {
        hint: '타입에 따라 최소 잔금유예금이 5,500만원 / 7,500만원으로 갈립니다',
      }),
      dateField('계약일', c.계약일, (v) => store.set('conversion.계약일', v)),
      dateField('청산일', c.청산일, (v) => store.set('conversion.청산일', v), { hint: '계약일+10년과 비교해 빠른 날이 만기입니다. 미정이면 비워 두십시오.' }),
      moneyField('분할납부액', c.분할납부액, (v) => store.set('conversion.분할납부액', v || null), {
        hint: '비워 두면 가능한 최대로 계산합니다',
      }),
      pctField('잔금유예 금리', c.잔금유예금리, (v) => store.set('conversion.잔금유예금리', v || null), {
        hint: '⚠ 상담일지에 금리가 적혀 있지 않습니다. 확인한 금리를 넣으십시오.',
      }),

      el('p.tiny.faint', { text: '③ LH 저소득층 검증 요건', style: 'margin:12px 0 2px' }),
      segField('가구원수', OPTIONS.가구원수.map((n) => ({ value: String(n), label: `${n}인` })), c.가구원수 != null ? String(c.가구원수) : null,
        (v) => store.set('conversion.가구원수', v ? Number(v) : null)),
      moneyField('월소득', c.월소득, (v) => store.set('conversion.월소득', v), { hint: '가구원수별 기준과 비교합니다' }),
      moneyField('자산가액', c.자산가액, (v) => store.set('conversion.자산가액', v)),
      moneyField('자동차가액', c.자동차가액, (v) => store.set('conversion.자동차가액', v), {
        hint: '여러 대여도 가장 높은 차량 1대 (보험개발원 확인)',
      }),
      el('div.checks', {}, [
        checkbox('국가유공자 자격으로 공급', c.국가유공자, (v) => store.set('conversion.국가유공자', v), {
          title: '유공자 자격으로 공급받은 경우에는 요건과 무관하게 신청 가능합니다',
        }),
      ]),

      // ── 일부상환. 100만원 단위로 언제든 가능하고 중도상환수수료가 없다.
      //    넣으면 그 날짜 이후로는 줄어든 원금에만 이자가 붙는다.
      el('p.tiny.faint', { text: '④ 일부상환 (선택)', style: 'margin:12px 0 2px' }),
      prepayRows(store, c),
      el('button.btn.sm', {
        type: 'button', text: '+ 일부상환 추가',
        onClick: () => store.set('conversion.일부상환', [...(c.일부상환 ?? []), { date: null, amount: 0 }]),
      }),
      el('p.tiny.faint', { text: '100만원 단위로 언제든 가능하고 중도상환수수료가 없습니다.' }),
    );
  }

  return panel('분양전환', body, { id: 'panel-conversion', actions: head });
}


/**
 * 잔금유예 일부상환 행.
 *
 * 100만원 단위가 아니면 접수되지 않으므로 **그 자리에서** 알려 준다.
 * 저장한 뒤에 반려되면 상담이 한 번 더 필요해진다.
 */
function prepayRows(store, c) {
  const list = c.일부상환 ?? [];

  // ★ 목록을 클로저의 c 에서 읽으면 안 된다.
  //   입력 중에는 화면을 다시 그리지 않으므로(포커스 보호) c 가 낡은 값으로 남는다.
  //   금액을 넣고 날짜를 넣으면, 날짜 저장이 금액 없던 시절의 목록을 덮어써
  //   금액이 0 으로 돌아간다. 실제로 그랬다 — 일부상환이 계산에 전혀 반영되지 않았다.
  //   항상 store 에서 지금 값을 읽는다.
  const now = () => store.get().conversion?.일부상환 ?? [];
  const update = (i, patch) =>
    store.set('conversion.일부상환', now().map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i) => store.set('conversion.일부상환', now().filter((_, j) => j !== i));

  return el('div.rows', {}, list.map((r, i) => {
    const warn = el('span.tiny.warn');
    const paint = (amount) => {
      const u = checkPrepayUnit(amount);
      warn.textContent = amount > 0 && !u.ok ? u.message : '';
      warn.title = warn.textContent;
    };

    const amountInput = inlineMoney(r.amount, (v) => { update(i, { amount: v }); paint(v); }, {
      placeholder: '금액(만원)',
      label: `일부상환 ${i + 1} 금액(만원)`,
      title: '100만원 단위로만 가능합니다',
    });
    paint(r.amount);

    return el('div.row-item.prepay', {}, [
      el('input', {
        type: 'date', value: r.date ?? '',
        'aria-label': `일부상환 ${i + 1} 날짜`,
        onInput: (e) => update(i, { date: e.target.value || null }),
      }),
      amountInput,
      warn,
      el('button.x', { type: 'button', text: '×', title: '삭제', onClick: () => remove(i) }),
    ]);
  }));
}
