"""
STEP 1: 청크 분할 스크립트.

데이터 폴더 두 갈래를 처리한다:

    data/explanation/standards/   → source_type='standard' (1곡 = 1파일 정형 분석)
    data/explanation/lessons/     → source_type='lesson'   (강의 트랜스크립트)

두 폴더 모두 동일한 Q&A 섹션 포맷을 사용한다 (앞에 `###` prefix 가 붙는지만 차이).
공통 파서로 섹션을 잘라내고, 폴더별로 메타데이터(곡명/출처/대상곡 목록)를
조금씩 다르게 채운다. 모든 청크는 같은 컬렉션에 들어가지만 `source_type` 메타로
필터링 가능.

실행: python 1_chunk.py
결과: chunks/chunks.json
"""

import os
import re
import json
from typing import Iterable

DATA_ROOT = "../data/explanation"
STANDARDS_DIR = os.path.join(DATA_ROOT, "standards")
LESSONS_DIR = os.path.join(DATA_ROOT, "lessons")
EOJ_DIR = os.path.join(DATA_ROOT, "이지원재즈")
YOUTUBE_ROOT = "../data/youtube"  # per-channel subdirs with transcripts/*.json
OUTPUT_FILE = "chunks/chunks.json"

# Target chunk length for YouTube transcripts. ~150 words ≈ 1 min of speech;
# big enough to carry a full thought, small enough that retrieval can pin
# the relevant passage rather than dump a whole lesson at the LLM.
YOUTUBE_CHUNK_CHARS = 1200

# 곡별 메타데이터 (standards/*.txt 파일명 → 토픽 태그)
TOPIC_TAGS = {
    "allofme":                   ["secondary-dominant", "extended-secondary", "dim7", "modal-interchange"],
    "anthropology":              ["rhythm-changes", "tritone-sub", "dual-function", "bridge"],
    "autumnleaves":              ["minor-key", "relative-major", "vii-pivot"],
    "blueingreen":               ["key-ambiguity", "tritone-sub", "circular-form"],
    "bolivia":                   ["key-center", "modal-interchange", "tritone-sub", "bass-line"],
    "cherokee":                  ["diatonic-analysis", "secondary-dominant", "related-to-minor", "two-scale"],
    "confirmation":              ["bebop", "dominant-chain", "pivot", "blues-fourth"],
    "donnalee":                  ["bebop", "vii-pivot", "dim7-substitute"],
    "flymetothemoon":            ["reharmonization", "minor-ii-v", "multi-version"],
    "ifallinlovetooeasily":      ["deceptive-resolution", "extended-secondary", "tritone-sub"],
    "itcouldhappentoyou":        ["1625", "dim7", "IMaj7-IIIm7", "II7", "tritone-sub", "augmented"],
    "justfriends":               ["flat-VII7", "tritone-sub", "dual-function", "IV-opening"],
    "momentsnotice":             ["coltrane", "dim-axis", "local-key", "pivot", "pattern"],
    "somedaymyprincewillcome":   ["whole-tone", "augmented", "3-4-time"],
    "thedaysofwineandroses":     ["chord-tone-plus-key", "lydian-b7", "mixolydian"],
    "theendofaloveaffair":       ["dim7-function", "dual-function", "related-keys", "modal-interchange"],
    "therewillneverbeanotheryou": ["non-diatonic", "secondary-dominant", "II7", "backdoor"],
}

