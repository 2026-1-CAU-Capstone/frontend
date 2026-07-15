/* §8 R7.1 — 화성 패턴 탐지(분석) 순수 모듈 (LeadSheet에서 분리).
 * ii-V 브래킷 / ii-V-I 스팬 / 세컨더리 도미넌트 화살표 탐지. UI 의존 없음 —
 * 입력은 resolved LeadSheetData, 출력은 chordId 기반 spec. 감사에서 포인터
 * 버그가 반복된 핫스팟(4,037줄 단일 파일)을 줄이는 1단계. */
import type { LeadSheetChord, LeadSheetData, LeadSheetSystem } from '../../data/leadSheetTypes';
import { normalizeQuality } from './leadSheetQuality';

export interface ArrowSpec {
  key: string;
  sourceChordId: string;
  targetChordId: string;
}

/* ─── ii-V detection ──────────────────────────────────────────────────── */

export interface BracketSpec {
  key: string;
  chordId1: string;
  chordId2: string;
}

const ROOT_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

export function chordPitchClass(root: string, accidental?: 'b' | '#'): number {
  const base = ROOT_PC[root] ?? 0;
  if (accidental === '#') return (base + 1) % 12;
  if (accidental === 'b') return (base + 11) % 12;
  return base;
}

/** True when the normalised quality is a dominant-7th type (7, 9, 13 …). */
function isDominant7(q: string): boolean {
  return /^7/.test(q) || /^(9|13)/.test(q);
}

/** True when q is the ii of a major 2-5-1 (must be -7). */
function isMajorII(q: string): boolean { return q.startsWith('-7'); }
/** True when q is the ii of a minor 2-5-1 (must be ø). */
function isMinorII(q: string): boolean { return q.startsWith('ø'); }
/** True when q is a major tonic (Δ7, △, 6, or bare major). */
function isMajorI(q: string): boolean {
  return q === '' || q.startsWith('△') || q === '6' || q.startsWith('maj');
}
/** True when q is a minor tonic (-7, -, -△7, etc. but NOT ø). */
function isMinorI(q: string): boolean {
  return q.startsWith('-') && !q.startsWith('ø');
}

/** Detect ii→V root motion (P4 up). Used for bracket detection — quality-agnostic. */
function isIIV(c1: LeadSheetChord, c2: LeadSheetChord): boolean {
  if (!c1.root || !c2.root || !c1.quality || !c2.quality) return false;
  const q1 = normalizeQuality(c1.quality);
  const q2 = normalizeQuality(c2.quality);
  if ((!isMajorII(q1) && !isMinorII(q1)) || !isDominant7(q2)) return false;
  const pc1 = chordPitchClass(c1.root, c1.accidental);
  const pc2 = chordPitchClass(c2.root, c2.accidental);
  return (pc2 - pc1 + 12) % 12 === 5;
}

/** Auto-detect ii-V pairs within each system row (expects resolved data). */
/**
 * Compute the active volta number for each bar in a system.
 * Once a bar has `ending: N`, all following bars in that system
 * are inside volta N until a different `ending` appears.
 * Returns an array parallel to system.bars (undefined = not inside any volta).
 */
function getActiveVoltas(system: LeadSheetSystem): (number | undefined)[] {
  let active: number | undefined;
  return system.bars.map((bar) => {
    if (bar.ending != null) active = bar.ending;
    return active;
  });
}

/** True when two volta values represent a cross-volta boundary.
 *  undefined→1 is OK (bars before volta lead into volta 1).
 *  1→2 is a boundary (volta 1 and 2 never play consecutively). */
function isVoltaBoundary(a?: number, b?: number): boolean {
  if (a == null || b == null) return false; // no-volta ↔ any volta is fine
  return a !== b;
}

export function detectIIVBrackets(data: LeadSheetData): BracketSpec[] {
  const brackets: BracketSpec[] = [];

  for (let si = 0; si < data.systems.length; si++) {
    const system = data.systems[si];
    const voltas = getActiveVoltas(system);
    const items: { chord: LeadSheetChord; key: string; volta?: number }[] = [];

    for (let bi = 0; bi < system.bars.length; bi++) {
      const bar = system.bars[bi];
      for (let ci = 0; ci < bar.chords.length; ci++) {
        items.push({ chord: bar.chords[ci], key: `${si}-${bi}-${ci}`, volta: voltas[bi] });
      }
    }

    for (let i = 0; i < items.length - 1; i++) {
      // Don't match across different volta brackets
      if (isVoltaBoundary(items[i].volta, items[i + 1].volta)) continue;
      if (isIIV(items[i].chord, items[i + 1].chord)) {
        brackets.push({
          key: `iiv-${items[i].key}`,
          chordId1: items[i].key,
          chordId2: items[i + 1].key,
        });
      }
    }
  }

  return brackets;
}

