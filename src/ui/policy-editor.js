/**
 * 규제 수치 입력 화면.
 *
 * 규제 수치를 JSON 파일로 손수 쓰게 하면 아무도 안 쓴다 — 단지 입력에서 이미 겪었다.
 * 여기서 넣은 값은 파일을 고치지 않고 이 브라우저에만 얹힌다(io/policy-overrides.js).
 *
 * 설계 규칙:
 *  - **구조는 못 바꾼다.** 비어 있는 값만 채운다. 규칙을 추가·삭제하려면 파일을 고쳐야 한다.
 *  - 각 칸 옆에 원본의 `_확인필요` 문구와 지금 들어 있는 값을 보여 준다.
 *  - 「원문에서 확인했습니다」를 체크해야 verified 가 올라간다.
 *    값을 넣었다는 사실만으로 검수완료로 보지 않는다 — 그건 확인이 아니다.
 *  - 입력 중 다시 그리지 않는다(setQuiet). complex-editor.js 와 같은 이유다.
 */

import { el, replace, panel } from './dom.js';
import { pctField, moneyField, intField, textField } from './fields.js';
import { getPath, loadOverrides, saveOverrides, clearOverrides, toFile, fromFile, emptyOverrides, countOverrides } from '../io/policy-overrides.js';
import { formatPct, formatKRW } from '../core/money.js';
import { today } from '../core/dates.js';

/**
 * 어떤 칸을 보여 줄지. **구조를 아는 유일한 곳**이다.
 * 정책 파일 구조가 바뀌면 여기도 바꾼다.
 */
export function fieldsFor(key, doc) {
  switch (key) {
    case 'ltv': return [
      ...(doc.rules ?? []).map((r, i) => ({
        path: `rules[${i}].ltv`, type: 'pct', label: r.id ?? `규칙 ${i + 1}`,
        hint: r.note || whenText(r.when),
      })),
      ...(doc.rules ?? []).map((r, i) => ({
        path: `rules[${i}].absoluteCap`, type: 'money', label: `${r.id ?? i} — 금액 상한`,
        hint: '없으면 비워 두십시오', group: '금액 절대상한',
      })),
    ];

    case 'dsr': return [
      { path: 'limits.은행권', type: 'pct', label: 'DSR 한도 — 은행권' },
      { path: 'limits.제2금융권', type: 'pct', label: 'DSR 한도 — 제2금융권' },
      { path: 'dtiLimits.투기과열', type: 'pct', label: 'DTI — 투기과열', group: 'DTI' },
      { path: 'dtiLimits.조정대상', type: 'pct', label: 'DTI — 조정대상', group: 'DTI' },
      { path: 'dtiLimits.비규제', type: 'pct', label: 'DTI — 비규제', hint: '적용 안 하면 비워 두십시오', group: 'DTI' },
      { path: 'dsrMaturityCapMonths.주택담보대출', type: 'int', label: '산정만기 상한 — 주담대', unit: '개월',
        hint: '★ 이 값이 없으면 한도가 과대계상됩니다', group: 'DSR 산정만기' },
      { path: 'dsrMaturityCapMonths.신용대출', type: 'int', label: '산정만기 상한 — 신용대출', unit: '개월', group: 'DSR 산정만기' },
      { path: 'dsrMaturityCapMonths.기타담보', type: 'int', label: '산정만기 상한 — 기타담보', unit: '개월', group: 'DSR 산정만기' },
      { path: 'existingDebtRules.default.maturityMonths', type: 'int', label: '기존부채 산정만기 — 기본', unit: '개월', group: '기존부채' },
      { path: 'existingDebtRules.주택담보대출.maturityMonths', type: 'int', label: '기존부채 산정만기 — 주담대', unit: '개월', group: '기존부채' },
    ];

    case 'stress': return [
      { path: 'currentStage', type: 'text', label: '현재 시행 단계', hint: '예) 3단계' },
      { path: 'baseAddOn', type: 'pct', label: '기본 가산폭', hint: '★ 없으면 DSR 한도가 과대계상됩니다' },
      { path: 'floor', type: 'pct', label: '하한' },
      { path: 'ceiling', type: 'pct', label: '상한' },
      { path: 'byRegion.수도권', type: 'pct', label: '수도권 적용비율', group: '지역별' },
      { path: 'byRegion.비수도권', type: 'pct', label: '비수도권 적용비율', group: '지역별' },
      { path: 'byRateType.변동', type: 'pct', label: '변동금리 적용비율', group: '금리유형별' },
      { path: 'byRateType.혼합', type: 'pct', label: '혼합형 적용비율', group: '금리유형별' },
      { path: 'byRateType.주기형', type: 'pct', label: '주기형 적용비율', group: '금리유형별' },
    ];

    case 'bangongje': return (doc.regions ?? []).flatMap((r, i) => [
      { path: `regions[${i}].최우선변제금`, type: 'money', label: `${r.key} — 최우선변제금`,
        hint: r.note || '★ 보증금 기준액이 아닙니다. 차감되는 금액입니다.' },
      { path: `regions[${i}].보증금기준`, type: 'money', label: `${r.key} — 보증금 기준액`,
        hint: '소액임차인 판단 기준. 차감액과 다른 수치입니다.', group: '보증금 기준액' },
    ]);

    case 'mci': return [
      { path: 'MCI.세대당건수', type: 'int', label: 'MCI 세대당 건수', unit: '건' },
      { path: 'MCI.한도', type: 'money', label: 'MCI 한도' },
      { path: 'MCG.세대당건수', type: 'int', label: 'MCG 세대당 건수', unit: '건', group: 'MCG' },
      { path: 'MCG.한도', type: 'money', label: 'MCG 한도', group: 'MCG' },
    ];

    case 'bunyangjeonhwan': return [
      { path: '잔금유예.이자.연이자율', type: 'pct', label: '잔금유예 연이자율',
        hint: '★ 상담일지에 이자율이 적혀 있지 않습니다. 사업시행자에게 확인해 넣으십시오.' },
      { path: '잔금유예.만기년', type: 'int', label: '잔금유예 만기', unit: '년' },
      { path: '분할납부.총액상한', type: 'money', label: '분할납부 총액 상한' },
    ];

    default: return [];
  }
}