# Metadata 라벨은 두 포맷 모두 흡수:
#   KR 헤더 (`## 곡 정보`)      : `- **곡명:** ...`     `- **센터 키:** ...` 등
#   EN 헤더 (`## Song Info`)    : `- **Title:** ...`    `- **Center Key:** ...` 등
# `\*{0,2}` 가 0 또는 2개 별표를 허용하고, `\s*(?:\([^)]*\))?` 가 `(Source)` 같은
# 영문 보조 라벨을 흡수한다. 라벨 본체는 KR / EN 둘 중 하나여도 매칭되도록 alt.
META_PATTERNS = {
    "song":           r"\*{0,2}(?:곡명|Title)\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
    "composer":       r"\*{0,2}(?:작곡|Composer)\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
    "key":            r"\*{0,2}(?:센터 키|Center Key)\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
    "form":           r"\*{0,2}(?:형식|Form)\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
    "source":         r"\*{0,2}(?:강의 출처|Source)\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
    "analyzed_songs": r"\*{0,2}(?:분석 대상 곡|Analyzed Songs)\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
}


def parse_file_meta(text: str) -> dict:
    """파일 상단 메타 블록 파싱. 키가 없으면 빈 문자열로 둔다."""
    out = {}
    for field, pat in META_PATTERNS.items():
        m = re.search(pat, text)
        out[field] = m.group(1).strip() if m else ""
    return out


# 섹션 헤더: `### N-M.` 또는 `N-M.` (lessons 는 ### 없이 평문)
SECTION_RE = re.compile(
    r"^(?:###\s+)?(\d+-\d+)\.\s+(.+?)$\n(.*?)(?=^(?:###\s+)?\d+-\d+\.|\Z)",
    re.MULTILINE | re.DOTALL,
)


def parse_sections(text: str) -> Iterable[tuple[str, str, str]]:
    """(section_id, title, body) 튜플 반복."""
    for m in SECTION_RE.finditer(text):
        yield m.group(1), m.group(2).strip(), m.group(3).strip()


def parse_qa(body: str) -> tuple[str, str]:
    """**instruction:** / **response:** 블록 분리. KR/EN 라벨 변형까지 흡수."""
    inst_m = re.search(
        r"\*\*instruction(?:\s*\(KR\))?:\*\*\s*(.+?)(?=\n\*\*(?:instruction|response)\s*(?:\([A-Z]+\))?:|\Z)",
        body,
        re.DOTALL,
    )
    resp_m = re.search(
        r"\*\*response(?:\s*\(KR\))?:\*\*\s*(.+?)(?=\n\*\*response\s*\([A-Z]+\):|\Z)",
        body,
        re.DOTALL,
    )
    instruction = inst_m.group(1).strip() if inst_m else ""
    response = resp_m.group(1).strip() if resp_m else body
    return instruction, response


def build_chunk(
    *,
    source_type: str,
    file_base: str,
    meta: dict,
    section_id: str,
    title: str,
    instruction: str,
    response: str,
    topic_tags: list[str],
) -> dict:
    # Prefix every chunk's embed_text with a short song-context header so that
    # song name / key keywords get matched on retrieval. Without this, embeddings
    # only see {title, instruction, response} and song-specific queries like
    # "All of Me 도미넌트 체인" miss the connection.
    #   standards: "[<곡명> · <키>]"
    #   lessons:   "[강의: <source>] (분석: <analyzed_songs>)" — falls back to
    #              source/analyzed_songs since a lesson can cover many songs.
    if source_type == "standard":
        song = meta.get("song", "").strip()
        key = meta.get("key", "").strip()
        header_parts = [p for p in (song, key) if p]
        header = f"[{' · '.join(header_parts)}]" if header_parts else ""
    else:
        src = meta.get("source", "").strip()
        songs = meta.get("analyzed_songs", "").strip()
        bits = []
        if src: bits.append(f"강의: {src}")
        if songs: bits.append(f"분석: {songs}")
        header = f"[{' / '.join(bits)}]" if bits else ""

    body = (
        f"{title}\n질문: {instruction}\n답변: {response}"
        if instruction
        else f"{title}\n{response}"
    )
    embed_text = f"{header}\n{body}" if header else body
    return {
        "id":           f"{source_type}__{file_base}__{section_id}",
        "source_type":  source_type,
        "song":         meta.get("song", ""),
        "key":          meta.get("key", ""),
        "source":       meta.get("source", ""),
        "analyzed_songs": meta.get("analyzed_songs", ""),
        "level":        int(section_id.split("-")[0]),
        "section_id":   section_id,
        "title":        title,
        "instruction":  instruction,
        "response":     response,
        "embed_text":   embed_text,
        "topic_tags":   topic_tags,
        "file":         file_base,
    }


