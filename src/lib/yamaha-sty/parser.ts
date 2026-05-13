/**
 * TypeScript port of JJazzLab's CASMDataReader.java (LGPL v2.1).
 *
 * Parses a Yamaha .sty / .sst / .prs / .bcs binary file into a {@link Style}
 * object. The file layout is documented in docs/sty-format.md; in short:
 *
 *   MThd  (8 bytes header + 6 bytes data)   ← standard SMF
 *   MTrk  (8 bytes header + N bytes data)   ← all MIDI events + meta markers
 *   CASM  (8 bytes header + section data)   ← Yamaha extension (this parser)
 *     └ CSEG ... (1+ section groups)
 *         ├ Sdec    : comma-separated StylePartType names
 *         ├ Ctab/Ctb2 : per-channel transposition rules
 *         └ Cntt    : optional NTT overrides (discarded by JJazzLab)
 *
 * This first pass parses the CASM tree only — it sets up the StyleParts
 * and their CtabChannelSettings, but leaves the per-section MIDI event
 * extraction (which uses the Marker meta-events in the MTrk) for a
 * follow-up. That matches JJazzLab's structure: CASMDataReader produces
 * StyleParts with no music data, then Style.read() loads the music.
 */

import { ByteReader } from './byte-reader';
import {
  createStyle, addStylePart, setChannelInstrument,
  type Style, type SFFVersion,
} from './style';
import {
  createStylePart, addNoteEvent, setSizeInBeats,
  type StylePart, type SourceNoteEvent,
} from './style-part';
import {
  stylePartTypeFromString, type StylePartType,
} from './style-part-type';
import {
  ntrFromByte, nttFromByte, rtrFromByte,
  type Ctb2ChannelSettings,
} from './ctb2-channel-settings';
import {
  createCtab, type CommonFirstPartFields, type CtabChannelSettings,
} from './ctab-channel-settings';

/* ─── public entry ───────────────────────────────────────────────────── */

export interface ParseOptions {
  /** Override the Style name (default = empty string; caller usually passes the file stem). */
  name?: string;
}

/**
 * Parse a Yamaha .sty/.sst/.prs/.bcs file from raw bytes.
 *
 * @throws if the header or CASM section is malformed.
 */
export function parseStyleFile(
  data: ArrayBuffer | Uint8Array,
  options: ParseOptions = {},
): Style {
  const reader = new ByteReader(data);
  const style = createStyle(options.name ?? '');

  parseHeader(reader, style);

  // First pass: harvest tempo, time-signature, program changes from MTrk.
  // Leaves the cursor at the end of MTrk.
  const mtrkStart = reader.position;
  parseMTrk(reader, style);
  const mtrkEnd = reader.position;

  // CASM tree comes immediately after MTrk and populates StyleParts + CTABs.
  parseCASM(reader, style);

  // Second pass: walk MTrk again with all StyleParts known, this time
  // partitioning notes into the right section + channel based on markers.
  reader.seek(mtrkStart);
  parseMTrkNotes(reader, style, mtrkEnd);

  return style;
}

/* ─── header + MTrk ──────────────────────────────────────────────────── */

function parseHeader(r: ByteReader, style: Style): void {
  r.expectAscii('MThd');
  const headerSize = r.readUInt32BE();
  if (headerSize !== 6) {
    throw new Error(`Unexpected MThd size: ${headerSize}`);
  }
  const format = r.readUInt16BE();
  const tracks = r.readUInt16BE();
  if (format !== 0 || tracks !== 1) {
    throw new Error(`Expected SMF format 0 / tracks 1, got format=${format} tracks=${tracks}`);
  }
  style.ticksPerQuarter = r.readUInt16BE();
}

/** Read MTrk; we only walk it shallowly to harvest the SInt program-change
 *  data, marker positions, and the initial tempo / time-signature. We don't
 *  yet extract notes (that needs a second pass once the section markers are
 *  known). */
