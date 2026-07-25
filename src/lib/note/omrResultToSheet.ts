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
