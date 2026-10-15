/**
 * 고객용 안내장 — 문자 속 링크로 여는 페이지.
 *
 * 주소의 # 뒤에 담긴 상담 값을 읽어, 상담사 화면과 **같은** 「분양전환 상담일지」 앞·뒷면을
 * 읽기 전용으로 그린다. # 뒤는 서버로 가지 않으므로 값이 호스팅 기록에 남지 않는다.
 * 이 페이지는 아무것도 저장하지 않는다.
 */
import { loadAll } from './data/loader.js';
import { el, replace } from './ui/dom.js';
import { decodeNotice, formCalc } from './core/sangdamilji.js';
import { renderForm } from './ui/sangdamilji.js';

async function main() {
  const root = document.getElementById('notice');
  try {
    const { values, 동, 호, 날짜 } = decodeNotice(location.hash.slice(1));
    const ctx = await loadAll();
    const form = ctx.policies.sangdamilji;
    const rules = ctx.policies.bunyangjeonhwan ?? {};
    const who = { 동, 호, 날짜 };
    if (동) document.title = `${동}동 ${호}호 분양전환 상담일지 — 법무법인 제이엘`;
    replace(root, [
      el('div.notice-bar', {}, [
        el('b', { text: '법무법인 제이엘' }),
        el('button', { type: 'button', text: '인쇄 · PDF 저장', onClick: () => window.print() }),
      ]),
      renderForm({ form, values, calc: formCalc(values, form, rules, who), who, editable: false }),
      el('p.notice-foot', { text: '본 상담일지는 상담 가이드입니다. 정확한 한도·금리·조건은 취급기관 및 상담사 확인이 필요합니다.' }),
    ]);
  } catch (e) {
    replace(root, [el('div', { style: 'padding:32px;max-width:560px;margin:0 auto' }, [
      el('h1', { text: '상담일지를 열 수 없습니다' }),
      el('p', { text: '문자로 받은 주소가 잘렸을 수 있습니다. 주소 전체를 눌러 다시 열어 주십시오.' }),
      el('p', { style: 'color:#8A9199;font-size:13px', text: String(e.message) }),
    ])]);
  }
}

main();