function parseMTrk(r: ByteReader, style: Style): void {
  r.expectAscii('MTrk');
  const trackSize = r.readUInt32BE();
  const trackStart = r.position;
  const trackEnd = trackStart + trackSize;

  // First pass: harvest tempo, time signature, program changes.
  let runningStatus = 0;
  while (r.position < trackEnd) {
    r.readVLQ(); // delta time (ignored — we only harvest meta + program changes here)
    if (r.position >= trackEnd) break;

    let status = r.readUInt8();
    if (status < 0x80) {
      // running status
      r.seek(r.position - 1);
      status = runningStatus;
    } else {
      runningStatus = status;
    }
    const upper = status & 0xF0;
    const chan = status & 0x0F;

    if (upper === 0xC0) {
      // Program Change
      const program = r.readUInt8();
      // Initialise (don't overwrite if a later message changes it again — we
      // capture the *first* program for each channel because that's the one
      // the SInt section actually represents).
      if (!style.channelInstruments.has(chan)) {
        setChannelInstrument(style, chan, {
          program, bankMSB: 0, bankLSB: 0, volume: 100, pan: 64,
        });
      }
    } else if (upper === 0x80 || upper === 0x90 || upper === 0xA0 || upper === 0xB0 || upper === 0xE0) {
      // Note Off / Note On / Aftertouch / Control Change / Pitch Bend — all 2 data bytes
      r.skip(2);
    } else if (upper === 0xD0) {
      // Channel pressure — 1 data byte
      r.skip(1);
    } else if (status === 0xFF) {
      // Meta event
      const meta = r.readUInt8();
      const length = r.readVLQ();
      if (meta === 0x51 && length === 3) {
        // Tempo: microseconds per quarter note (24-bit BE)
        const b0 = r.readUInt8(), b1 = r.readUInt8(), b2 = r.readUInt8();
        const micros = (b0 << 16) | (b1 << 8) | b2;
        if (style.tempo === 0 && micros > 0) {
          style.tempo = Math.round(60_000_000 / micros);
        }
      } else if (meta === 0x58 && length === 4) {
        // Time signature
        const num = r.readUInt8();
        const denomLog2 = r.readUInt8();
        r.skip(2); // ticks/click, 32nd-notes/quarter
        style.timeSignature = { numerator: num, denominator: 1 << denomLog2 };
      } else {
        r.skip(length);
      }
    } else if (status === 0xF0 || status === 0xF7) {
      // sysex
      const length = r.readVLQ();
      r.skip(length);
    } else {
      throw new Error(`Unknown MIDI status byte 0x${status.toString(16)} at pos ${r.position}`);
    }
  }
  r.seek(trackEnd);
}

/* ─── MTrk note extraction (second pass) ────────────────────────────── */

/**
 * Walk MTrk again, partition NoteOn/NoteOff events into the correct
 * StylePart + channel based on Marker meta events. Pairs NoteOn with the
 * matching NoteOff (same channel + pitch) to compute durationTicks.
 *
 * Port of MPL_MusicData.onMarkerParsed + onNoteParsed (LGPL v2.1).
 */
function parseMTrkNotes(r: ByteReader, style: Style, mtrkEnd: number): void {
  r.expectAscii('MTrk');
  r.readUInt32BE(); // size — we already know it
  const trackStart = r.position;
  const trackEnd = mtrkEnd; // cursor must end here

  let runningStatus = 0;
  let absoluteTick = 0;
  let currentSection: StylePart | null = null;
  let sectionStartTick = 0;
  // Track open NoteOns so we can pair them with NoteOff for duration. Keyed
  // by channel*128 + pitch.
  const openNotes = new Map<number, SourceNoteEvent>();

  while (r.position < trackEnd) {
    const delta = r.readVLQ();
    absoluteTick += delta;
    if (r.position >= trackEnd) break;

    let status = r.readUInt8();
    if (status < 0x80) {
      r.seek(r.position - 1);
      status = runningStatus;
    } else {
      runningStatus = status;
    }
    const upper = status & 0xF0;
    const chan = status & 0x0F;

    if (upper === 0x90) {
      // Note On
      const pitch = r.readUInt8();
      const vel = r.readUInt8();
      if (vel > 0) {
        if (currentSection !== null) {
          const ev: SourceNoteEvent = {
            channel: chan,
            pitch,
            velocity: vel,
            tick: absoluteTick - sectionStartTick,
            durationTicks: 0,
          };
          addNoteEvent(currentSection, ev);
          openNotes.set(chan * 128 + pitch, ev);
        }
      } else {
        // velocity 0 = note off in MIDI's running-status idiom
        closeNote(openNotes, chan, pitch, absoluteTick, sectionStartTick);
      }
    } else if (upper === 0x80) {
      // Note Off
      const pitch = r.readUInt8();
      r.readUInt8(); // velocity (ignored)
      closeNote(openNotes, chan, pitch, absoluteTick, sectionStartTick);
    } else if (upper === 0xA0 || upper === 0xB0 || upper === 0xE0) {
      r.skip(2);
    } else if (upper === 0xC0 || upper === 0xD0) {
      r.skip(1);
    } else if (status === 0xFF) {
      const meta = r.readUInt8();
      const length = r.readVLQ();
      if (meta === 0x06) {
        // Marker
        const markerBytes = r.readBytes(length);
        const markerStr = String.fromCharCode(...markerBytes);

        // Finalise the previous section's beats
        if (currentSection !== null) {
          const beats = (absoluteTick - sectionStartTick) / style.ticksPerQuarter;
          const rounded = Math.round(beats);
          if (rounded >= 1) setSizeInBeats(currentSection, rounded);
        }

        const t = stylePartTypeFromString(markerStr);
        if (t !== null) {
          currentSection = style.parts.get(t) ?? null;
          sectionStartTick = absoluteTick;
        } else {
          // Not a section marker (e.g. "SFF1", "SInt") — leave currentSection null
          currentSection = null;
        }
      } else if (meta === 0x2F) {
        // End-of-track: finalise the last section
        if (currentSection !== null) {
          const beats = (absoluteTick - sectionStartTick) / style.ticksPerQuarter;
          const rounded = Math.round(beats);
          if (rounded >= 1) setSizeInBeats(currentSection, rounded);
        }
        r.skip(length);
        break;
      } else {
        r.skip(length);
      }
    } else if (status === 0xF0 || status === 0xF7) {
      const length = r.readVLQ();
      r.skip(length);
    } else {
      throw new Error(`Unknown MIDI status byte 0x${status.toString(16)} at pos ${r.position}`);
    }
  }

  void trackStart;
}

