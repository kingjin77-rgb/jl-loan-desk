/**
 * 단지 만들기 / 수정 화면.
 *
 * 입주자모집공고를 보면서 **보이는 대로 치면** 되도록 배치한다.
 * 중도금 회차 날짜를 여섯 번 찍게 하지 않고 "1회차 날짜 + 간격"으로 받는다.
 * 비율 합계는 입력하는 동안 계속 보여 준다 — 100%가 안 맞는 게 제일 흔한 실수다.
 */

import { el, field, select, segmented, replace } from './dom.js';
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

  // 다시 그리면 입력칸이 새 노드로 바뀌어 포커스·커서·한글 조합이 날아간다.
  //  set      : 구조가 바뀌는 것(세그먼트·셀렉트·타입 추가/삭제) → 다시 그린다
  //  setQuiet : 글자·숫자 입력 → 값만 저장하고, 파생 표시만 직접 갱신한다
  const set = (k, v) => { form[k] = v; draw(); };
  const setQuiet = (k, v) => { form[k] = v; refreshDerived(); };
  const setType = (i, k, v) => {
    form.types = form.types.map((t, j) => (j === i ? { ...t, [k]: v } : t));
    refreshDerived();
  };

  // 입력하는 동안 갱신해야 하는 것: 비율 합계, 회차 날짜 미리보기
  let ratioBox = null;
  let roundsBox = null;
  function refreshDerived() {
    if (ratioBox) {
      const rc = ratioCheck(form);
      ratioBox.className = `callout ${rc.ok ? 'ok' : 'warn'}`;
      // ★ replaceChildren(null) 은 문자열 "null" 을 그대로 넣는다.
      //   화면에 "합계 100% ✓null" 이 찍혀 있었다. replace() 는 null 을 걸러 낸다.
      replace(ratioBox, [
        el('b', { text: rc.message }),
        rc.ok ? null : el('div.tiny', { text: '계약금 + 중도금 전 회차 + 잔금 = 100% 가 되어야 합니다.' }),
      ]);
    }
    if (roundsBox) {
      const rs = expandRounds(form);
      roundsBox.textContent = rs.length && rs[0].date ? `→ ${rs.map((r) => r.date).join(' · ')}` : '';
    }
  }

  function draw() {
    const rc = ratioCheck(form);
    const bgKeys = regionKeys(policies?.bangongje);
    const rounds = expandRounds(form);

    replace(body, [
      el('h2', { text: doc ? '단지 수정' : '단지 만들기' }),
      el('p.tiny.faint', { style: 'margin:2px 0 14px', text:
        '입주자모집공고를 보면서 그대로 입력하십시오. 이 기기에만 저장되며 인터넷에 올라가지 않습니다.' }),

      sec('단지'),
      textField('단지명', form.name, (v) => setQuiet('name', v), {
        placeholder: '예) 양주 백석 모아엘가 그랑데', chip: requiredChip(),
      }),
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
      textField('입주예정 / 지정기간 개시', form.moveInStart, (v) => setQuiet('moveInStart', v), {
        placeholder: '2028-06-01 또는 2028-06', hint: '연월만 써도 됩니다', chip: requiredChip(),
      }),
      textField('입주지정기간 종료', form.moveInEnd, (v) => setQuiet('moveInEnd', v), {
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
        moneyField('분양가', t.price, (v) => setType(i, 'price', v), { chip: requiredChip() }),
        moneyField('발코니확장', t.expansion, (v) => setType(i, 'expansion', v), { placeholder: '0' }),
        moneyField('옵션', t.option, (v) => setType(i, 'option', v), { placeholder: '0' }),
      ])),
      el('button.btn.sm', { type: 'button', text: '+ 타입 추가',
        onClick: () => { form.types = [...form.types, { typeId: '', areaSqm: null, price: 0, expansion: 0, option: 0 }]; draw(); } }),

      sec('납부 일정'),
      (ratioBox = el('div.callout', { class: rc.ok ? 'ok' : 'warn', style: 'margin-bottom:10px' }, [
        el('b', { text: rc.message }),
        !rc.ok ? el('div.tiny', { text: '계약금 + 중도금 전 회차 + 잔금 = 100% 가 되어야 합니다.' }) : null,
      ].filter(Boolean))),
      pctField('계약금 비율', form.contractRatio, (v) => setQuiet('contractRatio', v), { digits: 1 }),
      dateField('계약일', form.contractDate, (v) => setQuiet('contractDate', v)),
      intField('중도금 회차수', form.roundCount, (v) => setQuiet('roundCount', v ?? 0), { unit: '회' }),
      pctField('회차당 비율', form.roundRatio, (v) => setQuiet('roundRatio', v), { digits: 1 }),
      dateField('중도금 1회차일', form.firstRoundDate, (v) => setQuiet('firstRoundDate', v)),
      intField('회차 간격', form.roundIntervalMonths, (v) => setQuiet('roundIntervalMonths', v ?? 0), {
        unit: '개월', hint: '보통 4개월. 나머지 회차 날짜가 자동으로 잡힙니다.',
      }),
      (roundsBox = el('p.tiny.faint', {
        text: rounds.length && rounds[0].date ? `→ ${rounds.map((r) => r.date).join(' · ')}` : '',
      })),
      pctField('잔금 비율', form.balanceRatio, (v) => setQuiet('balanceRatio', v), { digits: 1,
        hint: '잔금일은 입주지정기간 개시일로 자동 처리됩니다' }),

      sec('중도금대출'),
      pctField('대출 비율', form.jungdogeumRatio, (v) => setQuiet('jungdogeumRatio', v), { digits: 1 }),
      pctField('금리', form.jungdogeumRate, (v) => setQuiet('jungdogeumRate', v)),
      segField('이자방식', OPTIONS.interestMode, form.interestMode, (v) => set('interestMode', v)),
      textField('취급은행', form.jungdogeumBank, (v) => setQuiet('jungdogeumBank', v), { placeholder: '(선택)' }),

      sec('부대비용'),
      pctField('취득세율', form.acquisitionTaxRate, (v) => setQuiet('acquisitionTaxRate', v), { digits: 2 }),
      moneyField('법무·중개비', form.legalFee, (v) => setQuiet('legalFee', v)),
      moneyField('선수관리비', form.prepaidMgmt, (v) => setQuiet('prepaidMgmt', v)),

      sec('기록'),
      textField('출처', form.sourceDoc, (v) => setQuiet('sourceDoc', v), {
        placeholder: '입주자모집공고문(2026.3.5)', hint: '나중에 값이 의심스러울 때 되짚을 단서입니다',
      }),
      textField('작성자', form.author, (v) => setQuiet('author', v)),
    ]);

    replace(foot, [
      el('div.err', { id: 'editor-err' }),
      el('button.btn', { type: 'button', text: '취소', onClick: () => { dlg.close(); onCancel(); } }),
      el('button.btn.primary', { type: 'button', text: '저장', onClick: trySave }),
    ]);
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
      replace(box, msgs.map((m) => el('div', { text: '· ' + humanize(m) })));
      box.scrollIntoView({ block: 'nearest' });
      return;
    }

    dlg.close();
    onSave(built);
  }

  function sec(title) {
    return el('h3.sec', { text: title });
  }

  function requiredChip() {
    return el('span.chip.req', { text: '필수', title: '이 칸이 비면 저장되지 않습니다' });
  }

  /**
   * 검증 메시지를 상담사 말로 바꾼다.
   *
   * validate.js 의 메시지는 JSON 을 손으로 쓰는 사람을 위한 것이라 경로가 그대로 나온다
   * ("moveIn.입주지정기간.start 또는 moveIn.예정시기 중 하나는 있어야 합니다").
   * 에디터에서 그걸 그대로 보여 주면 상담사가 어느 칸을 채워야 하는지 알 수 없다.
   * 아는 경로는 **화면의 칸 이름**으로 바꿔 준다. 모르는 메시지는 그대로 둔다
   * (틀린 안내보다 낯선 안내가 낫다).
   */
  function humanize(msg) {
    const MAP = [
      [/^moveIn 블록이 없습니다.*/, '「입주예정 / 지정기간 개시」를 입력하십시오. 입주시기가 없으면 중도금→잔금 계산을 할 수 없습니다.'],
      [/^moveIn\.입주지정기간\.start.*/, '「입주예정 / 지정기간 개시」를 입력하십시오 (예: 2028-06-01 또는 2028-06).'],
      [/^moveIn\.입주지정기간\.end "([^"]*)".*/, (m) => `「입주지정기간 종료」의 "${m[1]}" 형식이 맞지 않습니다 (예: 2028-08-31).`],
      [/^name\b.*/, '「단지명」을 입력하십시오.'],
      [/^types\b.*없습니다.*/, '타입을 하나 이상 넣고 「분양가」를 입력하십시오.'],
      [/^location\.regionGrade\b.*/, '「규제지역」을 고르십시오.'],
      [/^location\.bangongjeRegion\b.*/, '「방공제 지역」을 고르십시오.'],
    ];
    for (const [re, to] of MAP) {
      const m = msg.match(re);
      if (m) return typeof to === 'function' ? to(m) : to;
    }
    // 경로로 시작하는 낯선 메시지는 경로 부분만 떼어 읽기 쉽게 한다
    return msg;
  }

  draw();
  dlg.append(body, foot);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return dlg;
}
