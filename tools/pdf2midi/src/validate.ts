import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runProcess } from "./exec.js";
import type { ValidationResult, ValidationStats } from "./types.js";

const MIN_NOTE_COUNT = 10;
const MIN_DURATION_SECONDS = 4;
const MIN_MEASURE_COUNT = 4;

interface MidiSummary {
  noteCount: number;
  durationSeconds: number;
}

function readVarLen(buf: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  let i = offset;
  while (i < buf.length) {
    const byte = buf[i++]!;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: i };
  }
  throw new Error("Unexpected end of MIDI varlen");
}

export function parseMidi(buf: Buffer): MidiSummary {
  if (buf.length < 14 || buf.toString("ascii", 0, 4) !== "MThd") {
    throw new Error("Not a MIDI file (missing MThd)");
  }
  const division = buf.readUInt16BE(12);
  const ntracks = buf.readUInt16BE(10);
  let pos = 14;
  let noteCount = 0;

  let usPerQuarter = 500_000;
  let maxSeconds = 0;
  const isSmpte = (division & 0x8000) !== 0;
  const ticksPerQuarter = isSmpte ? 0 : division;

  for (let t = 0; t < ntracks; t++) {
    if (pos + 8 > buf.length) break;
    if (buf.toString("ascii", pos, pos + 4) !== "MTrk") {
      pos += 1;
      continue;
    }
    const trackLen = buf.readUInt32BE(pos + 4);
    const trackEnd = pos + 8 + trackLen;
    let i = pos + 8;
    let runningStatus = 0;
    let trackTicks = 0;
    let trackSeconds = 0;
    let lastTickConverted = 0;

    while (i < trackEnd) {
      const dv = readVarLen(buf, i);
      i = dv.next;
      trackTicks += dv.value;

      let status = buf[i]!;
      if ((status & 0x80) === 0) {
        status = runningStatus;
      } else {
        i += 1;
        runningStatus = status;
      }

      if (status === 0xff) {
        const metaType = buf[i++]!;
        const metaLen = readVarLen(buf, i);
        i = metaLen.next;
        if (metaType === 0x51 && metaLen.value === 3) {
          if (!isSmpte && ticksPerQuarter > 0) {
            const elapsedTicks = trackTicks - lastTickConverted;
            trackSeconds +=
              (elapsedTicks * usPerQuarter) / ticksPerQuarter / 1_000_000;
            lastTickConverted = trackTicks;
          }
          usPerQuarter =
            (buf[i]! << 16) | (buf[i + 1]! << 8) | buf[i + 2]!;
        }
        i += metaLen.value;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const sysLen = readVarLen(buf, i);
        i = sysLen.next + sysLen.value;
        continue;
      }

      const high = status & 0xf0;
      if (high === 0x90) {
        const _note = buf[i++]!;
        const vel = buf[i++]!;
        if (vel > 0) noteCount += 1;
      } else if (
        high === 0x80 ||
        high === 0xa0 ||
        high === 0xb0 ||
        high === 0xe0
      ) {
        i += 2;
      } else if (high === 0xc0 || high === 0xd0) {
        i += 1;
      } else {
        i += 1;
      }
    }

    if (!isSmpte && ticksPerQuarter > 0) {
      const elapsedTicks = trackTicks - lastTickConverted;
      trackSeconds +=
        (elapsedTicks * usPerQuarter) / ticksPerQuarter / 1_000_000;
    }
    if (trackSeconds > maxSeconds) maxSeconds = trackSeconds;
    pos = trackEnd;
  }

  return { noteCount, durationSeconds: maxSeconds };
}

interface MusicXmlSummary {
  measureCount: number;
  harmonyCount: number;
  partCount: number;
  wordsCount: number;
}

export function summarizeMusicXmlString(xml: string): MusicXmlSummary {
  const measureCount = (xml.match(/<measure[\s>]/g) ?? []).length;
  const harmonyCount = (xml.match(/<harmony[\s>]/g) ?? []).length;
  const partCount = (xml.match(/<score-part\s/g) ?? []).length;
  const wordsCount = (xml.match(/<words[\s>]/g) ?? []).length;
  return { measureCount, harmonyCount, partCount, wordsCount };
}