function closeNote(
  open: Map<number, SourceNoteEvent>,
  channel: number,
  pitch: number,
  absoluteTick: number,
  sectionStartTick: number,
): void {
  const key = channel * 128 + pitch;
  const ev = open.get(key);
  if (ev) {
    ev.durationTicks = absoluteTick - sectionStartTick - ev.tick;
    open.delete(key);
  }
}

/* ─── CASM tree ──────────────────────────────────────────────────────── */

function parseCASM(r: ByteReader, style: Style): void {
  // CASMDataReader.java tolerates ±1 byte offset of the "CASM" tag for
  // corrupted files. We replicate that recovery.
  const probe = r.readBytes(4);
  const asStr = String.fromCharCode(...probe);
  if (asStr === 'CASM') {
    // happy path (Java's "CASM was 1 byte too early" case actually — but we
    // got it right on the first try)
  } else if (asStr.substring(1) === 'CAS') {
    // normal case: we've consumed one byte already (whatever padding), then "CASM" follows
    r.expectAscii('M');
  } else if (asStr.substring(2) === 'CA') {
    r.expectAscii('SM');
  } else {
    throw new Error(`CASM tag not found near pos ${r.position} (got "${asStr}")`);
  }

  const casmSize = r.readUInt32BE();
  const casmEnd = r.position + casmSize;

  while (r.position < casmEnd) {
    parseCSEG(r, style);
  }
}

function parseCSEG(r: ByteReader, style: Style): void {
  r.expectAscii('CSEG');
  const csegSize = r.readUInt32BE();
  const csegEnd = r.position + csegSize;

  // 1. Sdec — section names
  r.expectAscii('Sdec');
  const sdecSize = r.readUInt32BE();
  const sdecBytes = r.readBytes(sdecSize);
  const sdecStr = String.fromCharCode(...sdecBytes);
  const partTypes: StylePartType[] = sdecStr
    .split(/\s*,\s*/)
    .map((s) => {
      const t = stylePartTypeFromString(s);
      if (t === null) throw new Error(`Unrecognised StylePartType in Sdec: "${s}"`);
      return t;
    });

  // Ensure the affected StyleParts exist
  const impactedParts: StylePart[] = partTypes.map((t) => {
    let sp = style.parts.get(t);
    if (!sp) {
      sp = createStylePart(t);
      addStylePart(style, sp);
    }
    return sp;
  });

  // 2. One or more Ctab / Ctb2 / Cntt sub-sections
  while (r.position < csegEnd) {
    const sectionName = r.readString(4);
    const sectionSize = r.readUInt32BE();
    const sectionBytes = r.readBytes(sectionSize);

    switch (sectionName) {
      case 'Ctab': {
        style.sff = 'SFF1';
        const ctab = parseCtabData(sectionBytes, 'SFF1');
        for (const sp of impactedParts) sp.ctabByChannel.set(ctab.channel, ctab);
        break;
      }
      case 'Ctb2': {
        style.sff = 'SFF2';
        const ctab = parseCtb2Data(sectionBytes);
        for (const sp of impactedParts) sp.ctabByChannel.set(ctab.channel, ctab);
        break;
      }
      case 'Cntt': {
        // NTT override — JJazzLab discards this; we do too (for now).
        break;
      }
      default:
        throw new Error(`Unknown CSEG sub-section "${sectionName}"`);
    }
  }
}

