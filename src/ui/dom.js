/**
 * 프레임워크 없는 최소 DOM 헬퍼. 이 앱에는 이 정도면 충분하다.
 */

/** el('div.panel', {id:'x'}, [child, '텍스트']) */
export function el(spec, props = {}, children = []) {
  const [tagPart, ...classParts] = String(spec).split('.');
  const node = document.createElement(tagPart || 'div');
  if (classParts.length) node.className = classParts.join(' ');

  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && k !== 'list' && typeof v !== 'object') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }

  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 자식을 전부 갈아끼운다. */
export function replace(node, children) {
  if (!node) return node;
  node.replaceChildren(...[].concat(children).filter((c) => c != null && c !== false)
    .map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
  return node;
}

/** 표 한 장. columns: [{key,label,num?,render?}] */
export function table(columns, rows, { foot = null, rowClass = null } = {}) {
  const thead = el('thead', {}, [
    el('tr', {}, columns.map((c) => el('th', { class: c.num ? 'num' : '', text: c.label }))),
  ]);
  const tbody = el('tbody', {}, rows.map((r) => {
    const tr = el('tr', {}, columns.map((c) => {
      const v = c.render ? c.render(r) : r[c.key];
      return el('td', { class: c.num ? 'num' : '' }, [v instanceof Node ? v : v == null ? '' : String(v)]);
    }));
    const cls = rowClass?.(r);
    if (cls) tr.className = cls;
    return tr;
  }));
  const parts = [thead, tbody];
  if (foot) {
    parts.push(el('tfoot', {}, [el('tr', {}, columns.map((c) => {
      const v = foot[c.key];
      return el('td', { class: c.num ? 'num' : '' }, [v == null ? '' : String(v)]);
    }))]));
  }
  return el('table', {}, parts);
}

/** 라벨 + 컨트롤 한 줄. */
export function field(label, control, { hint = null, unit = null, error = null, chip = null } = {}) {
  const wrap = el(`div.field${error ? ' err' : ''}`, {}, [
    el('label', {}, [label, chip ? ' ' : null, chip]),
    el('div.control', {}, [control, unit ? el('span.unit', { text: unit }) : null]),
  ]);
  if (hint || error) wrap.append(el('div.hint', { class: error ? 'danger-text' : '', text: error || hint }));
  return wrap;
}

export function panel(title, bodyChildren, { actions = null, flush = false, id = null } = {}) {
  return el(`section.panel${flush ? ' flush' : ''}`, id ? { id } : {}, [
    el('header', {}, [el('h2', { text: title }), el('div.spacer'), actions]),
    el('div.body', {}, bodyChildren),
  ]);
}

/** 세그먼트 토글. */
export function segmented(options, value, onChange) {
  const wrap = el('div.seg');
  for (const o of options) {
    const v = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    wrap.append(el('button', {
      type: 'button',
      text: label,
      title: typeof o === 'object' ? o.title ?? '' : '',
      'aria-pressed': String(v === value),
      onClick: () => onChange(v),
    }));
  }
  return wrap;
}

export function select(options, value, onChange, props = {}) {
  return el('select', {
    ...props,
    onChange: (e) => onChange(e.target.value),
  }, options.map((o) => {
    const v = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    return el('option', { value: v, text: label, selected: String(v) === String(value) });
  }));
}

export function debounce(fn, ms = 0) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
