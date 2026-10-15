/**
 * 현장 접수 화면 (전주) — 예약자 체크 → 상담일지 → 완료 후 문자.
 *
 * 현장 흐름 (상담사 기준):
 *   1. 고객이 현장 QR 로 대기표를 받는다 (현장 시스템 — 이 앱 밖)
 *   2. 상담사가 동·호 또는 연락처 뒷자리로 찾아 **예약 확인 체크**
 *   3. 「상담 시작」 → 상담일지(분양전환 상담 화면) 작성하며 상담
 *      저소득층(LH 검증) 요건을 못 넘으면 그 자리에서 「불가」
 *   4. 「상담 완료」 → 문자 문구 확인·수정 → 문자 앱으로 발송 → 다음 고객
 *
 * 명단 검색·체크는 store 를 거치지 않는다(입력 중 화면을 다시 그리면 커서가 날아간다).
 * 이 모듈이 자기 영역만 직접 다시 그린다.
 */

import { el, replace, select } from './dom.js';
import { formatKRW } from '../core/money.js';
import {
  STATUS, fromRows, search, bySlot, totals, maskPhone, formatPhone, toCsv, smsHref,
} from '../core/reservations.js';
import { formValues, formCalc, encodeNotice, noticeMessage, VALUE_PATHS } from '../core/sangdamilji.js';
import { renderForm, refreshForm } from './sangdamilji.js';
import { readSheetFile } from '../io/sheet-reader.js';
import * as resStore from '../io/reservation-store.js';

const nowText = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const shortSlot = (s) => String(s ?? '').replace(/^\d{4}\s*년\s*\d{1,2}\s*월\s*/, '');

