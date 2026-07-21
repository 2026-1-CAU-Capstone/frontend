import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/* The OMR backend only accepts a single PNG/JPG/JPEG. To support PDFs we
 * render every page client-side with pdf.js and stitch them vertically into
 * one tall image, then upload that as a single file. */

/** Target rasterization width in px (≈ A4 @ ~200 DPI) — high enough for OMR,
 *  capped so a multi-page stitch doesn't balloon in size. */
const TARGET_WIDTH = 1700;

/** 내부 공용: PDF 전 페이지를 페이지별 canvas 로 래스터라이즈. */
async function renderPdfPages(pdfFile: File): Promise<HTMLCanvasElement[]> {
  const buffer = await pdfFile.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;

  const canvases: HTMLCanvasElement[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('렌더 컨텍스트 생성 실패');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      canvases.push(canvas);
    }
  } finally {
    doc.destroy();
  }

  if (canvases.length === 0) throw new Error('PDF에 페이지가 없습니다.');
  return canvases;
}

function canvasToJpeg(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(new File([b], name, { type: 'image/jpeg' })) : reject(new Error('이미지 변환 실패'))),
      'image/jpeg',
      0.92,
    );
  });
}

/** Render a PDF File into a single stitched JPEG File (all pages stacked). */
export async function pdfToStitchedImage(pdfFile: File): Promise<File> {
  const canvases = await renderPdfPages(pdfFile);

  const width = Math.max(...canvases.map((c) => c.width));
  const height = canvases.reduce((sum, c) => sum + c.height, 0);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('렌더 컨텍스트 생성 실패');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, width, height);

  let y = 0;
  for (const c of canvases) {
    octx.drawImage(c, 0, y);
    y += c.height;
  }

  const name = pdfFile.name.replace(/\.pdf$/i, '') + '.jpg';
  return canvasToJpeg(out, name);
}

/** PDF 를 페이지별 JPEG File 배열로 변환.
 *
 *  멀티페이지 OMR 대비용(백엔드 합의: PDF → 페이지별 단일 이미지 OMR → JSON
 *  병합). 백엔드 배치 API 가 "페이지 이미지들"을 받는 형태로 나오면 이 결과를
 *  그대로 넘기고, 결과 병합은 lib/note/mergeOmrSheets 를 쓴다. 그 전까지
 *  업로드 경로는 기존 pdfToStitchedImage(한 장 합치기)를 유지한다. */
export async function pdfToPageImages(pdfFile: File): Promise<File[]> {
  const canvases = await renderPdfPages(pdfFile);
  const stem = pdfFile.name.replace(/\.pdf$/i, '');
  return Promise.all(
    canvases.map((c, i) => canvasToJpeg(c, `${stem}.p${String(i + 1).padStart(2, '0')}.jpg`)),
  );
}

/** Number of pages in a PDF (for preview labelling). */
export async function pdfPageCount(pdfFile: File): Promise<number> {
  const buffer = await pdfFile.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const n = doc.numPages;
  doc.destroy();
  return n;
}
