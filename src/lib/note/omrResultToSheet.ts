import type { NoteSheetData } from '../../data/sampleMelody';
import { parseXmlString, sortPartsByMelody } from './xmlMelodyParser';

/* ─────────────────────────────────────────────────────────────────────────
 * OMR 결과(원문) → NoteSheetData
 *
 * 백엔드는 `omrResult.pages[]` 로 **원문 두 개**를 준다(문서 #23):
 *   - `musicXml`             : 음표·조표·박자 (HOMR 결과)
 *   - `chordAssignmentsJson` : OCR 로 읽은 **코드 심볼**을 마디에 배정한 JSON
 *
 * 두 가지를 프론트에서 합쳐야 온전한 악보가 된다:
 *   1) 한손/양손은 MusicXML 의 `<staves>` 로 **자동 확정**된다(사용자에게 묻지 않는다).
 *      `<staves>2</staves>` → parseGrandStaff 가 오른손 `measures` / 왼손 `bassMeasures`
 *      로 나누고 화음(동시에 울리는 음)을 보존한다.
 *   2) 코드 심볼은 **MusicXML 에 없다**(OMR 산출물 실측: `<harmony>` 0개).
 *      `chord_assignments.json` 의 `text_norm` 을 `musicxml_measure_number` 로
 *      마디에 붙여야 한다.
 *
 * ⚠️ `measure_alignment.status` 규칙(문서 #28)을 반드시 지킨다:
 *   aligned     → 모든 마디 연결 가능
 *   partial     → `musicxml_measure_number` 가 있는 마디만
 *   mismatch    → 배열 인덱스로 강제 연결 **금지** (코드 위치가 틀어진다)
 *   visual_only → MusicXML 자체가 없음 (이 모듈의 대상 아님)
 * ──────────────────────────────────────────────────────────────────────── */

/** chord_assignments.json 에서 이 모듈이 쓰는 부분만 (전체 계약은 문서 #28). */
interface ChordAssignmentsDoc {
  measure_alignment?: { status?: string | null } | null;
  pages?: Array<{
    systems?: Array<{
      measures?: Array<{
        index?: number | null;
        musicxml_measure_number?: string | number | null;
        chords?: Array<{
          text_norm?: string | null;
          text_raw?: string | null;
          beat?: number | null;
        }> | null;
      }> | null;
    }> | null;
  }> | null;
}

function parseDoc(raw: string | object): ChordAssignmentsDoc | null {
  try {
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as ChordAssignmentsDoc;
  } catch {
    return null; // 원문이 깨져 있어도 음표는 살린다.
  }
}

/**
 * `chord_assignments.json` 의 코드 심볼을 악보 마디에 주입한다.
 *
 * 마디 안에 코드가 여러 개면 `beat` 순으로 정렬해 **공백 2칸**으로 이어 붙인다
 * (NoteSheet 렌더러가 이 구분자로 마디를 나눠 그린다).
 * 이미 `chord` 가 있는 마디는 건드리지 않는다(MusicXML `<harmony>` 우선).
 */
export function applyChordAssignments(
  sheet: NoteSheetData,
  rawJson: string | object | null | undefined,
): NoteSheetData {
  if (!rawJson) return sheet;
  const doc = parseDoc(rawJson);
  if (!doc) return sheet;

  const status = (doc.measure_alignment?.status ?? 'aligned').toLowerCase();
  // 안전한 시스템 대응이 없으면 연결하지 않는다 — 틀린 위치의 코드가 더 나쁘다.
  if (status === 'mismatch') return sheet;

  /** MusicXML 마디번호(1-based) → 코드 문자열 */
  const byMeasureNumber = new Map<number, string>();

  for (const page of doc.pages ?? []) {
    for (const system of page?.systems ?? []) {
      for (const measure of system?.measures ?? []) {
        if (!measure) continue;
        const num = measure.musicxml_measure_number != null
          ? Number(measure.musicxml_measure_number)
          : NaN;
        // partial 에서 번호가 없는 마디는 건너뛴다(인덱스로 추측하지 않는다).
        if (!Number.isFinite(num)) continue;

        const symbols = (measure.chords ?? [])
          .map((c) => (c?.text_norm ?? c?.text_raw ?? '').trim())
          .filter((s) => s.length > 0);
        if (symbols.length === 0) continue;

        // beat 순 정렬 후 연속 중복 제거 (같은 코드가 두 번 읽히는 경우).
        const ordered = (measure.chords ?? [])
          .map((c, i) => ({
            sym: (c?.text_norm ?? c?.text_raw ?? '').trim(),
            beat: typeof c?.beat === 'number' ? c.beat : i + 1,
          }))
          .filter((c) => c.sym.length > 0)
          .sort((a, b) => a.beat - b.beat)
          .map((c) => c.sym)
          .filter((s, i, arr) => i === 0 || s !== arr[i - 1]);

        if (ordered.length > 0) byMeasureNumber.set(num, ordered.join('  '));
      }
    }
  }

  if (byMeasureNumber.size === 0) return sheet;

  const measures = sheet.measures.map((m, i) => {
    const sym = byMeasureNumber.get(i + 1); // MusicXML 마디 번호는 1부터
    return sym && !m.chord ? { ...m, chord: sym } : m;
  });

  return { ...sheet, measures };
}

/**
 * OMR 한 페이지(musicXml + chordAssignmentsJson) → NoteSheetData.
 *
 * 한손/양손은 MusicXML `<staves>` 로 자동 결정된다(`bassMeasures` 가 채워지면 양손).
 * 파트가 여러 개면 멜로디로 보이는 파트를 먼저 쓴다.
 */
