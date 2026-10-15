/**
 * 상담 예약자 명단 — 현장 접수용.
 *
 * 현장 흐름:  예약(사전) → 현장 QR·대기표 → **상담사가 명단에서 예약 확인(체크)**
 *            → 상담일지 작성하며 상담 → 완료 후 문자 발송
 *
 * 이 파일은 계산만 한다(DOM·저장소 없음). 엑셀에서 읽은 행을 예약자 목록으로 바꾸고,
 * 검색·상태 집계·문자 문구를 만든다.
 *
 * ★ 연락처는 화면에 항상 가려서(010-****-1234) 보인다. 원본 번호는 문자 발송 링크를
 *   만들 때만 쓴다. 명단은 상담사 기기의 브라우저에만 남고 어디로도 보내지 않는다.
 */

export const STATUS = Object.freeze({
  예약: '예약',       // 명단에만 있음 (아직 안 옴)
  확인: '확인',       // 현장 도착, 예약 확인 체크
  상담중: '상담중',
  완료: '완료',
  불가: '불가',       // 저소득층(LH) 요건 미충족 등
});

const HEADER_RULES = {
  순번: (h) => /^순|^번호$|^no\.?$/i.test(h),
  동: (h) => h === '동' || /^동\s*\(|^동수|^동$/.test(h),
  호: (h) => /^호/.test(h),
  연락처: (h) => /연락|전화|휴대|핸드폰|phone/i.test(h),
  일시: (h) => /신청일|일시|시간|날짜|예약일|참석/.test(h),
  성명: (h) => /성명|이름|고객명|계약자/.test(h),
};

const clean = (v) => String(v ?? '').replace(/\*/g, '').trim();
const intText = (v) => (typeof v === 'number' ? String(Math.round(v)) : clean(v).replace(/\.0+$/, ''));
export const digits = (v) => String(v ?? '').replace(/\D/g, '');

/** 시트의 행 배열 → { list, columns, skipped, duplicates } */
export function fromRows(rows) {
  const headerAt = rows.findIndex((r) => {
    const hs = r.map(clean);
    return hs.some(HEADER_RULES.동) && hs.some(HEADER_RULES.호);
  });
  if (headerAt < 0) {
    throw new Error('명단에서 「동」「호수」 제목 칸을 찾지 못했습니다. 첫 줄에 순번·동·호수·연락처·신청일 제목이 있어야 합니다.');
  }
  const header = rows[headerAt].map(clean);
  const col = {};
  for (const [k, rule] of Object.entries(HEADER_RULES)) {
    const i = header.findIndex((h, j) => rule(h) && !Object.values(col).includes(j));
    if (i >= 0) col[k] = i;
  }

  const seen = new Map();
  const list = [];
  let skipped = 0;
  let duplicates = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const 동 = intText(r[col.동]);
    const 호 = intText(r[col.호]);
    if (!동 && !호) { skipped++; continue; }
    const phone = col.연락처 != null ? digits(r[col.연락처]) : '';
    const 일시 = col.일시 != null ? clean(r[col.일시]) : '';
    const id = `${동}-${호}-${phone.slice(-4)}`;
    if (seen.has(id)) {
      // 같은 세대·같은 번호가 두 번 신청한 경우 — 한 명으로 보고 신청 횟수만 남긴다.
      const prev = seen.get(id);
      prev.중복 += 1;
      if (일시 && !prev.일시목록.includes(일시)) prev.일시목록.push(일시);
      duplicates++;
      continue;
    }
    const item = {
      id,
      순번: col.순번 != null ? intText(r[col.순번]) : '',
      동, 호, phone,
      성명: col.성명 != null ? clean(r[col.성명]) : '',
      일시,
      일시목록: 일시 ? [일시] : [],
      중복: 0,
    };
    seen.set(id, item);
    list.push(item);
  }
  list.sort((a, b) => slotKey(a.일시).localeCompare(slotKey(b.일시))
    || Number(a.동) - Number(b.동) || Number(a.호) - Number(b.호));
  return { list, columns: Object.keys(col), skipped, duplicates };
}

/**
 * "2026년 10월 17일(토) 오후 1시" → "2026-10-17 13:00" (정렬용).
 * 명단의 "오전 12시"는 10시·11시 다음 칸이므로 정오로 본다.
 */