async function extractMxlToString(mxlPath: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdf2midi-mxl-"));
  try {
    const result = await runProcess("unzip", ["-o", "-qq", mxlPath, "-d", dir], {
      timeoutMs: 30_000,
    });
    if (result.code !== 0) {
      throw new Error(
        `unzip failed (code ${result.code}) on ${path.basename(mxlPath)}: ${result.stderr.slice(0, 200)}`,
      );
    }
    const containerPath = path.join(dir, "META-INF", "container.xml");
    let target: string | null = null;
    if (existsSync(containerPath)) {
      const container = await readFile(containerPath, "utf8");
      const m = container.match(/full-path="([^"]+)"/);
      if (m?.[1]) target = path.join(dir, m[1]);
    }
    if (!target || !existsSync(target)) {
      const ls = await runProcess("find", [dir, "-name", "*.xml", "-type", "f"], {
        timeoutMs: 5_000,
      });
      const candidates = ls.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s && !s.endsWith("container.xml"));
      target = candidates[0] ?? null;
    }
    if (!target) {
      throw new Error(`No MusicXML payload inside ${path.basename(mxlPath)}`);
    }
    return await readFile(target, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function readMusicXml(filePath: string): Promise<string> {
  if (/\.mxl$/i.test(filePath)) {
    return extractMxlToString(filePath);
  }
  return readFile(filePath, "utf8");
}

export async function validate(
  midiPath: string,
  musicxmlPath: string,
): Promise<ValidationResult> {
  const warnings: string[] = [];

  if (!existsSync(midiPath)) {
    return failed(["MIDI file missing"], warnings);
  }
  const midiBuf = await readFile(midiPath);
  if (midiBuf.length === 0) {
    return failed(["MIDI file is 0 bytes"], warnings);
  }

  let midiSummary: MidiSummary;
  try {
    midiSummary = parseMidi(midiBuf);
  } catch (err) {
    return failed([`MIDI parse error: ${(err as Error).message}`], warnings);
  }

  let xmlSummary: MusicXmlSummary = {
    measureCount: 0,
    harmonyCount: 0,
    partCount: 0,
    wordsCount: 0,
  };
  try {
    const xml = await readMusicXml(musicxmlPath);
    xmlSummary = summarizeMusicXmlString(xml);
  } catch (err) {
    warnings.push(`MusicXML read error: ${(err as Error).message}`);
  }

  const stats: ValidationStats = {
    midiBytes: midiBuf.length,
    midiNoteCount: midiSummary.noteCount,
    durationSeconds: Math.round(midiSummary.durationSeconds * 100) / 100,
    measureCount: xmlSummary.measureCount,
    harmonyCount: xmlSummary.harmonyCount,
    partCount: xmlSummary.partCount,
  };

  if (stats.midiNoteCount < MIN_NOTE_COUNT) {
    warnings.push(
      `Only ${stats.midiNoteCount} note events (min ${MIN_NOTE_COUNT})`,
    );
  }
  if (stats.durationSeconds < MIN_DURATION_SECONDS) {
    warnings.push(
      `Duration ${stats.durationSeconds}s below ${MIN_DURATION_SECONDS}s threshold`,
    );
  }
  if (stats.measureCount < MIN_MEASURE_COUNT) {
    warnings.push(
      `Only ${stats.measureCount} measures (min ${MIN_MEASURE_COUNT})`,
    );
  }
  if (stats.harmonyCount === 0 && xmlSummary.wordsCount > 0) {
    warnings.push(
      `Zero <harmony> elements but ${xmlSummary.wordsCount} <words> — chord symbols may have been parsed as plain text (jazz lead sheet?)`,
    );
  }

  const quality = warnings.length === 0 ? "ok" : "suspicious";
  return { quality, stats, warnings };
}

function failed(reasons: string[], extra: string[]): ValidationResult {
  return {
    quality: "failed",
    stats: {
      midiBytes: 0,
      midiNoteCount: 0,
      durationSeconds: 0,
      measureCount: 0,
      harmonyCount: 0,
      partCount: 0,
    },
    warnings: [...reasons, ...extra],
  };
}
