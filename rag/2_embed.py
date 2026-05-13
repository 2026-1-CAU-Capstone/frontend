"""
STEP 2: 임베딩 + ChromaDB 저장
chunks/chunks.json → ChromaDB (db/ 폴더)

실행: python 2_embed.py
결과: db/ 폴더에 벡터 DB 생성
"""

import json
import os
from sentence_transformers import SentenceTransformer
import chromadb

CHUNKS_FILE = "chunks/chunks.json"
DB_DIR = "db"
COLLECTION_NAME = "harmorag"

# 한국어 + 음악 이론 텍스트에 잘 맞는 다국어 모델
# 첫 실행 시 자동 다운로드 (~470MB)
MODEL_NAME = "paraphrase-multilingual-mpnet-base-v2"


def main():
    print("1. 청크 로딩...")
    with open(CHUNKS_FILE, encoding="utf-8") as f:
        chunks = json.load(f)
    print(f"   {len(chunks)}개 청크 로딩 완료")

    print("\n2. 임베딩 모델 로딩...")
    print(f"   모델: {MODEL_NAME}")
    print("   (첫 실행 시 다운로드 수분 소요)")
    model = SentenceTransformer(MODEL_NAME)
    print("   모델 로딩 완료")

    print("\n3. 텍스트 임베딩 중...")
    texts = [c["embed_text"] for c in chunks]
    embeddings = model.encode(texts, show_progress_bar=True, batch_size=32)
    print(f"   {len(embeddings)}개 임베딩 완료 (차원: {embeddings.shape[1]})")

    print("\n4. ChromaDB 초기화...")
    os.makedirs(DB_DIR, exist_ok=True)
    client = chromadb.PersistentClient(path=DB_DIR)

    # 기존 컬렉션이 있으면 삭제 후 재생성
    try:
        client.delete_collection(COLLECTION_NAME)
        print(f"   기존 컬렉션 '{COLLECTION_NAME}' 삭제")
    except Exception:
        pass

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}  # 코사인 유사도 사용
    )
    print(f"   컬렉션 '{COLLECTION_NAME}' 생성 완료")

    print("\n5. ChromaDB에 저장 중...")
    # ChromaDB는 배치로 저장 (한 번에 최대 5461개)
    batch_size = 100
    for i in range(0, len(chunks), batch_size):
        batch_chunks = chunks[i:i + batch_size]
        batch_embeds = embeddings[i:i + batch_size]

        collection.add(
            ids=[c["id"] for c in batch_chunks],
            embeddings=[e.tolist() for e in batch_embeds],
            documents=[c["embed_text"] for c in batch_chunks],
            metadatas=[{
                "source_type":    c.get("source_type", "standard"),
                "song":           c["song"],
                "key":            c["key"],
                "source":         c["source"],
                "analyzed_songs": c.get("analyzed_songs", ""),
                "level":          c["level"],
                "section_id":     c["section_id"],
                "title":          c["title"],
                "instruction":    c["instruction"][:500],   # 메타데이터 크기 제한
                "response":       c["response"][:1000],
                "topic_tags":     ",".join(c["topic_tags"]),
                "file":           c["file"],
            } for c in batch_chunks],
        )
        print(f"   배치 {i//batch_size + 1}: {len(batch_chunks)}개 저장")

    total = collection.count()
    print(f"\n완료! ChromaDB에 총 {total}개 청크 저장됨")
    print(f"DB 위치: {os.path.abspath(DB_DIR)}")

    # 빠른 검색 테스트
    print("\n[검색 테스트] 'F7 II7 스케일 선택'")
    results = collection.query(
        query_embeddings=[model.encode("F7 II7 스케일 선택").tolist()],
        n_results=3,
    )
    for i, (doc_id, meta) in enumerate(zip(
        results["ids"][0], results["metadatas"][0]
    )):
        print(f"  {i+1}. [{doc_id}] {meta['title']} ({meta['song']})")


if __name__ == "__main__":
    main()
