import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runProcess, tail } from "./exec.js";

const FALLBACK_BINS = [
  "/Applications/MuseScore 4.app/Contents/MacOS/mscore",
  "/Applications/MuseScore 3.app/Contents/MacOS/mscore",
  "mscore",
  "musescore",
];

export class MscoreError extends Error {
  override readonly name = "MscoreError";
  readonly stderrTail: string;
  constructor(message: string, stderrTail = "") {
    super(message);
    this.stderrTail = stderrTail;
  }
}

let cachedBin: string | null = null;

export function resolveMscoreBin(): string {
  if (cachedBin) return cachedBin;
  const fromEnv = process.env.MSCORE_BIN?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    cachedBin = fromEnv;
    return cachedBin;
  }
  for (const candidate of FALLBACK_BINS) {
    if (candidate.includes("/") && existsSync(candidate)) {
      cachedBin = candidate;
      return cachedBin;
    }
  }
  cachedBin = "mscore";
  return cachedBin;
}

export async function getMscoreVersion(): Promise<string | null> {
  const bin = resolveMscoreBin();
  try {
    const result = await runProcess(bin, ["-v"], { timeoutMs: 15_000 });
    const haystack = `${result.stdout}\n${result.stderr}`;
    // mscore prints e.g. "MuseScore4 4.6.5" — grab the dotted version, not the suffix digit
    const match = haystack.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (match?.[1]) return match[1];
    return result.code === 0 ? "unknown" : null;
  } catch {
    return null;
  }
}

async function quickValidateMusicXml(input: string): Promise<void> {
  if (!existsSync(input)) {
    throw new MscoreError(`MusicXML input does not exist: ${input}`);
  }
  if (/\.mxl$/i.test(input)) {
    return;
  }
  const head = (await readFile(input, "utf8")).slice(0, 4096);
  if (!/<score-(partwise|timewise)/i.test(head)) {
    throw new MscoreError(
      `MusicXML root element <score-partwise|score-timewise> not found in ${path.basename(input)}`,
    );
  }
}

export interface MscoreRunResult {
  outputPath: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function convertWithMscore(
  inputMusicXml: string,
  outputPath: string,
  timeoutMs: number,
): Promise<MscoreRunResult> {
  const bin = resolveMscoreBin();
  await quickValidateMusicXml(inputMusicXml);

  let result;
  try {
    result = await runProcess(
      bin,
      [inputMusicXml, "-o", outputPath],
      { timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MscoreError(
      `Failed to spawn MuseScore CLI (${bin}): ${msg}. Set MSCORE_BIN to override.`,
    );
  }

  if (result.timedOut) {
    throw new MscoreError(
      `MuseScore timed out after ${timeoutMs}ms while writing ${path.basename(outputPath)}`,
      tail(result.stderr),
    );
  }
  if (result.code !== 0) {
    throw new MscoreError(
      `MuseScore exited with code ${result.code} while writing ${path.basename(outputPath)}`,
      tail(result.stderr),
    );
  }
  if (!existsSync(outputPath)) {
    throw new MscoreError(
      `MuseScore reported success but output ${outputPath} is missing`,
      tail(result.stderr),
    );
  }

  return {
    outputPath,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
  };
}
