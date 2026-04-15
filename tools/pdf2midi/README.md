# pdf2midi

Local batch pipeline that turns vector PDF scores into MIDI + MusicXML by chaining two external CLIs:

```
input.pdf
  → [Audiveris -batch -export]   → tmp/<slug>.mxl
    → [MuseScore CLI]            → output/<slug>/<slug>.mid
                                 → output/<slug>/<slug>.mxl
                                 → output/<slug>/meta.json
                                 → (optional) <slug>.mp3
```

This tooling is **completely independent** from the React/Vite frontend: it never runs in the browser, never touches `src/`, and only writes outputs into `data/pdf2midi/` so the frontend can consume them as static assets later.

## Why this lives in `tools/pdf2midi`

- It depends on a JVM (Audiveris) and a native macOS app (MuseScore 4) — neither belongs in the browser bundle.
- It uses a **nested `package.json`** with its own `tsx` dev dependency so the frontend's `package.json` and lockfile stay clean.
- All run-time inputs/outputs/logs/temp files are gitignored. Source code under `src/` is committed.

## Prerequisites

| Tool | Required version | How to install |
|---|---|---|
| Node.js | ≥ 20 | `brew install node` (the repo uses npm, no pnpm) |
| MuseScore 4 | 4.x | `brew install --cask musescore` |
| Audiveris | 5.10+ | **Not in homebrew.** Download the `.dmg` from <https://github.com/Audiveris/audiveris/releases> and drag `Audiveris.app` into `/Applications`. The wrapper auto-detects the `.app` bundle layout — no `$PATH` setup needed. |
| `unzip` | system | already on macOS |

> ⚠️ **macOS jpackage launcher gotcha** — the native binary at `Audiveris.app/Contents/MacOS/Audiveris` silently swallows CLI arguments when invoked directly from a terminal. The wrapper sidesteps this by invoking the bundled JRE against the classpath: `java -classpath "<bundle>/Contents/app/*" Audiveris [...]`. If you set `AUDIVERIS_BIN` to a path inside an `.app` bundle, the wrapper will still apply this unwrap automatically.

### Verifying the install

```bash
# version probe via the wrapper (instant, no JVM spawn — reads Info.plist)
cd tools/pdf2midi && npm run batch
# expect output like:
#   Audiveris bin: /Applications/Audiveris.app/Contents/MacOS/Audiveris
#   MuseScore bin: /Applications/MuseScore 4.app/Contents/MacOS/mscore
#   Versions: audiveris=5.10.2 mscore=4.6.5
```

To exercise the actual Audiveris JVM (slower, ~3-5s):

```bash
"/Applications/Audiveris.app/Contents/runtime/Contents/Home/bin/java" \
  -classpath "/Applications/Audiveris.app/Contents/app/*" \
  Audiveris -version
```

### Environment variables

| Var | Purpose | Default fallback |
|---|---|---|
| `AUDIVERIS_BIN` | Absolute path to the Audiveris launcher | `audiveris` on `$PATH`, then a couple of common install paths |
| `MSCORE_BIN` | Absolute path to the MuseScore CLI | `/Applications/MuseScore 4.app/Contents/MacOS/mscore`, then `mscore`/`musescore` on `$PATH` |

## Install (one time)

```bash
cd tools/pdf2midi
npm install
```

This installs `tsx` + TypeScript locally inside `tools/pdf2midi/node_modules/`. No changes to the parent project.

## Quick start — single-file smoke test

```bash
cd tools/pdf2midi
npm run smoke -- /absolute/path/to/score.pdf
# or via the shell wrapper
./bin/convert.sh /absolute/path/to/score.pdf
```

The smoke run prints something like:

```
[smoke] input:  /…/stella.pdf
[smoke] output: /…/jazzify/frontend/data/pdf2midi
[smoke] ✓ ok in 38.2s — quality=ok
[smoke]   midi: …/data/pdf2midi/stella-1f3a9c2e/stella-1f3a9c2e.mid
[smoke]   mxl:  …/data/pdf2midi/stella-1f3a9c2e/stella-1f3a9c2e.mxl
[smoke]   notes=523 measures=32 harmony=24 duration=145.3s
```

Open the resulting `.mid` in MuseScore, Logic, or any DAW to verify it sounds right.

## Batch mode

```bash
cd tools/pdf2midi

# default — scan ./input recursively, write to ../../data/pdf2midi
npm run batch

# explicit paths + 4 workers
npm run batch -- --input ./input --output ../../data/pdf2midi --concurrency 4

# also render MP3 alongside each MIDI
npm run batch -- --audio

# re-convert everything, ignoring the meta.json skip cache
npm run batch -- --force

# only retry the failures from a previous run
npm run batch -- --retry logs/2026-04-16/failure.jsonl
```

CLI flags (all optional):

| Flag | Default | Notes |
|---|---|---|
| `-i, --input <dir>` | `./input` | recursively scanned for `*.pdf` |
| `-o, --output <dir>` | `../../data/pdf2midi` | one folder per input PDF |
| `-c, --concurrency <n>` | `cpus - 1` | parallel workers |
| `-f, --force` | off | re-convert even if `meta.json` is newer than the source |
| `--audio` | off | also write `<slug>.mp3` (best-effort, never fails the pipeline) |
| `--retry <jsonl>` | — | only process `source` entries from a prior `failure.jsonl` |
| `--audiveris-timeout <ms>` | 300000 | per-file Audiveris timeout |
| `--mscore-timeout <ms>` | 90000 | per-file MuseScore timeout |

## Output layout