def chunk_standards(dir_path: str) -> list[dict]:
    """곡-단위 정형 분석 (standards/)."""
    chunks = []
    for fname in sorted(os.listdir(dir_path)):
        if not fname.endswith(".txt"):
            continue
        path = os.path.join(dir_path, fname)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if not text.strip():
            print(f"  SKIP (empty): standards/{fname}")
            continue
        base = fname[:-4]
        meta = parse_file_meta(text)
        tags = TOPIC_TAGS.get(base, [])
        before = len(chunks)
        for section_id, title, body in parse_sections(text):
            instruction, response = parse_qa(body)
            chunks.append(build_chunk(
                source_type="standard",
                file_base=base,
                meta=meta,
                section_id=section_id,
                title=title,
                instruction=instruction,
                response=response,
                topic_tags=tags,
            ))
        print(f"  standards/{fname}: {len(chunks) - before}개 청크")
    return chunks


def chunk_youtube(root_dir: str) -> list[dict]:
    """YouTube transcript JSONs (produced by ingest_youtube.py).

    Layout: <root_dir>/<channel>/transcripts/<video_id>.json
    Each video is sliced into ~YOUTUBE_CHUNK_CHARS-sized windows snapped to
    Whisper-segment boundaries, so chunks always start/end on speech pauses
    and never split a sentence. We preserve start/end timestamps so the
    retriever can return a deep-link URL (?t=NN) pointing at the exact moment.
    """
    if not os.path.isdir(root_dir):
        return []
    chunks: list[dict] = []
    for channel in sorted(os.listdir(root_dir)):
        # easyonejazz is sourced from its Whisper transcript JSONs (which carry
        # per-segment start/end times) so retrieval can deep-link to the exact
        # moment. (Previously it was routed through chunk_eoj's plain .txt,
        # which has no timestamps — every chunk landed at 0:00.)
        tdir = os.path.join(root_dir, channel, "transcripts")
        if not os.path.isdir(tdir):
            continue
        for fname in sorted(os.listdir(tdir)):
            if not fname.endswith(".json"):
                continue
            with open(os.path.join(tdir, fname), encoding="utf-8") as f:
                doc = json.load(f)
            segments = doc.get("segments") or []
            if not segments:
                # Whisper sometimes returns text-only on very short clips;
                # fall back to a single chunk using the full text.
                full = (doc.get("text") or "").strip()
                if not full:
                    print(f"  SKIP (empty transcript): {channel}/{fname}")
                    continue
                segments = [{"start": 0.0,
                             "end": doc.get("duration", 0.0),
                             "text": full}]

            video_id = doc.get("video_id") or fname[:-5]
            title = doc.get("title", "")
            base_url = doc.get("url") or f"https://www.youtube.com/watch?v={video_id}"

            # Greedy pack: fill the current chunk until adding the next segment
            # would exceed YOUTUBE_CHUNK_CHARS, then flush.
            buf: list[dict] = []
            buf_len = 0
            chunk_idx = 0

            def flush():
                nonlocal buf, buf_len, chunk_idx
                if not buf: return
                start = float(buf[0]["start"])
                end = float(buf[-1]["end"])
                text = " ".join(s["text"].strip() for s in buf if s.get("text"))
                if not text.strip():
                    buf = []; buf_len = 0
                    return
                ts = int(start)
                deep_url = f"{base_url}&t={ts}s"
                header_bits = [f"YouTube: {channel}"]
                if title: header_bits.append(title)
                header_bits.append(f"@{ts // 60}:{ts % 60:02d}")
                header = f"[{' · '.join(header_bits)}]"
                chunks.append({
                    "id":           f"youtube__{channel}__{video_id}__{chunk_idx:03d}",
                    "source_type":  "youtube",
                    "song":         "",
                    "key":          "",
                    # Reuse `source` for the channel + video title — retrieval
                    # already filters/groups by this field for lessons.
                    "source":       f"{channel} · {title}".strip(" ·"),
                    "analyzed_songs": "",
                    "level":        1,
                    "section_id":   f"00-{chunk_idx}",
                    "title":        f"{title} @{ts // 60}:{ts % 60:02d}",
                    "instruction":  "",
                    "response":     text,
                    "embed_text":   f"{header}\n{text}",
                    "topic_tags":   [],
                    "file":         video_id,
                    # YouTube-specific extras (read by 2_embed.py if present).
                    "video_id":     video_id,
                    "video_url":    deep_url,
                    "channel":      channel,
                    "start_sec":    round(start, 2),
                    "end_sec":      round(end, 2),
                })
                chunk_idx += 1
                buf = []; buf_len = 0

            for seg in segments:
                seg_text = (seg.get("text") or "").strip()
                if not seg_text:
                    continue
                seg_len = len(seg_text) + 1
                if buf and buf_len + seg_len > YOUTUBE_CHUNK_CHARS:
                    flush()
                buf.append(seg); buf_len += seg_len
            flush()
            print(f"  youtube/{channel}/{fname}: {chunk_idx}개 청크")
    return chunks


