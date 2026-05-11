"""
Symbolic Jazz Standards (jspr/symbolic-jazz-standards) → frontend JSON 변환기.

입력: data/train-00000-of-00001.parquet (HuggingFace에서 다운로드)
출력:
  public/data/sjs/index.json        — 곡 목록 + 각 곡의 가용 stem 리스트
  public/data/sjs/<slug>.json       — 곡 1개 = { stems: { vocals: {...}, bass: {...}, other: {...}, drums: {...} } }

REMI 토큰 형식 (요약):
  Bar_None              새 마디 시작
  Position_N            마디 내 위치 (32분음표 그리드 기준 0~31, 4/4 = 0..31 = 1마디)
  Pitch_N               MIDI 노트 번호
  Velocity_N            MIDI velocity
  Duration_X.Y.Z        길이 = X박 + Y/Z 박 (예: 0.3.8 = 3/8 박)
  Chord_dim, Chord_7maj 코드 라벨 (참고 정보)
  Program_0             MIDI program (악기) — 무시 가능

Frontend가 사용할 컴팩트 노트 포맷:
  { bar, pos, midi, dur }   — pos는 0~31 (32분음표 그리드), dur은 32분음표 단위
"""

import json
import re
import sys
from pathlib import Path
from typing import Iterable

import pyarrow.parquet as pq

# ────────────────────────────────────────────────────────────────────────────

GRID = 32  # 32분음표 그리드 (REMI Position의 일반적 해상도)


def slugify(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip()).strip("-").lower()
    return s[:80] if s else "untitled"


def parse_duration(tok: str) -> int:
    """Duration_X.Y.Z → 32분음표 단위 정수.

    REMI duration은 'X.Y.Z' 형태 ('beats.ticks.resolution'):
        beats + ticks/resolution 박
    32분음표 1개 = 1/8박이므로 결과를 8배해서 정수화.
    """
    m = re.match(r"Duration_(\d+)\.(\d+)\.(\d+)", tok)
    if not m:
        return 1
    beats = int(m.group(1))
    ticks = int(m.group(2))
    res = int(m.group(3)) or 1
    # 1박 = 8개 32분음표
    units = beats * 8 + round((ticks / res) * 8)
    return max(1, units)


def tokens_to_notes(tokens: list[str]) -> dict:
    """REMI 토큰 시퀀스 → { bars: [...], chords: [{bar, pos, label}] }.

    각 bar는 list of { pos, midi, dur } 형태.
    """
    bars: list[list[dict]] = [[]]
    chords: list[dict] = []
    cur_bar = 0
    cur_pos = 0
    # Pitch_N 직후의 Velocity → Duration 시퀀스를 묶음
    i = 0
    n = len(tokens)
    while i < n:
        t = tokens[i]
        if t == "Bar_None":
            bars.append([])
            cur_bar = len(bars) - 1
            cur_pos = 0
        elif t.startswith("Position_"):
            try:
                cur_pos = int(t.split("_", 1)[1])
            except ValueError:
                cur_pos = 0
        elif t.startswith("Pitch_"):
            try:
                midi = int(t.split("_", 1)[1])
            except ValueError:
                i += 1
                continue
            # 다음 Velocity, Duration 토큰을 짝지어 찾음 (Program_은 건너뜀)
            j = i + 1
            dur_units = 4  # 기본: 8분음표
            while j < n and j < i + 6:
                nt = tokens[j]
                if nt.startswith("Duration_"):
                    dur_units = parse_duration(nt)
                    break
                if nt.startswith("Pitch_") or nt == "Bar_None" or nt.startswith("Position_"):
                    break
                j += 1
            bars[cur_bar].append({"pos": cur_pos, "midi": midi, "dur": dur_units})
        elif t.startswith("Chord_"):
            label = t.split("_", 1)[1]
            chords.append({"bar": cur_bar, "pos": cur_pos, "label": label})
        i += 1
    # 빈 leading bar 제거
    while bars and not bars[0]:
        bars.pop(0)
    return {"bars": bars, "chords": chords}


# ────────────────────────────────────────────────────────────────────────────


def main():
    parquet_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/sjs.parquet")
    out_dir = Path(__file__).parent.parent / "public" / "data" / "sjs"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Reading {parquet_path}…")
    table = pq.read_table(str(parquet_path))
    titles = table.column("song_title").to_pylist()
    stems = table.column("instrument_type").to_pylist()
    remi_tokens_col = table.column("remi.tokens")

    # song_title → { stem → tokens }
    by_song: dict[str, dict[str, list[str]]] = {}
    for i, (title, stem) in enumerate(zip(titles, stems)):
        if not title or not title.strip():
            continue
        by_song.setdefault(title, {})[stem] = remi_tokens_col[i].as_py()

    print(f"Unique songs: {len(by_song)}")

    index: list[dict] = []
    used_slugs: set[str] = set()
    for title, stem_map in sorted(by_song.items(), key=lambda x: x[0].lower()):
        slug = slugify(title)
        # 중복 회피
        base = slug
        n = 2
        while slug in used_slugs:
            slug = f"{base}-{n}"
            n += 1
        used_slugs.add(slug)

        song_data = {
            "title": title,
            "slug": slug,
            "stems": {},
        }
        for stem, toks in stem_map.items():
            song_data["stems"][stem] = tokens_to_notes(toks)
        # 곡 파일
        (out_dir / f"{slug}.json").write_text(
            json.dumps(song_data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        # 인덱스 entry
        index.append({
            "title": title,
            "slug": slug,
            "stems": sorted(stem_map.keys()),
        })

    (out_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {len(index)} songs to {out_dir}")
    total_bytes = sum((out_dir / f"{e['slug']}.json").stat().st_size for e in index)
    print(f"Total payload: {total_bytes / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
