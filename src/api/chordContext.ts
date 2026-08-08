import type { LeadSheetData } from '../data/leadSheetTypes';

/**
 * Serialize LeadSheetData into a concise text summary for the AI model.
 * Includes chord symbols, degrees, functions, secondary dominants, etc.
 */
export function buildChordContext(data: LeadSheetData): string {
  const lines: string[] = [];
  lines.push(`Song: ${data.title}`);
  lines.push(`Composer: ${data.composer}`);
  lines.push(`Key: ${data.key ?? 'C'}`);
  lines.push(`Time Signature: ${data.timeSignature}`);
  lines.push('');
  lines.push('=== Chord Progression ===');
  lines.push('(Note: Each bar below represents one chord change. In the original chart, some chords may span two bars when repeated.)');

  let prevChord: typeof data.systems[0]['bars'][0]['chords'][0] | null = null;
  let barCounter = 0;

  for (const system of data.systems) {
    if (system.sectionLabel) lines.push(`\n[Section: ${system.sectionLabel}]`);
    else if (system.label) lines.push(`\n[Section: ${system.label}]`);
    for (const bar of system.bars) {
      barCounter++;
      const barNum = bar.measureNumber ?? barCounter;
      for (let chord of bar.chords) {
        // Resolve repeat: use previous chord's symbol/analysis
        if (chord.isRepeat && prevChord) {
          chord = { ...prevChord, isRepeat: undefined };
        }
        if (!chord.isRepeat) prevChord = chord;
        const symbol = formatChordSymbol(chord);
        if (!symbol) continue;
        const a = chord.analysis;
        if (!a) {
          lines.push(`  Bar ${barNum}: ${symbol}`);
          continue;
        }

        const parts: string[] = [`Bar ${barNum}: ${symbol}`];
        if (a.degree) parts.push(`degree=${a.degree}`);
        if (a.isDiatonic !== undefined) parts.push(a.isDiatonic ? 'diatonic' : 'non-diatonic');

        // Functions
        if (a.functions?.length) {
          const fns = a.functions.map(f => {
            const label = f.function === 'T' ? 'Tonic' : f.function === 'SD' ? 'Subdominant' : f.function === 'D' ? 'Dominant' : f.function;
            let s = `${label}(${Math.round(f.confidence * 100)}%)`;
            if (f.note) s += ` — ${f.note}`;
            return s;
          }).join(', ');
          parts.push(`fn=[${fns}]`);
        }

        // Secondary dominant
        if (a.secondaryDominant) {
          const sd = a.secondaryDominant;
          const label = sd.label || (sd.targetDegree ? `V/${sd.targetDegree}` : '');
          parts.push(`secDom=${label}${sd.resolved ? ' (resolved)' : ' (unresolved)'}`);
        }

        // Group memberships (ii-V-I etc.)
        if (a.groupMemberships?.length) {
          for (const g of a.groupMemberships) {
            parts.push(`group=${g.groupType}[${g.role}]${g.variant !== 'standard' ? `(${g.variant})` : ''}`);
          }
        }

        // Modal interchange
        if (a.modalInterchange) {
          parts.push(`modalInterchange=${a.modalInterchange.borrowedDegree} from ${a.modalInterchange.sourceMode}`);
        }

        // Deceptive resolution
        if (a.deceptiveResolution) {
          parts.push(`deceptive: expected ${a.deceptiveResolution.expected} → got ${a.deceptiveResolution.actual}`);
        }

        // Mode segment
        if (a.modeSegment) parts.push(`mode=${a.modeSegment}`);

        lines.push(`  ${parts.join(' | ')}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Build context from raw analysis JSON (allofme_analysis.json format)
 */
export function buildRawAnalysisContext(data: {
  song: { title: string; key: string; time_signature: string };
  chords: Array<{
    bar: number;
    beat: number;
    symbol: string;
    duration_beats: number;
    analysis: {
      root_name: string;
      quality: string;
      degree: string;
      is_diatonic: boolean;
      functions: Array<{ function: string; confidence: number; note?: string }>;
      secondary_dominant: { type: string; target_degree: string; target_chord: string; resolved: boolean } | null;
      group_memberships: Array<{ group_id: number; group_type: string; role: string; variant: string }>;
      modal_interchange: { source_mode: string; borrowed_degree: string } | null;
      deceptive_resolution: { expected_resolution: string; actual_resolution: string } | null;
      pedal_info: { pedal_note_name: string; pedal_type: string } | null;
      mode_segment: string;
      tonicization: { temporary_key: string; confidence: number } | null;
      ambiguity_score: number;
    };
  }>;
}): string {
  const lines: string[] = [];
  lines.push(`Song: ${data.song.title}`);
  lines.push(`Key: ${data.song.key}`);
  lines.push(`Time Signature: ${data.song.time_signature}`);
  lines.push('');
  lines.push('=== Chord-by-Chord Analysis ===');

  for (const c of data.chords) {
    const a = c.analysis;
    const parts: string[] = [`Bar ${c.bar} (beat ${c.beat}): ${c.symbol} [${c.duration_beats} beats]`];
    parts.push(`degree=${a.degree}`);
    parts.push(a.is_diatonic ? 'diatonic' : 'non-diatonic');

    if (a.functions.length) {
      const fns = a.functions.map(f => {
        const label = f.function === 'T' ? 'Tonic' : f.function === 'SD' ? 'Subdominant' : f.function === 'D' ? 'Dominant' : f.function;
        let s = `${label}(${Math.round(f.confidence * 100)}%)`;
        if (f.note) s += ` — ${f.note}`;
        return s;
      }).join(', ');
      parts.push(`fn=[${fns}]`);
    }

    if (a.secondary_dominant) {
      parts.push(`secDom=${a.secondary_dominant.type} → ${a.secondary_dominant.target_chord}${a.secondary_dominant.resolved ? ' (resolved)' : ' (unresolved)'}`);
    }

    if (a.group_memberships.length) {
      for (const g of a.group_memberships) {
        parts.push(`group=${g.group_type}[${g.role}]${g.variant !== 'standard' ? `(${g.variant})` : ''}`);
      }
    }

    if (a.modal_interchange) {
      parts.push(`modalInterchange=${a.modal_interchange.borrowed_degree} from ${a.modal_interchange.source_mode}`);
    }

    if (a.deceptive_resolution) {
      parts.push(`deceptive: expected ${a.deceptive_resolution.expected_resolution} → got ${a.deceptive_resolution.actual_resolution}`);
    }

    if (a.tonicization) {
      parts.push(`tonicization → ${a.tonicization.temporary_key}(${Math.round(a.tonicization.confidence * 100)}%)`);
    }

    if (a.pedal_info) {
      parts.push(`pedal=${a.pedal_info.pedal_note_name}(${a.pedal_info.pedal_type})`);
    }

    if (a.mode_segment) parts.push(`mode=${a.mode_segment}`);
    if (a.ambiguity_score > 0.2) parts.push(`ambiguity=${a.ambiguity_score.toFixed(2)}`);

    lines.push(`  ${parts.join(' | ')}`);
  }

  return lines.join('\n');
}

function formatChordSymbol(chord: { root?: string; accidental?: 'b' | '#'; quality?: string; bass?: { root: string; accidental?: 'b' | '#' } }): string {
  let s = chord.root ?? '';
  if (chord.accidental) s += chord.accidental;
  if (chord.quality) s += chord.quality;
  if (chord.bass) {
    s += '/' + chord.bass.root;
    if (chord.bass.accidental) s += chord.bass.accidental;
  }
  return s;
}
