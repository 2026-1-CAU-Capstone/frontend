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
OUTPUT_FILE = "chunks/chunks.json"

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
#   standards: `- **곡명:** ...`         (markdown bold, KR-only)
#   lessons:   `강의 출처 (Source): ...`  (no bold, optional EN label)
# `\*{0,2}` 가 0 또는 2개 별표를 허용하고, `\s*(?:\([^)]*\))?` 가 `(Source)` 같은
# 영문 보조 라벨을 흡수한다.
META_PATTERNS = {
    "song":           r"\*{0,2}곡명\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
    "composer":       r"\*{0,2}작곡\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
    "key":            r"\*{0,2}센터 키\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
    "form":           r"\*{0,2}형식\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
    "source":         r"\*{0,2}강의 출처\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)",
    "analyzed_songs": r"분석 대상 곡\s*(?:\([^)]*\))?\s*:\s*(.+)",
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
