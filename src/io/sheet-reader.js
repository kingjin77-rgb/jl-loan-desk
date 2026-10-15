/**
 * 엑셀·CSV 명단 읽기 — 외부 라이브러리 없이, 브라우저 안에서만.
 *
 * 왜 직접 만드는가: 공개 npm 의 SheetJS(0.18.5)에는 알려진 취약점(프로토타입 오염·ReDoS)이
 * 있고, 새 버전은 이 앱이 쓰는 CDN 에서 받을 수 없다. 우리가 필요한 것은 "첫 시트의 셀 값"
 * 뿐이라 그 부분만 읽는다. 서식·수식 계산·병합셀은 읽지 않는다.
 *
 * 지원: .xls (Excel 97-2003, BIFF8) · .xlsx · .csv (UTF-8 또는 EUC-KR)
 * 반환: { sheets: [{ name, rows: [[셀, …], …] }] } — 셀은 문자열 또는 숫자
 *
 * ★ 읽은 내용은 어디로도 보내지 않는다. 파일은 상담사 PC 의 브라우저 메모리 안에서만 열린다.
 */

export async function readSheetFile(file) {
  const buf = await file.arrayBuffer();
  return readSheet(new Uint8Array(buf), file.name);
}

export async function readSheet(bytes, name = '') {
  if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) return readXls(bytes);
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) return readXlsx(bytes);
  if (/\.(xls|xlsx)$/i.test(name)) throw new Error('엑셀 파일 형식을 알아볼 수 없습니다. 엑셀에서 "다른 이름으로 저장 → CSV" 후 다시 올려 주십시오.');
  return { sheets: [{ name: 'CSV', rows: parseCsv(decodeText(bytes)) }] };
}

/* ───────────────────────── CSV ───────────────────────── */

export function decodeText(bytes) {
  let start = 0;
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) start = 3;
  const body = bytes.subarray(start);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    // 한국 엑셀이 저장한 CSV 는 대개 EUC-KR(CP949) 이다.
    return new TextDecoder('euc-kr').decode(body);
  }
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/* ───────────────────────── XLSX ───────────────────────── */

async function readXlsx(bytes) {
  const files = unzipIndex(bytes);
  const text = async (path) => {
    const f = files.get(path);
    return f ? new TextDecoder('utf-8').decode(await inflateEntry(bytes, f)) : null;
  };
  const shared = [];
  const sst = await text('xl/sharedStrings.xml');
  if (sst) {
    for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => xmlUnescape(t[1])).join(''));
    }
  }
  const wb = (await text('xl/workbook.xml')) ?? '';
  const rels = (await text('xl/_rels/workbook.xml.rels')) ?? '';
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0];
    const name = xmlUnescape(attr(tag, 'name') ?? '');
    const rid = attr(tag, 'r:id');
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((r) => r[0]).find((r) => attr(r, 'Id') === rid);
    let target = rel ? attr(rel, 'Target') : null;
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = await text(target);
    if (xml) sheets.push({ name, rows: xlsxRows(xml, shared) });
  }
  if (!sheets.length) throw new Error('엑셀(xlsx) 파일에서 시트를 찾지 못했습니다.');
  return { sheets };
}

function attr(tag, key) {
  const m = tag.match(new RegExp(`\\s${key.replace(':', '\\:')}="([^"]*)"`));
  return m ? m[1] : null;
}

function xmlUnescape(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
    const map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (map[e.toLowerCase()]) return map[e.toLowerCase()];
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function xlsxRows(xml, shared) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attr(rm[0], 'r') ?? rows.length + 1) - 1;
    const row = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = `<c${cm[1]}>`;
      const ref = attr(head, 'r');
      const t = attr(head, 't');
      const body = cm[2] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = null;
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xmlUnescape(x[1])).join('');
      else if (t === 'str' || t === 'e') val = v != null ? xmlUnescape(v) : '';
      else if (t === 'b') val = v === '1';
      else if (v != null) val = Number(v);
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows[r] = row;
  }
  return rows.filter(Boolean).map((r) => Array.from(r, (c) => c ?? ''));
}

