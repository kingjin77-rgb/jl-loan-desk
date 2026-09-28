/**
 * 설정·단지 JSON 로더.
 *
 * GitHub Pages 프로젝트 페이지(/jl-loan-desk/) 에서 돌기 때문에 절대경로를 쓸 수 없다.
 * 모든 경로는 이 파일의 위치(import.meta.url) 기준으로 푼다.
 */

import { validatePolicy, validateComplex, validateMeta, collectUnsetValues, collectTrustFlags } from './validate.js';
import { loadOverrides, applyAll, countOverrides } from '../io/policy-overrides.js';

const DATA_ROOT = new URL('../../data/', import.meta.url);

export function dataUrl(relative) {
  return new URL(relative, DATA_ROOT).href;
}

async function getJSON(relative) {
  const url = dataUrl(relative);
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(
      `설정 파일을 읽지 못했습니다: ${relative}\n` +
      `브라우저에서 file:// 로 열면 보안 정책 때문에 파일을 읽을 수 없습니다. ` +
      `로컬에서는 "npx serve ." 로 띄우거나 GitHub Pages 주소로 여십시오.\n(${e.message})`
    );
  }
  if (!res.ok) throw new Error(`설정 파일을 읽지 못했습니다: ${relative} (HTTP ${res.status})`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`설정 파일의 JSON 형식이 잘못되었습니다: ${relative}\n${e.message}`);
  }
}

/**
 * manifest → 선택한 프로파일의 정책 세트 + 단지 목록.
 * @param {string} [profileName]
 */
export async function loadAll(profileName = null) {
  const manifest = await getJSON('manifest.json');
  const name = profileName || manifest.defaultProfile || Object.keys(manifest.profiles)[0];
  const profile = manifest.profiles?.[name];
  if (!profile) {
    throw new Error(`설정 프로파일 "${name}" 이 manifest.json 에 없습니다. 가능한 값: ${Object.keys(manifest.profiles || {}).join(', ')}`);
  }

  const entries = Object.entries(profile.policy);
  const docs = await Promise.all(entries.map(([, path]) => getJSON(path)));

  const productWarnings = [];
  const policies = {};
  entries.forEach(([key, path], i) => {
    policies[key] = validatePolicy(docs[i], path);
    policies[key].__path = path;
  });

  // 상품 파일 — 없거나 깨져도 앱 전체를 멈추지 않는다. 일반 주담대 계산은 계속 되어야 한다.
  const products = [];
  for (const path of profile.products ?? []) {
    try {
      const doc = await getJSON(path);
      validateMeta(doc, path).forEach((m) => productWarnings.push(`${path}: ${m}`));
      doc.__path = path;
      products.push(doc);
    } catch (e) {
      productWarnings.push(`${path}: ${e.message}`);
    }
  }

  // ★ 상담사가 화면에서 넣은 규제 수치를 마지막에 얹는다.
  //   파일은 그대로 두고 복사본에만 얹으므로, 원본이 무엇이었는지가 남는다.
  //   trust/unset 은 **얹은 뒤의 값**으로 다시 본다 — 안 그러면 다 채웠는데도
  //   붉은 경고가 안 사라진다.
  const overrides = loadOverrides();
  const effective = applyAll(policies, overrides);

  let complexIndex = { complexes: [] };
  try {
    complexIndex = await getJSON(manifest.complexes);
  } catch {
    // 단지 목록이 없어도 앱은 "직접 입력" 모드로 동작한다.
  }

  return {
    manifest,
    profileName: name,
    profileLabel: profile.label ?? name,
    profiles: Object.entries(manifest.profiles).map(([k, v]) => ({ key: k, label: v.label ?? k })),
    policies: effective,
    policiesFromFile: policies,   // 원본 — "무엇을 덮어썼는지" 비교용
    overrides,
    overrideCount: countOverrides(overrides),
    products,
    productWarnings,
    complexIndex,
    trust: collectTrustFlags(effective),
    unset: collectUnsetValues(effective),
  };
}

/** 저장소에 들어 있는 단지 파일 로드. */
export async function loadComplex(entry, policies) {
  const doc = await getJSON(entry.file);
  return validateComplex(doc, entry.file, contextFor(policies));
}

/**
 * 상담사가 화면에서 연 로컬 JSON 파일.
 * 공개 저장소에 실제 단지 데이터를 커밋하지 않기 위한 주 경로다.
 */
export function parseComplexFile(text, fileName, policies) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new Error(`${fileName}: JSON 형식이 잘못되었습니다.\n${e.message}`);
  }
  return validateComplex(doc, fileName, contextFor(policies));
}

function contextFor(policies) {
  return {
    bangongjeKeys: (policies?.bangongje?.regions || []).map((r) => r.key),
    regionGrades: policies?.regions?.grades || ['투기과열', '조정대상', '비규제'],
  };
}
