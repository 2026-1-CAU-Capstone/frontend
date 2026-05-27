"""
Q&A extractions + raw chunks → standards/lessons .txt files.

Reads:
  chunks/qa_progress/<chunk_id>.json   — refined Q&A per chunk (from refine_youtube_qa.py)
  chunks/chunks.raw.json               — original chunks (for video_id, title, url, ...)

Writes:
  ../data/explanation/standards/<slug>.txt   if the video covers ONE jazz standard
  ../data/explanation/lessons/<slug>.txt     otherwise

Classification:
  1. Heuristic — quoted song names in the YouTube title, or "#N - <Song> Reharmonization"
  2. LLM fallback — Sonnet 4.6 classifies the ambiguous ones (~1 cheap call per video)

Output format matches the existing standards/lessons schema that 1_chunk.py
already parses (## 곡 정보 / ### N-M. / **instruction:** / **response:**),
so the next step is just `python 1_chunk.py && python 2_embed.py`.

Run:  source .venv/bin/activate && python qa_to_txt.py
"""

import argparse
import asyncio
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Optional

from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from pydantic import BaseModel, Field

THIS_DIR = Path(__file__).resolve().parent
PROGRESS_DIR = THIS_DIR / "chunks" / "qa_progress"
RAW_CHUNKS = THIS_DIR / "chunks" / "chunks.raw.json"

DATA_ROOT = THIS_DIR.parent / "data" / "explanation"
STANDARDS_DIR = DATA_ROOT / "standards"
LESSONS_DIR = DATA_ROOT / "lessons"

MODEL = "claude-sonnet-4-6"
CLASSIFY_CONCURRENCY = 8


# ── classification ────────────────────────────────────────────────────────

# Anything wrapped in these quote pairs is a strong song-name signal.
QUOTE_PATTERNS = [
    (r"'([^']{2,60})'", 1),    # straight single
    (r"\"([^\"]{2,60})\"", 1), # straight double
    (r"‘([^’]{2,60})’", 1),    # curly single
    (r"“([^”]{2,60})”", 1),    # curly double
    (r"「([^」]{2,60})」", 1), # KR brackets
    (r"『([^』]{2,60})』", 1),
]

# "#N - <Song> Reharmonization" or "#N <Song> Reharmonization"
REHARM_RE = re.compile(
    r"#\s*\d+\s*[-–—]?\s*([A-Z][A-Za-z0-9'\s,!?.&]{2,60}?)\s+(?:Reharmonization|reharm)",
)


def heuristic_song(title: str) -> Optional[str]:
    """Pull a likely song name out of a YouTube title, or None."""
    for pat, group in QUOTE_PATTERNS:
        for m in re.finditer(pat, title):
            cand = m.group(group).strip()
            if 2 <= len(cand) <= 60 and not cand.lower().startswith("part"):
                return cand
    m = REHARM_RE.search(title)
    if m:
        return m.group(1).strip()
    return None


class ClassifyResult(BaseModel):
    song_title: Optional[str] = Field(
        description="이 강의가 다루는 단일 재즈 스탠다드 곡명 (영문 또는 한국어). "
                    "해당 없음/여러 곡/개념 강의면 null."
    )


CLASSIFY_SYSTEM = """당신은 한국어 재즈 강의 유튜브 영상이 단일 재즈 스탠다드를 집중 분석하는지, 아니면 일반 개념 강의인지 분류합니다.

규칙:
- 단일 곡을 처음부터 끝까지 분석/리하모니제이션/연주하는 영상 → 곡명 반환 (영문 표준 표기 우선; 한국어 곡명이면 그대로)
- 두 곡 이상 비교, 또는 여러 예시곡을 짧게 언급하는 강의 → null
- 코드/스케일/모드/청음/시창/즉흥 등 개념 강의 → null
- 곡 외운 단편 (Realbook 초견, "오늘의 한 곡") → null
- 곡 정보가 불명확하거나 단편적 → null

출력: ClassifyResult JSON. 단일 곡이 명확하면 곡명, 아니면 null."""