function whenText(when) {
  if (!when) return '';
  return Object.entries(when)
    .map(([k, v]) => `${k}=${v === true ? '예' : v === false ? '아니오' : v}`)
    .join(' · ');
}

const TITLES = {
  ltv: 'LTV', dsr: 'DSR · DTI', stress: '스트레스 금리',
  bangongje: '방공제(소액임차보증금)', mci: 'MCI · MCG',
  regions: '규제지역', bunyangjeonhwan: '분양전환',
};

/**
 * @param {object} p
 * @param {object} p.policies       현재 적용 중인 정책 문서들
 * @param {Function} p.onSave       (overrides) => void  — 저장 후 재로딩은 호출부가 한다
 */
export function openPolicyEditor({ policies, onSave, onCancel = () => {} }) {
  const overrides = loadOverrides();
  // 편집 중 사본. 저장을 눌러야 반영된다.
  const draft = structuredClone(overrides.policies ?? {});
  const keys = Object.keys(policies ?? {}).filter((k) => fieldsFor(k, policies[k]).length > 0);
  let active = keys[0] ?? null;

  const dlg = el('dialog.editor.policy', { 'aria-label': '규제 수치 입력' });
  const body = el('div.editor-body');
  const foot = el('div.editor-foot');

  const entry = (k) => (draft[k] ??= { values: {}, meta: {} });
  const valueOf = (k, path) => {
    const v = draft[k]?.values?.[path];
    return v !== undefined ? v : getPath(policies[k], path);
  };
  // 글자·숫자 입력은 다시 그리지 않는다(포커스·한글 조합이 날아간다).
  const setQuiet = (k, path, v) => {
    entry(k).values[path] = v;
    refreshCount();
  };

  let countBox = null;
  function refreshCount() {
    if (!countBox) return;
    const n = countOverrides({ policies: draft });
    const 남은 = keys.reduce((s, k) =>
      s + fieldsFor(k, policies[k]).filter((f) => valueOf(k, f.path) == null).length, 0);
    countBox.textContent = `입력 ${n}칸 · 아직 빈 칸 ${남은}개`;
  }

  function draw() {
    replace(body, [
      el('h2', { text: '규제 수치 입력' }),
      el('p.tiny.faint', { style: 'margin:2px 0 12px', text:
        '원문에서 확인한 값을 넣으십시오. 설정 파일은 고치지 않고 이 브라우저에만 저장됩니다. '
        + '「내보내기」로 동료 PC에 옮길 수 있습니다.' }),

      el('div.tabs', {}, keys.map((k) => el(k === active ? 'button.tab.on' : 'button.tab', {
        type: 'button',
        text: `${TITLES[k] ?? k}${빈칸수(k) ? ` (${빈칸수(k)})` : ' ✓'}`,
        onClick: () => { active = k; draw(); },
      }))),

      active ? section(active) : null,
    ].filter(Boolean));

    replace(foot, [
      el('div.err', { id: 'policy-err' }),
      (countBox = el('span.tiny.faint')),
      el('div.spacer'),
      el('button.btn', { type: 'button', text: '내보내기', onClick: exportFile }),
      el('label.btn', {}, ['가져오기', el('input', {
        type: 'file', accept: '.json,application/json', class: 'sr-only',
        onChange: importFile,
      })]),
      el('button.btn', { type: 'button', text: '전체 지우기', onClick: wipe }),
      el('div.spacer'),
      el('button.btn', { type: 'button', text: '닫기', onClick: () => { dlg.close(); onCancel(); } }),
      el('button.btn.primary', { type: 'button', text: '저장', onClick: save }),
    ]);
    refreshCount();
  }

  function 빈칸수(k) {
    return fieldsFor(k, policies[k]).filter((f) => valueOf(k, f.path) == null).length;
  }

  function section(k) {
    const doc = policies[k];
    const fields = fieldsFor(k, doc);
    const groups = new Map();
    for (const f of fields) {
      const g = f.group ?? '기본';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(f);
    }

    const need = doc?._확인필요 ?? [];
    const m = draft[k]?.meta ?? {};

    return el('div.policy-section', {}, [
      need.length
        ? el('div.callout', { style: 'margin-bottom:10px' }, [
            el('b', { text: '원문에서 확인할 것' }),
            el('ul.tiny', {}, need.map((x) => el('li', { text: x }))),
          ])
        : null,

      ...[...groups].map(([g, fs]) => el('div', {}, [
        g !== '기본' ? el('h3.sec', { text: g }) : null,
        ...fs.map((f) => fieldFor(k, f)),
      ].filter(Boolean))),

      el('h3.sec', { text: '출처' }),
      textField('출처', m.출처 ?? doc?.meta?.출처 ?? '', (v) => { entry(k).meta.출처 = v; }, {
        placeholder: '예) 금융위원회 2026-09-19 보도자료',
      }),
      textField('출처 URL', m.출처URL ?? doc?.meta?.출처URL ?? '', (v) => { entry(k).meta.출처URL = v; }),
      el('label.check', {}, [
        el('input', {
          type: 'checkbox', checked: Boolean(m.verified),
          onChange: (e) => {
            entry(k).meta.verified = e.target.checked;
            entry(k).meta.확인일 = e.target.checked ? today() : null;
          },
        }),
        ' 원문에서 직접 확인했습니다',
      ]),
      el('p.tiny.faint', { text:
        '체크해야 「미검증」 경고가 사라집니다. 값을 넣은 것만으로는 확인이 아닙니다.' }),
    ].filter(Boolean));
  }

  function fieldFor(k, f) {
    const cur = valueOf(k, f.path);
    const opts = { hint: f.hint, unit: f.unit };
    const set = (v) => setQuiet(k, f.path, v);
    const 원본 = getPath(policies[k], f.path);
    const chip = 원본 != null && draft[k]?.values?.[f.path] === undefined
      ? el('span.chip.auto', { text: '파일값', title: '설정 파일에 들어 있는 값입니다' })
      : null;

    if (f.type === 'pct') return pctField(f.label, cur, (v) => set(v || null), { ...opts, chip });
    if (f.type === 'money') return moneyField(f.label, cur ?? 0, (v) => set(v || null), { ...opts, chip });
    if (f.type === 'int') return intField(f.label, cur, (v) => set(v), { ...opts, chip });
    return textField(f.label, cur ?? '', (v) => set(v || null), { ...opts, chip });
  }

  function save() {
    const saved = saveOverrides({ ...overrides, policies: draft });
    if (!saved) {
      showErr('이 브라우저에 저장할 수 없습니다(사생활 보호 모드 등). '
        + '「내보내기」로 파일에 저장한 뒤 다음에 「가져오기」 하십시오.');
      return;
    }
    dlg.close();
    onSave(saved);
  }

  function wipe() {
    if (!confirm('입력한 규제 수치를 전부 지웁니다. 설정 파일의 기본값으로 돌아갑니다. 계속할까요?')) return;
    clearOverrides();
    dlg.close();
    onSave(emptyOverrides());
  }

  function exportFile() {
    const blob = new Blob([toFile({ ...overrides, policies: draft })], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `jl-규제수치-${today()}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  async function importFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const o = fromFile(await file.text());
      Object.assign(draft, o.policies ?? {});
      draw();
    } catch (err) {
      showErr(`가져오지 못했습니다: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  }

  function showErr(msg) {
    const box = foot.querySelector('#policy-err');
    if (box) { replace(box, [el('div', { text: '· ' + msg })]); box.scrollIntoView({ block: 'nearest' }); }
  }

  draw();
  dlg.append(body, foot);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return dlg;
}