/** A continuous highlight span covering one ii-V-I progression. */
export interface IIVISpan {
  chordKeys: string[];              // ordered chord keys from ii through I
  chordRoles: string[];             // parallel to chordKeys: 'ii'/'V'/'I' (major) or 'iiø'/'V'/'i' (minor)
  label: string;                    // e.g. "G Minor 2-5-1"
  kind: 'major' | 'minor';
}

/** Detect ii-V-I across the entire song (cross-row).
 *  Consecutive duplicate chords are collapsed so resolved repeats don't
 *  break pattern matching. The I chord key is the actual occurrence that
 *  immediately follows V in sequence (not the first group occurrence),
 *  ensuring cross-row resolution is always highlighted correctly. */
export function detectIIVI(data: LeadSheetData): IIVISpan[] {
  const spans: IIVISpan[] = [];

  // Flatten all chords with chord-level keys and volta tracking.
  // Chords in different voltas must never form a pattern together.
  const all: { chord: LeadSheetChord; chordKey: string; volta?: number }[] = [];
  for (let si = 0; si < data.systems.length; si++) {
    const voltas = getActiveVoltas(data.systems[si]);
    for (let bi = 0; bi < data.systems[si].bars.length; bi++) {
      const bar = data.systems[si].bars[bi];
      for (let ci = 0; ci < bar.chords.length; ci++) {
        all.push({ chord: bar.chords[ci], chordKey: `${si}-${bi}-${ci}`, volta: voltas[bi] });
      }
    }
  }

  // Build fast lookup: chordKey → index in all[]
  const allIdxByKey = new Map<string, number>();
  all.forEach((item, idx) => allIdxByKey.set(item.chordKey, idx));

  // Collapse consecutive identical chords into groups (ordered keys).
  // Never merge across volta boundaries.
  const groups: { chord: LeadSheetChord; chordKeys: string[]; volta?: number }[] = [];
  for (const item of all) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      prev.volta === item.volta &&
      prev.chord.root === item.chord.root &&
      prev.chord.accidental === item.chord.accidental &&
      prev.chord.quality === item.chord.quality
    ) {
      prev.chordKeys.push(item.chordKey);
    } else {
      groups.push({ chord: item.chord, chordKeys: [item.chordKey], volta: item.volta });
    }
  }

  // Check consecutive groups for ii → V → I (strict: ii and I quality must agree)
  for (let i = 0; i < groups.length - 2; i++) {
    // Skip if any of the three groups cross a volta boundary
    if (isVoltaBoundary(groups[i].volta, groups[i + 1].volta) || isVoltaBoundary(groups[i + 1].volta, groups[i + 2].volta)) continue;
    if (!isDomResolution(groups[i + 1].chord, groups[i + 2].chord)) continue;

    const iiQ = normalizeQuality(groups[i].chord.quality ?? '');
    const vQ  = normalizeQuality(groups[i + 1].chord.quality ?? '');
    const iQ  = normalizeQuality(groups[i + 2].chord.quality ?? '');
    if (!isDominant7(vQ)) continue;

    const pc1 = groups[i].chord.root ? chordPitchClass(groups[i].chord.root!, groups[i].chord.accidental) : -1;
    const pc2 = groups[i + 1].chord.root ? chordPitchClass(groups[i + 1].chord.root!, groups[i + 1].chord.accidental) : -1;
    if ((pc2 - pc1 + 12) % 12 !== 5) continue; // must be ii→V root motion

    let kind: 'major' | 'minor' | null = null;
    if (isMajorII(iiQ) && isMajorI(iQ)) kind = 'major';
    else if (isMinorII(iiQ) && isMinorI(iQ)) kind = 'minor';
    // ø7 → V7 → IMaj7: ø의 ♭5는 V7 얼터드 텐션과 같으므로 메이저 2-5-1로 허용
    else if (isMinorII(iiQ) && isMajorI(iQ)) kind = 'major';
    if (!kind) continue;

    const tonicChord = groups[i + 2].chord;
    const tonicAcc = tonicChord.accidental === '#' ? '♯' : tonicChord.accidental === 'b' ? '♭' : '';
    const label = `${tonicChord.root ?? ''}${tonicAcc} ${kind === 'major' ? 'Major' : 'Minor'} 2-5-1`;

    // Find the actual I key: the item in all[] immediately after V's last occurrence.
    // This avoids the dedup bug where groups[i+2].chordKeys[0] might point to a
    // repeated I chord earlier in the song (same row as V) rather than the true resolution.
    const vLastKey = groups[i + 1].chordKeys[groups[i + 1].chordKeys.length - 1];
    const vLastIdx = allIdxByKey.get(vLastKey) ?? -1;
    const iActualKey = vLastIdx >= 0 && vLastIdx + 1 < all.length
      ? all[vLastIdx + 1].chordKey
      : groups[i + 2].chordKeys[0];

    spans.push({
      chordKeys: [
        groups[i].chordKeys[groups[i].chordKeys.length - 1],
        groups[i + 1].chordKeys[groups[i + 1].chordKeys.length - 1],
        iActualKey,
      ],
      chordRoles: kind === 'minor' ? ['iiø', 'V', 'i'] : ['ii', 'V', 'I'],
      label,
      kind,
    });
  }

  // Wrap-around: check last 2 groups + first group for a turnaround ii-V-I
  // (e.g. the D-7 G7 at the end of the last row resolving to C△7 at bar 1).
  if (groups.length >= 3) {
    const iiGroup = groups[groups.length - 2];
    const vGroup  = groups[groups.length - 1];
    const iGroup  = groups[0];
    if (isDomResolution(vGroup.chord, iGroup.chord)) {
      const iiQ = normalizeQuality(iiGroup.chord.quality ?? '');
      const vQ  = normalizeQuality(vGroup.chord.quality  ?? '');
      const iQ  = normalizeQuality(iGroup.chord.quality  ?? '');
      if (isDominant7(vQ)) {
        const pc1 = iiGroup.chord.root ? chordPitchClass(iiGroup.chord.root, iiGroup.chord.accidental) : -1;
        const pc2 = vGroup.chord.root  ? chordPitchClass(vGroup.chord.root,  vGroup.chord.accidental)  : -1;
        if ((pc2 - pc1 + 12) % 12 === 5) {
          let kind: 'major' | 'minor' | null = null;
          if (isMajorII(iiQ) && isMajorI(iQ)) kind = 'major';
          else if (isMinorII(iiQ) && isMinorI(iQ)) kind = 'minor';
          else if (isMinorII(iiQ) && isMajorI(iQ)) kind = 'major';
          if (kind) {
            const tonicChord = iGroup.chord;
            const tonicAcc = tonicChord.accidental === '#' ? '♯' : tonicChord.accidental === 'b' ? '♭' : '';
            const label = `${tonicChord.root ?? ''}${tonicAcc} ${kind === 'major' ? 'Major' : 'Minor'} 2-5-1`;
            spans.push({
              chordKeys: [
                iiGroup.chordKeys[iiGroup.chordKeys.length - 1],
                vGroup.chordKeys[vGroup.chordKeys.length - 1],
                iGroup.chordKeys[0],
              ],
              chordRoles: kind === 'minor' ? ['iiø', 'V', 'i'] : ['ii', 'V', 'I'],
              label,
              kind,
            });
          }
        }
      }
    }
  }

  // Volta-1 repeat: the last chords of volta 1 loop back to the repeat start.
  // Check if they form a ii-V-I with the first chord after the repeat-start barline.
  const repeatStartIdx = data.systems.findIndex((sys) => sys.hasRepeatStart);
  if (repeatStartIdx >= 0 && groups.length >= 3) {
    const repeatSys = data.systems[repeatStartIdx];
    let repeatIKey: string | undefined;
    findRepeatI: for (let bi = 0; bi < repeatSys.bars.length; bi++) {
      for (let ci = 0; ci < repeatSys.bars[bi].chords.length; ci++) {
        repeatIKey = `${repeatStartIdx}-${bi}-${ci}`;
        break findRepeatI;
      }
    }
    if (repeatIKey) {
      const repeatIGroup = groups.find((g) => g.chordKeys.includes(repeatIKey!));
      const v1Groups = groups.filter((g) => g.volta === 1);
      if (v1Groups.length >= 2 && repeatIGroup && repeatIGroup.volta !== 1) {
        const iiG = v1Groups[v1Groups.length - 2];
        const vG = v1Groups[v1Groups.length - 1];
        if (isDomResolution(vG.chord, repeatIGroup.chord)) {
          const iiQ = normalizeQuality(iiG.chord.quality ?? '');
          const vQ = normalizeQuality(vG.chord.quality ?? '');
          const iQ = normalizeQuality(repeatIGroup.chord.quality ?? '');
          if (isDominant7(vQ)) {
            const pc1 = iiG.chord.root ? chordPitchClass(iiG.chord.root, iiG.chord.accidental) : -1;
            const pc2 = vG.chord.root ? chordPitchClass(vG.chord.root, vG.chord.accidental) : -1;
            if ((pc2 - pc1 + 12) % 12 === 5) {
              let kind: 'major' | 'minor' | null = null;
              if (isMajorII(iiQ) && isMajorI(iQ)) kind = 'major';
              else if (isMinorII(iiQ) && isMinorI(iQ)) kind = 'minor';
              else if (isMinorII(iiQ) && isMajorI(iQ)) kind = 'major';
              if (kind) {
                const tc = repeatIGroup.chord;
                const tcAcc = tc.accidental === '#' ? '♯' : tc.accidental === 'b' ? '♭' : '';
                spans.push({
                  chordKeys: [
                    iiG.chordKeys[iiG.chordKeys.length - 1],
                    vG.chordKeys[vG.chordKeys.length - 1],
                    repeatIGroup.chordKeys[0],
                  ],
                  chordRoles: kind === 'minor' ? ['iiø', 'V', 'i'] : ['ii', 'V', 'I'],
                  label: `${tc.root ?? ''}${tcAcc} ${kind === 'major' ? 'Major' : 'Minor'} 2-5-1`,
                  kind,
                });
              }
            }
          }
        }
      }
    }
  }

  return spans;
}