async def classify_one(
    client: AsyncAnthropic,
    sem: asyncio.Semaphore,
    title: str,
    sample_qa: str,
) -> Optional[str]:
    async with sem:
        try:
            msg = await client.messages.parse(
                model=MODEL,
                max_tokens=200,
                system=[{
                    "type": "text",
                    "text": CLASSIFY_SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=[{
                    "role": "user",
                    "content": (
                        f"영상 제목: {title}\n\n"
                        f"첫 Q&A 샘플:\n{sample_qa[:600]}\n\n"
                        f"이 영상은 단일 재즈 스탠다드를 분석하나요?"
                    ),
                }],
                output_format=ClassifyResult,
            )
            return msg.parsed_output.song_title
        except Exception as e:
            print(f"  classify err: {e}", file=sys.stderr)
            return None


# ── slug helper ───────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """Filesystem-safe slug. 'Blue in Green' → 'blueingreen'."""
    # Strip diacritics, lowercase, keep [a-z0-9], drop everything else.
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    norm = norm.lower()
    norm = re.sub(r"[^a-z0-9]+", "", norm)
    return norm or "untitled"


def safe_video_slug(video_id: str, title: str) -> str:
    """For lessons — short, recognizable, but unique."""
    # Strip the channel-name 'easyonejazz' tag pattern and grab first few words.
    cleaned = re.sub(r"#\d+", "", title)
    cleaned = re.sub(r"[\(\[].*?[\)\]]", "", cleaned)  # drop bracketed annotations
    s = slugify(cleaned)[:30]
    return f"{s}_{video_id}" if s else video_id


# ── format ────────────────────────────────────────────────────────────────

def format_standard_txt(*, song: str, video_title: str, video_url: str,
                        qa_sections: list[tuple[str, str]]) -> str:
    """qa_sections: [(question, answer), ...] in display order."""
    lines = [
        "## 곡 정보",
        f"- **곡명:** {song}",
        f"- **강의 출처:** YouTube — {video_title}",
        f"- **영상 URL:** {video_url}",
        "",
    ]
    for i, (q, a) in enumerate(qa_sections, 1):
        # Use 1-N section numbering. 1_chunk.py's regex expects "### N-M. Title".
        # Title = the question itself, truncated for the section header.
        header_title = q[:60].rstrip(" ?.,") + ("…" if len(q) > 60 else "")
        lines += [
            f"### 1-{i}. {header_title}",
            f"**instruction:** {q}",
            "",
            f"**response:** {a}",
            "",
        ]
    return "\n".join(lines)


def format_lesson_txt(*, video_title: str, video_url: str,
                      qa_sections: list[tuple[str, str]]) -> str:
    lines = [
        "## 강의 정보",
        f"- **강의 출처:** YouTube — {video_title}",
        f"- **영상 URL:** {video_url}",
        "",
    ]
    for i, (q, a) in enumerate(qa_sections, 1):
        header_title = q[:60].rstrip(" ?.,") + ("…" if len(q) > 60 else "")
        lines += [
            f"### 1-{i}. {header_title}",
            f"**instruction:** {q}",
            "",
            f"**response:** {a}",
            "",
        ]
    return "\n".join(lines)


# ── main ───────────────────────────────────────────────────────────────────

async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--no-llm", action="store_true",
                   help="skip LLM classification — use only heuristic; rest → lessons")
    p.add_argument("--limit", type=int, default=0,
                   help="process only first N videos (debugging)")
    args = p.parse_args()

    load_dotenv()
    api_key = os.getenv("VITE_ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_API_KEY")

    # ── load Q&A extractions ──────────────────────────────────────────────
    qa_by_chunk: dict[str, list[tuple[str, str]]] = {}
    for p_path in sorted(PROGRESS_DIR.glob("*.json")):
        with open(p_path, encoding="utf-8") as f:
            doc = json.load(f)
        pairs = [(qa["question"], qa["answer"]) for qa in doc.get("qa_pairs", [])]
        if pairs:
            qa_by_chunk[p_path.stem] = pairs
    print(f"loaded Q&A for {len(qa_by_chunk)} chunks from {PROGRESS_DIR.relative_to(THIS_DIR)}")

    # ── load original chunk metadata (for video_id, title, url) ───────────
    # Prefer the refine backup; fall back to the current chunks.json (the raw
    # state from 1_chunk.py — refine hasn't overwritten it yet).
    src = RAW_CHUNKS if RAW_CHUNKS.exists() else THIS_DIR / "chunks" / "chunks.json"
    if not src.exists():
        print(f"✗ neither {RAW_CHUNKS.name} nor chunks.json found — run 1_chunk.py first.",
              file=sys.stderr)
        sys.exit(1)
    with open(src, encoding="utf-8") as f:
        all_raw = json.load(f)
    raw_youtube = {c["id"]: c for c in all_raw if c.get("source_type") == "youtube"}
    print(f"raw youtube chunks: {len(raw_youtube)}  (from {src.relative_to(THIS_DIR)})")

    # ── group by video_id ─────────────────────────────────────────────────
    # Preserve chunk order so the resulting Q&A flow matches the video timeline.
    by_video: dict[str, dict] = {}
    for chunk_id in sorted(raw_youtube.keys()):
        raw = raw_youtube[chunk_id]
        pairs = qa_by_chunk.get(chunk_id, [])
        if not pairs:
            continue
        vid = raw.get("video_id") or chunk_id.rsplit("__", 2)[-2]
        if vid not in by_video:
            by_video[vid] = {
                "video_id": vid,
                "title": raw.get("title", ""),
                "url": (raw.get("video_url", "") or "").split("&t=")[0],
                "qa": [],
            }
        by_video[vid]["qa"].extend(pairs)
    print(f"grouped into {len(by_video)} videos")

    videos = list(by_video.values())
    if args.limit:
        videos = videos[: args.limit]

    # ── classify ──────────────────────────────────────────────────────────
    # 1. Heuristic first.
    needs_llm: list[dict] = []
    for v in videos:
        v["song"] = heuristic_song(v["title"])
        if v["song"] is None:
            needs_llm.append(v)
    print(f"heuristic classified {len(videos) - len(needs_llm)} videos with a song; "
          f"{len(needs_llm)} need LLM")

    # 2. LLM for the rest (unless disabled).
    if needs_llm and not args.no_llm and api_key:
        client = AsyncAnthropic(api_key=api_key)
        sem = asyncio.Semaphore(CLASSIFY_CONCURRENCY)
        tasks = []
        for v in needs_llm:
            sample = "\n".join(f"Q: {q}\nA: {a}" for q, a in v["qa"][:2])
            tasks.append(classify_one(client, sem, v["title"], sample))
        results = await asyncio.gather(*tasks)
        for v, song in zip(needs_llm, results):
            v["song"] = song
        named = sum(1 for v in needs_llm if v["song"])
        print(f"LLM classified: {named}/{len(needs_llm)} as song-specific")

    # ── write files ───────────────────────────────────────────────────────
    STANDARDS_DIR.mkdir(parents=True, exist_ok=True)
    LESSONS_DIR.mkdir(parents=True, exist_ok=True)

    n_standards = 0
    n_lessons = 0
    used_slugs: dict[str, int] = {}
    for v in videos:
        if v["song"]:
            slug = slugify(v["song"])
            count = used_slugs.get(slug, 0) + 1
            used_slugs[slug] = count
            fname = slug if count == 1 else f"{slug}_{v['video_id'][:6]}"
            out_path = STANDARDS_DIR / f"{fname}.txt"
            text = format_standard_txt(
                song=v["song"], video_title=v["title"],
                video_url=v["url"], qa_sections=v["qa"],
            )
            n_standards += 1
        else:
            fname = safe_video_slug(v["video_id"], v["title"])
            out_path = LESSONS_DIR / f"{fname}.txt"
            text = format_lesson_txt(
                video_title=v["title"], video_url=v["url"], qa_sections=v["qa"],
            )
            n_lessons += 1
        out_path.write_text(text, encoding="utf-8")

    print(f"\nwrote {n_standards} standards + {n_lessons} lessons "
          f"into {DATA_ROOT.relative_to(THIS_DIR.parent)}/")
    print("\nNext: python 1_chunk.py && python 2_embed.py")


if __name__ == "__main__":
    asyncio.run(main())
