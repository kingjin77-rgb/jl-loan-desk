/**
 * 좌측 입력 레일의 패널들.
 *
 * 은행 상담사 프로그램의 밀도를 목표로 한다 — 한 화면에 조건이 다 보이고,
 * 무엇을 바꿔도 즉시 재계산된다.
 */

import { el, panel, select, segmented } from './dom.js';
import { moneyField, pctField, intField, textField, dateField, selectField, segField, checkbox, editedChip, autoChip } from './fields.js';
import { OPTIONS } from '../state/defaults.js';
import { formatKRW, formatNumber } from '../core/money.js';
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

export function complexPanel({ store, ctx, onPickComplex, onImportComplex, onClearComplex, onTypeChange, onConversionPreset }) {
  const s = store.get().schedule;
  const listed = ctx.complexIndex?.complexes ?? [];

  const picker = el('div.field.field-wide', {}, [
    el('div.control', {}, [
      select(
        [{ value: '', label: '— 단지 선택 (직접 입력) —' }, ...listed.map((c) => ({ value: c.complexId, label: `${c.name}${c.demo ? ' [데모]' : ''}` }))],
        s.complexId ?? '',
        (v) => (v ? onPickComplex(v) : onClearComplex())
      ),
      el('label.btn.sm', { title: '내 컴퓨터의 단지 JSON 파일을 엽니다. 이 방식이 권장됩니다 — 저장소는 공개이므로 실제 단지 데이터를 커밋하지 마십시오.' }, [
        '파일 열기',
        el('input', {
          type: 'file', accept: '.json,application/json', class: 'sr-only',
          onChange: (e) => { const f = e.target.files?.[0]; if (f) onImportComplex(f); e.target.value = ''; },
        }),
      ]),
    ]),
  ]);

  const body = [picker];

  if (!s.enabled) {
    body.push(el('p.tiny.faint', { text: '단지를 고르면 분양가·중도금 회차·입주지정기간이 자동으로 채워지고, 입주 시 부족자금까지 계산됩니다. 고르지 않으면 한도·월상환액만 계산합니다.' }));
    return panel('단지', body, { id: 'panel-complex' });
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
    id: 'panel-complex',
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
    el('input.num', {
      type: 'text', inputmode: 'numeric', placeholder: '잔액',
      value: d.balance ? formatNumber(d.balance) : '',
      onInput: (e) => updateDebt(store, i, { balance: parseMoney(e.target.value) }),
      title: '마이너스통장은 사용액이 아니라 한도금액을 넣으십시오',
    }),
    el('input.num', {
      type: 'text', inputmode: 'decimal', placeholder: '금리%',
      value: d.rate ? (d.rate * 100).toFixed(2) : '',
      onInput: (e) => updateDebt(store, i, { rate: (Number(e.target.value) || 0) / 100 }),
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
    segField('스트레스 적용', OPTIONS.stressRegion, b.stressRegion, (v) => store.set('borrower.stressRegion', v), {
      hint: '스트레스 DSR 가산폭의 수도권/비수도권 구분',
    }),

    el('div.field.field-wide', {}, [
      el('label', {}, ['기존 부채 ', el('span.tiny.faint', { text: '(종류 / 잔액 / 금리)' })]),
    ]),
    debts,
    el('button.btn.sm', { type: 'button', text: '+ 부채 추가', onClick: () => addDebt(store) }),
  ].filter(Boolean), { id: 'panel-borrower' });
}

function parseMoney(v) {
  return Number(String(v).replace(/[^\d]/g, '')) || 0;
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
    segField('금융권', OPTIONS.lenderTier, p.lenderTier, (v) => store.set('product.lenderTier', v)),
    moneyField('희망 대출금액', p.requestedAmount, (v) => store.set('product.requestedAmount', v || null), {
      hint: '입력하면 한도와 비교해 부족분을 알려줍니다', placeholder: '(선택)',
    }),
    moneyField('수기 상한', p.manualCap, (v) => store.set('product.manualCap', v || null), {
      hint: '은행이 알려준 내부 한도 등', placeholder: '(선택)',
    }),
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

export function consultationPanel({ store }) {
  const c = store.get().consultation;
  return panel('상담 정보', [
    textField('상담사', c.consultant, (v) => store.set('consultation.consultant', v)),
    textField('고객', c.clientAlias, (v) => store.set('consultation.clientAlias', v), {
      placeholder: '김○○',
      hint: '공용 PC에 기록이 남습니다. 실명 대신 이니셜을 쓰십시오.',
    }),
    dateField('상담일', c.date, (v) => store.set('consultation.date', v)),
  ], { id: 'panel-consultation' });
}