/** ZIP 중앙 디렉터리만 읽어 파일 위치를 잡는다. */
function unzipIndex(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('엑셀(xlsx) 파일이 손상되었습니다.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014B50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateEntry(bytes, { method, csize, local }) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
  const data = bytes.subarray(start, start + csize);
  if (method === 0) return data;
  if (method !== 8) throw new Error('지원하지 않는 압축 방식입니다. CSV 로 저장해 올려 주십시오.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ───────────────────────── XLS (CFB + BIFF8) ───────────────────────── */

const ENDOFCHAIN = 0xFFFFFFFE;

function readXls(bytes) {
  const stream = cfbStream(bytes, ['Workbook', 'Book']);
  if (!stream) throw new Error('엑셀(xls) 파일에서 통합문서를 찾지 못했습니다.');
  return biff8(stream);
}

/** 복합 문서(CFB) 에서 이름이 맞는 스트림 하나를 꺼낸다. */
function cfbStream(bytes, names) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const secSize = 1 << dv.getUint16(0x1E, true);
  const miniSize = 1 << dv.getUint16(0x20, true);
  const nFat = dv.getUint32(0x2C, true);
  const dirStart = dv.getUint32(0x30, true);
  const cutoff = dv.getUint32(0x38, true);
  const miniFatStart = dv.getUint32(0x3C, true);
  let difatNext = dv.getUint32(0x44, true);
  const off = (s) => 512 + s * secSize;

  // DIFAT → FAT 섹터 목록
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(0x4C + i * 4, true));
  let guard = 0;
  while (fatSecs.length < nFat && difatNext < ENDOFCHAIN && guard++ < 10000) {
    const per = secSize / 4 - 1;
    for (let i = 0; i < per && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(off(difatNext) + i * 4, true));
    difatNext = dv.getUint32(off(difatNext) + per * 4, true);
  }
  const fat = [];
  for (const s of fatSecs) for (let i = 0; i < secSize / 4; i++) fat.push(dv.getUint32(off(s) + i * 4, true));

  const chain = (start, table) => {
    const out = [];
    for (let s = start, n = 0; s < ENDOFCHAIN && n < table.length; s = table[s], n++) out.push(s);
    return out;
  };
  const readChain = (start) => {
    const secs = chain(start, fat);
    const buf = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => buf.set(bytes.subarray(off(s), off(s) + secSize), i * secSize));
    return buf;
  };

  const dir = readChain(dirStart);
  const ddv = new DataView(dir.buffer);
  const entries = [];
  for (let p = 0; p + 128 <= dir.length; p += 128) {
    const nameLen = ddv.getUint16(p + 64, true);
    let name = '';
    for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(p + i * 2, true));
    entries.push({ name, type: dir[p + 66], start: ddv.getUint32(p + 116, true), size: ddv.getUint32(p + 120, true) });
  }
  const root = entries.find((e) => e.type === 5);
  const entry = entries.find((e) => e.type === 2 && names.includes(e.name));
  if (!entry) return null;

  if (entry.size >= cutoff) return readChain(entry.start).subarray(0, entry.size);

  // 작은 스트림은 미니 스트림 안에 있다.
  const miniFatBuf = miniFatStart < ENDOFCHAIN ? readChain(miniFatStart) : new Uint8Array(0);
  const mdv = new DataView(miniFatBuf.buffer);
  const miniFat = [];
  for (let i = 0; i + 4 <= miniFatBuf.length; i += 4) miniFat.push(mdv.getUint32(i, true));
  const ministream = readChain(root.start);
  const secs = chain(entry.start, miniFat);
  const buf = new Uint8Array(secs.length * miniSize);
  secs.forEach((s, i) => buf.set(ministream.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize));
  return buf.subarray(0, entry.size);
}

function rk(v) {
  let n;
  if (v & 2) n = v >> 2;
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(4, v & 0xFFFFFFFC, true);
    n = b.getFloat64(0, true);
  }
  return v & 1 ? n / 100 : n;
}

