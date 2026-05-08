"""
STEP 4: Agentic 레이어 (HarmoRAG의 핵심)
Rule-based 엔진 출력 → 쿼리 분해 → 멀티소스 검색 → 컨텍스트 종합

사용법 (서버에서 import):
  from agent import build_context
  context = build_context(chord_analysis_json, user_question)
"""

import json
from retrieve import search, format_for_llm


# ──────────────────────────────────────────────────────────────────────────────
# 1. Query Decomposition (Agentic 핵심 #1)
#    Rule-based 엔진 출력 → 의미 있는 검색 쿼리 3~4개로 분해
# ──────────────────────────────────────────────────────────────────────────────

def decompose_query(
    chord_context: dict,   # rule-based 엔진 출력
    user_question: str,
    song_title: str = "",
) -> list[dict]:
    """
    chord_context 예시:
    {
      "chord": "F7",
      "key": "Eb",
      "function": "II7",
      "is_diatonic": false,
      "secondary_dominant": null,
      "modal_interchange": null,
      "group_memberships": [],
      "next_chord": "Fm7",
      "patterns_detected": ["ii7-flat5-not-resolving-to-v"]
    }

    반환: [{"query": "...", "level": 1|2|3, "tag": "..."}, ...]
    """
    queries = []
    chord = chord_context.get("chord", "")
    key   = chord_context.get("key", "C")
    func  = chord_context.get("function", "")
    next_chord = chord_context.get("next_chord", "")
    patterns = chord_context.get("patterns_detected", [])
    sec_dom = chord_context.get("secondary_dominant")
    modal   = chord_context.get("modal_interchange")

    # ── Query 1: 범용 개념 (Lv1) ──────────────────────────────────────────────
    if func == "II7":
        queries.append({
            "query": f"II7 코드 특수성 얼터드 안 어울림 샵11 스케일",
            "level": 1,
            "tag": None,
        })
    elif func in ("V7", "D"):
        target = next_chord or "I"
        queries.append({
            "query": f"도미넌트 세븐 {chord} {target}로 해결 얼터드 스케일",
            "level": 1,
            "tag": None,
        })
    elif func in ("T", "I"):
        queries.append({
            "query": f"토닉 코드 {chord} 스케일 선택 솔로",
            "level": 1,
            "tag": None,
        })

    # ── Query 2: 세컨더리 도미넌트 ────────────────────────────────────────────
    if sec_dom:
        target_deg = sec_dom.get("targetDegree", "")
        queries.append({
            "query": f"세컨더리 도미넌트 V/{target_deg} 얼터드 스케일 {chord}",
            "level": 1,
            "tag": "secondary-dominant",
        })

    # ── Query 3: 모달 인터체인지 ──────────────────────────────────────────────
    if modal:
        source_mode = modal.get("sourceMode", "")
        queries.append({
            "query": f"모달 인터체인지 {source_mode} {chord} 스케일",
            "level": 1,
            "tag": "modal-interchange",
        })

    # ── Query 4: 트라이톤 서브 패턴 감지 ────────────────────────────────────
    if any("tritone" in p.lower() for p in patterns):
        queries.append({
            "query": f"트라이톤 서브스티튜션 {chord} 가이드톤 스케일",
            "level": 1,
            "tag": "tritone-sub",
        })

    # ── Query 5: dim7 패턴 ────────────────────────────────────────────────────
    if any("dim" in p.lower() for p in patterns) or "dim" in chord.lower():
        queries.append({
            "query": f"디미니쉬드 코드 {chord} 모체 도미넌트 얼터드",
            "level": 1,
            "tag": "dim7",
        })

    # ── Query 6: 곡명 기반 직접 검색 ────────────────────────────────────────
    # 가장 중요한 쿼리: 해당 곡의 분석 청크를 직접 가져옴
    if song_title:
        queries.insert(0, {
            "query": f"{song_title} 코드 분석 화성",
            "level": None,
            "tag": None,
        })
        queries.insert(1, {
            "query": f"{song_title} 솔로 연주 판단",
            "level": 3,
            "tag": None,
        })

    # ── Query 7: 연주 판단 (Lv3) — 사용자 질문 기반 ─────────────────────────
    if user_question and user_question not in ("이 코드 진행 분석해줘",):
        queries.append({
            "query": f"{user_question} {chord} {key} 키",
            "level": 3,
            "tag": None,
        })

    # 최소 1개 보장
    if not queries:
        queries.append({
            "query": f"{song_title or chord} {key} 키 코드 분석",
            "level": None,
            "tag": None,
        })

    return queries