def chunk_lessons(dir_path: str) -> list[dict]:
    """강의 트랜스크립트 (lessons/). `analyzed_songs` 메타에서 곡 목록 추출."""
    chunks = []
    for fname in sorted(os.listdir(dir_path)):
        if not fname.endswith(".txt"):
            continue
        path = os.path.join(dir_path, fname)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if not text.strip():
            print(f"  SKIP (empty): lessons/{fname}")
            continue
        base = fname[:-4]
        meta = parse_file_meta(text)
        # lessons 파일은 한 강의가 여러 곡을 다루는 경우가 흔하다. analyzed_songs
        # 필드를 그대로 메타에 보존해 두면 retrieval 단에서 키워드 매칭 가능.
        before = len(chunks)
        for section_id, title, body in parse_sections(text):
            instruction, response = parse_qa(body)
            chunks.append(build_chunk(
                source_type="lesson",
                file_base=base,
                meta=meta,
                section_id=section_id,
                title=title,
                instruction=instruction,
                response=response,
                topic_tags=[],
            ))
        print(f"  lessons/{fname}: {len(chunks) - before}개 청크")
    return chunks



EOJ_CHUNK_CHARS = 1200
EOJ_FILENAME_RE = re.compile(r"\[([A-Za-z0-9_-]{6,15})\]\.txt$")