function biff8(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recs = [];
  for (let p = 0; p + 4 <= bytes.length;) {
    const type = dv.getUint16(p, true);
    const len = dv.getUint16(p + 2, true);
    recs.push({ type, pos: p, data: bytes.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
  }

  const sheetsMeta = [];
  let sst = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === 0x0085) {
      const d = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      const pos = d.getUint32(0, true);
      const sheetType = r.data[5];
      const cch = r.data[6];
      const wide = r.data[7] & 1;
      const name = readChars(r.data, 8, cch, wide);
      if (sheetType === 0) sheetsMeta.push({ name, pos });
    } else if (r.type === 0x00FC) {
      const parts = [r.data];
      while (recs[i + 1]?.type === 0x003C) parts.push(recs[++i].data);
      sst = parseSst(parts);
    }
  }

  const sheets = sheetsMeta.map(({ name, pos }) => {
    const rows = [];
    const set = (row, col, v) => { (rows[row] ??= [])[col] = v; };
    let k = recs.findIndex((r) => r.pos === pos);
    if (k < 0) return { name, rows: [] };
    let pendingFormula = null;
    for (k++; k < recs.length && recs[k].type !== 0x000A; k++) {
      const { type, data } = recs[k];
      const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const row = data.length >= 4 ? d.getUint16(0, true) : 0;
      const col = data.length >= 4 ? d.getUint16(2, true) : 0;
      if (type === 0x00FD) set(row, col, sst[d.getUint32(6, true)] ?? '');
      else if (type === 0x0203) set(row, col, d.getFloat64(6, true));
      else if (type === 0x027E) set(row, col, rk(d.getUint32(6, true)));
      else if (type === 0x00BD) {
        const last = d.getUint16(data.length - 2, true);
        for (let c = col, q = 4; c <= last; c++, q += 6) set(row, c, rk(d.getUint32(q + 2, true)));
      } else if (type === 0x0204) {
        const cch = d.getUint16(6, true);
        set(row, col, readChars(data, 9, cch, data[8] & 1));
      } else if (type === 0x0006) {
        if (d.getUint16(12, true) === 0xFFFF) {
          if (data[6] === 0) pendingFormula = { row, col };
          else if (data[6] === 1) set(row, col, data[8] === 1);
          else set(row, col, '');
        } else set(row, col, d.getFloat64(6, true));
      } else if (type === 0x0207 && pendingFormula) {
        const cch = d.getUint16(0, true);
        set(pendingFormula.row, pendingFormula.col, readChars(data, 3, cch, data[2] & 1));
        pendingFormula = null;
      }
    }
    return { name, rows: Array.from(rows, (r) => Array.from(r ?? [], (c) => c ?? '')) };
  });
  if (!sheets.length) throw new Error('엑셀(xls) 파일에서 시트를 찾지 못했습니다.');
  return { sheets };
}

function readChars(data, pos, cch, wide) {
  let s = '';
  for (let i = 0; i < cch; i++) {
    s += String.fromCharCode(wide ? data[pos + i * 2] | (data[pos + i * 2 + 1] << 8) : data[pos + i]);
  }
  return s;
}

/**
 * 공유 문자열 표. 문자열이 CONTINUE 레코드 경계를 넘으면, 넘어간 쪽 첫 바이트에
 * 1바이트/2바이트 글자 여부가 다시 적힌다 — 그 처리가 이 함수의 전부다.
 */
function parseSst(parts) {
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  const bounds = new Set();
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; bounds.add(o); }
  const dv = new DataView(buf.buffer);
  const unique = dv.getUint32(4, true);
  const out = [];
  let p = 8;
  const nextBound = (x) => { let b = Infinity; for (const v of bounds) if (v > x && v < b) b = v; return b; };
  for (let n = 0; n < unique && p < buf.length; n++) {
    const cch = dv.getUint16(p, true);
    let flags = buf[p + 2];
    p += 3;
    const rich = flags & 8 ? dv.getUint16(p, true) : 0;
    if (flags & 8) p += 2;
    const ext = flags & 4 ? dv.getUint32(p, true) : 0;
    if (flags & 4) p += 4;
    let s = '';
    let left = cch;
    while (left > 0) {
      const wide = flags & 1;
      const room = Math.floor((nextBound(p) - p) / (wide ? 2 : 1));
      const take = Math.min(left, room);
      s += readChars(buf, p, take, wide);
      p += take * (wide ? 2 : 1);
      left -= take;
      if (left > 0) { flags = buf[p]; p += 1; }
    }
    p += rich * 4 + ext;
    out.push(s);
  }
  return out;
}
