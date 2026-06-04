"""
chunks.json (로컬 ChromaDB 적재분) → 백엔드 RAG 문서로 이관.

  로컬 청크 1개  ==  백엔드 문서 1개   (slug = 청크 id → 멱등성 보장)

매핑
  id          → slug
  source_type → sourceType            (standard | lesson | youtube)
  title       → title
  embed_text  → content               (★ 로컬에서 실제 임베딩된 텍스트와 동일하게
                                          넘겨, 백엔드 재임베딩 결과가 같은 검색
                                          동작을 내도록 함)
  instruction/response/song/key/level/section_id/source/analyzed_songs/file
              → metadata{}            (백엔드 search 응답이 이 필드들을 surface)
  video_id/video_url/channel/start_sec/end_sec
              → metadata{}            (YouTube 딥링크 인용용 — 백엔드가 아직
                                          surface 안 할 수 있음. 데이터는 보존)
  topic_tags  → topicTags[]

멱등성
  --apply 시 먼저 백엔드의 기존 문서 목록을 받아 slug→publicId 맵을 만든다.
  같은 slug 가 이미 있으면 PUT(업데이트), 없으면 POST(생성).
  → 몇 번을 재실행해도 중복이 생기지 않는다.

인증 (둘 중 하나)
  JAZZIFY_TOKEN=<accessToken>                         직접 토큰 지정
  JAZZIFY_USERNAME=<id> JAZZIFY_PASSWORD=<pw>         /v1/auth/login 자동 로그인

사용
  cd frontend/rag
  .venv/bin/python migrate_chunks_to_backend.py                 # dry-run (네트워크 X, 매핑 검증)
  .venv/bin/python migrate_chunks_to_backend.py --only youtube  # source_type 필터
  JAZZIFY_USERNAME=.. JAZZIFY_PASSWORD=.. \
    .venv/bin/python migrate_chunks_to_backend.py --apply --limit 20   # 처음 20개만 실제 전송
  JAZZIFY_USERNAME=.. JAZZIFY_PASSWORD=.. \
    .venv/bin/python migrate_chunks_to_backend.py --apply              # 전체 전송

주의: --apply 는 공용 백엔드 데이터를 변경합니다. 문서 생성/수정 권한
      (ADMIN/MANAGE)이 없으면 403 이 납니다.
"""

import os
import sys
import json
import time
import argparse

import requests

API_BASE = os.environ.get("JAZZIFY_API_BASE", "https://jazzify.p-e.kr/api").rstrip("/")
CHUNKS_PATH = os.path.join(os.path.dirname(__file__), "chunks", "chunks.json")

# metadata 로 옮길 청크 필드 (값이 비어있지 않은 것만, 전부 문자열로 변환).
# title/slug/sourceType/topicTags/content 는 최상위 필드라 여기서 제외.
META_FIELDS = [
    "song", "key", "level", "section_id", "source", "analyzed_songs", "file",
    "video_id", "video_url", "channel", "start_sec", "end_sec",
]


# ── 매핑 ──────────────────────────────────────────────────────────────────────

def to_document(chunk: dict) -> dict:
    """로컬 청크 → RagDocumentCreateRequest 형태."""
    content = chunk.get("embed_text") or chunk.get("response") or chunk.get("title") or ""

    metadata: dict[str, str] = {}
    for f in META_FIELDS:
        v = chunk.get(f)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            metadata[f] = s
    # instruction/response 는 search 응답의 핵심 필드 → metadata 로도 보존
    for f in ("instruction", "response"):
        v = (chunk.get(f) or "").strip()
        if v:
            metadata[f] = v

    tags = chunk.get("topic_tags") or []
    if isinstance(tags, str):
        tags = [t for t in tags.split(",") if t.strip()]

    return {
        "slug": chunk["id"],
        "sourceType": chunk.get("source_type", "standard"),
        "title": chunk.get("title", "") or chunk["id"],
        "content": content,
        "metadata": metadata,
        "topicTags": tags,
    }


def validate(doc: dict) -> list[str]:
    """전송 전 형식 검증. 문제 메시지 리스트 반환(비어있으면 정상)."""
    problems = []
    if not doc["slug"]:
        problems.append("slug 비어있음")
    if not doc["content"]:
        problems.append("content 비어있음")
    for k, v in doc["metadata"].items():
        if not isinstance(v, str):
            problems.append(f"metadata.{k} 가 문자열 아님({type(v).__name__})")
    return problems


# ── 백엔드 통신 ───────────────────────────────────────────────────────────────

