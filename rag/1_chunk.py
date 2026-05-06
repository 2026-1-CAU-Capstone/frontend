"""
STEP 1: 청크 분할 스크립트
17개 .txt 파일 → 개별 Q&A 청크 JSON으로 변환

실행: python 1_chunk.py
결과: chunks/ 폴더에 chunks.json 생성
"""

import os
import re
import json

DATA_DIR = "../data/explanation/jazzstandard"
OUTPUT_FILE = "chunks/chunks.json"

# 곡별 메타데이터 (파일명 → 추가 태그)
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


def parse_file_meta(text: str) -> dict:
    """파일 상단 곡 정보 파싱"""
    meta = {}
    patterns = {
        "song":     r"\*\*곡명:\*\*\s*(.+)",
        "composer": r"\*\*작곡:\*\*\s*(.+)",
        "key":      r"\*\*센터 키:\*\*\s*(.+)",
        "form":     r"\*\*형식:\*\*\s*(.+)",
        "source":   r"\*\*강의 출처:\*\*\s*(.+)",
    }
    for field, pattern in patterns.items():
        m = re.search(pattern, text)
        meta[field] = m.group(1).strip() if m else ""
    return meta


def parse_chunks(filename: str, text: str) -> list[dict]:
    """### 1-1., ### 2-1. 등의 섹션을 청크로 분할"""
    base = filename.replace(".txt", "")
    meta = parse_file_meta(text)
    topic_tags = TOPIC_TAGS.get(base, [])
    chunks = []

    # 레벨별 섹션 분할 (### 1-x, ### 2-x, ### 3-x)
    section_pattern = re.compile(
        r"### (\d+-\d+)\.\s+(.+?)\n(.*?)(?=\n### \d+-\d+\.|\Z)",
        re.DOTALL
    )

    for m in section_pattern.finditer(text):
        section_id  = m.group(1)          # "1-1"
        section_title = m.group(2).strip() # "곡의 키 센터 확인법"
        body = m.group(3).strip()

        # instruction / response 파싱
        inst_m = re.search(r"\*\*instruction:\*\*\s*(.+?)(?=\n\*\*response:|$)", body, re.DOTALL)
        resp_m = re.search(r"\*\*response:\*\*\s*(.+)", body, re.DOTALL)
        instruction = inst_m.group(1).strip() if inst_m else ""
        response    = resp_m.group(1).strip() if resp_m else body

        # 레벨 추출 (1 = 범용 개념, 2 = 곡별 분석, 3 = 연주 판단)
        level = int(section_id.split("-")[0])

        # 임베딩할 텍스트: instruction + response 합친 것
        embed_text = f"{section_title}\n질문: {instruction}\n답변: {response}" if instruction else f"{section_title}\n{response}"

        chunk = {
            "id":           f"{base}__{section_id}",
            "song":         meta.get("song", ""),
            "key":          meta.get("key", ""),
            "source":       meta.get("source", ""),
            "level":        level,
            "section_id":   section_id,
            "title":        section_title,
            "instruction":  instruction,
            "response":     response,
            "embed_text":   embed_text,
            "topic_tags":   topic_tags,
            "file":         base,
        }
        chunks.append(chunk)

    return chunks


def main():
    os.makedirs("chunks", exist_ok=True)
    all_chunks = []

    files = sorted([f for f in os.listdir(DATA_DIR) if f.endswith(".txt")])
    for fname in files:
        path = os.path.join(DATA_DIR, fname)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if not text.strip():
            print(f"  SKIP (empty): {fname}")
            continue
        chunks = parse_chunks(fname, text)
        all_chunks.extend(chunks)
        print(f"  {fname}: {len(chunks)}개 청크")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, ensure_ascii=False, indent=2)

    print(f"\n총 {len(all_chunks)}개 청크 → {OUTPUT_FILE} 저장 완료")

    # 샘플 출력
    if all_chunks:
        print("\n[샘플 청크]")
        sample = all_chunks[0]
        print(f"  id: {sample['id']}")
        print(f"  song: {sample['song']}")
        print(f"  title: {sample['title']}")
        print(f"  level: {sample['level']}")
        print(f"  embed_text (앞 100자): {sample['embed_text'][:100]}")


if __name__ == "__main__":
    main()
