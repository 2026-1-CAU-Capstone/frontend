"""
data/이지원재즈/*.txt  →  ChromaDB (replaces the `harmorag` collection).

Splits each .txt at line boundaries into ~CHUNK_CHARS chunks, embeds with the
same multilingual model the rest of this pipeline uses, and writes them as the
SOLE contents of the `harmorag` collection. Standards/lessons stop being indexed.

Run:  source .venv/bin/activate && python embed_easyonejazz.py
"""

import os
import sys
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer

THIS_DIR = Path(__file__).resolve().parent
SRC_DIR = THIS_DIR.parent / "data" / "이지원재즈"
DB_DIR = THIS_DIR / "db"
COLLECTION = "harmorag"

MODEL_NAME = "paraphrase-multilingual-mpnet-base-v2"
CHUNK_CHARS = 1200   # ~1 minute of speech; comfortably under the 512-token embed window


def parse_txt(path: Path) -> dict:
    """Strip the 4-line header (# title / url / duration / blank) and return
    {video_id, title, url, body}."""
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    title = lines[0].lstrip("# ").strip() if lines else ""
    url = lines[1].strip() if len(lines) > 1 else ""
    # lines[2] is "<sec>초 · <lang>" — skip; lines[3] is blank.
    body = "\n".join(lines[4:]).strip()
    # video_id is the suffix after "__" in the filename.
    video_id = path.stem.rsplit("__", 1)[-1]
    return {"video_id": video_id, "title": title, "url": url, "body": body}


def chunk_body(body: str, chunk_chars: int = CHUNK_CHARS) -> list[str]:
    """Pack lines into chunks of up to chunk_chars, never splitting a line."""
    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0
    for line in body.split("\n"):
        line = line.strip()
        if not line:
            continue
        line_len = len(line) + 1
        if buf and buf_len + line_len > chunk_chars:
            chunks.append(" ".join(buf))
            buf = []
            buf_len = 0
        buf.append(line)
        buf_len += line_len
    if buf:
        chunks.append(" ".join(buf))
    return chunks


def main():
    if not SRC_DIR.is_dir():
        print(f"✗ {SRC_DIR} not found — run transcripts_to_txt.py first.", file=sys.stderr)
        sys.exit(1)

    print(f"reading from {SRC_DIR.relative_to(THIS_DIR.parent)}/")
    files = sorted(SRC_DIR.glob("*.txt"))
    print(f"  {len(files)} .txt files")

    # ── chunk ──────────────────────────────────────────────────────────────
    chunks: list[dict] = []
    for path in files:
        meta = parse_txt(path)
        body = meta["body"]
        if not body:
            continue
        pieces = chunk_body(body)
        for i, piece in enumerate(pieces):
            header = f"[YouTube: {meta['title']}]" if meta["title"] else ""
            embed_text = f"{header}\n{piece}" if header else piece
            chunks.append({
                "id":          f"easyonejazz__{meta['video_id']}__{i:03d}",
                "video_id":    meta["video_id"],
                "video_url":   meta["url"],
                "title":       meta["title"],
                "chunk_index": i,
                "text":        piece,
                "embed_text":  embed_text,
            })
    print(f"  → {len(chunks)} chunks total")

    # ── embed ──────────────────────────────────────────────────────────────
    print(f"\nloading embedding model: {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)

    print(f"embedding {len(chunks)} chunks…")
    texts = [c["embed_text"] for c in chunks]
    embeddings = model.encode(texts, show_progress_bar=True, batch_size=32)
    print(f"  {embeddings.shape[0]} embeddings, dim={embeddings.shape[1]}")

    # ── write to ChromaDB ──────────────────────────────────────────────────
    print(f"\nwriting to {DB_DIR}/  (collection: {COLLECTION})")
    os.makedirs(DB_DIR, exist_ok=True)
    client = chromadb.PersistentClient(path=str(DB_DIR))
    try:
        client.delete_collection(COLLECTION)
        print(f"  dropped existing collection '{COLLECTION}'")
    except Exception:
        pass

    coll = client.create_collection(name=COLLECTION, metadata={"hnsw:space": "cosine"})

    batch = 100
    for i in range(0, len(chunks), batch):
        block = chunks[i:i + batch]
        coll.add(
            ids=[c["id"] for c in block],
            embeddings=[e.tolist() for e in embeddings[i:i + batch]],
            documents=[c["embed_text"] for c in block],
            metadatas=[{
                "source_type": "easyonejazz",
                "video_id":    c["video_id"],
                "video_url":   c["video_url"],
                "title":       c["title"],
                "chunk_index": c["chunk_index"],
                "text":        c["text"][:1500],   # ChromaDB metadata size cap
            } for c in block],
        )
        print(f"  batch {i // batch + 1}: {len(block)} stored")

    print(f"\ncomplete — {coll.count()} chunks in '{COLLECTION}'")
    print(f"DB path: {DB_DIR.resolve()}")

    # ── smoke test ─────────────────────────────────────────────────────────
    print("\n[검색 테스트] '디미니쉬 코드'")
    q = model.encode("디미니쉬 코드").tolist()
    r = coll.query(query_embeddings=[q], n_results=3)
    for i, (doc_id, meta) in enumerate(zip(r["ids"][0], r["metadatas"][0])):
        print(f"  {i+1}. {meta['title']}")
        print(f"      {meta['video_url']}")


if __name__ == "__main__":
    main()
