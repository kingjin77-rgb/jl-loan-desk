/**
 * 설정·단지 데이터 검증.
 *
 * 라이브러리 없이 손으로 쓴다. 검사하는 것은 **구조**이지 값이 아니다 —
 * 값을 검사하면 규제 수치가 바뀔 때마다 검증이 깨진다.
 *
 * 에러 메시지는 개발자가 아니라 **법무법인 직원이 읽는다**. 한국어로,
 * 어느 파일 어느 필드가 왜 잘못됐고 어떻게 고치는지까지 적는다.
 */

import { isValidISO, expandYearMonth } from '../core/dates.js';

export class ValidationError extends Error {
  constructor(file, problems) {
    super(`${file} 검증 실패:\n` + problems.map((p) => `  · ${p}`).join('\n'));
    this.name = 'ValidationError';
    this.file = file;
    this.problems = problems;
  }
}

/** 모든 설정·단지 파일이 공통으로 가져야 하는 meta. */
export function validateMeta(doc, file) {
  const p = [];
  const m = doc?.meta;
  if (!m) {
    p.push('meta 블록이 없습니다. 모든 설정 파일에는 기준일·출처·verified 가 들어가야 합니다.');
    return p;
  }
  if (!m.기준일) p.push('meta.기준일 이 없습니다 (예: "2026-09-19").');
  else if (!isValidISO(m.기준일)) p.push(`meta.기준일 "${m.기준일}" 이 YYYY-MM-DD 형식이 아닙니다.`);
  if (m.출처 == null) p.push('meta.출처 가 없습니다. 값을 확인한 문서명을 적으십시오(미확인이면 빈 문자열이라도 두십시오).');
  if (typeof m.verified !== 'boolean') p.push('meta.verified 가 true/false 가 아닙니다. 검수 전이면 false 로 두십시오.');
  return p;
}

/** 정책 설정 파일. 구조만 본다. */
export function validatePolicy(doc, file) {
  const p = validateMeta(doc, file);
  if (p.length) throw new ValidationError(file, p);
  return doc;
}

/**
 * 단지 JSON. 상담사가 손으로 만드는 파일이므로 가장 꼼꼼히 본다.
 * @param {object} doc
 * @param {string} file
 * @param {object} ctx { bangongjeKeys: string[], regionGrades: string[] }
 */
export function validateComplex(doc, file, ctx = {}) {
  const p = validateMeta(doc, file);

  if (!doc?.complexId) p.push('complexId 가 없습니다.');
  if (!doc?.name) p.push('name(단지명)이 없습니다.');

  // ── 소재지
  const loc = doc?.location;
  if (!loc) {
    p.push('location 블록이 없습니다.');
  } else {
    const grades = ctx.regionGrades?.length ? ctx.regionGrades : ['투기과열', '조정대상', '비규제'];
    if (!grades.includes(loc.regionGrade)) {
      p.push(`location.regionGrade "${loc.regionGrade ?? '(비어 있음)'}" 은(는) 쓸 수 없습니다. 가능한 값: ${grades.join(' / ')}`);
    }
    if (ctx.bangongjeKeys?.length && !ctx.bangongjeKeys.includes(loc.bangongjeRegion)) {
      p.push(
        `location.bangongjeRegion "${loc.bangongjeRegion ?? '(비어 있음)'}" 을(를) 방공제 설정에서 찾을 수 없습니다. ` +
        `가능한 값: ${ctx.bangongjeKeys.join(' / ')}`
      );
    }
  }

  // ── 입주시기
  const mi = doc?.moveIn;
  if (!mi) {
    p.push('moveIn 블록이 없습니다. 입주시기가 없으면 중도금→잔금 계산을 할 수 없습니다.');
  } else {
    const start = expandYearMonth(mi.입주지정기간?.start ?? mi.예정시기);
    if (!start) p.push('moveIn.입주지정기간.start 또는 moveIn.예정시기 중 하나는 있어야 합니다 (예: "2028-06-01" 또는 "2028-06").');
    const end = mi.입주지정기간?.end;
    if (end && !isValidISO(end)) p.push(`moveIn.입주지정기간.end "${end}" 가 YYYY-MM-DD 형식이 아닙니다.`);
    if (start && end && isValidISO(end) && end < start) p.push('입주지정기간의 end 가 start 보다 앞섭니다.');
  }

  // ── 타입·분양가
  if (!Array.isArray(doc?.unitTypes) || !doc.unitTypes.length) {
    p.push('unitTypes 가 비어 있습니다. 최소 한 개 타입의 분양가가 필요합니다.');
  } else {
    doc.unitTypes.forEach((t, i) => {
      const where = `unitTypes[${i}]${t.typeId ? `(${t.typeId})` : ''}`;
      if (!t.typeId) p.push(`${where}: typeId 가 없습니다.`);
      if (!Array.isArray(t.priceByFloor) || !t.priceByFloor.length) {
        p.push(`${where}: priceByFloor 가 비어 있습니다.`);
      } else {
        t.priceByFloor.forEach((f, j) => {
          if (!(Number(f.분양가) > 0)) p.push(`${where}.priceByFloor[${j}](${f.floorBand ?? '?'}): 분양가가 0 이거나 비어 있습니다.`);
        });
      }
    });
  }

  // ── 납부 일정 (가장 사고가 잦은 곳)
  const ps = doc?.paymentSchedule;
  if (!ps) {
    p.push('paymentSchedule 이 없습니다.');
  } else {
    const 계약 = Number(ps.계약금?.ratio) || 0;
    const splits = ps.계약금?.분납 ?? [];
    if (splits.length) {
      const sum = splits.reduce((s, x) => s + (Number(x.ratio) || 0), 0);
      if (Math.abs(sum - 계약) > 0.001) {
        p.push(`계약금 분납 비율 합계 ${pct(sum)} 가 계약금 비율 ${pct(계약)} 와 다릅니다.`);
      }
    }

    const 중 = ps.중도금;
    let 중합 = 0;
    if (중) {
      const rounds = 중.rounds ?? [];
      if (중.회차수 != null && rounds.length && 중.회차수 !== rounds.length) {
        p.push(`중도금 회차수(${중.회차수})와 rounds 배열 길이(${rounds.length})가 다릅니다.`);
      }
      rounds.forEach((r, i) => {
        if (r.date && !isValidISO(r.date)) p.push(`중도금 ${i + 1}회차 날짜 "${r.date}" 가 YYYY-MM-DD 형식이 아닙니다.`);
        중합 += Number(r.ratio) || 0;
      });
      if (!rounds.length) 중합 = (Number(중.ratioPerRound) || 0) * (Number(중.회차수) || 0);

      // 회차 날짜가 순서대로인지
      const dated = rounds.filter((r) => r.date);
      for (let i = 1; i < dated.length; i++) {
        if (dated[i].date < dated[i - 1].date) {
          p.push(`중도금 회차 날짜 순서가 뒤집혀 있습니다: ${dated[i - 1].date} 다음에 ${dated[i].date}`);
          break;
        }
      }
    }

    const 잔 = Number(ps.잔금?.ratio) || 0;
    const total = 계약 + 중합 + 잔;
    if (Math.abs(total - 1) > 0.001) {
      p.push(
        `납부 비율 합계가 ${pct(total)} 입니다 (100% 가 되어야 합니다). ` +
        `계약금 ${pct(계약)} + 중도금 ${pct(중합)} + 잔금 ${pct(잔)}`
      );
    }
  }

  if (p.length) throw new ValidationError(file, p);
  return doc;
}

