/**
 * 상담기록 직렬화.
 *
 * ★ 입력만 저장하면 안 된다. 그 상담이 **어느 기준일의 규정으로** 계산됐는지
 *   함께 저장해야 나중에 같은 숫자를 재현할 수 있다. 규제가 바뀐 뒤 기록을 열면
 *   "이 상담은 ○○ 기준입니다. 지금 기준으로 다시 계산할까요?"를 물을 수 있어야 한다.
 */

export const RECORD_SCHEMA_VERSION = 1;

export function toRecord(input, result, ctx) {
  return {
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    recordId: input.recordId ?? cryptoId(),
    createdAt: null,
    updatedAt: null,

    consultant: input.consultation?.consultant ?? '',
    clientAlias: input.consultation?.clientAlias ?? '',
    consultedAt: input.consultation?.date ?? null,
    title: buildTitle(input, result),

    configVersions: {
      profile: ctx.profileName,
      policies: Object.fromEntries(
        Object.entries(ctx.policies).map(([k, v]) => [k, { id: v.meta?.id, 기준일: v.meta?.기준일, verified: Boolean(v.meta?.verified), demo: Boolean(v.meta?.demo) }])
      ),
      complex: input.schedule?.complexId
        ? { id: input.schedule.complexId, name: input.schedule.complexName }
        : null,
    },

    input: structuredClone(stripVolatile(input)),
    origins: ctx.origins ?? {},

    // 설정 파일이 사라져도 인쇄물을 재현할 수 있도록 결과 요약을 함께 남긴다.
    resultSnapshot: result ? {
      finalAmount: result.limit.finalAmount,
      binding: result.limit.binding?.label ?? null,
      bindingFormula: result.limit.binding?.formula ?? null,
      caps: result.limit.caps.map((c) => ({ label: c.label, amount: Number.isFinite(c.amount) ? c.amount : null, applicable: c.applicable })),
      monthlyPayment: result.payment.monthlyPayment ?? result.payment.firstPayment,
      totalInterest: result.payment.totalInterest,
      dsrRate: result.stress.forDsrOnly,
      contractRate: result.input.product.annualRate,
      shortfallAtMoveIn: result.janggeum?.shortfall ?? null,
      requiredAtMoveIn: result.janggeum?.requiredAtMoveIn ?? null,
      headline: result.headline,
    } : null,

    memo: input.consultation?.memo ?? '',
  };
}

export function fromRecord(record) {
  if (!record) throw new Error('상담기록이 비어 있습니다.');
  if (record.recordSchemaVersion > RECORD_SCHEMA_VERSION) {
    throw new Error(
      `이 상담기록은 더 최신 버전(${record.recordSchemaVersion})으로 저장되었습니다. ` +
      `프로그램을 새로고침한 뒤 다시 열어 보십시오.`
    );
  }
  return { input: record.input, origins: record.origins ?? {}, record };
}

/**
 * 저장 당시의 설정과 현재 설정이 다른지 판정. 다르면 화면에 배너를 띄운다.
 */
export function compareConfig(record, ctx) {
  const saved = record?.configVersions?.policies ?? {};
  const diffs = [];
  for (const [key, meta] of Object.entries(saved)) {
    const now = ctx.policies[key]?.meta;
    if (!now) { diffs.push(`${key}: 현재 설정에 없음`); continue; }
    if (now.기준일 !== meta.기준일) diffs.push(`${key}: ${meta.기준일} → ${now.기준일}`);
  }
  if (record?.configVersions?.profile && record.configVersions.profile !== ctx.profileName) {
    diffs.push(`설정 프로파일: ${record.configVersions.profile} → ${ctx.profileName}`);
  }
  return diffs;
}

function buildTitle(input, result) {
  const who = input.consultation?.clientAlias || '무명';
  const what = input.schedule?.complexName || '직접입력';
  return `${who} · ${what}`;
}

/** 저장할 필요 없는 파생·대용량 필드를 뺀다. */
function stripVolatile(input) {
  const out = { ...input };
  if (out.schedule) out.schedule = { ...out.schedule };
  return out;
}

function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
