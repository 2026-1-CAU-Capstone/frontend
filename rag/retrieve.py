"""
STEP 3: 검색 함수
쿼리 문자열 → 관련 청크 반환

실행 예시:
  python 3_retrieve.py "F7 II7 스케일 선택"
"""

import sys
import json
import chromadb
from sentence_transformers import SentenceTransformer

import os
DB_DIR = os.path.join(os.path.dirname(__file__), "db")
COLLECTION_NAME = "harmorag"
MODEL_NAME = "paraphrase-multilingual-mpnet-base-v2"

# 모델/DB를 모듈 로딩 시 1회만 초기화 (서버에서 import해서 재사용)
_model = None
_collection = None

def _init():
    global _model, _collection
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    if _collection is None:
        client = chromadb.PersistentClient(path=DB_DIR)
        _collection = client.get_collection(COLLECTION_NAME)


def search(
    query: str,
    n_results: int = 5,
    level_filter: int | None = None,         # 1=개념, 2=곡분석, 3=연주판단
    song_filter: str | None = None,           # 특정 곡만 검색
    tag_filter: str | None = None,            # 특정 태그만 (예: "tritone-sub")
    source_type: str | list[str] | None = None,  # 'standard' | 'lesson' (또는 둘 다)
) -> list[dict]:
    """
    쿼리 → 관련 청크 top-N 반환

    반환 형식:
    [
      {
        "id": "standard__allofme__1-1",
        "source_type": "standard",
        "score": 0.87,        # 코사인 유사도 (높을수록 관련성 높음)
        "title": "곡의 키 센터 확인법",
        "song": "All of Me",
        "level": 1,
        "instruction": "...",
        "response": "...",
        "topic_tags": [...],
      },
      ...
    ]
    """
    _init()

    # 메타데이터 필터 구성
    where = {}
    if level_filter is not None:
        where["level"] = level_filter
    if song_filter is not None:
        where["song"] = {"$contains": song_filter}
    if source_type is not None:
        if isinstance(source_type, str):
            where["source_type"] = source_type
        else:
            where["source_type"] = {"$in": list(source_type)}

    embedding = _model.encode(query).tolist()

    results = _collection.query(
        query_embeddings=[embedding],
        n_results=n_results,
        where=where if where else None,
    )

    chunks = []
    for i in range(len(results["ids"][0])):
        meta = results["metadatas"][0][i]
        dist = results["distances"][0][i]

        # 태그 필터 (ChromaDB where에서 배열 contains가 안 되므로 post-filter)
        if tag_filter and tag_filter not in meta.get("topic_tags", ""):
            continue

        chunks.append({
            "id":             results["ids"][0][i],
            "score":          round(1 - dist, 4),   # distance → similarity
            "source_type":    meta.get("source_type", "standard"),
            "title":          meta["title"],
            "song":           meta["song"],
            "key":            meta["key"],
            "level":          meta["level"],
            "section_id":     meta["section_id"],
            "instruction":    meta["instruction"],
            "response":       meta["response"],
            "topic_tags":     meta["topic_tags"].split(","),
            "source":         meta["source"],
            "analyzed_songs": meta.get("analyzed_songs", ""),
        })

    return chunks


def format_for_llm(chunks: list[dict]) -> str:
    """LLM 프롬프트에 주입할 형태로 변환"""
    if not chunks:
        return "관련 강의 내용을 찾지 못했습니다."

    lines = ["[관련 강의 내용 (HarmoRAG)]\n"]
    for i, c in enumerate(chunks, 1):
        lines.append(
            f"[{i}] {c['song']} — {c['title']} (Lv{c['level']}, 유사도: {c['score']})"
        )
        if c["instruction"]:
            lines.append(f"Q: {c['instruction']}")
        lines.append(f"A: {c['response']}")
        lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    query = " ".join(sys.argv[1:]) or "ii-V-I 진행에서 스케일 선택"
    print(f"검색어: {query}\n")
    results = search(query, n_results=5)
    for r in results:
        print(f"[{r['score']}] {r['id']} — {r['title']} ({r['song']})")
        print(f"  {r['response'][:120]}...")
        print()