export function slotKey(text) {
  const s = String(text ?? '');
  const d = s.match(/(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/)
    ?? s.match(/()(\d{1,2})\s*[월/.]\s*(\d{1,2})/);
  const t = s.match(/(오전|오후)?\s*(\d{1,2})\s*(?:시|:)\s*(\d{1,2})?/g)?.at(-1)?.match(/(오전|오후)?\s*(\d{1,2})\s*(?:시|:)\s*(\d{1,2})?/);
  if (!d) return `9999 ${s}`;
  const y = d[1] || '0000';
  let h = t ? Number(t[2]) : 0;
  if (t?.[1] === '오후' && h < 12) h += 12;
  const mm = t?.[3] ? Number(t[3]) : 0;
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(d[2])}-${pad(d[3])} ${pad(h)}:${pad(mm)}`;
}

export function maskPhone(phone) {
  const p = digits(phone);
  if (p.length < 8) return p ? '****' : '';
  return `${p.slice(0, 3)}-****-${p.slice(-4)}`;
}

export function formatPhone(phone) {
  const p = digits(phone);
  if (p.length === 11) return `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`;
  if (p.length === 10) return `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
  return p;
}

/**
 * 찾기. 상담사가 실제로 치는 형태들:
 *   "301 1503", "301-1503", "301동 1503호" → 동·호
 *   "1503"                               → 호수 또는 연락처 뒷자리
 *   "0323"                               → 연락처 뒷자리
 */
export function search(list, query) {
  const q = String(query ?? '').trim();
  if (!q) return list;
  const nums = q.match(/\d+/g) ?? [];
  if (nums.length >= 2) {
    const [동, 호] = nums;
    return list.filter((x) => x.동 === String(Number(동)) && x.호 === String(Number(호)));
  }
  if (nums.length === 1) {
    const n = nums[0];
    if (/동/.test(q)) return list.filter((x) => x.동 === String(Number(n)));
    return list.filter((x) => x.호 === String(Number(n)) || x.동 === String(Number(n))
      || (n.length >= 4 && x.phone.endsWith(n)));
  }
  return list.filter((x) => x.성명 && x.성명.includes(q));
}

/** 시간대별 집계 — 현황판. */
export function bySlot(list, states = {}) {
  const map = new Map();
  for (const x of list) {
    const k = x.일시 || '시간 미기재';
    if (!map.has(k)) map.set(k, { 일시: k, key: slotKey(k), 전체: 0, 확인: 0, 완료: 0, 불가: 0 });
    const g = map.get(k);
    g.전체++;
    const st = states[x.id]?.status;
    if (st && st !== STATUS.예약) g.확인++;
    if (st === STATUS.완료) g.완료++;
    if (st === STATUS.불가) g.불가++;
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function totals(list, states = {}) {
  const t = { 전체: list.length, 확인: 0, 상담중: 0, 완료: 0, 불가: 0, 문자: 0 };
  for (const x of list) {
    const s = states[x.id];
    if (!s) continue;
    if (s.status && s.status !== STATUS.예약) t.확인++;
    if (s.status === STATUS.상담중) t.상담중++;
    if (s.status === STATUS.완료) t.완료++;
    if (s.status === STATUS.불가) t.불가++;
    if (s.smsAt) t.문자++;
  }
  return t;
}

/** 다음 대기번호 — 지금까지 받은 번호 중 가장 큰 값 + 1. */
export function nextTicket(states = {}) {
  let max = 0;
  for (const s of Object.values(states)) if (Number(s?.ticket) > max) max = Number(s.ticket);
  return max + 1;
}

/**
 * 현황 CSV (엑셀에서 열림). 연락처는 가린 채로 내보낸다 — 파일이 돌아다녀도 번호가 새지 않게.
 */
export function toCsv(list, states = {}) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['순번', '동', '호수', '연락처(가림)', '신청일시', '상태', '대기번호', '확인시각', '완료시각', '문자발송', '결과', '메모'];
  const lines = [head.join(',')];
  for (const x of list) {
    const s = states[x.id] ?? {};
    lines.push([x.순번, x.동, x.호, maskPhone(x.phone), x.일시, s.status ?? STATUS.예약, s.ticket ?? '',
      s.checkedAt ?? '', s.doneAt ?? '', s.smsAt ?? '', s.결과 ?? '', s.memo ?? ''].map(esc).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * 문자 앱 열기 링크. iOS 는 본문 구분자가 '&', 그 외는 '?'.
 * 서버·문자 API 없이 상담사 휴대폰의 문자 앱으로 보낸다 — 발송 버튼은 상담사가 누른다.
 */
export function smsHref(phone, body, { ios = false } = {}) {
  return `sms:${digits(phone)}${ios ? '&' : '?'}body=${encodeURIComponent(body)}`;
}
