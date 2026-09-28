/**
 * 입력 위젯.
 *
 * 금액 입력은 상담 속도를 좌우한다. "3억8천", "38000만", "380000000" 을 전부 받고,
 * 포커스가 빠지면 천단위 구분 기호로 정돈해 보여준다. 타이핑 중에는 건드리지 않는다
 * (커서가 튀면 입력이 불가능해진다).
 */

import { el, field, segmented, select } from './dom.js';
import { parseKRW, parsePct, formatNumber, formatKRW, parseManwon, toManwon } from '../core/money.js';

/**
 * ★ 자유 입력 공통 처리.
 *
 * 두 가지를 막는다:
 *  1) 한글 IME 조합 중에 값을 읽으면 중간 자모("ㅇ", "어")가 들어온다.
 *     조합이 끝날 때까지 onChange 를 미룬다.
 *  2) 입력 중 화면을 다시 그리면 포커스·커서·조합이 날아간다.
 *     window.__jlTyping 을 세워 두면 main.js 가 입력 영역을 건드리지 않는다.
 */
function typingInput(props, onValue) {
  let composing = false;
  return el('input', {
    ...props,
    onCompositionStart: () => { composing = true; },
    onCompositionEnd: (e) => {
      composing = false;
      emit(e.target.value);
    },
    onInput: (e) => {
      if (composing || e.isComposing) return;   // 조합 중에는 손대지 않는다
      emit(e.target.value);
    },
  });

  function emit(raw) {
    window.__jlTyping = true;
    try { onValue(raw); } finally { window.__jlTyping = false; }
  }
}

/**
 * 금액 입력 — **만원 단위**.
 *
 * store 에는 원 단위로 들어가고, 화면에서는 만원으로 주고받는다.
 * 시중 계산기가 다 그렇게 하고, 자릿수가 4자리 줄어 폰에서 치기 쉽다.
 *   5억 → "50000" 만원
 * "5억", "3억8천" 처럼 단위를 붙여 쳐도 그대로 받는다.
 *
 * 상담 속도:
 *  - ↑↓ 로 1,000만원씩, Shift+↑↓ 로 1억씩
 *  - 입력값을 바로 아래에 한국어로 되읽어 자릿수 오타를 그 자리에서 잡는다
 */
export function moneyField(label, value, onChange, opts = {}) {
  const STEP = opts.step ?? 1000;        // 만원 단위: 1,000만원
  const BIG_STEP = opts.bigStep ?? 10000; // 1억

  const shown = value ? formatNumber(toManwon(value)) : '';

  const input = typingInput({
    class: 'num',
    type: 'text',
    inputmode: 'numeric',
    value: shown,
    placeholder: opts.placeholder ?? '0',
    onBlur: (e) => {
      const v = parseManwon(e.target.value);
      e.target.value = v ? formatNumber(toManwon(v)) : '';
      if (opts.onBlurRender) opts.onBlurRender();
    },
    onKeyDown: (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const step = e.shiftKey ? BIG_STEP : STEP;
      const curManwon = toManwon(parseManwon(e.target.value)) || 0;
      const next = Math.max(0, curManwon + (e.key === 'ArrowUp' ? step : -step));
      e.target.value = next ? formatNumber(next) : '';
      onChange(next * 10_000);
    },
  }, (raw) => onChange(parseManwon(raw)));

  // 되읽기 — 자릿수를 잘못 친 것을 눈으로 바로 잡는다.
  // 입력 중에는 화면을 다시 그리지 않으므로(포커스 보호) 이 줄만 직접 갱신한다.
  const hint = value > 0 ? formatKRW(value) : opts.hint ?? null;
  const wrap = field(label, input, { ...opts, unit: opts.unit ?? '만원', hint });

  const hintEl = wrap.querySelector('.hint');
  input.addEventListener('input', () => {
    if (!hintEl) return;
    const v = parseManwon(input.value);
    hintEl.textContent = v > 0 ? formatKRW(v) : (opts.hint ?? '');
  });

  return wrap;
}

/**
 * 퍼센트 입력. 값은 비율(0.042)로 store 에 들어간다.
 * ↑/↓ 로 0.1%p, Shift+↑/↓ 로 0.5%p — 금리를 흔들어 보는 것이 상담의 절반이다.
 */
export function pctField(label, ratio, onChange, opts = {}) {
  const STEP = opts.step ?? 0.001;
  const BIG_STEP = opts.bigStep ?? 0.005;

  const input = typingInput({
    class: 'num',
    type: 'text',
    inputmode: 'decimal',
    value: ratio != null ? (ratio * 100).toFixed(opts.digits ?? 3).replace(/\.?0+$/, '') : '',
    placeholder: opts.placeholder ?? '0',
    onKeyDown: (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const step = e.shiftKey ? BIG_STEP : STEP;
      const cur = parsePct(e.target.value);
      const next = Math.max(0, Math.round((cur + (e.key === 'ArrowUp' ? step : -step)) * 1e6) / 1e6);
      e.target.value = (next * 100).toFixed(opts.digits ?? 3).replace(/\.?0+$/, '');
      onChange(next);
    },
  }, (raw) => onChange(parsePct(raw)));
  return field(label, input, { ...opts, unit: opts.unit ?? '%' });
}

/** 정수 입력(개월·건수 등). */
export function intField(label, value, onChange, opts = {}) {
  const input = typingInput({
    class: 'num',
    type: 'number',
    min: opts.min ?? 0,
    max: opts.max ?? undefined,
    step: opts.step ?? 1,
    value: value ?? '',
  }, (raw) => onChange(raw === '' ? null : Number(raw)));
  return field(label, input, opts);
}

export function textField(label, value, onChange, opts = {}) {
  // 단지명 등 한글을 치는 칸이다. 조합 중 값을 읽으면 자모가 들어온다.
  const input = typingInput({
    type: opts.type ?? 'text',
    value: value ?? '',
    placeholder: opts.placeholder ?? '',
  }, (raw) => onChange(raw));
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

/**
 * 표 안에 들어가는 좁은 금액 칸 — **만원 단위**.
 *
 * 기존부채 행처럼 라벨을 붙일 자리가 없는 곳에 쓴다. moneyField 와 단위가 같아야 한다.
 * 이 칸만 원 단위였던 탓에 상담사가 「20000」(2억을 의도)을 치면 2만원이 들어가
 * DSR 이 전혀 줄지 않았다. 한도를 과대계상하는 종류의 오류다.
 */
export function inlineMoney(value, onChange, opts = {}) {
  return typingInput({
    class: 'num',
    type: 'text',
    inputmode: 'numeric',
    value: value ? formatNumber(toManwon(value)) : '',
    placeholder: opts.placeholder ?? '만원',
    title: opts.title ?? '',
    'aria-label': opts.label ?? '금액(만원)',
    onBlur: (e) => {
      const v = parseManwon(e.target.value);
      e.target.value = v ? formatNumber(toManwon(v)) : '';
    },
  }, (raw) => onChange(parseManwon(raw)));
}

/** 표 안에 들어가는 좁은 퍼센트 칸. 값은 비율(0.06)로 돌려준다. */
export function inlinePct(ratio, onChange, opts = {}) {
  return typingInput({
    class: 'num',
    type: 'text',
    inputmode: 'decimal',
    value: ratio ? (ratio * 100).toFixed(2).replace(/\.?0+$/, '') : '',
    placeholder: opts.placeholder ?? '금리%',
    'aria-label': opts.label ?? '금리(%)',
  }, (raw) => onChange(parsePct(raw)));
}
