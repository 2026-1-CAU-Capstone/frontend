/* ─────────────────────────────────────────────────────────────────────────
 * Score → PDF exporter.
 *
 * Why not svg2pdf / browser print?
 *   - svg2pdf can't draw VexFlow's musical glyphs or the MuseJazz chord font
 *     (they come out blank / garbled).
 *   - window.print() is accurate but the browser forces a date/URL/page-number
 *     header & footer that CSS can't remove, and it can't split the single
 *     giant score SVG on staff boundaries (staves get cut mid-line).
 *
 * Approach here: rasterize the already-rendered on-screen SVG to a high-res
 * canvas (the browser's own renderer draws every glyph correctly), embedding
 * the MuseJazz font as a data URL so chord symbols survive the isolated
 * <img> load. Then slice the canvas into A4 pages — backing each page break
 * off to the nearest blank pixel row so a staff is never cut in half — and
 * place each slice into a jsPDF page. No header/footer, no blank first page,
 * page width fit, staff-aware breaks.
 * ──────────────────────────────────────────────────────────────────────── */

import { jsPDF } from 'jspdf';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* Fonts the score SVG references. All three must be embedded as data URLs so
 * they survive the isolated <img> raster:
 *   - MuseJazz Text : jazz chord symbols (Bb△7 등)
 *   - Bravura       : VexFlow musical glyphs (noteheads, clefs, time sig…)
 *   - Academico     : VexFlow text (measure numbers 등)
 * Bravura/Academico are extracted from the vexflow package into /public. */
const FONT_SOURCES: Array<{ family: string; url: string; mime: string }> = [
  { family: 'MuseJazz Text', url: '/MuseJazzText.otf', mime: 'font/otf' },
  { family: 'Bravura',       url: '/bravura.woff2',    mime: 'font/woff2' },
  { family: 'Academico',     url: '/academico.woff2',  mime: 'font/woff2' },
];

/* A4 portrait, millimetres. */
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 12;

/* Raster resolution multiplier — higher = crisper PDF, larger memory.
 * 2.0 keeps staff lines crisp while halving the bitmap area vs 2.5. */
const RASTER_SCALE = 2.0;

/* JPEG quality for the page bitmaps. Score art is black-on-white line work,
 * so 0.82 is visually indistinguishable from lossless yet ~10-20× smaller
 * than PNG (the cause of the 100MB+ files). */
const JPEG_QUALITY = 0.82;

/* A blank vertical gap at least this tall (canvas px) is treated as a real
 * "between-systems" break. Smaller gaps (e.g. the space between a chord label
 * and its staff) are ignored so a system is never split across pages. */
const MIN_SYSTEM_GAP_PX = Math.round(26 * RASTER_SCALE);

export interface ScorePdfMeta {
  title?: string;
  artist?: string;     // shown as "Played by {artist}" on the right
}

const fontB64Cache = new Map<string, string>();

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* Render the title (MuseJazz) + "Played by {artist}" header to a small canvas
 * so it carries the real jazz font and supports any script (incl. Korean).
 * Returns null when there's nothing to show. Width is in canvas px to match
 * the page bitmap resolution. */
