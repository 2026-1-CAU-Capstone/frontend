"""
SJS 189곡 ↔ iRealPro 1460곡 제목 매칭.

SJS title 예시:
  "All of Me"
  "Etta Jones - Bye Bye Blackbird"
  "Andra Day - God Bless the Child"
  "Andy Williams - A Summer Place - 1962"

iRealPro 파일명(slug) 예시:
  all-of-me.mid
  bye-bye-blackbird.mid
  god-bless-the-child.mid

전략:
  1. SJS 제목에서 일반적인 "Artist - Title" 분리 (마지막 segment를 곡명으로)
  2. 양쪽 normalize: 소문자 + 영숫자만
  3. 정확 매칭 → 정확 매칭 안 되면 contains/fuzzy 매칭

출력: public/data/sjs/ireal-matches.json
  [
    {
      "sjs_slug": "all-of-me",
      "sjs_title": "All of Me",
      "ireal_id": "all-of-me",
      "ireal_title": "All Of Me",
      "match_method": "exact",
      "confidence": 1.0
    },
    ...
  ]
"""

import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional


def normalize(s: str) -> str:
    """소문자 + 영숫자만 남기기."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


# 흔한 artist prefix/suffix 제거 (정확도 향상용)
KNOWN_ARTIST_HINTS = {
    "ella fitzgerald", "ella", "andra day", "etta jones", "kenny garrett",
    "andy williams", "anita o'day", "anita oday", "nat king cole",
    "anonymous", "feat", "ft", "remastered", "1958", "1962", "1998",
}


def clean_title_variants(title: str) -> list[str]:
    """가능한 곡명 후보들을 만듦 (artist 제거 시도 포함)."""
    variants = [title]
    # 여러 separator로 분리 (": ", " / ", " - ", " by ", "(from ")
    for sep in [" - ", ": ", " / ", " by ", "—"]:
        if sep in title:
            parts = [p.strip(' "\'') for p in title.split(sep)]
            variants.extend(parts)
    # 큰따옴표/작은따옴표로 둘러싼 부분 추출 (대개 곡명)
    for m in re.finditer(r'"([^"]+)"', title):
        variants.append(m.group(1).strip())
    # 괄호 안 내용 제거
    no_paren = re.sub(r"\([^)]*\)", "", title).strip()
    if no_paren and no_paren != title:
        variants.append(no_paren)
    # 따옴표/콜론/슬래시 등 punct 제거 버전
    no_punct = re.sub(r'[":\'/]', " ", title).strip()
    if no_punct != title:
        variants.append(no_punct)
    # 연도(4자리 숫자) 제거
    no_year = re.sub(r"\b(19|20)\d{2}\b", "", title).strip()
    if no_year != title:
        variants.append(no_year)
    return list(dict.fromkeys(v for v in variants if v))  # dedupe, drop empty


def best_match(sjs_title: str, ireal_index: dict[str, str]) -> Optional[tuple[str, str, float]]:
    """ireal_index: { normalized_title: ireal_id }. 반환: (ireal_id, method, confidence)."""
    variants = clean_title_variants(sjs_title)

    # 1. 정확 매칭 (normalized)
    for v in variants:
        nv = normalize(v)
        if nv in ireal_index:
            return (ireal_index[nv], "exact", 1.0)

    # 2. contains 매칭 — 모든 (variant, ireal) 쌍 중 best score 선택
    best: Optional[tuple[str, str, float]] = None
    for v in variants:
        nv = normalize(v)
        if len(nv) < 4:
            continue
        for ireal_norm, ireal_id in ireal_index.items():
            if len(ireal_norm) < 6:  # 매우 짧은 iRealPro slug는 false positive 위험 (예: "soon", "now")
                continue
            if nv == ireal_norm:
                return (ireal_id, "exact-normalized", 0.98)
            # 둘 중 짧은 게 긴 것에 포함되면 score = 짧은쪽/긴쪽
            if nv in ireal_norm:
                conf = len(nv) / len(ireal_norm)
            elif ireal_norm in nv:
                conf = len(ireal_norm) / len(nv)
            else:
                continue
            if conf >= 0.45:
                method = "sjs-in-ireal" if nv in ireal_norm else "ireal-in-sjs"
                if best is None or conf > best[2]:
                    best = (ireal_id, method, conf)
    if best is not None:
        return best

    # 3. Fuzzy 매칭 (SequenceMatcher) — 위 단계 실패 시 최후 수단.
    # SJS variant 중 가장 짧은(=곡명 가능성 높은) 것 사용해서 모든 iRealPro와 비교.
    short_variants = sorted(set(variants), key=lambda x: len(x))
    for v in short_variants[:5]:
        nv = normalize(v)
        if len(nv) < 6:
            continue
        for ireal_norm, ireal_id in ireal_index.items():
            if abs(len(nv) - len(ireal_norm)) > max(len(nv), len(ireal_norm)) * 0.4:
                continue
            ratio = SequenceMatcher(None, nv, ireal_norm).ratio()
            if ratio >= 0.85:
                if best is None or ratio > best[2]:
                    best = (ireal_id, "fuzzy", ratio)

    return best


# ────────────────────────────────────────────────────────────────────────────


def main():
    project_root = Path(__file__).parent.parent
    ireal_dir = project_root / "data" / "iRealPro" / "jazz-1460"
    sjs_dir = project_root / "public" / "data" / "sjs"

    # iRealPro 인덱스: { normalized_title_from_slug: ireal_id }
    ireal_files = list(ireal_dir.glob("*.mid"))
    print(f"Found {len(ireal_files)} iRealPro MIDI files")

    def slug_to_norm(slug: str) -> str:
        # all-of-me → allofme / a-ghost-of-a-chance → aghostofachance
        # 일부 slug는 -- 가 ' 였음 (slugToTitle 참고)
        title = slug.replace("--", "'").replace("-", " ")
        return normalize(title)

    ireal_index: dict[str, str] = {}
    for f in ireal_files:
        ireal_id = f.stem
        norm = slug_to_norm(ireal_id)
        # 충돌 시 첫 번째만
        ireal_index.setdefault(norm, ireal_id)

    # SJS 인덱스
    sjs_index_path = sjs_dir / "index.json"
    if not sjs_index_path.exists():
        print(f"ERROR: SJS index not found at {sjs_index_path}")
        sys.exit(1)
    sjs_entries = json.loads(sjs_index_path.read_text(encoding="utf-8"))
    print(f"Found {len(sjs_entries)} SJS songs")

    matches: list[dict] = []
    for sjs in sjs_entries:
        result = best_match(sjs["title"], ireal_index)
        if result is None:
            matches.append({
                "sjs_slug": sjs["slug"],
                "sjs_title": sjs["title"],
                "ireal_id": None,
                "match_method": "none",
                "confidence": 0.0,
            })
        else:
            ireal_id, method, conf = result
            # 원본 slug → 표시 title (slugToTitle 시뮬레이션)
            ireal_title = ireal_id.replace("--", "'").replace("-", " ").title().strip()
            matches.append({
                "sjs_slug": sjs["slug"],
                "sjs_title": sjs["title"],
                "ireal_id": ireal_id,
                "ireal_title": ireal_title,
                "match_method": method,
                "confidence": round(conf, 3),
            })

    # 통계
    matched = [m for m in matches if m["ireal_id"]]
    by_method: dict[str, int] = {}
    for m in matches:
        by_method[m["match_method"]] = by_method.get(m["match_method"], 0) + 1
    print(f"\nMatched: {len(matched)} / {len(matches)}")
    print("By method:")
    for method, count in sorted(by_method.items(), key=lambda x: -x[1]):
        print(f"  {method}: {count}")

    out = sjs_dir / "ireal-matches.json"
    out.write_text(json.dumps(matches, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {out}")

    # 매칭 안 된 곡 샘플 (디버그)
    unmatched = [m for m in matches if not m["ireal_id"]]
    print(f"\nUnmatched samples ({len(unmatched)}):")
    for m in unmatched[:15]:
        print(f"  {m['sjs_title']}")


if __name__ == "__main__":
    main()
