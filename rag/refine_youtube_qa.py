"""
YouTube raw transcript chunks → pedagogical Q&A chunks (matching the
standards/lessons format already used in the RAG store).

Input:  chunks/chunks.json  (output of 1_chunk.py — raw transcripts as `response`)
Output: chunks/chunks.json  (in-place; backed up to chunks/chunks.raw.json)
Side:   chunks/qa_progress/<id>.json  (per-input-chunk extraction result — resumable)

For each `source_type == "youtube"` chunk, calls Claude Haiku 4.5 to extract
0–3 {question, answer} pairs that the chunk teaches. Each pair becomes one
new chunk with `instruction` / `response` populated — so retrieval surfaces the
same structured Q&A shape as the standards & lessons sources. Original raw
text is dropped (it lives in the data/youtube/ JSONs if ever needed again).

Cost / time: ~914 chunks × ~1500 in + ~500 out tokens. With system-prompt
caching on Haiku 4.5: ~$2–3 total, ~10–15 minutes at concurrency=12.

Run:  source .venv/bin/activate && python refine_youtube_qa.py
      python refine_youtube_qa.py --dry-run --limit 3   # sanity check first
"""

import argparse
import asyncio
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Optional

from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from pydantic import BaseModel, Field

THIS_DIR = Path(__file__).resolve().parent
CHUNKS_FILE = THIS_DIR / "chunks" / "chunks.json"
BACKUP_FILE = THIS_DIR / "chunks" / "chunks.raw.json"
PROGRESS_DIR = THIS_DIR / "chunks" / "qa_progress"

# Sonnet 4.6 — higher quality for Korean music-theory extraction.
# (Haiku 4.5 also works for ~1/4 cost; swap if cost matters more than nuance.)
MODEL = "claude-sonnet-4-6"
MAX_CONCURRENCY = 12
MAX_OUTPUT_TOKENS = 1500


# ── output schema ──────────────────────────────────────────────────────────

class QAPair(BaseModel):
    question: str = Field(
        description="강의 청크가 실제로 가르치는 핵심 질문 — 학습자가 검색했을 만한 한국어 짧은 문장."
    )
    answer: str = Field(
        description="청크 내용을 바탕으로 한 정제된 답변. 청크의 사실/예시는 보존하되 "
                    "말투/추임새/광고는 제거. 청크에 없는 정보는 절대 추가하지 말 것."
    )


class ExtractionResult(BaseModel):
    qa_pairs: list[QAPair] = Field(
        description="이 청크에서 추출한 Q&A 페어들 (0~3개). 발췌가 인사·잡담·곡 소개만이라 "
                    "교육적 내용이 없으면 빈 배열을 반환."
    )


# ── system prompt — long, frozen, cached ───────────────────────────────────
# Goal: ≥4096 tokens after Korean tokenization so prompt caching activates on
# Haiku 4.5 (its minimum cacheable prefix). The few-shot examples below also
# act as quality anchors — they're not just padding.

