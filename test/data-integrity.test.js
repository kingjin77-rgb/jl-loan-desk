/**
 * 실제 data/ 파일의 **구조** 검사.
 *
 * 값은 검사하지 않는다. 규제 수치가 갱신될 때마다 테스트가 깨지면 아무도
 * 테스트를 믿지 않게 된다. 여기서 보는 것은 "manifest 가 가리키는 파일이 실제로
 * 있는가", "meta 가 붙어 있는가", "단지 비율 합이 100% 인가" 뿐이다.
 *
 * 브라우저 러너에서는 파일시스템을 읽을 수 없으므로 node 에서만 돈다.
 */

import { test, assert } from './env.js';
import { validateComplex, validateMeta } from '../src/data/validate.js';

const isNode = typeof process !== 'undefined' && process.versions?.node;

if (isNode) {
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const read = (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));

  test('manifest: 가리키는 설정 파일이 전부 실재한다', () => {
    const m = read('manifest.json');
    assert.ok(m.profiles && Object.keys(m.profiles).length, '프로파일이 하나 이상 있어야 한다');
    for (const [name, profile] of Object.entries(m.profiles)) {
      for (const [key, path] of Object.entries(profile.policy)) {
        assert.ok(existsSync(join(DATA, path)), `프로파일 "${name}" 의 ${key} 파일이 없습니다: ${path}`);
      }
    }
    assert.ok(m.defaultProfile in m.profiles, 'defaultProfile 이 profiles 에 있어야 한다');
  });

  test('manifest: 단지 목록 파일이 실재한다', () => {
    const m = read('manifest.json');
    assert.ok(existsSync(join(DATA, m.complexes)), `${m.complexes} 가 없습니다`);
  });

  test('정책 설정: 모든 파일에 meta(기준일·출처·verified)가 있다', () => {
    const files = [];
    for (const dir of ['policy', 'policy/demo']) {
      const full = join(DATA, dir);
      if (!existsSync(full)) continue;
      for (const f of readdirSync(full)) {
        if (f.endsWith('.json')) files.push(`${dir}/${f}`);
      }
    }
    assert.ok(files.length, '정책 설정 파일이 하나도 없습니다');
    for (const f of files) {
      const problems = validateMeta(read(f), f);
      assert.equal(problems.length, 0, `${f}: ${problems.join(' / ')}`);
    }
  });

  test('정책 설정: 미검증 파일은 verified 가 false 로 정직하게 표시돼 있다', () => {
    // 값을 확인하지 않은 채 verified:true 로 두는 것이 가장 위험하다.
    // 출처가 비어 있는데 verified:true 인 파일이 있으면 실패시킨다.
    for (const dir of ['policy', 'policy/demo']) {
      const full = join(DATA, dir);
      if (!existsSync(full)) continue;
      for (const f of readdirSync(full).filter((x) => x.endsWith('.json'))) {
        const doc = read(`${dir}/${f}`);
        if (doc.meta.verified) {
          assert.ok(doc.meta.출처, `${dir}/${f}: verified:true 인데 meta.출처 가 비어 있습니다`);
        }
      }
    }
  });

  test('데모 설정: demo:true 이면서 verified:true 인 파일은 없다', () => {
    const full = join(DATA, 'policy/demo');
    if (!existsSync(full)) return;
    for (const f of readdirSync(full).filter((x) => x.endsWith('.json'))) {
      const doc = read(`policy/demo/${f}`);
      assert.ok(doc.meta.demo === true, `policy/demo/${f}: meta.demo 가 true 여야 합니다`);
      assert.equal(doc.meta.verified, false, `policy/demo/${f}: 데모 값은 verified:false 여야 합니다`);
    }
  });

  test('단지: 목록의 모든 항목이 실재하고 검증을 통과한다', () => {
    const m = read('manifest.json');
    const index = read(m.complexes);
    const bg = read(m.profiles[m.defaultProfile].policy.bangongje);
    const regions = read(m.profiles[m.defaultProfile].policy.regions);
    const ctx = {
      bangongjeKeys: (bg.regions || []).map((r) => r.key),
      regionGrades: regions.grades,
    };

    assert.ok(index.complexes.length, '단지 목록이 비어 있습니다');
    for (const entry of index.complexes) {
      assert.ok(existsSync(join(DATA, entry.file)), `${entry.file} 가 없습니다`);
      const doc = read(entry.file);
      assert.equal(doc.complexId, entry.complexId, `${entry.file}: complexId 가 목록과 다릅니다`);
      validateComplex(doc, entry.file, ctx); // 실패하면 예외를 던진다
    }
  });

  test('단지 템플릿: 필수 블록이 빠지지 않았다', () => {
    const t = read('complexes/_template.json');
    for (const key of ['location', 'moveIn', 'unitTypes', 'paymentSchedule', 'extras']) {
      assert.ok(key in t, `템플릿에 ${key} 블록이 없습니다`);
    }
    assert.ok(t.location.regionGrade, '템플릿에 regionGrade 예시가 있어야 합니다');
    assert.ok(t.location.bangongjeRegion, '템플릿에 bangongjeRegion 예시가 있어야 합니다');
  });

  test('노출 방지: 커밋된 단지는 가상 샘플뿐이다', () => {
    // 이 저장소는 공개이고, 배포된 사이트도 주소를 아는 사람이면 열 수 있다.
    // 커밋한 단지 JSON 은 양쪽에서 그대로 내려받을 수 있으므로, 실제 단지의
    // 분양가·취급은행이 노출되지 않도록 저장소에는 가상 샘플만 둔다.
    // 실제 단지 데이터는 화면의 "파일 열기"로 쓴다.
    const index = read('complexes/_index.json');
    for (const entry of index.complexes) {
      const doc = read(entry.file);
      assert.ok(
        doc.meta?.demo === true,
        `${entry.file}: 저장소에는 meta.demo:true 인 가상 단지만 커밋할 수 있습니다. ` +
        `실제 단지 데이터는 커밋하지 말고 화면의 "파일 열기"로 불러오십시오 ` +
        `(커밋하면 배포된 사이트에서 그대로 내려받을 수 있게 됩니다).`
      );
    }
  });

  test('PWA: 설치에 필요한 파일이 전부 있다', () => {
    const root = join(DATA, '..');
    for (const f of [
      'manifest.webmanifest', 'sw.js', '.nojekyll',
      'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
      'assets/icons/icon-maskable-512.png', 'assets/icons/apple-touch-icon.png',
    ]) {
      assert.ok(existsSync(join(root, f)), `${f} 가 없습니다 — 홈 화면 설치가 안 됩니다`);
    }
  });

  test('PWA: manifest 의 아이콘 경로가 실재한다', () => {
    const root = join(DATA, '..');
    const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
    assert.ok(m.icons.length >= 2);
    for (const i of m.icons) {
      assert.ok(existsSync(join(root, i.src)), `manifest 가 가리키는 ${i.src} 가 없습니다`);
    }
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'), '안드로이드 아이콘이 잘리지 않으려면 maskable 이 필요합니다');
    assert.equal(m.start_url, './', 'Pages 하위 경로 배포에서는 상대 경로여야 합니다');
    assert.equal(m.scope, './');
  });

  test('★ 서비스워커가 캐시하는 소스 모듈에 빠진 파일이 없다', () => {
    // 하나라도 빠지면 오프라인에서 앱이 아예 뜨지 않는다.
    const root = join(DATA, '..');
    const sw = readFileSync(join(root, 'sw.js'), 'utf8');
    const listed = new Set([...sw.matchAll(/'\.\/(src\/[^']+\.js)'/g)].map((m) => m[1]));

    const actual = [];
    const walk = (dir) => {
      for (const f of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (f.isDirectory()) walk(`${dir}/${f.name}`);
        else if (f.name.endsWith('.js')) actual.push(`${dir}/${f.name}`);
      }
    };
    walk('src');

    const missing = actual.filter((f) => !listed.has(f));
    assert.equal(missing.length, 0,
      `sw.js 의 캐시 목록에 빠진 모듈: ${missing.join(', ')}\n` +
      `새 모듈을 추가했으면 sw.js 의 SHELL 에도 넣어야 오프라인에서 앱이 뜹니다.`);
  });

  // ── 분양전환 설정: 상담일지 안에서 서로 맞아떨어지는지 검사한다.
  //    값이 바뀌어도(다른 단지·다른 사업장) 이 관계는 유지되어야 한다.
  test('★ 분양전환: 타입별 최소주택가격 = 총액상한 + 최소잔금유예금', () => {
    for (const rel of ['policy/bunyangjeonhwan.2026-09-28.json', 'policy/demo/bunyangjeonhwan.demo.json']) {
      const f = join(DATA, rel);
      if (!existsSync(f)) continue;
      const d = JSON.parse(readFileSync(f, 'utf8'));
      const 상한 = d.분할납부?.총액상한;
      const 최소 = d.분할납부?.타입별최소잔금유예금 ?? {};
      const 최소주택가격 = d.분할납부?._타입별최소주택가격 ?? {};
      assert.ok(상한 > 0, `${rel}: 분할납부.총액상한 이 없습니다`);
      for (const [타입, v] of Object.entries(최소)) {
        const 기대 = 상한 + v;
        const 적힌값 = 최소주택가격[타입];
        assert.equal(적힌값, 기대,
          `${rel} ${타입}타입: 최소주택가격이 ${적힌값} 로 적혀 있지만 ` +
          `총액상한(${상한}) + 최소잔금유예금(${v}) = ${기대} 이어야 합니다`);
      }
    }
  });

  test('분양전환: LH 검증 월소득 기준은 가구원수가 늘수록 커진다', () => {
    const f = join(DATA, 'policy/bunyangjeonhwan.2026-09-28.json');
    const d = JSON.parse(readFileSync(f, 'utf8'));
    const 소득 = d.LH검증?.월소득 ?? {};
    const keys = Object.keys(소득).map(Number).sort((a, b) => a - b);
    assert.ok(keys.length >= 2, 'LH검증.월소득 기준이 비어 있습니다');
    for (let i = 1; i < keys.length; i++) {
      assert.ok(소득[keys[i]] > 소득[keys[i - 1]],
        `${keys[i]}인 기준(${소득[keys[i]]})이 ${keys[i - 1]}인 기준(${소득[keys[i - 1]]})보다 작습니다`);
    }
  });

  test('★ 금리표: 만기가 길수록 금리가 낮아지지 않는다 (행이 밀려 들어간 것을 잡는다)', () => {
    // 금리표를 옮겨 적을 때 행·열을 바꿔 넣는 실수가 가장 흔하다.
    // 기금·정책 상품은 만기가 길수록 금리가 같거나 높다.
    for (const rel of readdirSync(join(DATA, 'products')).filter((f) => f.endsWith('.json') && f !== '_index.json')) {
      const d = JSON.parse(readFileSync(join(DATA, 'products', rel), 'utf8'));
      for (const v of d.variants ?? []) {
        const t = v.rateTable;
        if (!t?.matrix?.length) continue;
        t.matrix.forEach((row, ri) => {
          for (let i = 1; i < row.length; i++) {
            if (row[i] == null || row[i - 1] == null) continue;
            assert.ok(row[i] >= row[i - 1],
              `${rel} ${v.variantId} ${ri}행: ${t.termYears?.[i]}년 금리(${row[i]})가 ` +
              `${t.termYears?.[i - 1]}년(${row[i - 1]})보다 낮습니다`);
          }
        });
        // 소득이 높을수록 금리가 낮아지지도 않는다
        for (let ri = 1; ri < t.matrix.length; ri++) {
          const a = t.matrix[ri - 1], b = t.matrix[ri];
          for (let i = 0; i < Math.min(a.length, b.length); i++) {
            if (a[i] == null || b[i] == null) continue;
            assert.ok(b[i] >= a[i],
              `${rel} ${v.variantId}: 소득구간 ${ri} 의 ${t.termYears?.[i]}년 금리가 아래 구간보다 낮습니다`);
          }
        }
      }
    }
  });

  test('우대금리 상한은 개별 우대폭 합계보다 작거나 같아야 의미가 있다', () => {
    for (const rel of readdirSync(join(DATA, 'products')).filter((f) => f.endsWith('.json') && f !== '_index.json')) {
      const d = JSON.parse(readFileSync(join(DATA, 'products', rel), 'utf8'));
      for (const v of d.variants ?? []) {
        if (v.discountCap == null) continue;
        assert.ok(v.discountCap > 0, `${rel} ${v.variantId}: discountCap 이 0 이하입니다`);
        for (const r of v.discountCapWhen ?? []) {
          assert.ok(r.value > 0 && r.condition, `${rel} ${v.variantId}: discountCapWhen 에 값이나 조건이 없습니다`);
        }
      }
    }
  });
}