/** True when source (dominant) resolves down a P5 to target. */
function isDomResolution(source: LeadSheetChord, target: LeadSheetChord): boolean {
  if (!source.root || !target.root || !source.quality) return false;
  const q = normalizeQuality(source.quality);
  if (!isDominant7(q)) return false;
  const srcPc = chordPitchClass(source.root, source.accidental);
  const tgtPc = chordPitchClass(target.root, target.accidental);
  return (srcPc - tgtPc + 12) % 12 === 7;
}

/** Auto-detect dominant resolutions V7 → I (song-wide, handles cross-row). */
export function detectSecDomArrows(data: LeadSheetData): ArrowSpec[] {
  const specs: ArrowSpec[] = [];

  // Flatten all chords across the entire song with volta tracking
  const all: { chord: LeadSheetChord; key: string; volta?: number }[] = [];
  for (let si = 0; si < data.systems.length; si++) {
    const voltas = getActiveVoltas(data.systems[si]);
    for (let bi = 0; bi < data.systems[si].bars.length; bi++) {
      const bar = data.systems[si].bars[bi];
      for (let ci = 0; ci < bar.chords.length; ci++) {
        all.push({ chord: bar.chords[ci], key: `${si}-${bi}-${ci}`, volta: voltas[bi] });
      }
    }
  }

  for (let i = 0; i < all.length - 1; i++) {
    // Don't match across different volta brackets
    if (isVoltaBoundary(all[i].volta, all[i + 1].volta)) continue;
    if (isDomResolution(all[i].chord, all[i + 1].chord)) {
      specs.push({
        key: `secdom-${all[i].key}`,
        sourceChordId: all[i].key,
        targetChordId: all[i + 1].key,
      });
    }
  }

  // Wrap-around: last chord → first chord (turnaround)
  if (all.length >= 2 && isDomResolution(all[all.length - 1].chord, all[0].chord)) {
    specs.push({
      key: `secdom-wrap`,
      sourceChordId: all[all.length - 1].key,
      targetChordId: all[0].key,
    });
  }

  return specs;
}