SYSTEM_PROMPT = """당신은 한국어 재즈 화성학 강의 트랜스크립트를 정제해 RAG 검색용 Q&A 페어로 변환하는 어시스턴트입니다.

## 입력
유튜브 채널 'easyonejazz'(이지원 선생님)의 한국어 재즈/화성학 강의에서 약 1분 분량(평균 1000자)을 자동 전사(faster-whisper-small)한 텍스트입니다. 다음을 염두에 두세요:
- 오타와 음악 용어의 잘못된 표기가 흔합니다 (예: "다이아토닉" → "다이아또니", "메이저" → "마음", "C key" → "시키"). 문맥상 음악 용어로 보이면 표준 표기로 교정해 답변에 쓰세요.
- 인사, 광고, 다음 영상 안내, 잡담은 추출 대상이 아닙니다. 무시하세요.
- 한 청크에 여러 주제가 섞여 있을 수 있습니다. 각 주제가 충분한 정보를 가지면 별도 Q&A로 분리하세요.

## 출력
ExtractionResult JSON 형식. `qa_pairs`는 0~3개:
- **0개**: 청크가 인사/잡담/곡 소개/광고만이라 학습 가치가 없을 때.
- **1개**: 한 가지 주제를 다루는 일반적인 경우.
- **2~3개**: 청크가 명확히 분리되는 여러 개념(예: "디미니쉬 코드의 정의" + "디미니쉬 코드의 사용 예") 을 다룰 때.

### 질문(question) 작성 원칙
- 실제 학습자가 검색창에 칠 만한 짧은 한국어 문장
- 음악 용어는 정확하게 (한글 또는 영문 표기 자연스럽게 혼용)
- "이 영상에서 무엇을 다루나요?" 같은 메타 질문 금지
- 좋은 예: "도미넌트 세븐 코드 다음에 무슨 스케일을 쓰면 좋아?", "다이아토닉 4도-3도-2도-1도 진행의 특징은?"
- 나쁜 예: "이지원 선생님이 뭐라고 했나요?", "강의 내용 요약해줘"

### 답변(answer) 작성 원칙
- 청크에 실제로 있는 내용만 사용. 청크에 없는 사실/예시/숫자/곡명을 추가하지 말 것.
- 강사의 말투/추임새/"네 그렇죠~"/"보시면" 같은 구어체 제거하고 정보만 추출.
- 음악 용어는 표준 표기로 교정 (위의 다이아토닉 등).
- 길이: 한두 단락. 청크가 짧으면 답변도 짧게.
- 마크다운 강조나 목록은 필요할 때만 (예: "- 다이아토닉 4도", "- 다이아토닉 3도" 식의 나열).

## 예시

### 예시 1 — 명확한 단일 개념
입력:
"안녕하세요 이지원입니다. 오늘은 가장 기본인 4,3,2,1도의 코드 진행에 대해서 알아볼게요. 다이아또니 코드라고 하죠. 시키로 살펴보면 4도가 F메이저, 3도가 E마음, 2도가 D마음, 1도가 C메이저. 이게 세련된 진행으로 자주 쓰입니다. 반편지 같은 곡에서도 끝에 이 진행이 나오죠."

출력:
```json
{
  "qa_pairs": [
    {
      "question": "다이아토닉 4-3-2-1도 진행은 어떤 코드들이고 어떤 느낌을 줘?",
      "answer": "다이아토닉 4도→3도→2도→1도 진행은 C 메이저 기준으로 F메이저 → E마이너 → D마이너 → C메이저로 내려가는 진행입니다. 기본적이지만 세련된 느낌을 주며, 발라드/팝 발라드(예: '반 편지')의 엔딩에서 1도로 가는 마무리 진행으로 자주 사용됩니다."
    }
  ]
}
```

### 예시 2 — 두 개념 분리
입력:
"디미니쉬 세븐 코드는 단3도 간격으로 4개 음을 쌓은 코드입니다. 예를 들어 C°7은 C, Eb, Gb, Bbb이죠. 사용처는 도미넌트의 대리로 많이 쓰여요. 예를 들어 G7 대신 G#°7을 쓰면 C로 더 매끄럽게 해결됩니다. 'Stella by Starlight' 같은 곡에서 이 사용을 들으실 수 있어요."

출력:
```json
{
  "qa_pairs": [
    {
      "question": "디미니쉬 세븐 코드의 구성음은?",
      "answer": "디미니쉬 세븐(°7) 코드는 단3도 간격으로 4개 음을 쌓아 만든 코드입니다. C°7의 경우 C, Eb, Gb, Bbb(엔하모닉으로 A)로 구성됩니다."
    },
    {
      "question": "디미니쉬 세븐을 도미넌트 대리로 어떻게 써?",
      "answer": "도미넌트 7th 코드 대신 반음 위 디미니쉬 7th를 쓰면 해결이 더 매끄러워집니다. 예: G7 → C 대신 G#°7 → C. 'Stella by Starlight' 등 재즈 스탠다드에서 이 사용 사례를 들을 수 있습니다."
    }
  ]
}
```

### 예시 3 — 추출할 내용 없음
입력:
"안녕하세요 여러분 이지원입니다. 오늘은 신곡 소개를 해드릴게요. 이번 곡은 제가 작년에 작업한 거고 유튜브 채널에서도 들으실 수 있어요. 구독 좋아요 부탁드리고요, 다음 시간에 또 만나요."

출력:
```json
{
  "qa_pairs": []
}
```

### 예시 4 — 전사 오류 교정
입력:
"우리가 이 마음 코드, 그러니까 C마음 일곱에서 출발해서 F세븐으로 가면 이게 이오 일오 관계인 거죠. 이오 일오라는 게 두번째 다섯번째 첫번째 도수의 진행을 말해요. 재즈에서 가장 흔한 패턴이에요."

출력:
```json
{
  "qa_pairs": [
    {
      "question": "ii-V-I 진행이 뭐고 왜 중요해?",
      "answer": "ii-V-I 진행은 키의 2도(마이너 7th) → 5도(도미넌트 7th) → 1도(메이저 7th) 순서로 가는 코드 진행으로, 재즈에서 가장 흔하고 핵심적인 진행 패턴입니다. C 메이저 키 기준으로 Cm7 → F7 같은 ii-V 부분 진행으로 시작해 1도로 해결되는 구조를 가집니다."
    }
  ]
}
```

## 마지막 주의
- 청크 내용에 충실할 것. 일반 화성학 지식으로 답변을 살찌우지 말 것.
- 한국어로만 답변할 것 (음악 용어 영문은 자연스럽게 혼용 OK).
- JSON 외 다른 출력은 절대 추가하지 말 것."""