export function createSite({ ios = false, onRender, onStart, onFinish }) {
  const site = {
    data: resStore.load(),   // { fileName, importedAt, list, states, duplicates }
    step: 'list',            // list | consult
    currentId: null,
    query: '',
    slot: '',
    filter: '전체',          // 전체 | 미확인 | 확인 | 완료
    msgDraft: null,          // 상담사가 고친 문자 문구 (null = 자동)
    error: null,
  };

  const persist = () => {
    if (site.data && !resStore.save(site.data)) {
      site.error = '이 브라우저에 체크 상태를 저장하지 못했습니다(시크릿 모드이거나 저장 차단). 새로고침하면 체크가 사라집니다.';
    }
  };
  const stateOf = (id) => site.data?.states?.[id] ?? {};
  const setState = (id, patch) => {
    site.data.states[id] = { ...stateOf(id), ...patch };
    persist();
  };
  const current = () => site.data?.list.find((x) => x.id === site.currentId) ?? null;

  /* ── 명단 불러오기 ── */
  async function importFile(file) {
    try {
      const { sheets } = await readSheetFile(file);
      const sheet = sheets.find((s) => s.rows.length > 1) ?? sheets[0];
      const res = fromRows(sheet.rows);
      if (!res.list.length) throw new Error('명단에 세대가 한 건도 없습니다.');
      const prev = site.data;
      // 같은 명단을 다시 올리면 기존 체크 상태를 이어 쓴다(같은 세대·번호 = 같은 id).
      const states = {};
      if (prev?.states) for (const x of res.list) if (prev.states[x.id]) states[x.id] = prev.states[x.id];
      site.data = { fileName: file.name, importedAt: nowText(), list: res.list, states, duplicates: res.duplicates };
      site.error = null;
      persist();
      alert(`예약 명단을 불러왔습니다: ${res.list.length}세대`
        + (res.duplicates ? `\n(같은 세대·같은 번호 중복 신청 ${res.duplicates}건은 한 건으로 합쳤습니다)` : '')
        + '\n\n명단은 이 기기의 브라우저에만 저장됩니다. 행사가 끝나면 「명단 지우기」를 눌러 주십시오.');
    } catch (e) {
      alert(`명단을 읽지 못했습니다.\n${e.message}`);
    }
    onRender();
  }

  function clearList() {
    if (!confirm('이 기기에 저장된 예약 명단과 체크 상태를 모두 지웁니다. 되돌릴 수 없습니다.\n(먼저 「현황 내보내기」로 저장해 두는 것을 권합니다)\n\n계속할까요?')) return;
    resStore.clear();
    site.data = null;
    site.currentId = null;
    site.step = 'list';
    onRender();
  }

  function exportCsv() {
    const blob = new Blob([toCsv(site.data.list, site.data.states)], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `상담현황_${nowText().replace(/[: ]/g, '-')}.csv` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ── 체크 · 상담 시작 ── */
  function toggleCheck(x, checked) {
    const s = stateOf(x.id);
    if (!checked) {
      if ((s.status === STATUS.완료 || s.status === STATUS.불가)
        && !confirm(`${x.동}동 ${x.호}호는 이미 「${s.status}」 처리되었습니다. 체크를 해제할까요?`)) { refreshList(); return; }
      setState(x.id, { status: STATUS.예약, checkedAt: null });
    } else {
      setState(x.id, { status: s.status && s.status !== STATUS.예약 ? s.status : STATUS.확인, checkedAt: s.checkedAt ?? nowText() });
    }
    refreshList();
    refreshBoard();
  }

  function start(x) {
    const s = stateOf(x.id);
    if (!s.status || s.status === STATUS.예약) setState(x.id, { status: STATUS.확인, checkedAt: nowText() });
    if (stateOf(x.id).status === STATUS.확인) setState(x.id, { status: STATUS.상담중, startedAt: nowText() });
    site.currentId = x.id;
    site.step = 'consult';
    site.msgDraft = null;
    onStart(x, stateOf(x.id));
  }

  function backToList() {
    site.step = 'list';
    site.currentId = null;
    onRender();
  }

  /* ── 명단 화면 (rail) ── */
  let listBox = null;
  let boardBox = null;
  let countLine = null;

  function filtered() {
    let list = site.data?.list ?? [];
    if (site.slot) list = list.filter((x) => x.일시 === site.slot);
    if (site.filter !== '전체') {
      list = list.filter((x) => {
        const st = stateOf(x.id).status ?? STATUS.예약;
        if (site.filter === '미확인') return st === STATUS.예약;
        if (site.filter === '확인') return st === STATUS.확인 || st === STATUS.상담중;
        return st === STATUS.완료 || st === STATUS.불가;
      });
    }
    return search(list, site.query);
  }

  function row(x) {
    const s = stateOf(x.id);
    const st = s.status ?? STATUS.예약;
    const checked = st !== STATUS.예약;
    const ticket = el('input.res-ticket', {
      type: 'text', inputmode: 'numeric', value: s.ticket ?? '', placeholder: '대기번호',
      'aria-label': `${x.동}동 ${x.호}호 대기번호`,
      onChange: (e) => setState(x.id, { ticket: e.target.value.replace(/\D/g, '') || null }),
    });
    return el('div.res-row', { class: `st-${st}`, dataset: { id: x.id } }, [
      el('label.res-check', { title: '예약 확인 체크' }, [
        el('input', {
          type: 'checkbox', checked, 'aria-label': `${x.동}동 ${x.호}호 예약 확인`,
          onChange: (e) => toggleCheck(x, e.target.checked),
        }),
      ]),
      el('div.res-who', {}, [
        el('b', { text: `${x.동}동 ${x.호}호` }),
        el('div.tiny.faint', { text: `${shortSlot(x.일시)} · ${maskPhone(x.phone)}${x.중복 ? ` · ${x.중복 + 1}회 신청` : ''}` }),
      ]),
      checked ? ticket : null,
      el('span.res-chip', { class: `st-${st}`, text: st }),
      checked
        ? el('button.btn.sm', { type: 'button', class: st === STATUS.확인 ? 'primary' : '', text: st === STATUS.완료 || st === STATUS.불가 ? '다시 보기' : '상담 시작', onClick: () => start(x) })
        : null,
    ]);
  }

  function refreshList() {
    if (!listBox || !site.data) return;
    const list = filtered();
    const shown = list.slice(0, 200);
    replace(listBox, list.length
      ? [...shown.map(row), list.length > shown.length ? el('p.tiny.faint', { text: `${list.length - shown.length}건 더 있습니다. 동·호로 검색하세요.` }) : null]
      : [el('div.res-none', {}, [
          el('b', { text: site.query ? `「${site.query}」 — 예약 명단에 없습니다` : '해당하는 예약자가 없습니다' }),
          site.query ? el('p.tiny', { text: '예약자만 현장 상담이 가능합니다. 동·호수·연락처 뒷자리를 다시 확인해 주세요.' }) : null,
        ])]);
    if (countLine) countLine.textContent = `${list.length}세대 표시`;
  }

  function listRail() {
    if (!site.data) {
      return [el('section.panel', { id: 'site-import' }, [
        el('header', {}, [el('h2', { text: '① 상담 예약자 명단' })]),
        el('div.body', {}, [
          el('p', { text: '예약 명단 엑셀 파일(.xls · .xlsx · .csv)을 불러오면 예약자를 체크하며 상담할 수 있습니다.' }),
          fileButton('예약 명단 불러오기', true),
          el('p.tiny.faint', { text: '파일은 이 기기 안에서만 열립니다. 서버로 보내지 않습니다. 명단에는 순번·동·호수·연락처·신청일 칸이 있어야 합니다.' }),
        ]),
      ])];
    }

    const slots = [...new Set(site.data.list.map((x) => x.일시).filter(Boolean))];
    const q = el('input.res-search', {
      type: 'search', value: site.query, placeholder: '동·호수 또는 연락처 뒷자리  예) 301 1503',
      inputmode: 'search', 'aria-label': '예약자 찾기',
      onInput: (e) => { site.query = e.target.value; refreshList(); },
    });
    listBox = el('div.res-list');
    countLine = el('span.tiny.faint');
    refreshList();

    return [el('section.panel', { id: 'site-list' }, [
      el('header', {}, [el('h2', { text: '① 예약자 확인' }), el('div.spacer'), countLine]),
      el('div.body', {}, [
        q,
        el('div.res-filters', {}, [
          select([{ value: '', label: '전체 시간' }, ...slots.map((s) => ({ value: s, label: shortSlot(s) }))], site.slot,
            (v) => { site.slot = v; refreshList(); }, { 'aria-label': '시간대' }),
          ...['전체', '미확인', '확인', '완료'].map((f) => el('button.btn.sm', {
            type: 'button', class: site.filter === f ? 'primary' : '', text: f,
            onClick: () => { site.filter = f; onRender(); },
          })),
        ]),
        listBox,
      ]),
    ])];
  }

  function fileButton(text, primary = false) {
    return el(`label.btn${primary ? '.primary' : '.sm'}`, {}, [text, el('input', {
      type: 'file', accept: '.xls,.xlsx,.csv', class: 'sr-only',
      onChange: (e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; },
    })]);
  }

  /* ── 현황판 (results) ── */
  function refreshBoard() {
    if (boardBox) replace(boardBox, boardChildren());
  }

  function boardChildren() {
    if (!site.data) {
      return [el('section.q-card', {}, [
        el('h2.q-h', { text: '현장 상담 순서' }),
        flow(),
      ])];
    }
    const t = totals(site.data.list, site.data.states);
    const g = bySlot(site.data.list, site.data.states);
    return [
      el('section.q-card', { id: 'site-totals' }, [
        el('h2.q-h', { text: '오늘 현황' }),
        el('div.res-totals', {}, [
          stat('예약', t.전체), stat('확인', t.확인), stat('상담중', t.상담중), stat('완료', t.완료), stat('불가', t.불가), stat('문자', t.문자),
        ]),
        el('table.res-slots', {}, [
          el('thead', {}, [el('tr', {}, ['시간', '예약', '확인', '완료', '불가'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, g.map((x) => el('tr', {}, [
            el('td', { text: shortSlot(x.일시) }), el('td.num', { text: x.전체 }), el('td.num', { text: x.확인 }),
            el('td.num', { text: x.완료 }), el('td.num', { text: x.불가 }),
          ]))),
        ]),
      ]),
      el('section.q-card', {}, [
        el('h2.q-h', { text: '명단' }),
        el('p.tiny', { text: `${site.data.fileName} · ${site.data.list.length}세대${site.data.duplicates ? ` (중복 ${site.data.duplicates}건 합침)` : ''} · ${site.data.importedAt} 불러옴` }),
        el('p.tiny.faint', { text: '체크 상태는 이 기기에만 저장됩니다. 상담사 여러 명이 각자 기기로 쓰면 서로의 체크가 보이지 않습니다.' }),
        el('div.res-actions', {}, [
          el('button.btn.sm', { type: 'button', text: '현황 내보내기 (엑셀용 CSV)', onClick: exportCsv }),
          fileButton('다른 명단 불러오기'),
          el('button.btn.sm.danger', { type: 'button', text: '명단 지우기', onClick: clearList }),
        ]),
      ]),
      el('section.q-card', {}, [el('h2.q-h', { text: '현장 상담 순서' }), flow()]),
    ];
  }

  function board() {
    boardBox = el('div.res-board');
    replace(boardBox, boardChildren());
    return [site.error ? el('div.callout.warn', { text: site.error }) : null, boardBox].filter(Boolean);
  }

  /* ── 상담 중: 고객 머리 · 완료 카드 ── */
  function customerCard() {
    const x = current();
    if (!x) return null;
    const s = stateOf(x.id);
    return el('section.panel.site-customer', {}, [
      el('header', {}, [
        el('h2', { text: `${x.동}동 ${x.호}호` }),
        el('div.spacer'),
        el('button.btn.sm', { type: 'button', text: '◂ 명단', onClick: backToList }),
      ]),
      el('div.body', {}, [
        el('div.tiny', { text: `예약 ${shortSlot(x.일시)} · ${maskPhone(x.phone)}${s.ticket ? ` · 대기 ${s.ticket}번` : ''} · ${s.status ?? STATUS.예약}` }),
      ]),
    ]);
  }

  /* ── 상담일지 (종이 양식과 같은 화면) ── */
  const today = () => nowText().slice(0, 10);

  function formParts(store, ctx) {
    const x = current();
    const form = ctx.policies?.sangdamilji;
    const rules = ctx.policies?.bunyangjeonhwan ?? {};
    const values = formValues(store.get());
    const who = { 동: x?.동, 호: x?.호, 날짜: today() };
    return { x, form, rules, values, who, calc: form ? formCalc(values, form, rules, who) : null };
  }

  function formArea(store, ctx) {
    const { form, values, calc, who } = formParts(store, ctx);
    if (!form) return [el('div.callout.warn', { text: '상담일지 양식 파일(sangdamilji)이 없습니다. 메뉴 → 「분양전환 상담」 화면을 쓰십시오.' })];
    return [renderForm({
      form, values, calc, who, editable: true,
      set: (key, v) => store.set(VALUE_PATHS[key], v),
    })];
  }

  function refreshArea(root, store, ctx) {
    const { calc, values } = formParts(store, ctx);
    const f = root.querySelector('.f-form');
    if (f && calc) refreshForm(f, calc, values);
  }

  function noticeUrl(store, ctx) {
    const { x, values } = formParts(store, ctx);
    const code = encodeNotice({ values, 동: x.동, 호: x.호, 날짜: today() });
    return new URL(`notice.html#${code}`, document.baseURI).href;
  }

  function finishCard(store, ctx) {
    const x = current();
    if (!x) return null;
    const { calc } = formParts(store, ctx);
    const 불가 = Boolean(calc?.불가);
    const url = noticeUrl(store, ctx);
    const auto = noticeMessage({ 동: x.동, 호: x.호, url });
    // 상담사가 문구를 고쳤어도 링크(양식 값)는 늘 최신으로 바꿔 끼운다.
    const text = site.msgDraft != null ? site.msgDraft.replace(/https?:\/\/\S*notice\.html#\S*/, url) : auto;
    const sms = el('a.btn.primary', {
      href: smsHref(x.phone, text, { ios }),
      text: '안내장 문자 보내기',
      onClick: () => { setState(x.id, { smsAt: nowText() }); setTimeout(onRender, 0); },
    });
    const area = el('textarea.site-msg', {
      rows: 6, 'aria-label': '문자 문구',
      onInput: (e) => { site.msgDraft = e.target.value; sms.href = smsHref(x.phone, e.target.value, { ios }); },
    });
    area.value = text;
    const s = stateOf(x.id);

    return el('section.q-card', { id: 'site-finish' }, [
      el('h2.q-h', { text: '상담 종료 · 안내장 발송' }),
      불가 ? el('div.q-verdict.bad', { text: '저소득층 분할납부 불가 — 상담일지에 「불가」로 표시됩니다' }) : null,
      el('p.tiny', { text: `받는 사람 ${maskPhone(x.phone)} · 고객은 문자 속 링크를 누르면 지금 화면과 같은 상담일지(앞·뒷면)를 봅니다.` }),
      el('div.res-actions', {}, [
        el('a.btn.sm', { href: url, target: '_blank', rel: 'noopener', text: '안내장 미리보기 ↗' }),
      ]),
      area,
      el('div.res-actions', {}, [
        sms,
        el('button.btn.sm', { type: 'button', text: '문구 복사', onClick: () => copy(area.value, '문구를 복사했습니다.') }),
        el('button.btn.sm', { type: 'button', text: '번호 복사', onClick: () => copy(formatPhone(x.phone), '번호를 복사했습니다.') }),
        site.msgDraft != null ? el('button.btn.sm', { type: 'button', text: '자동 문구로', onClick: () => { site.msgDraft = null; onRender(); } }) : null,
      ]),
      s.smsAt ? el('p.tiny.ok', { text: `문자 앱 열기: ${s.smsAt}` }) : el('p.tiny.faint', { text: '휴대폰에서는 문자 앱이 열리고, 발송 버튼은 상담사가 누릅니다. PC에서는 「문구 복사」를 쓰세요.' }),
      el('div.res-actions.site-done', {}, [
        el('button.btn.primary', {
          type: 'button',
          text: 불가 ? '불가로 종료 · 다음 고객' : '상담 완료 · 다음 고객',
          onClick: () => finish(불가 ? STATUS.불가 : STATUS.완료, calc, area.value),
        }),
        !불가 ? el('button.btn.sm.danger', { type: 'button', text: '불가로 종료', onClick: () => finish(STATUS.불가, calc, area.value) }) : null,
      ]),
    ]);
  }

  function finish(status, calc, message) {
    const x = current();
    if (!x) return;
    const s = stateOf(x.id);
    if (!s.smsAt && !confirm('아직 문자 앱을 열지 않았습니다. 문자 없이 종료할까요?')) return;
    setState(x.id, {
      status, doneAt: nowText(),
      결과: status === STATUS.불가 ? '불가' : calc?.필요자금 ? `필요자금 ${formatKRW(calc.필요자금)}` : '완료',
      message,
    });
    onFinish(x, status);
    site.step = 'list';
    site.currentId = null;
    site.msgDraft = null;
    site.query = '';
    onRender();
  }

  return {
    get step() { return site.step; },
    get hasList() { return Boolean(site.data); },
    current, listRail, board, customerCard, finishCard, formArea, refreshArea,
  };
}

function stat(k, v) {
  return el('div.res-stat', {}, [el('div.k', { text: k }), el('div.v', { text: String(v) })]);
}

function flow() {
  return el('ol.res-flow', {}, [
    '고객이 현장 QR로 대기표를 받습니다 (현장 시스템)',
    '동·호수 또는 연락처 뒷자리로 찾아 예약 확인 체크 ☑ (대기번호 입력)',
    '「상담 시작」 → 상담일지 작성하며 상담',
    '저소득층(LH 검증) 요건을 못 넘으면 바로 「불가」',
    '상담 완료 → 문자 문구 확인 → 문자 발송 → 다음 고객',
  ].map((t) => el('li', { text: t })));
}

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    alert(done);
  } catch {
    prompt('복사가 막혀 있습니다. 아래 내용을 길게 눌러 복사하세요.', text);
  }
}
