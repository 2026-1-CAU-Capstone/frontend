import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAudiverisVersion, resolveAudiverisBin } from "./audiveris.js";
import { convertSingle } from "./convert.js";
import { getMscoreVersion, resolveMscoreBin } from "./mscore.js";
import type { ConvertOutcome, ToolVersions } from "./types.js";

const TOOL_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const DEFAULT_INPUT = path.join(TOOL_ROOT, "input");
const DEFAULT_OUTPUT = path.join(REPO_ROOT, "data", "pdf2midi");
const LOGS_ROOT = path.join(TOOL_ROOT, "logs");

interface BatchArgs {
  input: string;
  output: string;
  concurrency: number;
  audio: boolean;
  force: boolean;
  retryFrom: string | null;
  audiverisTimeoutMs: number;
  mscoreTimeoutMs: number;
}

function parseArgs(argv: string[]): BatchArgs {
  const args: BatchArgs = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    concurrency: Math.max(1, os.cpus().length - 1),
    audio: false,
    force: false,
    retryFrom: null,
    audiverisTimeoutMs: 5 * 60 * 1000,
    mscoreTimeoutMs: 90 * 1000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--input":
      case "-i":
        args.input = path.resolve(argv[++i]!);
        break;
      case "--output":
      case "-o":
        args.output = path.resolve(argv[++i]!);
        break;
      case "--concurrency":
      case "-c":
        args.concurrency = Math.max(1, parseInt(argv[++i]!, 10) || 1);
        break;
      case "--audio":
        args.audio = true;
        break;
      case "--force":
      case "-f":
        args.force = true;
        break;
      case "--retry":
      case "--from":
        args.retryFrom = path.resolve(argv[++i] ?? "");
        break;
      case "--audiveris-timeout":
        args.audiverisTimeoutMs = parseInt(argv[++i]!, 10) || args.audiverisTimeoutMs;
        break;
      case "--mscore-timeout":
        args.mscoreTimeoutMs = parseInt(argv[++i]!, 10) || args.mscoreTimeoutMs;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (a.startsWith("-")) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`pdf2midi batch runner

Usage:
  tsx src/batch.ts [options]
  tsx src/batch.ts --retry <failure.jsonl>

Options:
  -i, --input <dir>         input directory (default: ${path.relative(process.cwd(), DEFAULT_INPUT)})
  -o, --output <dir>        output directory (default: ${path.relative(process.cwd(), DEFAULT_OUTPUT)})
  -c, --concurrency <n>     parallel workers (default: cpus-1 = ${Math.max(1, os.cpus().length - 1)})
  -f, --force               re-convert even if meta.json already exists
      --audio               also render .mp3 alongside .mid
      --retry <jsonl>       only process sources listed in a failure.jsonl
      --audiveris-timeout <ms>  per-file Audiveris timeout (default 300000)
      --mscore-timeout <ms>     per-file MuseScore timeout (default 90000)
  -h, --help                show this help

Environment:
  AUDIVERIS_BIN             override path to Audiveris CLI
  MSCORE_BIN                override path to MuseScore CLI
`);
}

async function walkPdfs(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && /\.pdf$/i.test(e.name)) {
        out.push(full);
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}

async function loadRetryList(jsonlPath: string, inputRoot: string): Promise<string[]> {
  const text = await readFile(jsonlPath, "utf8");
  const lines = text.split(/\r?\n/).filter((s) => s.trim().length > 0);
  const sources: string[] = [];
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as { source?: string };
      if (rec.source) {
        const abs = path.isAbsolute(rec.source)
          ? rec.source
          : path.resolve(inputRoot, rec.source);
        sources.push(abs);
      }
    } catch {
      // skip malformed lines
    }
  }
  return sources;
}

interface Counters {
  total: number;
  done: number;
  ok: number;
  suspicious: number;
  failed: number;
  skipped: number;
  startedAt: number;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // log dirs
  const today = new Date().toISOString().slice(0, 10);
  const logDir = path.join(LOGS_ROOT, today);
  await mkdir(logDir, { recursive: true });
  const fullLog = path.join(logDir, "full.log");
  const successLog = path.join(logDir, "success.jsonl");
  const failureLog = path.join(logDir, "failure.jsonl");
  const suspiciousLog = path.join(logDir, "suspicious.jsonl");

  await mkdir(args.output, { recursive: true });

  const log = async (line: string) => {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    console.log(stamped);
    await appendFile(fullLog, stamped + "\n", "utf8");
  };

  // probe tools
  await log(`Audiveris bin: ${resolveAudiverisBin()}`);
  await log(`MuseScore bin: ${resolveMscoreBin()}`);
  const versions: ToolVersions = {
    audiveris: await getAudiverisVersion(),
    mscore: await getMscoreVersion(),
  };
  await log(
    `Versions: audiveris=${versions.audiveris ?? "MISSING"} mscore=${versions.mscore ?? "MISSING"}`,
  );
  if (!versions.audiveris) {
    await log(
      "WARN: Audiveris not detected. Install from https://github.com/Audiveris/audiveris/releases or set AUDIVERIS_BIN",
    );
  }
  if (!versions.mscore) {
    await log("WARN: MuseScore CLI not detected. Set MSCORE_BIN to override.");
  }

