/**
 * 방공제 (소액임차보증금 최우선변제금 차감).
 *
 * 은행은 담보 주택에 소액임차인이 들어올 경우 최우선변제될 금액만큼을 미리 빼고
 * 대출해 준다. 지역구분별 금액은 주택임대차보호법 시행령에 있고, 이 파일은
 * 그 금액을 **config 에서 받아 쓰기만 한다**. 숫자를 알지 못한다.
 *
 * MCI(모기지신용보험) 또는 MCG(모기지신용보증)에 가입하면 이 차감이 면제된다.
 * 대신 MCI 자체의 가입한도가 별도 상한으로 붙는다 — 그건 limit.js 에서 처리한다.
 */

import { won, formatKRW } from './money.js';
import { makeDeduction } from './cap.js';
import { CAP_IDS } from './cap.js';

/**
 * @param {object} p
 * @param {string} p.regionKey   config.regions[].key 와 일치해야 하는 지역구분
 * @param {number} [p.roomCount] 차감 건수. 아파트는 통상 1.
 * @param {boolean} [p.mci]      MCI 가입 여부
 * @param {boolean} [p.mcg]      MCG 가입 여부
 * @param {object} config        policy/bangongje.json
 * @returns {import('./cap.js')} Deduction
 */
export function bangongjeDeduction({ regionKey, roomCount = 1, mci = false, mcg = false }, config) {
  const source = sourceOf(config);
  const entry = (config?.regions || []).find((r) => r.key === regionKey);

  if (!entry) {
    // 지역을 모르면 0원으로 조용히 넘어가지 않는다. 0원 차감은 한도를 과대계상한다.
    throw new BangongjeRegionError(regionKey, (config?.regions || []).map((r) => r.key));
  }

  const per = entry.최우선변제금;
  if (per == null) {
    return makeDeduction({
      id: 'BANGONGJE',
      label: '방공제(소액임차보증금)',
      amount: 0,
      appliesTo: CAP_IDS.LTV,
      formula: `${regionKey}: 최우선변제금 값이 설정되지 않았습니다`,
      reason: '설정값 미입력 — 이 상태의 한도는 과대계상입니다',
      source,
    });
  }

  const rooms = Math.max(1, Math.round(roomCount) || 1);
  const gross = won(per * rooms);
  const waived = Boolean(mci || mcg);
  const waiver = mci ? 'MCI' : mcg ? 'MCG' : null;

  return makeDeduction({
    id: 'BANGONGJE',
    label: '방공제(소액임차보증금)',
    amount: gross,
    waived,
    appliesTo: CAP_IDS.LTV,
    formula: waived
      ? `${waiver} 가입으로 면제 (미가입 시 ${formatKRW(gross)} 차감)`
      : rooms > 1
        ? `${regionKey} ${formatKRW(per)} × ${rooms}건 = ${formatKRW(gross)}`
        : `${regionKey} ${formatKRW(per)}`,
    reason: waived ? `${waiver} 가입` : '',
    source,
  });
}

export class BangongjeRegionError extends Error {
  constructor(regionKey, known) {
    super(
      `방공제 지역구분 "${regionKey ?? '(비어 있음)'}" 을(를) 설정에서 찾을 수 없습니다. ` +
      `사용 가능한 값: ${known.length ? known.join(', ') : '(설정 없음)'}`
    );
    this.name = 'BangongjeRegionError';
    this.regionKey = regionKey;
    this.known = known;
  }
}

/** 화면 안내용: 이 지역의 소액임차인 보증금 기준액. */
export function regionInfo(regionKey, config) {
  return (config?.regions || []).find((r) => r.key === regionKey) || null;
}

export function regionKeys(config) {
  return (config?.regions || []).map((r) => r.key);
}

function sourceOf(config) {
  if (!config?.meta) return null;
  return { file: config.meta.id, 기준일: config.meta.기준일, verified: Boolean(config.meta.verified) };
}
