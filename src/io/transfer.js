/**
 * JSON 내보내기 / 불러오기.
 *
 * 실제 단지 데이터를 공개 저장소에 커밋하지 않기 위한 주 경로이기도 하다 —
 * 상담사는 단지 JSON 파일을 여기서 열어 쓴다.
 */

export function download(filename, data, mime = 'application/json') {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error(`${file.name} 파일을 읽지 못했습니다.`));
    fr.readAsText(file, 'utf-8');
  });
}

export function safeFilename(s) {
  return String(s || '상담기록').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}