For each input `path/to/Stella.pdf`:

```
data/pdf2midi/
└── stella-1f3a9c2e/                 # <slug>-<8-char path hash>
    ├── stella-1f3a9c2e.mid
    ├── stella-1f3a9c2e.mxl
    ├── stella-1f3a9c2e.mp3          # only with --audio
    └── meta.json
```

The slug is derived from the basename plus a short hash of the **input-relative path**, so two different PDFs named `lead-sheet.pdf` in different folders will not collide.

`meta.json` shape:

```json
{
  "source": "jazz/stella.pdf",
  "source_abs": "/Users/.../input/jazz/stella.pdf",
  "slug": "stella-1f3a9c2e",
  "midi_path": "...",
  "mxl_path": "...",
  "audio_path": null,
  "converted_at": "2026-04-16T01:30:00.000Z",
  "audiveris_version": "5.3.1",
  "mscore_version": "4.6.5",
  "duration_seconds": 145.3,
  "midi_note_count": 523,
  "measure_count": 32,
  "harmony_count": 24,
  "part_count": 1,
  "warnings": [],
  "quality": "ok"
}
```

`quality` is one of:

- `ok` — passed all heuristics
- `suspicious` — converted successfully but failed at least one heuristic (too few notes, too short, no `<harmony>` despite `<words>` text, etc.); ends up in `suspicious.jsonl` for manual review
- `failed` — MIDI is missing or unreadable

## Idempotency

Re-running `npm run batch` is safe. Each input is **skipped** when:

- `meta.json` already exists in the slug folder, **and**
- its mtime is `>=` the source PDF's mtime.

Pass `--force` to bypass the skip cache.

## Logging

Every batch run writes to `tools/pdf2midi/logs/<YYYY-MM-DD>/`:

| File | Format | Purpose |
|---|---|---|
| `full.log` | text | timestamped human-readable log |
| `success.jsonl` | one JSON object per line | every successful conversion (incl. `quality`) |
| `suspicious.jsonl` | one JSON object per line | a subset of successes that failed at least one heuristic |
| `failure.jsonl` | one JSON object per line | failed conversions: `{ source, stage, error, stderr_tail }` — feed back into `--retry` |
| `summary.json` | single object | counters + tool versions for the run |

End of each run prints a console summary table:

```
==== batch summary ====
Total:       1203
Success:     987 (82%)
Suspicious:   84 (7%)
Failed:      132 (11%)
Skipped:       0
Time:        2h 14m
```

Logs are gitignored.

## Validation heuristics

`src/validate.ts` runs after every successful conversion:

- `.mid` exists, > 0 bytes, parses as a valid MIDI file
- ≥ 10 note-on events
- ≥ 4 seconds of music (computed from MIDI tempo events)
- ≥ 4 `<measure>` elements in the MusicXML
- If `<harmony>` count is 0 **and** `<words>` count is > 0 → flagged as suspicious (likely a jazz lead sheet whose chord symbols were OCR'd as plain text)

Any heuristic miss demotes a successful conversion to `quality: "suspicious"` (it still counts as a usable result, just earns manual review).

## Known limits

- **Jazz chord symbols** (`Cmaj7`, `D-7`, `G7alt`, `F#ø`, `C6/9`, …) are notoriously hard for Audiveris's lexicon. Expect them to land in `<words>` rather than `<harmony>`. A Phase-2 post-processor can promote `<words>` → `<harmony>` based on a regex/dictionary; left as a TODO inside `validate.ts`.
- **1-line drum / rhythm-slash staves** are misread frequently.
- **Guitar chord diagrams** confuse the staff-line detector and may appear as bogus notes.
- **OMR error rate** on real-world jazz PDFs: empirically ~10% of pages need manual cleanup. Expect `quality: suspicious` to be a meaningful chunk of the output.
- **MIDI duration** is computed from MIDI deltas only; it ignores fermatas, swing feel, and rubato.

## Re-running failures

```bash
npm run batch -- --retry logs/2026-04-16/failure.jsonl
```

Reads each `source` field, resolves it relative to the current `--input`, and reprocesses just those files. Combine with `--force` if a previous partial output is in the way.

## Project layout

```
tools/pdf2midi/
├── README.md
├── package.json          # nested — does NOT touch the frontend's package.json
├── tsconfig.json
├── .gitignore
├── src/
│   ├── audiveris.ts      # Audiveris CLI wrapper + version probe
│   ├── batch.ts          # entry point: directory walker + worker pool
│   ├── convert.ts        # entry point: single-file pipeline (also exports convertSingle)
│   ├── exec.ts           # spawn helper with timeout/maxBuffer/stderr capture
│   ├── mscore.ts         # MuseScore CLI wrapper + version probe
│   ├── slug.ts           # deterministic per-source folder naming
│   ├── types.ts          # shared types
│   └── validate.ts       # MIDI parser + MusicXML heuristics
├── bin/
│   └── convert.sh        # bash wrapper for the smoke test
├── input/                # gitignored — drop your PDFs here
└── logs/                 # gitignored — created per run
```

## What this tool intentionally does NOT do

- It does **not** modify the frontend (`src/`, `vite.config.ts`, etc.).
- It does **not** run in the browser. No WASM port, no `ffi-napi`.
- It does **not** train models, download datasets, or scrape sites.
- It does **not** touch `src/lib/backing/` (separate work in progress).
- It does **not** auto-commit converted MIDI/MXL into git. The repo's `.gitignore` excludes `data/pdf2midi/` so the working tree stays clean. Reconsider with git-LFS if you ever want to ship the corpus.