async function renderHeaderCanvas(
  meta: ScorePdfMeta,
  widthPx: number,
): Promise<HTMLCanvasElement | null> {
  if (!meta.title && !meta.artist) return null;

  const titlePx = Math.round(40 * RASTER_SCALE);
  const artistPx = Math.round(20 * RASTER_SCALE);
  const heightPx = Math.round(58 * RASTER_SCALE);

  // Make sure MuseJazz is decoded before we draw with it.
  try {
    if (document.fonts?.load) {
      await document.fonts.load(`${titlePx}px 'MuseJazz Text'`);
    }
  } catch { /* fall back to whatever's available */ }

  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(widthPx));
  c.height = heightPx;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textBaseline = 'alphabetic';

  if (meta.title) {
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `${titlePx}px 'MuseJazz Text', serif`;
    ctx.textAlign = 'center';
    ctx.fillText(meta.title, c.width / 2, titlePx);
  }
  if (meta.artist) {
    ctx.fillStyle = '#666666';
    ctx.font = `${artistPx}px 'Pretendard', sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(`Played by ${meta.artist}`, c.width, titlePx);
  }
  return c;
}

/** Build the combined @font-face CSS (data URLs) for every score font. */
async function buildFontFaceCss(): Promise<string> {
  const faces = await Promise.all(
    FONT_SOURCES.map(async ({ family, url, mime }) => {
      let b64 = fontB64Cache.get(url);
      if (!b64) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`폰트를 불러오지 못했습니다: ${url}`);
        b64 = arrayBufferToBase64(await res.arrayBuffer());
        fontB64Cache.set(url, b64);
      }
      return `@font-face{font-family:'${family}';src:url(data:${mime};base64,${b64});}`;
    }),
  );
  return faces.join('');
}

/**
 * Render the given on-screen score <svg> to a multi-page A4 PDF and trigger
 * a download. `filename` should NOT include the .pdf extension.
 */
export async function exportScoreSvgToPdf(
  liveSvg: SVGSVGElement,
  filename: string,
  meta?: ScorePdfMeta,
): Promise<void> {
  // Native pixel dimensions — prefer viewBox, fall back to the bounding rect.
  const vb = liveSvg.viewBox?.baseVal;
  const rect = liveSvg.getBoundingClientRect();
  const W = vb && vb.width ? vb.width : rect.width;
  const H = vb && vb.height ? vb.height : rect.height;
  if (!W || !H) throw new Error('악보 크기를 읽을 수 없습니다.');

  // Clone & strip any on-screen fit-scale transform; pin the native size.
  const clone = liveSvg.cloneNode(true) as SVGSVGElement;
  clone.style.transform = '';
  clone.style.width = '';
  clone.style.height = '';
  clone.setAttribute('width', String(W));
  clone.setAttribute('height', String(H));
  clone.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // Embed every referenced font (MuseJazz + Bravura + Academico) so chord
  // symbols AND musical glyphs render inside the isolated <img> context.
  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = await buildFontFaceCss();
  clone.insertBefore(style, clone.firstChild);

  const svgStr = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }));

  try {
    const img = new Image();
    img.src = url;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(W * RASTER_SCALE);
    canvas.height = Math.ceil(H * RASTER_SCALE);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('렌더 컨텍스트 생성 실패');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const usableW = PAGE_W - MARGIN * 2;
    const usableH = PAGE_H - MARGIN * 2;
    const mmPerPx = usableW / canvas.width;            // canvas px → mm

    // Pull the whole bitmap once for fast blank-row scanning.
    const full = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const rowIsBlank = (yy: number): boolean => {
      const base = yy * canvas.width * 4;
      for (let x = 0; x < canvas.width; x++) {
        const i = base + x * 4;
        // treat near-white (>=248) as blank; anything darker = ink
        if (full[i] < 248 || full[i + 1] < 248 || full[i + 2] < 248) return false;
      }
      return true;
    };

    /* Back a page cut up to a real between-systems gap so a chord+staff system
     * is never split. Walk upward from idealEnd; the first blank run that's at
     * least MIN_SYSTEM_GAP_PX tall is a system boundary — cut at its middle.
     * Small gaps (chord label ↔ staff) are skipped. Returns idealEnd if none
     * found above minEnd (page would otherwise get too short). */
    const findSystemBreak = (idealEnd: number, minEnd: number): number => {
      let yy = idealEnd;
      while (yy > minEnd) {
        if (rowIsBlank(yy)) {
          let top = yy;
          while (top > minEnd && rowIsBlank(top)) top--;
          if (yy - top >= MIN_SYSTEM_GAP_PX) {
            return Math.floor((top + yy) / 2);
          }
          yy = top - 1; // skip this too-small gap
        } else {
          yy--;
        }
      }
      return idealEnd;
    };

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

    // First-page header (title in MuseJazz + "Played by {artist}" on the right),
    // rendered to a canvas so the jazz font / any script survives. It consumes
    // vertical space, so the first page's score area starts lower & is shorter.
    let headerMM = 0;
    let headerImg: string | null = null;
    let headerHmm = 0;
    const header = await renderHeaderCanvas(meta ?? {}, canvas.width);
    if (header) {
      headerImg = header.toDataURL('image/png'); // small; keep crisp text
      headerHmm = header.height * mmPerPx;
      headerMM = headerHmm + 4; // gap below header
    }

    let y = 0;
    let firstPage = true;
    while (y < canvas.height) {
      const topMM = firstPage ? MARGIN + headerMM : MARGIN;
      const pageH = PAGE_H - topMM - MARGIN;          // mm available for the score this page
      const pageSlicePx = Math.floor(pageH / mmPerPx); // canvas px that fit

      let sliceEnd = Math.min(y + pageSlicePx, canvas.height);
      if (sliceEnd < canvas.height) {
        const minEnd = y + Math.floor(pageSlicePx * 0.5);
        sliceEnd = findSystemBreak(sliceEnd, minEnd);
      }

      const sh = sliceEnd - y;
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sh;
      const sctx = slice.getContext('2d');
      if (!sctx) throw new Error('슬라이스 렌더 실패');
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, y, canvas.width, sh, 0, 0, canvas.width, sh);

      if (!firstPage) doc.addPage();
      if (firstPage && headerImg) {
        doc.addImage(headerImg, 'PNG', MARGIN, MARGIN, usableW, headerHmm);
      }
      // Score pages as JPEG — order-of-magnitude smaller than PNG.
      doc.addImage(slice.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', MARGIN, topMM, usableW, sh * mmPerPx);
      firstPage = false;
      y = sliceEnd;
    }

    doc.save(`${filename}.pdf`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