def get_token() -> str:
    tok = os.environ.get("JAZZIFY_TOKEN", "").strip()
    if tok:
        return tok
    user = os.environ.get("JAZZIFY_USERNAME", "").strip()
    pw = os.environ.get("JAZZIFY_PASSWORD", "").strip()
    if not (user and pw):
        sys.exit("인증 정보 없음: JAZZIFY_TOKEN 또는 JAZZIFY_USERNAME/JAZZIFY_PASSWORD 를 설정하세요.")
    res = requests.post(
        f"{API_BASE}/v1/auth/login",
        json={"username": user, "password": pw},
        timeout=20,
    )
    if not res.ok:
        sys.exit(f"로그인 실패 {res.status_code}: {res.text[:300]}")
    body = res.json()
    data = body.get("data", body)  # ApiResponse 봉투 대응
    token = data.get("accessToken")
    if not token:
        sys.exit(f"로그인 응답에 accessToken 없음: {body}")
    return token


def fetch_existing_slugs(session: requests.Session) -> dict[str, str]:
    """GET /v1/rag/documents 페이지네이션 → {slug: publicId}."""
    slug_to_id: dict[str, str] = {}
    page = 0
    while True:
        res = session.get(
            f"{API_BASE}/v1/rag/documents",
            params={"page": page, "size": 100, "sort": "slug,asc"},
            timeout=30,
        )
        res.raise_for_status()
        data = res.json().get("data", {})
        for item in data.get("content", []):
            if item.get("slug"):
                slug_to_id[item["slug"]] = item["publicId"]
        if data.get("last", True):
            break
        page += 1
    return slug_to_id


def upsert(session: requests.Session, doc: dict, existing: dict[str, str]) -> tuple[str, int]:
    """slug 존재 여부로 PUT/POST 분기. (동작, status_code) 반환."""
    pid = existing.get(doc["slug"])
    if pid:
        res = session.put(f"{API_BASE}/v1/rag/documents/{pid}", json=doc, timeout=60)
        return "PUT", res.status_code
    res = session.post(f"{API_BASE}/v1/rag/documents", json=doc, timeout=60)
    # 새로 만든 publicId 를 맵에 반영(이후 재시도/중복 방지)
    if res.ok:
        try:
            new_id = res.json().get("data", {}).get("publicId")
            if new_id:
                existing[doc["slug"]] = new_id
        except Exception:
            pass
    return "POST", res.status_code


# ── 메인 ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="실제 전송(미지정 시 dry-run)")
    ap.add_argument("--only", help="source_type 필터 (standard|lesson|youtube)")
    ap.add_argument("--limit", type=int, help="처음 N개만 처리(테스트용)")
    ap.add_argument("--sleep", type=float, default=0.05, help="요청 간 간격(초)")
    args = ap.parse_args()

    with open(CHUNKS_PATH, encoding="utf-8") as f:
        chunks = json.load(f)

    if args.only:
        chunks = [c for c in chunks if c.get("source_type") == args.only]
    if args.limit:
        chunks = chunks[: args.limit]

    docs = [to_document(c) for c in chunks]

    # 검증
    bad = [(d["slug"], probs) for d in docs if (probs := validate(d))]
    by_type: dict[str, int] = {}
    for d in docs:
        by_type[d["sourceType"]] = by_type.get(d["sourceType"], 0) + 1

    print(f"대상 문서 {len(docs)}개  {by_type}")
    if bad:
        print(f"⚠️ 검증 실패 {len(bad)}개:")
        for slug, probs in bad[:10]:
            print(f"   {slug}: {', '.join(probs)}")

    if not args.apply:
        print("\n[DRY-RUN] 네트워크 호출 없음. 샘플 payload 2개:")
        for d in docs[:2]:
            preview = dict(d)
            preview["content"] = preview["content"][:160] + ("…" if len(preview["content"]) > 160 else "")
            print(json.dumps(preview, ensure_ascii=False, indent=2))
        print(f"\n실제 전송하려면: --apply  (대상 {API_BASE})")
        return

    if bad:
        sys.exit("검증 실패 항목이 있어 중단합니다. 위 문제를 고친 뒤 다시 실행하세요.")

    # ── 실제 전송 ──
    token = get_token()
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

    print("기존 문서 목록 조회 중…")
    existing = fetch_existing_slugs(session)
    print(f"기존 문서 {len(existing)}개 (slug 매칭으로 PUT/POST 분기)")

    created = updated = failed = 0
    errors: list[str] = []
    for i, doc in enumerate(docs, 1):
        try:
            action, status = upsert(session, doc, existing)
            if 200 <= status < 300:
                if action == "POST":
                    created += 1
                else:
                    updated += 1
            else:
                failed += 1
                errors.append(f"{doc['slug']} [{action} {status}]")
        except Exception as e:
            failed += 1
            errors.append(f"{doc['slug']} [예외 {e}]")

        if i % 50 == 0 or i == len(docs):
            print(f"  {i}/{len(docs)}  생성 {created} · 수정 {updated} · 실패 {failed}")
        if args.sleep:
            time.sleep(args.sleep)

    print(f"\n완료: 생성 {created} · 수정 {updated} · 실패 {failed}")
    if errors:
        print(f"실패 {len(errors)}건(최대 20):")
        for e in errors[:20]:
            print(f"   {e}")


if __name__ == "__main__":
    main()
