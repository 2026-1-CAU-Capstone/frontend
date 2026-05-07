import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformLick } from "./transform.js";
import type {
  FailureRecord,
  LickCreateRequest,
  SourceLick,
  SuccessRecord,
} from "./types.js";

const TOOL_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const DEFAULT_SOURCE_FILE = path.join(
  REPO_ROOT,
  "public",
  "data",
  "licks",
  "user_licks.json",
);
const LOGS_ROOT = path.join(TOOL_ROOT, "logs");

interface CliArgs {
  baseUrl: string;
  sourceFile: string;
  dryRun: boolean;
  preview: boolean;
  delayMs: number;
  authToken: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    baseUrl: "https://jazzify.p-e.kr/api",
    sourceFile: DEFAULT_SOURCE_FILE,
    dryRun: false,
    preview: false,
    delayMs: 100,
    authToken: process.env.JAZZIFY_TOKEN?.trim() || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--base-url":
        args.baseUrl = argv[++i]!.replace(/\/+$/, "");
        break;
      case "--source":
      case "-s":
        args.sourceFile = path.resolve(argv[++i]!);
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--preview":
        args.preview = true;
        break;
      case "--delay":
        args.delayMs = Math.max(0, parseInt(argv[++i]!, 10) || 0);
        break;
      case "--token":
        args.authToken = argv[++i]!;
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
  console.log(`lick-migrate

Read user_licks.json and POST each lick to the Jazzify backend.

Usage:
  npm run migrate -- [options]
  npm run dry-run     # transform but don't POST
  npm run preview     # print the first 2 transformed payloads, then exit

Options:
  --base-url <url>    API base (default: https://jazzify.p-e.kr/api)
  -s, --source <file> source JSON (default: public/data/licks/user_licks.json)
      --dry-run       skip POST, only validate transforms
      --preview       print 2 sample payloads and exit
      --delay <ms>    sleep between requests (default: 100)
      --token <jwt>   Bearer token (or set JAZZIFY_TOKEN env var)
  -h, --help          show this help
`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PostResult {
  ok: boolean;
  status: number;
  body: string;
  publicId: string | null;
}

async function postLick(
  baseUrl: string,
  payload: LickCreateRequest,
  token: string | null,
): Promise<PostResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/licks`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: `network error: ${msg}`, publicId: null };
  }

  const text = await res.text();
  let publicId: string | null = null;
  if (res.ok) {
    try {
      const parsed = JSON.parse(text) as { data?: { publicId?: string } };
      publicId = parsed?.data?.publicId ?? null;
    } catch {
      // ignore parse error; we still report success based on status
    }
  }
  return { ok: res.ok, status: res.status, body: text, publicId };
}

function tail(text: string, max = 500): string {
  if (text.length <= max) return text;
  return text.slice(-max);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const logDir = path.join(LOGS_ROOT, today);
  await mkdir(logDir, { recursive: true });
  const fullLog = path.join(logDir, "full.log");
  const successLog = path.join(logDir, "success.jsonl");
  const failureLog = path.join(logDir, "failure.jsonl");

  const log = async (line: string) => {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    console.log(stamped);
    if (!args.preview) await appendFile(fullLog, stamped + "\n", "utf8");
  };

  await log(`source: ${args.sourceFile}`);
  await log(`base-url: ${args.baseUrl}`);
  await log(`mode: ${args.preview ? "preview" : args.dryRun ? "dry-run" : "live"}`);
  await log(`auth: ${args.authToken ? "Bearer token set" : "none"}`);

  const raw = await readFile(args.sourceFile, "utf8");
  const licks: SourceLick[] = JSON.parse(raw);
  await log(`loaded ${licks.length} source licks`);

  const transformed: { src: SourceLick; payload: LickCreateRequest }[] = licks.map(
    (src) => ({
      src,
      payload: transformLick(src, {
        defaultInstrument: "as",
        source: "user",
      }),
    }),
  );

  if (args.preview) {
    const samples = transformed.slice(0, 2);
    for (const { src, payload } of samples) {
      console.log(`\n===== id=${src.id} ${src.performer} — ${src.title} =====`);
      console.log(JSON.stringify(payload, null, 2));
    }
    console.log(`\n(${transformed.length} licks total; showed first 2)`);
    return;
  }

  if (args.dryRun) {
    await log(`dry-run: ${transformed.length} payloads built; not POSTing`);
    return;
  }

  let ok = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (let i = 0; i < transformed.length; i++) {
    const item = transformed[i]!;
    const { src, payload } = item;
    const label = `[${i + 1}/${transformed.length}] id=${src.id} ${src.performer} — ${src.title}`;
    await log(`${label} -> POST`);

    const result = await postLick(args.baseUrl, payload, args.authToken);

    if (result.ok && result.publicId) {
      ok += 1;
      const rec: SuccessRecord = {
        id: src.id,
        title: src.title,
        performer: src.performer,
        publicId: result.publicId,
        http_status: result.status,
      };
      await appendFile(successLog, JSON.stringify(rec) + "\n", "utf8");
      await log(`${label} ✓ ${result.status} publicId=${result.publicId}`);
    } else {
      failed += 1;
      const rec: FailureRecord = {
        id: src.id,
        title: src.title,
        performer: src.performer,
        http_status: result.status || null,
        error: result.ok ? "no publicId in response" : `http ${result.status}`,
        body_tail: tail(result.body),
      };
      await appendFile(failureLog, JSON.stringify(rec) + "\n", "utf8");
      await log(
        `${label} ✗ status=${result.status} body_tail=${tail(result.body, 200)}`,
      );
    }

    if (args.delayMs > 0 && i < transformed.length - 1) {
      await sleep(args.delayMs);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const summary = [
    "",
    "==== migrate summary ====",
    `Total:    ${transformed.length}`,
    `Success:  ${ok}`,
    `Failed:   ${failed}`,
    `Elapsed:  ${(elapsedMs / 1000).toFixed(1)}s`,
    `Logs:     ${logDir}`,
    "",
  ].join("\n");
  console.log(summary);
  await appendFile(fullLog, summary + "\n", "utf8");
  await writeFile(
    path.join(logDir, "summary.json"),
    JSON.stringify(
      {
        total: transformed.length,
        ok,
        failed,
        elapsed_ms: elapsedMs,
        base_url: args.baseUrl,
        source_file: args.sourceFile,
        finished_at: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("migrate crashed:", err);
  process.exit(2);
});