function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * 설정 세트 전체에서 "값이 비어 있어 계산을 신뢰할 수 없는" 항목을 모은다.
 * 화면 경고 배너의 재료.
 */
export function collectUnsetValues(policies) {
  const issues = [];

  const push = (file, path, why) => issues.push({ file, path, why });

  const ltv = policies.ltv;
  if (ltv) {
    const nulls = (ltv.rules || []).filter((r) => r.ltv == null);
    if (nulls.length) push(ltv.meta?.id ?? 'ltv', 'rules[].ltv', `${nulls.length}개 규칙의 LTV 비율이 비어 있습니다`);
  }

  const dsr = policies.dsr;
  if (dsr) {
    if (dsr.limits?.은행권 == null) push(dsr.meta?.id ?? 'dsr', 'limits.은행권', 'DSR 한도율이 비어 있습니다');
    if (dsr.dsrMaturityCapMonths?.['주택담보대출'] == null) {
      push(dsr.meta?.id ?? 'dsr', 'dsrMaturityCapMonths.주택담보대출', 'DSR 산정만기 상한이 비어 있습니다 — 한도가 과대계상됩니다');
    }
  }

  const st = policies.stress;
  if (st && st.baseAddOn == null && st.byRegion?.수도권 == null) {
    push(st.meta?.id ?? 'stress', 'baseAddOn', '스트레스 가산폭이 비어 있습니다 — DSR 한도가 과대계상됩니다');
  }

  const bg = policies.bangongje;
  if (bg) {
    const nulls = (bg.regions || []).filter((r) => r.최우선변제금 == null);
    if (nulls.length) push(bg.meta?.id ?? 'bangongje', 'regions[].최우선변제금', `${nulls.length}개 지역의 최우선변제금이 비어 있습니다`);
  }

  return issues;
}

/** 미검증·데모 설정 목록. 배너에 그대로 쓴다. */
export function collectTrustFlags(policies) {
  const out = { demo: [], example: [], unverified: [], oldest: null };
  for (const [key, doc] of Object.entries(policies)) {
    if (!doc?.meta) continue;
    if (doc.meta.demo) out.demo.push(doc.meta.id);
    // 예시는 데모와 다르다: 실무에서 은행 주담대 설명용으로 쓰이는 값이며 결과에 「예시」가 붙는다.
    else if (doc.meta.example) out.example.push(key);
    else if (!doc.meta.verified) out.unverified.push(doc.meta.id);
    if (doc.meta.기준일 && (!out.oldest || doc.meta.기준일 < out.oldest)) out.oldest = doc.meta.기준일;
  }
  return out;
}
