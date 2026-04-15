import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { runProcess, tail } from "./exec.js";

const FALLBACK_BINS = [
  "/Applications/Audiveris.app/Contents/MacOS/Audiveris",
  "audiveris",
  "/opt/homebrew/bin/audiveris",
  "/usr/local/bin/audiveris",
];

export class AudiverisError extends Error {
  override readonly name = "AudiverisError";
  readonly stderrTail: string;
  constructor(message: string, stderrTail = "") {
    super(message);
    this.stderrTail = stderrTail;
  }
}

interface Invocation {
  bin: string;
  argsPrefix: string[];
  appRoot: string | null;
}

let cachedInvocation: Invocation | null = null;

function macAppRootFromBin(bin: string): string | null {
  const m = bin.match(/^(.+?\.app)\/Contents\/MacOS\/[^/]+$/);
  return m?.[1] ?? null;
}

function resolveBundleInvocation(appRoot: string): Invocation | null {
  const java = path.join(appRoot, "Contents", "runtime", "Contents", "Home", "bin", "java");
  const appDir = path.join(appRoot, "Contents", "app");
  if (!existsSync(java) || !existsSync(appDir)) return null;
  return {
    bin: java,
    argsPrefix: ["-classpath", path.join(appDir, "*"), "Audiveris"],
    appRoot,
  };
}

function buildInvocation(): Invocation {
  if (cachedInvocation) return cachedInvocation;

  const fromEnv = process.env.AUDIVERIS_BIN?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    const appRoot = macAppRootFromBin(fromEnv);
    if (appRoot) {
      const bundled = resolveBundleInvocation(appRoot);
      if (bundled) {
        cachedInvocation = bundled;
        return bundled;
      }
    }
    cachedInvocation = { bin: fromEnv, argsPrefix: [], appRoot: null };
    return cachedInvocation;
  }

  for (const candidate of FALLBACK_BINS) {
    if (!candidate.includes("/")) continue;
    if (!existsSync(candidate)) continue;
    const appRoot = macAppRootFromBin(candidate);
    if (appRoot) {
      const bundled = resolveBundleInvocation(appRoot);
      if (bundled) {
        cachedInvocation = bundled;
        return bundled;
      }
    }
    cachedInvocation = { bin: candidate, argsPrefix: [], appRoot: null };
    return cachedInvocation;
  }

  cachedInvocation = { bin: "audiveris", argsPrefix: [], appRoot: null };
  return cachedInvocation;
}

export function resolveAudiverisBin(): string {
  const inv = buildInvocation();
  if (inv.appRoot) return path.join(inv.appRoot, "Contents", "MacOS", "Audiveris");
  return inv.bin;
}

export async function getAudiverisVersion(): Promise<string | null> {
  const inv = buildInvocation();

  // Prefer Info.plist (instant, no JVM spawn) when we have a macOS bundle
  if (inv.appRoot) {
    try {
      const plist = readFileSync(
        path.join(inv.appRoot, "Contents", "Info.plist"),
        "utf8",
      );
      const m = plist.match(
        /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
      );
      if (m?.[1]) return m[1];
    } catch {
      // fall through to runtime probe
    }
  }

  try {
    const result = await runProcess(inv.bin, [...inv.argsPrefix, "-version"], {
      timeoutMs: 30_000,
    });
    const haystack = `${result.stdout}\n${result.stderr}`;
    const m =
      haystack.match(/-\s*Version:\s*([\d.]+)/i) ??
      haystack.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (m?.[1]) return m[1];
    return result.code === 0 ? "unknown" : null;
  } catch {
    return null;
  }
}

export interface AudiverisRunResult {
  musicxmlPath: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

async function findMusicXml(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findMusicXml(full);
      if (nested) candidates.push(nested);
    } else if (/\.(mxl|musicxml|xml)$/i.test(entry.name)) {
      candidates.push(full);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const score = (p: string) =>
      /\.mxl$/i.test(p) ? 0 : /\.musicxml$/i.test(p) ? 1 : 2;
    return score(a) - score(b);
  });
  return candidates[0] ?? null;
}

export async function runAudiveris(
  inputPdf: string,
  outputDir: string,
  timeoutMs: number,
): Promise<AudiverisRunResult> {
  const inv = buildInvocation();
  const args = [
    ...inv.argsPrefix,
    "-batch",
    "-export",
    "-output",
    outputDir,
    "--",
    inputPdf,
  ];
  let result;
  try {
    result = await runProcess(inv.bin, args, { timeoutMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AudiverisError(
      `Failed to spawn Audiveris (${inv.bin}): ${msg}. ` +
        `Set AUDIVERIS_BIN or install from https://github.com/Audiveris/audiveris/releases`,
    );
  }

  if (result.timedOut) {
    throw new AudiverisError(
      `Audiveris timed out after ${timeoutMs}ms on ${path.basename(inputPdf)}`,
      tail(result.stderr),
    );
  }
  if (result.code !== 0) {
    throw new AudiverisError(
      `Audiveris exited with code ${result.code} on ${path.basename(inputPdf)}`,
      tail(result.stderr),
    );
  }

  const found = await findMusicXml(outputDir);
  if (!found) {
    throw new AudiverisError(
      `Audiveris finished but no .mxl/.musicxml output found under ${outputDir}`,
      tail(result.stderr),
    );
  }

  return {
    musicxmlPath: found,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
  };
}