/* ─── Ctab / Ctb2 record parsing ─────────────────────────────────────── */

function parseCtabData(bytes: Uint8Array, sff: SFFVersion): CtabChannelSettings {
  const r = new ByteReader(bytes);
  const cf = parseCommonFirstPart(r);
  const ctb2Main = parseCtb2Subpart(r, ntr0FromCf(cf), sff);
  // SFF1 has one trailing "specialFeature" byte we mostly ignore.
  if (r.remaining >= 1) {
    const sf = r.readUInt8();
    if (sf !== 0 && r.remaining >= 4) {
      r.skip(4); // extra-break-drum-voice bytes — rare, not modelled
    }
  }
  return createCtab(cf, ctb2Main, { sff });
}

function parseCtb2Data(bytes: Uint8Array): CtabChannelSettings {
  const r = new ByteReader(bytes);
  const cf = parseCommonFirstPart(r);
  const middleLowPitch = r.readUInt8();
  const middleHighPitch = r.readUInt8();
  if (middleLowPitch > 127) throw new Error(`middleLowPitch out of range: ${middleLowPitch}`);
  if (middleHighPitch > 127) throw new Error(`middleHighPitch out of range: ${middleHighPitch}`);

  // Three subparts; we use the same NTR for all (the spec lets it differ,
  // but in practice it's the same byte position repeated).
  // We need to read the NTR per subpart, so let's just decode each.
  const ctb2Low = middleLowPitch > 0 ? parseCtb2Subpart(r, undefined, 'SFF2') : skipCtb2Subpart(r);
  const ctb2Main = parseCtb2Subpart(r, undefined, 'SFF2');
  const ctb2High = middleHighPitch < 127 ? parseCtb2Subpart(r, undefined, 'SFF2') : skipCtb2Subpart(r);

  // Skip 7 final "unknown bytes" per CASMDataReader.java
  if (r.remaining >= 7) r.skip(7);

  return createCtab(cf, ctb2Main, {
    sff: 'SFF2',
    ctb2Low,
    ctb2High,
    ctb2MiddleLowPitch: middleLowPitch,
    ctb2MiddleHighPitch: middleHighPitch,
  });
}

/** Parse the 20-byte common first part of Ctab/Ctb2. */
function parseCommonFirstPart(r: ByteReader): CommonFirstPartFields {
  const srcChannel = r.readUInt8();
  const name = r.readString(8).trimEnd();
  const destChannel = r.readUInt8();
  // editable in Java is `(byte == 0)`, so the stored sense is inverted.
  const editable = r.readUInt8() === 0;
  const mn1 = r.readUInt8(), mn2 = r.readUInt8();
  const mc1 = r.readUInt8(), mc2 = r.readUInt8(), mc3 = r.readUInt8();
  const mc4 = r.readUInt8(), mc5 = r.readUInt8();
  const sourceChordNote = r.readUInt8();
  const sourceChordTypeByte = r.readUInt8();
  return {
    srcChannel, name, destChannel, editable,
    mutedNotesBytes: [mn1, mn2],
    mutedChordsBytes: [mc1, mc2, mc3, mc4, mc5],
    sourceChordNote, sourceChordTypeByte,
  };
}

/** Parse a 6-byte Ctb2 subpart. If `ntrHint` is given (only the SFF1 path
 *  knows it via Ctab structure), we use it; otherwise we read NTR fresh. */
function parseCtb2Subpart(
  r: ByteReader,
  _ntrHint: unknown,
  sff: SFFVersion,
): Ctb2ChannelSettings {
  const ntr = ntrFromByte(r.readUInt8());
  const nttByte = r.readUInt8();
  const { ntt, bassOn } = nttFromByte(nttByte, ntr, sff);
  const chordRootUpperLimit = r.readUInt8();
  const noteLowLimit = r.readUInt8();
  const noteHighLimit = r.readUInt8();
  const rtr = rtrFromByte(r.readUInt8());
  return { ntr, ntt, bassOn, chordRootUpperLimit, noteLowLimit, noteHighLimit, rtr };
}

/** Java parseCtb2Subpart() with `ctb2 == null` path: just consume 6 bytes. */
function skipCtb2Subpart(r: ByteReader): null {
  r.skip(6);
  return null;
}

// Helper kept for symmetry with the Java code which sometimes hints NTR
// from an outer scope; we don't yet use it but keep the signature open.
function ntr0FromCf(_cf: CommonFirstPartFields): undefined {
  return undefined;
}