export function omrPageToSheet(
  musicXml: string,
  chordAssignmentsJson: string | object | null | undefined,
  fallbackTitle: string,
): NoteSheetData {
  const parts = sortPartsByMelody(parseXmlString(musicXml, fallbackTitle));
  if (parts.length === 0) throw new Error('MusicXML 에서 파트를 찾지 못했습니다.');
  return applyChordAssignments(parts[0].data, chordAssignmentsJson);
}

/** 이 악보가 양손(그랜드스태프)인지 — `bassMeasures` 존재가 곧 판정 결과다. */
export function isGrandStaff(sheet: NoteSheetData): boolean {
  return Array.isArray(sheet.bassMeasures) && sheet.bassMeasures.length > 0;
}

/** 단건 조회 응답의 `omrResult` 모양 중 이 모듈이 쓰는 부분만. */
interface OmrResultLike {
  pages?: Array<{
    page?: number;
    musicXml?: string;
    chordAssignmentsJson?: string;
  }> | null;
}

/**
 * OMR 결과 **전체(여러 페이지)** → 악보 하나.
 *
 * 페이지는 한 곡의 연속이므로 마디를 페이지 순서대로 이어 붙인다. 곡 메타(제목·조·박자·
 * 템포)는 첫 페이지 것을 쓴다 — 뒤 페이지의 조/박자 변화는 마디 단위 필드로 이미 실려 있다.
 *
 * 양손 정렬: 한 페이지라도 왼손이 있으면 결과는 양손이 되고, 왼손이 없는 페이지 구간은
 * **빈 마디로 채워** `measures` 와 인덱스 1:1 을 유지한다(렌더러가 이 정렬을 가정한다).
 *
 * 파싱에 실패하거나 `musicXml` 이 없는 페이지는 건너뛴다(visual_only 등). 쓸 수 있는
 * 페이지가 하나도 없으면 **null** 을 반환해, 호출부가 기존 `sheetData` 로 폴백하게 한다.
 */
export function omrResultToSheet(
  omrResult: OmrResultLike | null | undefined,
  fallbackTitle: string,
): NoteSheetData | null {
  const pages = (omrResult?.pages ?? [])
    .filter((p) => typeof p?.musicXml === 'string' && p.musicXml.trim().length > 0)
    // `page` 가 없으면 배열 순서를 그대로 쓴다.
    .map((p, i) => ({ ...p, _order: typeof p.page === 'number' ? p.page : i + 1 }))
    .sort((a, b) => a._order - b._order);

  if (pages.length === 0) return null;

  const parsed: NoteSheetData[] = [];
  for (const p of pages) {
    try {
      parsed.push(omrPageToSheet(p.musicXml as string, p.chordAssignmentsJson, fallbackTitle));
    } catch {
      // 한 페이지가 깨져도 나머지는 살린다.
    }
  }
  if (parsed.length === 0) return null;

  const head = parsed[0];
  if (parsed.length === 1) return head;

  const anyGrand = parsed.some(isGrandStaff);
  const measures = parsed.flatMap((s) => s.measures);
  const bassMeasures = anyGrand
    ? parsed.flatMap((s) =>
        isGrandStaff(s)
          ? s.bassMeasures!
          // 이 페이지엔 왼손이 없다 — 오른손 마디 수만큼 빈 마디로 채워 정렬을 지킨다.
          : s.measures.map(() => ({ notes: [] })),
      )
    : undefined;

  return { ...head, measures, ...(bassMeasures ? { bassMeasures } : {}) };
}

/** 원문에 2단 보표가 하나라도 있나 — 무거운 파싱 전에 문자열로 싸게 거른다. */
function hasTwoStaves(omrResult: OmrResultLike | null | undefined): boolean {
  return (omrResult?.pages ?? []).some((p) => {
    const x = p?.musicXml;
    return typeof x === 'string' && /<staves>\s*[2-9]\s*<\/staves>/.test(x);
  });
}

/**
 * 저장된 `sheetData` 를 OMR 원문으로 **양손일 때만** 대체한다.
 *
 * 백엔드 `SheetDataResponse` 에는 `bassMeasures` 필드가 없어(문서 #21) 양손 악보의 왼손이
 * 저장 왕복에서 유실된다. 원문(`musicXml`)에는 남아 있으므로 그것을 파싱해 되살린다.
 *
 * 단선율 솔로는 손대지 않는다 — `sheetData` 로 이미 정상이고, 원문으로 갈아끼우면 얻는 것
 * 없이 회귀 위험만 생긴다. 그래서 교체 조건은 "**원문이 2단이고 실제로 왼손이 나왔을 때**"
 * 하나뿐이다.
 */
export function upgradeSheetWithOmr(
  sheetData: NoteSheetData,
  omrResult: OmrResultLike | null | undefined,
  fallbackTitle: string,
): NoteSheetData {
  if (isGrandStaff(sheetData)) return sheetData; // 이미 양손이면 그대로.
  if (!hasTwoStaves(omrResult)) return sheetData;

  const parsed = omrResultToSheet(omrResult, fallbackTitle);
  if (!parsed || !isGrandStaff(parsed)) return sheetData;

  /* 곡 메타는 저장본이 정본이다(사용자가 편집했을 수 있다). 원문에서 가져오는 건
   * 실제로 유실된 것 — 양손 마디뿐이다. */
  return { ...sheetData, measures: parsed.measures, bassMeasures: parsed.bassMeasures };
}
