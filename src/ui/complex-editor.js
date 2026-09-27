/**
 * 단지 만들기 / 수정 화면.
 *
 * 입주자모집공고를 보면서 **보이는 대로 치면** 되도록 배치한다.
 * 중도금 회차 날짜를 여섯 번 찍게 하지 않고 "1회차 날짜 + 간격"으로 받는다.
 * 비율 합계는 입력하는 동안 계속 보여 준다 — 100%가 안 맞는 게 제일 흔한 실수다.
 */

import { el, field, select, segmented } from './dom.js';
import { moneyField, pctField, intField, textField, dateField, selectField, segField } from './fields.js';
import { emptyForm, buildComplexDoc, docToForm, ratioCheck, expandRounds } from '../core/complex-builder.js';
import { validateComplex, ValidationError } from '../data/validate.js';
import { regionKeys } from '../core/bangongje.js';
import { formatKRW } from '../core/money.js';
import { OPTIONS } from '../state/defaults.js';

/**
 * @param {object} p
 * @param {object|null} p.doc      수정할 단지(없으면 새로 만들기)
 * @param {object} p.policies      방공제 지역 목록을 얻기 위해
 * @param {Function} p.onSave      (doc) => void
 * @param {Function} p.onCancel
 */
export function openComplexEditor({ doc = null, policies, onSave, onCancel = () => {} }) {
  let form = doc ? docToForm(doc) : emptyForm();

  const dlg = el('dialog.editor');
  const body = el('div.body');
  const foot = el('footer');

  const set = (k, v) => { form[k] = v; draw(); };
  const setType = (i, k, v) => {
    form.types = form.types.map((t, j) => (j === i ? { ...t, [k]: v } : t));
    draw();
  };

  function draw() {
    const rc = ratioCheck(form);
    const bgKeys = regionKeys(policies?.bangongje);
    const rounds = expandRounds(form);

    body.replaceChildren(
      el('h2', { text: doc ? '단지 수정' : '단지 만들기' }),
      el('p.tiny.faint', { style: 'margin:2px 0 14px', text:
        '입주자모집공고를 보면서 그대로 입력하십시오. 이 기기에만 저장되며 인터넷에 올라가지 않습니다.' }),

      sec('단지'),
      textField('단지명', form.name, (v) => set('name', v), { placeholder: '예) 양주 백석 모아엘가 그랑데' }),
      el('div.field', {}, [
        el('label', { text: '소재지' }),
        el('div.control', {}, [
          el('input', { value: form.sido, placeholder: '시·도', onInput: (e) => { form.sido = e.target.value; } }),
          el('input', { value: form.sigungu, placeholder: '시·군·구', onInput: (e) => { form.sigungu = e.target.value; } }),
        ]),
      ]),
      segField('규제지역', OPTIONS.regionGrade, form.regionGrade, (v) => set('regionGrade', v)),
      selectField('방공제 지역', bgKeys.length ? bgKeys : ['(설정 없음)'], form.bangongjeRegion,
        (v) => set('bangongjeRegion', v),
        { hint: '주택임대차보호법 시행령 구분. 모르면 담당자에게 확인하십시오 — 한도가 수천만원 달라집니다.' }),

      sec('입주'),
      textField('입주예정 / 지정기간 개시', form.moveInStart, (v) => set('moveInStart', v), {
        placeholder: '2028-06-01 또는 2028-06', hint: '연월만 써도 됩니다',
      }),
      textField('입주지정기간 종료', form.moveInEnd, (v) => set('moveInEnd', v), {
        placeholder: '2028-08-31 (비워도 됨)',
      }),

      sec('타입별 분양가'),
      ...form.types.map((t, i) => el('div.type-row', {}, [
        el('div.type-head', {}, [
          el('b', { text: `타입 ${i + 1}` }),
          form.types.length > 1
            ? el('button.x', { type: 'button', text: '×', title: '삭제',
                onClick: () => { form.types = form.types.filter((_, j) => j !== i); draw(); } })
            : null,
        ].filter(Boolean)),
        el('div.control', {}, [
          el('input', { value: t.typeId ?? '', placeholder: '84A', onInput: (e) => setTypeQuiet(i, 'typeId', e.target.value) }),
          el('input', { type: 'number', step: '0.01', value: t.areaSqm ?? '', placeholder: '전용㎡',
            onInput: (e) => setTypeQuiet(i, 'areaSqm', e.target.value === '' ? null : Number(e.target.value)) }),
        ]),
        moneyField('분양가', t.price, (v) => setType(i, 'price', v)),
        moneyField('발코니확장', t.expansion, (v) => setType(i, 'expansion', v), { placeholder: '0' }),
        moneyField('옵션', t.option, (v) => setType(i, 'option', v), { placeholder: '0' }),
      ])),
      el('button.btn.sm', { type: 'button', text: '+ 타입 추가',
        onClick: () => { form.types = [...form.types, { typeId: '', areaSqm: null, price: 0, expansion: 0, option: 0 }]; draw(); } }),

      sec('납부 일정'),
      el('div.callout', { class: rc.ok ? 'ok' : 'warn', style: 'margin-bottom:10px' }, [
        el('b', { text: rc.message }),
        !rc.ok ? el('div.tiny', { text: '계약금 + 중도금 전 회차 + 잔금 = 100% 가 되어야 합니다.' }) : null,
      ].filter(Boolean)),
      pctField('계약금 비율', form.contractRatio, (v) => set('contractRatio', v), { digits: 1 }),
      dateField('계약일', form.contractDate, (v) => set('contractDate', v)),
      intField('중도금 회차수', form.roundCount, (v) => set('roundCount', v ?? 0), { unit: '회' }),
      pctField('회차당 비율', form.roundRatio, (v) => set('roundRatio', v), { digits: 1 }),
      dateField('중도금 1회차일', form.firstRoundDate, (v) => set('firstRoundDate', v)),
      intField('회차 간격', form.roundIntervalMonths, (v) => set('roundIntervalMonths', v ?? 0), {
        unit: '개월', hint: '보통 4개월. 나머지 회차 날짜가 자동으로 잡힙니다.',
      }),
      rounds.length && rounds[0].date
        ? el('p.tiny.faint', { text: `→ ${rounds.map((r) => r.date).join(' · ')}` })
        : null,
      pctField('잔금 비율', form.balanceRatio, (v) => set('balanceRatio', v), { digits: 1,
        hint: '잔금일은 입주지정기간 개시일로 자동 처리됩니다' }),

      sec('중도금대출'),
      pctField('대출 비율', form.jungdogeumRatio, (v) => set('jungdogeumRatio', v), { digits: 1 }),
      pctField('금리', form.jungdogeumRate, (v) => set('jungdogeumRate', v)),
      segField('이자방식', OPTIONS.interestMode, form.interestMode, (v) => set('interestMode', v)),
      textField('취급은행', form.jungdogeumBank, (v) => set('jungdogeumBank', v), { placeholder: '(선택)' }),

      sec('부대비용'),
      pctField('취득세율', form.acquisitionTaxRate, (v) => set('acquisitionTaxRate', v), { digits: 2 }),
      moneyField('법무·중개비', form.legalFee, (v) => set('legalFee', v)),
      moneyField('선수관리비', form.prepaidMgmt, (v) => set('prepaidMgmt', v)),

      sec('기록'),
      textField('출처', form.sourceDoc, (v) => set('sourceDoc', v), {
        placeholder: '입주자모집공고문(2026.3.5)', hint: '나중에 값이 의심스러울 때 되짚을 단서입니다',
      }),
      textField('작성자', form.author, (v) => set('author', v)),
    );

    foot.replaceChildren(
      el('div.err', { id: 'editor-err' }),
      el('button.btn', { type: 'button', text: '취소', onClick: () => { dlg.close(); onCancel(); } }),
      el('button.btn.primary', { type: 'button', text: '저장', onClick: trySave }),
    );
  }

  // 타입의 텍스트/숫자 입력은 다시 그리면 커서가 튀므로 값만 바꾼다
  function setTypeQuiet(i, k, v) {
    form.types = form.types.map((t, j) => (j === i ? { ...t, [k]: v } : t));
  }

  function trySave() {
    const built = buildComplexDoc(form);
    if (doc?.complexId) built.complexId = doc.complexId;   // 수정이면 id 유지

    try {
      validateComplex(built, form.name || '새 단지', {
        bangongjeKeys: regionKeys(policies?.bangongje),
        regionGrades: policies?.regions?.grades ?? ['투기과열', '조정대상', '비규제'],
      });
    } catch (e) {
      const box = foot.querySelector('#editor-err');
      const msgs = e instanceof ValidationError ? e.problems : [e.message];
      box.replaceChildren(...msgs.map((m) => el('div', { text: '· ' + m })));
      box.scrollIntoView({ block: 'nearest' });
      return;
    }

    dlg.close();
    onSave(built);
  }

  function sec(title) {
    return el('h3.sec', { text: title });
  }

  draw();
  dlg.append(body, foot);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return dlg;
}