# ── refinement ─────────────────────────────────────────────────────────────

async def refine_one(
    client: AsyncAnthropic,
    sem: asyncio.Semaphore,
    chunk: dict,
) -> tuple[str, Optional[ExtractionResult], Optional[str]]:
    """Returns (chunk_id, result, error). Caches the system prompt."""
    async with sem:
        try:
            msg = await client.messages.parse(
                model=MODEL,
                max_tokens=MAX_OUTPUT_TOKENS,
                system=[{
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=[{
                    "role": "user",
                    "content": (
                        f"### 정제할 청크\n"
                        f"제목: {chunk.get('title', '')}\n"
                        f"내용:\n{chunk['response']}\n\n"
                        f"위 청크에서 Q&A 페어를 추출하세요."
                    ),
                }],
                output_format=ExtractionResult,
            )
            return chunk["id"], msg.parsed_output, None
        except Exception as e:
            return chunk["id"], None, f"{type(e).__name__}: {e}"


def build_refined_chunks(original: dict, qa: ExtractionResult) -> list[dict]:
    """One youtube chunk + its Q&A pairs → N refined chunks matching the
    schema 2_embed.py expects."""
    refined = []
    title = original.get("title", "")
    channel = original.get("channel", "")
    video_url = original.get("video_url", "")
    start_sec = original.get("start_sec", 0.0)
    base_id = original["id"]
    for i, pair in enumerate(qa.qa_pairs):
        header_bits = []
        if channel: header_bits.append(f"YouTube: {channel}")
        if title: header_bits.append(title)
        header = f"[{' · '.join(header_bits)}]" if header_bits else ""
        embed_text = (
            f"{header}\n질문: {pair.question}\n답변: {pair.answer}"
            if header else f"질문: {pair.question}\n답변: {pair.answer}"
        )
        refined.append({
            "id":            f"{base_id}__qa_{i}",
            "source_type":   "youtube",
            "song":          "",
            "key":           "",
            "source":        original.get("source", ""),
            "analyzed_songs": "",
            "level":         1,
            "section_id":    f"{original.get('section_id', '00-0')}-qa{i}",
            "title":         title,
            "instruction":   pair.question,
            "response":      pair.answer,
            "embed_text":    embed_text,
            "topic_tags":    [],
            "file":          original.get("file", ""),
            # Preserve YouTube metadata for deep-links + filtering.
            "video_id":      original.get("video_id", ""),
            "video_url":     video_url,
            "channel":       channel,
            "start_sec":     start_sec,
            "end_sec":       original.get("end_sec", 0.0),
        })
    return refined


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0,
                        help="process only the first N youtube chunks (0 = all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print results, don't write chunks.json")
    parser.add_argument("--no-resume", action="store_true",
                        help="ignore qa_progress/ cache and re-call API for everything")
    args = parser.parse_args()

    load_dotenv()
    if not os.getenv("VITE_ANTHROPIC_API_KEY") and not os.getenv("ANTHROPIC_API_KEY"):
        print("✗ ANTHROPIC_API_KEY (or VITE_ANTHROPIC_API_KEY) not set", file=sys.stderr)
        sys.exit(1)
    api_key = os.getenv("VITE_ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_API_KEY")

    with open(CHUNKS_FILE, encoding="utf-8") as f:
        all_chunks = json.load(f)

    youtube_chunks = [c for c in all_chunks if c.get("source_type") == "youtube"]
    other_chunks   = [c for c in all_chunks if c.get("source_type") != "youtube"]
    print(f"input: {len(all_chunks)} total → {len(youtube_chunks)} youtube to refine, "
          f"{len(other_chunks)} pass-through")

    if args.limit:
        youtube_chunks = youtube_chunks[: args.limit]
        print(f"      limited to first {len(youtube_chunks)}")

    PROGRESS_DIR.mkdir(parents=True, exist_ok=True)

    # ── resume: skip chunks we've already extracted ────────────────────────
    pending = []
    cached_results: dict[str, ExtractionResult] = {}
    for c in youtube_chunks:
        cache_path = PROGRESS_DIR / f"{c['id']}.json"
        if not args.no_resume and cache_path.exists():
            try:
                cached_results[c["id"]] = ExtractionResult.model_validate_json(
                    cache_path.read_text(encoding="utf-8")
                )
                continue
            except Exception:
                pass
        pending.append(c)
    print(f"      {len(cached_results)} cached from prior run, {len(pending)} new to extract")

    # ── refine via Claude ──────────────────────────────────────────────────
    client = AsyncAnthropic(api_key=api_key)
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    fresh_results: dict[str, ExtractionResult] = {}
    failures: list[tuple[str, str]] = []

    done = 0
    total_in_tokens = total_cache_read = total_cache_write = total_out_tokens = 0

    tasks = [refine_one(client, sem, c) for c in pending]
    for coro in asyncio.as_completed(tasks):
        chunk_id, result, error = await coro
        done += 1
        if error:
            failures.append((chunk_id, error))
            print(f"  [{done:4d}/{len(pending)}] ✗ {chunk_id}: {error[:80]}", flush=True)
            continue
        assert result is not None
        fresh_results[chunk_id] = result
        # Persist immediately for resumability.
        (PROGRESS_DIR / f"{chunk_id}.json").write_text(
            result.model_dump_json(indent=2), encoding="utf-8"
        )
        if done % 25 == 0:
            print(f"  [{done:4d}/{len(pending)}] {chunk_id} → {len(result.qa_pairs)} pairs",
                  flush=True)

    print(f"\nextraction done: {len(fresh_results)} ok, {len(failures)} failed")
    if failures:
        print("  first 5 failures:")
        for fid, err in failures[:5]:
            print(f"    {fid}: {err[:120]}")

    # ── stitch refined chunks ──────────────────────────────────────────────
    all_results = {**cached_results, **fresh_results}
    refined_youtube: list[dict] = []
    empty_count = 0
    for c in youtube_chunks:
        res = all_results.get(c["id"])
        if res is None:
            # Failed; keep original raw chunk so we don't lose retrieval coverage.
            refined_youtube.append(c)
            continue
        new_chunks = build_refined_chunks(c, res)
        if not new_chunks:
            empty_count += 1
        refined_youtube.extend(new_chunks)

    new_total = other_chunks + refined_youtube
    print(f"\noutput: {len(other_chunks)} non-youtube + {len(refined_youtube)} refined youtube "
          f"(from {len(youtube_chunks)} raw, {empty_count} dropped as empty) "
          f"= {len(new_total)} total")

    if args.dry_run:
        print("\n[dry-run] sample refined chunk:")
        sample = next((c for c in refined_youtube if c.get("instruction")), None)
        if sample:
            print(f"  id: {sample['id']}")
            print(f"  Q: {sample['instruction']}")
            print(f"  A: {sample['response'][:200]}")
            print(f"  url: {sample.get('video_url')}")
        return

    # Backup + overwrite.
    if not BACKUP_FILE.exists():
        shutil.copy2(CHUNKS_FILE, BACKUP_FILE)
        print(f"  backup → {BACKUP_FILE.relative_to(THIS_DIR)}")
    with open(CHUNKS_FILE, "w", encoding="utf-8") as f:
        json.dump(new_total, f, ensure_ascii=False, indent=2)
    print(f"  wrote {CHUNKS_FILE.relative_to(THIS_DIR)}  ({len(new_total)} chunks)")
    print("\nNext: python 2_embed.py")


if __name__ == "__main__":
    asyncio.run(main())
