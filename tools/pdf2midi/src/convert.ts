import { existsSync } from "node:fs";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AudiverisError,
  getAudiverisVersion,
  runAudiveris,
} from "./audiveris.js";
import {
  MscoreError,
  convertWithMscore,
  getMscoreVersion,
} from "./mscore.js";
import { buildSlug } from "./slug.js";
import type {
  ConvertOptions,
  ConvertOutcome,
  ConvertResultMeta,
  PipelineStage,
  ToolVersions,
} from "./types.js";
import { validate } from "./validate.js";

const DEFAULT_AUDIVERIS_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MSCORE_TIMEOUT_MS = 90 * 1000;

export interface ConvertSingleArgs {
  inputPdf: string;
  outputRoot: string;
  inputRoot: string;
  audio?: boolean;
  force?: boolean;
  audiverisTimeoutMs?: number;
  mscoreTimeoutMs?: number;
  versions?: ToolVersions;
}

export async function convertSingle(
  args: ConvertSingleArgs,
): Promise<ConvertOutcome> {
  const inputAbs = path.resolve(args.inputPdf);
  const inputRoot = path.resolve(args.inputRoot);
  const outputRoot = path.resolve(args.outputRoot);

  if (!existsSync(inputAbs)) {
    return failure(inputAbs, "scan", "Input PDF does not exist", "");
  }

  const rel = path.relative(inputRoot, inputAbs) || path.basename(inputAbs);
  const slug = buildSlug(inputAbs, rel);
  const itemDir = path.join(outputRoot, slug);
  const midiPath = path.join(itemDir, `${slug}.mid`);
  const mxlPath = path.join(itemDir, `${slug}.mxl`);
  const audioPath = path.join(itemDir, `${slug}.mp3`);
  const metaPath = path.join(itemDir, "meta.json");

  if (!args.force && existsSync(metaPath)) {
    try {
      const metaStat = await stat(metaPath);
      const inputStat = await stat(inputAbs);
      if (metaStat.mtimeMs >= inputStat.mtimeMs) {
        return {
          kind: "skipped",
          source: rel,
          reason: "already converted (meta.json newer than source)",
        };
      }
    } catch {
      // fall through and reconvert
    }
  }

  await mkdir(itemDir, { recursive: true });
  const tmpDir = path.join(itemDir, ".tmp");
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  const versions: ToolVersions = args.versions ?? {
    audiveris: await getAudiverisVersion(),
    mscore: await getMscoreVersion(),
  };

  const opts: ConvertOptions = {
    inputPdf: inputAbs,
    outputDir: itemDir,
    tmpDir,
    audio: args.audio ?? false,
    audiverisTimeoutMs: args.audiverisTimeoutMs ?? DEFAULT_AUDIVERIS_TIMEOUT_MS,
    mscoreTimeoutMs: args.mscoreTimeoutMs ?? DEFAULT_MSCORE_TIMEOUT_MS,
    force: args.force ?? false,
    versions,
  };

  let stage: PipelineStage = "audiveris";
  try {
    const audiverisResult = await runAudiveris(
      opts.inputPdf,
      tmpDir,
      opts.audiverisTimeoutMs,
    );

    await copyFile(audiverisResult.musicxmlPath, mxlPath);

    stage = "mscore_midi";
    await convertWithMscore(mxlPath, midiPath, opts.mscoreTimeoutMs);

    let renderedAudio: string | null = null;
    if (opts.audio) {
      stage = "mscore_audio";
      try {
        await convertWithMscore(mxlPath, audioPath, opts.mscoreTimeoutMs);
        renderedAudio = audioPath;
      } catch (err) {
        if (err instanceof MscoreError) {
          // audio is best-effort; do not fail the whole pipeline
          renderedAudio = null;
        } else throw err;
      }
    }

    stage = "validate";
    const validation = await validate(midiPath, mxlPath);

    stage = "meta";
    const meta: ConvertResultMeta = {
      source: rel,
      source_abs: inputAbs,
      slug,
      output_dir: itemDir,
      midi_path: midiPath,
      mxl_path: mxlPath,
      audio_path: renderedAudio,
      converted_at: new Date().toISOString(),
      audiveris_version: versions.audiveris,
      mscore_version: versions.mscore,
      duration_seconds: validation.stats.durationSeconds,
      midi_note_count: validation.stats.midiNoteCount,
      measure_count: validation.stats.measureCount,
      harmony_count: validation.stats.harmonyCount,
      part_count: validation.stats.partCount,
      warnings: validation.warnings,
      quality: validation.quality,
    };

    await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    await rm(tmpDir, { recursive: true, force: true });

    return { kind: "success", meta };
  } catch (err) {
    const tail = err instanceof AudiverisError || err instanceof MscoreError
      ? err.stderrTail
      : "";
    const message = err instanceof Error ? err.message : String(err);
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return failure(rel, stage, message, tail);
  }
}