def chunk_eoj(dir_path: str) -> list[dict]:
    """explanation/이지원재즈/*.txt → youtube chunks.

    Body split into ~EOJ_CHUNK_CHARS sentence-aligned windows. No segment
    timestamps (the source txt is plain text), so the chunk URL points to
    the video without &t=.
    """
    if not os.path.isdir(dir_path):
        return []
    chunks: list[dict] = []
    for fname in sorted(os.listdir(dir_path)):
        if not fname.endswith(".txt"):
            continue
        with open(os.path.join(dir_path, fname), encoding="utf-8") as f:
            raw = f.read()

        header = {}
        body_lines = []
        for ln in raw.splitlines():
            if ln.startswith("# "):
                header["title"] = ln[2:].strip()
            elif ln.startswith("channel:"):
                header["channel"] = ln.split(":", 1)[1].strip()
            elif ln.startswith("url:"):
                header["url"] = ln.split(":", 1)[1].strip()
            elif ln.startswith("duration:"):
                header["duration"] = ln.split(":", 1)[1].strip()
            elif ln.startswith("language:"):
                header["language"] = ln.split(":", 1)[1].strip()
            else:
                body_lines.append(ln)
        body = "\n".join(body_lines).strip()
        if not body:
            print(f"  SKIP (empty body): 이지원재즈/{fname}")
            continue

        title = header.get("title", fname[:-4])
        channel = header.get("channel", "easyonejazz") or "easyonejazz"
        url = header.get("url", "")
        m = EOJ_FILENAME_RE.search(fname)
        video_id = m.group(1) if m else fname[:-4]

        sents = re.split(r"(?<=[.!?\n])\s+", body)
        sents = [s.strip() for s in sents if s.strip()]
        buf = []
        buf_len = 0
        chunk_idx = 0

        def flush():
            nonlocal buf, buf_len, chunk_idx
            if not buf:
                return
            text = " ".join(buf).strip()
            if not text:
                buf = []; buf_len = 0; return
            header_bits = [f"YouTube: {channel}"]
            if title: header_bits.append(title)
            hdr = f"[{' · '.join(header_bits)}]"
            chunks.append({
                "id":           f"youtube__{channel}__{video_id}__{chunk_idx:03d}",
                "source_type":  "youtube",
                "song":         "",
                "key":          "",
                "source":       f"{channel} · {title}".strip(" ·"),
                "analyzed_songs": "",
                "level":        1,
                "section_id":   f"00-{chunk_idx}",
                "title":        title,
                "instruction":  "",
                "response":     text,
                "embed_text":   f"{hdr}\n{text}",
                "topic_tags":   [],
                "file":         video_id,
                "video_id":     video_id,
                "video_url":    url,
                "channel":      channel,
                "start_sec":    0.0,
                "end_sec":      0.0,
            })
            chunk_idx += 1
            buf = []; buf_len = 0

        for s in sents:
            sl = len(s) + 1
            if buf and buf_len + sl > EOJ_CHUNK_CHARS:
                flush()
            buf.append(s); buf_len += sl
        flush()
        print(f"  이지원재즈/{fname}: {chunk_idx}개 청크")
    return chunks


def main():
    os.makedirs("chunks", exist_ok=True)
    all_chunks: list[dict] = []

    if os.path.isdir(STANDARDS_DIR):
        all_chunks.extend(chunk_standards(STANDARDS_DIR))
    else:
        print(f"  (no folder) {STANDARDS_DIR}")

    if os.path.isdir(LESSONS_DIR):
        all_chunks.extend(chunk_lessons(LESSONS_DIR))
    else:
        print(f"  (no folder) {LESSONS_DIR}")

    # NOTE: easyonejazz now comes from chunk_youtube (timestamped transcript
    # JSONs), so chunk_eoj's plain-.txt path is disabled to avoid duplicate,
    # timestamp-less copies of the same videos. Re-enable only if you have EOJ
    # .txt content that has no corresponding transcript JSON.
    # if os.path.isdir(EOJ_DIR):
    #     all_chunks.extend(chunk_eoj(EOJ_DIR))

    if os.path.isdir(YOUTUBE_ROOT):
        all_chunks.extend(chunk_youtube(YOUTUBE_ROOT))
    else:
        print(f"  (no folder) {YOUTUBE_ROOT}")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, ensure_ascii=False, indent=2)

    by_type: dict[str, int] = {}
    for c in all_chunks:
        by_type[c["source_type"]] = by_type.get(c["source_type"], 0) + 1
    print(f"\n총 {len(all_chunks)}개 청크 → {OUTPUT_FILE}")
    for k, v in sorted(by_type.items()):
        print(f"  {k}: {v}")

    if all_chunks:
        sample = all_chunks[0]
        print(f"\n[샘플] {sample['id']}")
        print(f"  source_type: {sample['source_type']}")
        print(f"  song: {sample['song']}")
        print(f"  title: {sample['title']}")
        print(f"  level: {sample['level']}")
        print(f"  embed_text (앞 100자): {sample['embed_text'][:100]}")


if __name__ == "__main__":
    main()
