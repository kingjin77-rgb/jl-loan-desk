/**
 * 스트레스 DSR 금리.
 *
 * ★ 이 금리는 **DSR 한도 산정에만** 쓰인다. 고객이 실제로 내는 월 상환액 계산에는
 *   절대 쓰지 않는다. 두 금리가 섞이면 "한도는 맞는데 월 상환액이 과대"인,
 *   현장에서 제일 알아채기 어려운 오류가 난다.
 *
 * 그래서 반환 객체의 필드명을 `forDsrOnly` 로 못박았다. derive.js 는 이 필드를
 * amortize() 에 넘기지 않는다.
 */

import { formatPct } from './money.js';
import { usesExample } from './cap.js';

/**
 * @param {object} p
 * @param {number} p.contractRate  약정금리(연, 0.042)
 * @param {string} p.rateType      '변동'|'혼합'|'주기형'|'고정'
 * @param {string} [p.region]      '수도권'|'비수도권' — 지역 차등이 있는 경우
 * @param {string} [p.loanType]    '주택담보대출'|'신용대출' 등 (적용범위 판정)
 * @param {object} config          policy/stress.json
 */
export function stressedRate({ contractRate, rateType = '변동', region = '수도권', loanType = '주택담보대출' }, config) {
  const base = Number(contractRate) || 0;
  const source = sourceOf(config);
  // 가산폭·비율 중 이 계산이 읽는 칸이 예시로 메워졌을 때만 「예시」.
  source && (source.example = usesExample(config?.meta,
    'baseAddOn', 'floor', 'ceiling', 'currentStage', 'appliedRatio',
    `byRegion.${region}`, `ratioByRegion.${region}`, `byRateType.${rateType}`));

  const inScope = !config?.scope || config.scope.includes(loanType);
  if (!inScope) {
    return {
      forDsrOnly: base,
      addOn: 0,
      applied: false,
      explanation: `${loanType}은 스트레스 금리 적용 대상이 아닙니다`,
      source,
    };
  }

  // 기준 가산폭. 지역 차등이 있으면 지역값 우선.
  let addOn = config?.byRegion?.[region] ?? config?.baseAddOn;
  if (addOn == null) {
    return {
      forDsrOnly: base,
      addOn: 0,
      applied: false,
      unconfigured: true,
      explanation: '스트레스 가산폭이 설정되지 않았습니다 — 이 상태의 DSR 한도는 과대계상입니다',
      source,
    };
  }

  // 하한·상한
  const floor = config?.floor;
  const ceiling = config?.ceiling;
  let bounded = addOn;
  if (floor != null) bounded = Math.max(bounded, floor);
  if (ceiling != null) bounded = Math.min(bounded, ceiling);

  // 시행 단계별 적용비율 (1단계 25%, 2단계 50%, 3단계 100% 식).
  // ★ 지역별로 다른 비율이 정해져 있으면 그것이 우선한다.
  //   3단계 시행 후에도 지방 주담대는 2단계 수준(50%)이 유지되고 있다(2026년 하반기 기준).
  //   같은 3단계인데 지역마다 비율이 다르므로 stage 하나로는 표현이 안 된다.
  const stage = config?.currentStage;
  const stageRatio = config?.ratioByRegion?.[region]
    ?? (stage ? (config?.appliedRatio?.[stage] ?? 1) : 1);

  // 금리유형별 적용비율 (변동 100%, 혼합형 일부, 고정 0%)
  const typeRatio = config?.byRateType?.[rateType] ?? 1;

  const effective = bounded * stageRatio * typeRatio;

  return {
    forDsrOnly: base + effective,
    contractRate: base,
    addOn: effective,
    rawAddOn: addOn,
    boundedAddOn: bounded,
    stage,
    stageRatio,
    typeRatio,
    applied: effective > 0,
    explanation:
      `약정금리 ${formatPct(base)} + 스트레스 ${formatPct(effective)}` +
      ` (가산폭 ${formatPct(bounded)}` +
      (stage ? ` × ${stage} ${formatPct(stageRatio, 0)}` : '') +
      (typeRatio !== 1 ? ` × ${rateType} ${formatPct(typeRatio, 0)}` : '') +
      `) = ${formatPct(base + effective)}`,
    note: config?.note || '',
    source,
  };
}

function sourceOf(config) {
  if (!config?.meta) return null;
  return { file: config.meta.id, 기준일: config.meta.기준일, verified: Boolean(config.meta.verified), example: Boolean(config.meta.example) };
}