function failure(
  source: string,
  stage: PipelineStage,
  error: string,
  stderr_tail: string,
): ConvertOutcome {
  return { kind: "failure", source, stage, error, stderr_tail };
}

function parseArgv(argv: string[]): { input?: string; outputRoot: string; audio: boolean; force: boolean } {
  let input: string | undefined;
  let outputRoot = path.resolve(
    fileURLToPath(new URL("../../../data/pdf2midi/", import.meta.url)),
  );
  let audio = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--output" || a === "-o") {
      outputRoot = path.resolve(argv[++i]!);
    } else if (a === "--audio") {
      audio = true;
    } else if (a === "--force" || a === "-f") {
      force = true;
    } else if (!a.startsWith("-") && !input) {
      input = path.resolve(a);
    }
  }
  return { input, outputRoot, audio, force };
}

const isDirectExec = (() => {
  try {
    return (
      import.meta.url === `file://${process.argv[1]}` ||
      import.meta.url === new URL(`file://${process.argv[1]}`).href
    );
  } catch {
    return false;
  }
})();

if (isDirectExec) {
  const { input, outputRoot, audio, force } = parseArgv(process.argv.slice(2));
  if (!input) {
    console.error(
      "Usage: tsx src/convert.ts <input.pdf> [--output <dir>] [--audio] [--force]",
    );
    process.exit(2);
  }
  const inputRoot = path.dirname(input);
  console.log(`[smoke] input:  ${input}`);
  console.log(`[smoke] output: ${outputRoot}`);
  const started = Date.now();
  convertSingle({
    inputPdf: input,
    outputRoot,
    inputRoot,
    audio,
    force,
  })
    .then((outcome) => {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      if (outcome.kind === "success") {
        console.log(`[smoke] ✓ ok in ${elapsed}s — quality=${outcome.meta.quality}`);
        console.log(`[smoke]   midi: ${outcome.meta.midi_path}`);
        console.log(`[smoke]   mxl:  ${outcome.meta.mxl_path}`);
        if (outcome.meta.audio_path)
          console.log(`[smoke]   mp3:  ${outcome.meta.audio_path}`);
        console.log(`[smoke]   notes=${outcome.meta.midi_note_count} measures=${outcome.meta.measure_count} harmony=${outcome.meta.harmony_count} duration=${outcome.meta.duration_seconds}s`);
        if (outcome.meta.warnings.length > 0) {
          console.log(`[smoke]   warnings:`);
          for (const w of outcome.meta.warnings) console.log(`[smoke]     - ${w}`);
        }
        process.exit(outcome.meta.quality === "failed" ? 1 : 0);
      } else if (outcome.kind === "skipped") {
        console.log(`[smoke] - skipped: ${outcome.reason}`);
        process.exit(0);
      } else {
        console.error(`[smoke] ✗ failed at stage=${outcome.stage}: ${outcome.error}`);
        if (outcome.stderr_tail)
          console.error(`[smoke]   stderr tail:\n${outcome.stderr_tail}`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("[smoke] unexpected error:", err);
      process.exit(2);
    });
}
