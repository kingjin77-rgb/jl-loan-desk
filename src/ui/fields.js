/**
 * 입력 위젯.
 *
 * 금액 입력은 상담 속도를 좌우한다. "3억8천", "38000만", "380000000" 을 전부 받고,
 * 포커스가 빠지면 천단위 구분 기호로 정돈해 보여준다. 타이핑 중에는 건드리지 않는다
 * (커서가 튀면 입력이 불가능해진다).
 */

import { el, field, segmented, select } from './dom.js';
import { parseKRW, parsePct, formatNumber, formatKRW } from '../core/money.js';

/** 금액 입력. 값은 원 단위 숫자로 store 에 들어간다. */
export function moneyField(label, value, onChange, opts = {}) {
  const input = el('input.num', {
    type: 'text',
    inputmode: 'numeric',
    value: value ? formatNumber(value) : '',
    placeholder: opts.placeholder ?? '0',
    onInput: (e) => onChange(parseKRW(e.target.value)),
    onBlur: (e) => {
      const v = parseKRW(e.target.value);
      e.target.value = v ? formatNumber(v) : '';
      if (opts.onBlurRender) opts.onBlurRender();
    },
  });
  const hint = value > 0 ? formatKRW(value) : opts.hint ?? null;
  return field(label, input, { ...opts, unit: opts.unit ?? '원', hint });
}

/** 퍼센트 입력. 값은 비율(0.042)로 store 에 들어간다. */
export function pctField(label, ratio, onChange, opts = {}) {
  const input = el('input.num', {
    type: 'text',
    inputmode: 'decimal',
    value: ratio != null ? (ratio * 100).toFixed(opts.digits ?? 3).replace(/\.?0+$/, '') : '',
    placeholder: opts.placeholder ?? '0',
    onInput: (e) => onChange(parsePct(e.target.value)),
  });
  return field(label, input, { ...opts, unit: opts.unit ?? '%' });
}

/** 정수 입력(개월·건수 등). */
export function intField(label, value, onChange, opts = {}) {
  const input = el('input.num', {
    type: 'number',
    min: opts.min ?? 0,
    max: opts.max ?? undefined,
    step: opts.step ?? 1,
    value: value ?? '',
    onInput: (e) => onChange(e.target.value === '' ? null : Number(e.target.value)),
  });
  return field(label, input, opts);
}

export function textField(label, value, onChange, opts = {}) {
  const input = el('input', {
    type: opts.type ?? 'text',
    value: value ?? '',
    placeholder: opts.placeholder ?? '',
    onInput: (e) => onChange(e.target.value),
  });
  return field(label, input, opts);
}

export function dateField(label, value, onChange, opts = {}) {
  const input = el('input', {
    type: 'date',
    value: value ?? '',
    onInput: (e) => onChange(e.target.value || null),
  });
  return field(label, input, opts);
}

export function selectField(label, options, value, onChange, opts = {}) {
  return field(label, select(options, value, onChange), opts);
}

export function segField(label, options, value, onChange, opts = {}) {
  return field(label, segmented(options, value, onChange), opts);
}

export function checkbox(label, checked, onChange, opts = {}) {
  return el('label', { title: opts.title ?? '' }, [
    el('input', { type: 'checkbox', checked: Boolean(checked), onChange: (e) => onChange(e.target.checked) }),
    label,
  ]);
}

/** "수정됨" 칩 + 되돌리기. 자동입력된 값을 상담사가 고쳤을 때만 나온다. */
export function editedChip(onRevert) {
  return el('button.chip.edited', {
    type: 'button',
    title: '단지 데이터의 값과 다릅니다. 눌러서 되돌립니다.',
    text: '수정됨 ↩',
    onClick: onRevert,
  });
}

export function autoChip() {
  return el('span.chip.auto', { title: '단지 데이터에서 자동으로 채워진 값입니다.', text: '단지' });
}