  // collect inputs
  let pdfs: string[];
  if (args.retryFrom) {
    if (!existsSync(args.retryFrom)) {
      await log(`Retry list does not exist: ${args.retryFrom}`);
      process.exit(2);
    }
    pdfs = await loadRetryList(args.retryFrom, args.input);
    await log(`Retry mode: loaded ${pdfs.length} entries from ${args.retryFrom}`);
  } else {
    pdfs = await walkPdfs(args.input);
    await log(`Scanned ${args.input}: found ${pdfs.length} PDFs`);
  }

  if (pdfs.length === 0) {
    await log("nothing to do");
    return;
  }

  const counters: Counters = {
    total: pdfs.length,
    done: 0,
    ok: 0,
    suspicious: 0,
    failed: 0,
    skipped: 0,
    startedAt: Date.now(),
  };

  let nextIndex = 0;
  const workerCount = Math.min(args.concurrency, pdfs.length);
  await log(`Starting ${workerCount} workers (concurrency=${args.concurrency}) audio=${args.audio} force=${args.force}`);

  const handle = async (idx: number, pdf: string) => {
    const rel = path.relative(args.input, pdf) || path.basename(pdf);
    await log(`[${idx + 1}/${counters.total}] -> ${rel}`);
    let outcome: ConvertOutcome;
    try {
      outcome = await convertSingle({
        inputPdf: pdf,
        outputRoot: args.output,
        inputRoot: args.input,
        audio: args.audio,
        force: args.force,
        audiverisTimeoutMs: args.audiverisTimeoutMs,
        mscoreTimeoutMs: args.mscoreTimeoutMs,
        versions,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome = {
        kind: "failure",
        source: rel,
        stage: "audiveris",
        error: `unexpected: ${message}`,
        stderr_tail: "",
      };
    }

    counters.done += 1;
    if (outcome.kind === "success") {
      const q = outcome.meta.quality;
      if (q === "ok") counters.ok += 1;
      else if (q === "suspicious") counters.suspicious += 1;
      else counters.failed += 1;

      const summary = {
        source: outcome.meta.source,
        slug: outcome.meta.slug,
        quality: outcome.meta.quality,
        midi_note_count: outcome.meta.midi_note_count,
        measure_count: outcome.meta.measure_count,
        harmony_count: outcome.meta.harmony_count,
        duration_seconds: outcome.meta.duration_seconds,
        warnings: outcome.meta.warnings,
      };
      await appendFile(successLog, JSON.stringify(summary) + "\n", "utf8");
      if (q === "suspicious") {
        await appendFile(suspiciousLog, JSON.stringify(summary) + "\n", "utf8");
      }
      await log(`[${idx + 1}/${counters.total}] ✓ ${q} ${rel}`);
    } else if (outcome.kind === "skipped") {
      counters.skipped += 1;
      await log(`[${idx + 1}/${counters.total}] - skip ${rel} (${outcome.reason})`);
    } else {
      counters.failed += 1;
      const rec = {
        source: outcome.source,
        stage: outcome.stage,
        error: outcome.error,
        stderr_tail: outcome.stderr_tail,
      };
      await appendFile(failureLog, JSON.stringify(rec) + "\n", "utf8");
      await log(`[${idx + 1}/${counters.total}] ✗ fail ${rel} stage=${outcome.stage}: ${outcome.error}`);
    }
  };

  const worker = async () => {
    while (true) {
      const myIdx = nextIndex++;
      if (myIdx >= pdfs.length) return;
      await handle(myIdx, pdfs[myIdx]!);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const elapsed = Date.now() - counters.startedAt;
  const summary = [
    "",
    "==== batch summary ====",
    `Total:       ${counters.total}`,
    `Success:     ${counters.ok} (${pct(counters.ok, counters.total)})`,
    `Suspicious:  ${counters.suspicious} (${pct(counters.suspicious, counters.total)})`,
    `Failed:      ${counters.failed} (${pct(counters.failed, counters.total)})`,
    `Skipped:     ${counters.skipped}`,
    `Time:        ${formatDuration(elapsed)}`,
    `Logs:        ${logDir}`,
    "",
  ].join("\n");
  console.log(summary);
  await appendFile(fullLog, summary + "\n", "utf8");

  // also drop a small JSON summary
  await writeFile(
    path.join(logDir, "summary.json"),
    JSON.stringify(
      {
        ...counters,
        elapsed_ms: elapsed,
        input: args.input,
        output: args.output,
        concurrency: args.concurrency,
        versions,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  process.exit(counters.failed > 0 ? 1 : 0);
}

function pct(n: number, d: number): string {
  if (d === 0) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

main().catch((err) => {
  console.error("batch crashed:", err);
  process.exit(2);
});