# ──────────────────────────────────────────────────────────────────────────────
# 2. Multi-Source Routing + Reciprocal Rank Fusion (Agentic 핵심 #2)
#    각 쿼리를 올바른 소스에 라우팅해 검색하고, RRF로 결과를 융합한다.
#    RRF 공식:    score(c) = Σ_q  1 / (k + rank_q(c))
#    - rank_q(c): sub-query q의 결과 안에서 청크 c의 순위 (1, 2, 3, ...)
#    - k:         보통 60. rank 1과 rank 10의 차이를 부드럽게 만드는 상수
#    이렇게 하면 (1) 쿼리별 score 스케일 차이를 무시하고,
#                (2) 여러 쿼리에 걸쳐 일관되게 상위에 든 청크를 우선시한다.
# ──────────────────────────────────────────────────────────────────────────────

def route_and_retrieve(
    queries: list[dict],
    n_per_query: int = 3,
    rrf_k: int = 60,
) -> list[dict]:
    """
    현재 소스: HarmoRAG (ChromaDB)
    추후 확장: Lick DB 검색 추가 예정

    각 sub-query를 따로 검색해 결과를 모은 뒤, Reciprocal Rank Fusion으로 융합.
    원본 cosine score는 그대로 보존되고, 정렬 기준만 rrf_score로 바뀐다.
    """
    rrf_scores: dict[str, float] = {}
    chunk_data:  dict[str, dict] = {}
    matched_qs:  dict[str, list[str]] = {}

    for q in queries:
        results = search(
            q["query"],
            n_results=n_per_query,
            level_filter=q.get("level"),
            tag_filter=q.get("tag"),
        )
        for rank, r in enumerate(results, start=1):
            cid = r["id"]
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + 1.0 / (rrf_k + rank)
            # 청크 메타데이터는 처음 등장한 것을 보존 (cosine score 포함)
            if cid not in chunk_data:
                chunk_data[cid] = r
            matched_qs.setdefault(cid, []).append(q["query"])

    # RRF score 내림차순 정렬
    sorted_ids = sorted(rrf_scores.keys(), key=lambda c: rrf_scores[c], reverse=True)

    fused: list[dict] = []
    for cid in sorted_ids:
        r = dict(chunk_data[cid])  # shallow copy — 원본을 건드리지 않음
        r["rrf_score"]       = round(rrf_scores[cid], 6)
        r["matched_queries"] = matched_qs[cid]
        # 하위 호환: 기존 'matched_query' 필드를 첫 번째 매칭 쿼리로 유지
        r["matched_query"]   = matched_qs[cid][0]
        fused.append(r)
    return fused


# ──────────────────────────────────────────────────────────────────────────────
# 3. 메인 진입점
# ──────────────────────────────────────────────────────────────────────────────

def build_context(
    chord_context: dict,
    user_question: str,
    top_k: int = 5,
    song_title: str = "",
) -> tuple[str, dict]:
    """
    LLM에 주입할 컨텍스트 문자열 + 디버그 정보 반환

    반환: (llm_context_str, debug_dict)
    """
    queries = decompose_query(chord_context, user_question, song_title)
    results = route_and_retrieve(queries, n_per_query=3)
    top_results = results[:top_k]

    debug = {
        "queries": [
            {"query": q["query"], "level": q.get("level"), "tag": q.get("tag")}
            for q in queries
        ],
        "total_retrieved": len(results),
        "top_k": top_k,
        "fusion": "rrf",
        "rrf_k": 60,
        "chunks": [
            {
                "id":               r["id"],
                "score":            r["score"],            # cosine similarity (참고용)
                "rrf_score":        r.get("rrf_score"),    # RRF 융합 점수 (정렬 기준)
                "title":            r["title"],
                "song":             r["song"],
                "level":            r["level"],
                "matched_query":    r.get("matched_query", ""),
                "matched_queries":  r.get("matched_queries", []),
                "response":         r["response"][:400],   # 미리보기용
            }
            for r in top_results
        ],
    }

    # 터미널 로그
    print(f"\n[HarmoRAG] 쿼리 {len(queries)}개 → 청크 {len(results)}개 → top-{top_k} (RRF)")
    for q in queries:
        print(f"  쿼리: {q['query'][:70]}... (lv={q.get('level')}, tag={q.get('tag')})")
    print()
    for r in top_results:
        rrf = r.get("rrf_score", 0.0)
        nmatch = len(r.get("matched_queries", []))
        print(f"  rrf={rrf:.4f} cos={r['score']} (×{nmatch}) {r['id']} — {r['title']}")

    return format_for_llm(top_results), debug


# ──────────────────────────────────────────────────────────────────────────────
# 테스트용 실행
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # It Could Happen to You의 F7 (II7) 시뮬레이션
    test_context = {
        "chord": "F7",
        "key": "Eb",
        "function": "II7",
        "is_diatonic": False,
        "secondary_dominant": None,
        "modal_interchange": None,
        "next_chord": "Fm7",
        "patterns_detected": [],
    }
    test_question = "이 F7 위에서 어떻게 솔로해?"

    result = build_context(test_context, test_question)
    print("\n" + "="*60)
    print("LLM에 주입될 컨텍스트:")
    print("="*60)
    print(result[:1000] + "..." if len(result) > 1000 else result)
