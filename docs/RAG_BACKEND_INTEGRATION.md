# RAG 백엔드 통합 가이드

> **대상 독자**: 백엔드 개발자 (Spring Boot / Java)
> **목적**: 현재 로컬(Mac mini)에서 돌고 있는 RAG 파이프라인을 백엔드 서버에서 그대로 운영할 수 있게 하기 위한 모든 정보 정리

---

## 0. TL;DR (먼저 한 페이지로)

| 항목 | 값 |
|---|---|
| **RAG 서비스 언어** | Python 3.10+ (FastAPI) |
| **RAG 서비스 포트** | 8001 (`uvicorn`) |
| **벡터 DB** | ChromaDB (파일 기반, `rag/db/`) |
| **임베딩 모델** | `sentence-transformers/paraphrase-multilingual-mpnet-base-v2` (자동 다운로드, ~470MB) |
| **LLM** | Anthropic Claude (`claude-sonnet-4-6`) — `VITE_ANTHROPIC_API_KEY` 필요 |
| **RAG가 읽는 raw 데이터** | `data/explanation/{standards,lessons}/*.txt` (22개, 308KB) |
| **외부 의존성** | Anthropic API 1개 (LLM). 임베딩은 로컬 모델이라 외부 호출 없음 |
| **프론트 호출 위치** | [src/api/harmorag.ts](../src/api/harmorag.ts) — `RAG_SERVER` 환경변수로 endpoint 지정 |

**백엔드 개발자가 해야 할 일은 두 갈래로 나뉜다:**

- **Part A (즉시)**: Python RAG 서비스를 백엔드 서버 호스트에 배포하고 동작시킴. 데이터는 파일 그대로. 코드 무수정.
- **Part B (다음 단계)**: `explanation/` 콘텐츠를 RDB에 넣고, Spring Boot에서 CRUD API 제공. 프론트 admin 페이지 가능. RAG는 파일 대신 DB SELECT로 변경.

본 문서는 **Part A를 먼저 끝낼 수 있도록** 모든 정보를 자세히 제공하고, 이어서 Part B의 설계를 제시한다.

---

## 1. 아키텍처

### 1.1 현재 (로컬)

```
┌─────────────────────────────────────────────────────────────────┐
│                          Mac mini                                │
│                                                                  │
│   ┌────────────────┐    ┌──────────────────────────────────┐    │
│   │  React (Vite)  │    │  Python RAG Service              │    │
│   │  localhost:5173│────│  uvicorn :8001  (rag/server.py)  │    │
│   └────────────────┘    │                                  │    │
│                         │  ┌────────────────────────────┐  │    │
│                         │  │  ChromaDB (rag/db/)        │  │    │
│                         │  │  - chroma.sqlite3          │  │    │
│                         │  │  - {uuid}/ (벡터 인덱스)    │  │    │
│                         │  └────────────────────────────┘  │    │
│                         │                                  │    │
│                         │  Source: ../data/explanation/    │    │
│                         │   ├ standards/*.txt (20곡)       │    │
│                         │   └ lessons/*.txt (2개)          │    │
│                         └──────────────────────────────────┘    │
│                                       │                          │
└───────────────────────────────────────┼──────────────────────────┘
                                        │ HTTPS
                                        ▼
                            Anthropic API (Claude Sonnet 4.6)
```

### 1.2 목표 (Part A — 즉시 운영)

```
┌──────────────────────────────────────────────────────────────────┐
│                  jazzify.p-e.kr 백엔드 서버                       │
│                                                                   │
│   ┌──────────────────────┐      ┌────────────────────────────┐   │
│   │  Spring Boot         │      │  Python RAG Service        │   │
│   │  :443 (nginx)        │◄────►│  :8001 (uvicorn)           │   │
│   │  /v1/auth, /v1/solos │ HTTP │  /chat, /search, /health   │   │
│   │  /v1/rag/...  ←프록시│      │                            │   │
│   └──────────────────────┘      │  ChromaDB (rag/db/)        │   │
│         │                       │  data/explanation/         │   │
│         ▼                       └────────────────────────────┘   │
│   PostgreSQL                              │                       │
│                                           ▼                       │
└───────────────────────────────────────────┼───────────────────────┘
                                            │ HTTPS
                                            ▼
                                  Anthropic API
```

**핵심:** Python RAG 서비스는 **별도 프로세스(8001 포트)**로 띄우고, Spring Boot가 같은 호스트 안에서 HTTP로 호출하거나 nginx가 프론트의 요청을 RAG로 직접 프록시한다.

### 1.3 목표 (Part B — DB 마이그레이션 후)

```
┌──────────────────────────────────────────────────────────────────┐
│                  jazzify.p-e.kr 백엔드 서버                       │
│                                                                   │
│   ┌──────────────────────┐      ┌────────────────────────────┐   │
│   │  Spring Boot         │      │  Python RAG Service        │   │
│   │  /v1/admin/          │      │                            │   │
│   │  explanations CRUD   │      │  ChromaDB (벡터)            │   │
│   │  + /v1/rag/reindex   │──────│  PostgreSQL 에서 SELECT    │   │
│   └──────────────────────┘      └────────────────────────────┘   │
│         │   ▲                              │                       │
│         ▼   │                              ▼                       │
│   PostgreSQL  ←──── explanation_documents 테이블 (raw 마크다운)      │
└───────────────────────────────────────────┼───────────────────────┘
                                            ▼ Anthropic API
```

---

## 2. RAG 코드베이스 구조

### 2.1 파일별 역할

리포: `https://github.com/<...>/jazzify` (현재 모노레포)
경로: 리포 루트의 `rag/` 디렉토리

| 파일 | 역할 | 런타임에 필요? |
|---|---|---|
| [rag/server.py](../rag/server.py) | FastAPI 진입점. `/chat`, `/search`, `/health` 엔드포인트 제공. Anthropic Claude 호출 + RAG 컨텍스트 주입 | ✅ |
| [rag/agent.py](../rag/agent.py) | 에이전트 레이어. user 질문 + chord_context 를 쿼리 3~4개로 분해 → 멀티 쿼리 검색 → Reciprocal Rank Fusion으로 융합 | ✅ |
| [rag/retrieve.py](../rag/retrieve.py) | ChromaDB 검색 함수 (`search`, `format_for_llm`). 임베딩 모델은 모듈 로딩 시 1회 초기화 | ✅ |
| [rag/1_chunk.py](../rag/1_chunk.py) | 파이프라인 1단계: `data/explanation/*.txt` 를 파싱 → `rag/chunks/chunks.json` 생성 | 빌드용 |
| [rag/2_embed.py](../rag/2_embed.py) | 파이프라인 2단계: `chunks.json` → 임베딩 → ChromaDB(`rag/db/`) 저장 | 빌드용 |
| [rag/match_sjs_ireal.py](../rag/match_sjs_ireal.py) | 별도 도구 (SJS-iRealPro 곡 매칭). RAG 와 무관 | ❌ |
| [rag/sjs_to_json.py](../rag/sjs_to_json.py) | 별도 도구. RAG 와 무관 | ❌ |
| [rag/requirements.txt](../rag/requirements.txt) | Python 의존성 목록 | ✅ |
| `rag/chunks/chunks.json` | 1_chunk.py 산출물. Git 에 포함되어 있을 수도/없을 수도 — 없으면 1_chunk.py 다시 실행 | 산출물 |
| `rag/db/` | ChromaDB 영구 저장소. `chroma.sqlite3` + `<uuid>/` 폴더 (~4.1MB) | ✅ |
| `rag/venv/` | 로컬 Python venv (1.4GB) — **절대 서버로 옮기지 말 것**. 서버에서 자체 venv 생성 | ❌ |
| `rag/scratch/`, `rag/__pycache__/` | POC/캐시 — 무시 | ❌ |

### 2.2 데이터 흐름 (런타임 — `/chat` 호출 시)

```
[프론트엔드]
   POST /chat
   { message, chord_context, chord_context_text, history, song_title }
       │
       ▼
[rag/server.py::chat]
   1) agent.build_context(chord_context, message, song_title)
       │
       ▼
[rag/agent.py::decompose_query]
   chord_context + user_question → 쿼리 3~5개 분해
   예) "All of Me 코드 분석 화성" (song-based)
       "도미넌트 세븐 G7 C로 해결 얼터드 스케일" (function-based)
       "트라이톤 서브스티튜션 G7 가이드톤 스케일" (pattern-based)
       │
       ▼
[rag/agent.py::route_and_retrieve]
   각 쿼리마다 retrieve.search(query) 호출 → n_results=3 씩 수집
   Reciprocal Rank Fusion (RRF) 로 융합 → top_k=5
       │
       ▼
[rag/retrieve.py::search]
   1) SentenceTransformer.encode(query) → 768차원 벡터
   2) ChromaDB collection.query(query_embeddings=..., where=metadata_filter)
   3) cosine similarity 기준 top-N 청크 반환
       │
       ▼
[rag/agent.py::build_context]
   - format_for_llm 으로 청크를 프롬프트 문자열로 변환
   - debug 정보(쿼리들, 각 청크의 점수/제목) 동시 반환
       │
       ▼
[rag/server.py::chat (계속)]
   2) system 프롬프트에 RAG 컨텍스트 주입
   3) Anthropic Claude 스트리밍 호출 (claude-sonnet-4-6)
   4) 응답을 StreamingResponse 로 프론트에 전달
      - 첫 chunk: \x00RAG_DEBUG\x00 + JSON(debug) + \x00END_DEBUG\x00
      - 이후: Claude 의 토큰 스트림 그대로
```

### 2.3 파이프라인 (빌드 — 데이터 변경 시 1회 실행)

```
data/explanation/{standards,lessons}/*.txt
   │
   ▼
[python 1_chunk.py]
   - 파일 메타 파싱 (곡명, 작곡, 키, 형식, 출처)
   - ### N-N. 섹션 헤더로 청크 분할
   - **instruction:** / **response:** 분리
   - embed_text 구성: "[곡명 · 키]\n제목\n질문: ...\n답변: ..."
   - source_type, topic_tags 등 메타 부여
   - → rag/chunks/chunks.json
   │
   ▼
[python 2_embed.py]
   - chunks.json 로드
   - SentenceTransformer("paraphrase-multilingual-mpnet-base-v2")
   - 각 embed_text → 768차원 벡터
   - ChromaDB collection 재생성 후 batch_size=100 단위 add()
   - → rag/db/ (chroma.sqlite3 + 벡터 폴더)
```

**중요 — 임베딩 차원**: 768 (paraphrase-multilingual-mpnet-base-v2 기준). 모델을 바꾸면 차원/유사도 의미가 달라지므로 DB 전체 재빌드 필요.

---

## 3. 외부 의존성 / 환경 변수

### 3.1 Python 의존성 ([requirements.txt](../rag/requirements.txt))

```
chromadb>=1.5.0
sentence-transformers>=3.0.0
fastapi>=0.115.0
uvicorn>=0.32.0
anthropic>=0.40.0
python-dotenv>=1.0.0
```

설치:
```bash
cd rag/
python3.10 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**주의사항**:
- `sentence-transformers` 첫 import 시 모델을 HuggingFace Hub 에서 다운로드(~470MB). 서버는 외부 인터넷 접근이 가능해야 함. 또는 모델을 미리 받아 서버에 동봉.
- `chromadb`는 SQLite 백엔드를 사용 — 시스템 SQLite ≥ 3.35 권장.
- 파이썬 버전: **3.10 이상** (FastAPI / Anthropic SDK 호환).

### 3.2 환경 변수 (.env)

`rag/server.py` 가 `load_dotenv("../.env")` 로 읽음 — 즉 리포 **루트의 `.env`** 를 본다.

| 환경변수 | 용도 | 예시 / 필수 |
|---|---|---|
| `VITE_ANTHROPIC_API_KEY` | Anthropic Claude API 키. `/chat` 엔드포인트에서 사용 | `sk-ant-...` (필수) |

> 이름이 `VITE_*`라 어색하지만, 원래 프론트 .env 를 공유하던 흔적. 백엔드 호스팅 시에는 `ANTHROPIC_API_KEY` 같은 이름으로 바꾸고 `server.py`도 같이 수정하는 게 깔끔하다. (변경 시 [rag/server.py:35](../rag/server.py#L35) 한 줄 수정)

### 3.3 외부 API 호출

| API | 호출 위치 | 트래픽 |
|---|---|---|
| **Anthropic Claude** | `rag/server.py::chat` — `claude.messages.stream` | `/chat` 1회 당 1회. 스트리밍 |
| HuggingFace Hub | 임베딩 모델 다운로드 (서비스 첫 부팅 시 1회) | 1회만, ~470MB |
| **그 외 없음** | — | — |

→ 임베딩은 로컬 모델이라 임베딩 API 비용/외부 호출 없음. **외부 의존은 Anthropic API 하나뿐.**

---

## 4. Part A — 로컬 RAG 그대로 백엔드 서버에서 운영

### 4.1 서버 사전 준비

| 요구사항 | 버전 |
|---|---|
| OS | Ubuntu 22.04 LTS 권장 (Linux 어디든 가능) |
| Python | 3.10 이상 |
| RAM | 최소 2GB (임베딩 모델 로드 시) |
| 디스크 | ~3GB (venv 1.4GB + 모델 470MB + DB + 여유) |
| 네트워크 | HuggingFace Hub, Anthropic API 외부 호출 가능 |
| systemd or Docker | 프로세스 관리 |

### 4.2 배포 디렉토리 구조 (권장)

```
/opt/jazzify-rag/                  ← 백엔드 서버에서 RAG 가 살 위치
├── data/
│   └── explanation/
│       ├── standards/             (20개 .txt)
│       └── lessons/               (2개 .txt)
├── rag/
│   ├── server.py
│   ├── agent.py
│   ├── retrieve.py
│   ├── 1_chunk.py
│   ├── 2_embed.py
│   ├── requirements.txt
│   ├── chunks/
│   │   └── chunks.json            (산출물 — 같이 전송하면 즉시 가동)
│   └── db/                        (산출물 — 같이 전송하면 즉시 가동)
│       ├── chroma.sqlite3
│       └── <uuid>/                (벡터 인덱스 폴더)
├── venv/                          (서버에서 직접 생성)
└── .env                           (VITE_ANTHROPIC_API_KEY 등)
```

> `1_chunk.py`의 `DATA_ROOT = "../data/explanation"` 는 cwd 기준 상대 경로다. **반드시 `rag/` 디렉토리에서 실행**해야 `../data/explanation` 이 올바르게 잡힌다. (또는 `DATA_ROOT` 를 절대 경로/환경변수로 바꿔라.)

### 4.3 전송할 파일 (Mac mini → 서버)

**필수:**
```
data/explanation/                  308KB   raw 데이터 (필수)
rag/server.py, agent.py, retrieve.py, 1_chunk.py, 2_embed.py
rag/requirements.txt
```

**선택 (전송하면 즉시 가동, 안 전송하면 서버에서 재빌드):**
```
rag/chunks/chunks.json             548KB   1_chunk.py 산출물
rag/db/                            4.1MB   2_embed.py 산출물
```

**절대 보내지 마:**
```
rag/venv/                          1.4GB   서버에서 자체 venv
rag/__pycache__/                           자동 생성
rag/scratch/                       15MB    POC/캐시
data/ 의 나머지(iRealPro, wjazzd 등)        RAG 와 무관
```

전송 방법 (rsync 예시):
```bash
# Mac 에서 실행
rsync -avz --exclude='venv' --exclude='__pycache__' --exclude='scratch' \
  /Users/<...>/jazzify/rag/ \
  user@jazzify.p-e.kr:/opt/jazzify-rag/rag/

rsync -avz \
  /Users/<...>/jazzify/data/explanation/ \
  user@jazzify.p-e.kr:/opt/jazzify-rag/data/explanation/
```

### 4.4 서버에서 초기 세팅

```bash
# 1. 위치
cd /opt/jazzify-rag

# 2. venv 생성 + 의존성 설치
python3.10 -m venv venv
source venv/bin/activate
pip install -r rag/requirements.txt

# 3. .env 작성
cat > .env <<EOF
VITE_ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
EOF
chmod 600 .env

# 4. (선택) chunks/db 가 없으면 재빌드
cd rag
python 1_chunk.py     # → chunks/chunks.json
python 2_embed.py     # → db/  (첫 실행 시 모델 다운로드 수 분 소요)
cd ..

# 5. 동작 테스트 (포그라운드)
cd rag
uvicorn server:app --host 0.0.0.0 --port 8001
# 다른 터미널에서
curl http://localhost:8001/health
# → {"status":"ok","service":"HarmoRAG"}
```

### 4.5 systemd 서비스 등록 (운영용)

`/etc/systemd/system/jazzify-rag.service`:
```ini
[Unit]
Description=Jazzify RAG service (HarmoRAG)
After=network.target

[Service]
Type=simple
User=jazzify
WorkingDirectory=/opt/jazzify-rag/rag
EnvironmentFile=/opt/jazzify-rag/.env
ExecStart=/opt/jazzify-rag/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable jazzify-rag
sudo systemctl start jazzify-rag
sudo journalctl -u jazzify-rag -f      # 로그 확인
```

> `--host 127.0.0.1` 로 바인딩한 것에 주의 — **외부로 직접 노출하지 않고** nginx 또는 Spring Boot 가 internal 호출/프록시. 외부에서 8001 포트를 그대로 열면 누구나 Claude API 비용을 발생시킬 수 있음.

### 4.6 nginx 프록시 (옵션 1 — 가장 단순)

기존 `jazzify.p-e.kr` 의 nginx 설정에 추가:
```nginx
location /rag/ {
    proxy_pass http://127.0.0.1:8001/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;                  # 스트리밍을 위해 필수
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

→ 프론트에서 `https://jazzify.p-e.kr/rag/chat` 으로 호출 → nginx 가 `http://127.0.0.1:8001/chat` 으로 프록시.

`proxy_buffering off`가 **필수** — `/chat` 은 SSE 스타일 스트리밍이라 버퍼링되면 첫 토큰이 늦게 도착.

### 4.7 Spring Boot 프록시 (옵션 2 — 인증 가드 가능)

만약 RAG 호출도 로그인된 사용자만 허용하고 싶다면, Spring Boot 에서 인증 가드 후 RAG 로 forward:

```kotlin
// 예시 — Kotlin / Spring WebFlux
@RestController
@RequestMapping("/v1/rag")
class RagProxyController(
    @Value("\${rag.base-url:http://127.0.0.1:8001}") private val ragBaseUrl: String,
    private val webClient: WebClient = WebClient.create(),
) {
    @PostMapping("/chat", produces = [MediaType.TEXT_PLAIN_VALUE])
    fun chat(
        @AuthenticationPrincipal user: CustomPrincipal,
        @RequestBody body: Map<String, Any?>,
    ): Flux<DataBuffer> =
        webClient.post()
            .uri("$ragBaseUrl/chat")
            .bodyValue(body)
            .retrieve()
            .bodyToFlux(DataBuffer::class.java)

    @GetMapping("/search")
    fun search(
        @AuthenticationPrincipal user: CustomPrincipal,
        @RequestParam q: String,
        @RequestParam(required = false) level: Int?,
        @RequestParam(defaultValue = "5") n: Int,
    ): Mono<Map<*, *>> = ...
}
```

**중요 — 스트리밍 보존**: `/chat` 응답은 Claude 토큰을 실시간 스트리밍한다. Spring 의 controller 도 `Flux` / `StreamingResponseBody` / WebFlux 로 스트리밍을 끝까지 흘려보내야 한다. ResponseEntity 한 번에 모으면 첫 토큰이 응답 끝에 한꺼번에 도착해서 UX 가 깨진다.

### 4.8 프론트엔드 endpoint 변경

[src/api/harmorag.ts:19](../src/api/harmorag.ts#L19) 에 RAG 서버 URL 이 박혀 있음. 운영 배포 시 환경변수로:

```ts
const RAG_SERVER =
  import.meta.env.VITE_RAG_SERVER
  || 'http://127.0.0.1:8001';
```

배포 `.env` (프론트):
```
VITE_RAG_SERVER=https://jazzify.p-e.kr/rag       # nginx 프록시 옵션
# 또는
VITE_RAG_SERVER=https://jazzify.p-e.kr/v1/rag    # Spring Boot 프록시 옵션
```

### 4.9 CORS

현재 `rag/server.py` 의 CORS 는 localhost + Tailnet(100.x.x.x) + *.ts.net 만 허용.
**배포 시에는** 프론트 origin (`https://jazzify.p-e.kr` 등)을 `allow_origins` 에 추가하거나, nginx/Spring Boot 가 같은 도메인에서 프록시하므로 CORS 자체가 불필요해진다 (same-origin).

[rag/server.py:27-33](../rag/server.py#L27-L33) 수정 예시:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://jazzify.p-e.kr", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

(같은 호스트에서 프록시한다면 origin 자체가 같으므로 미들웨어 제거해도 OK.)

### 4.10 Part A 체크리스트

- [ ] Python 3.10+ 설치 확인
- [ ] `/opt/jazzify-rag` 디렉토리 생성, 위 4.2 구조대로 파일 배치
- [ ] `venv` 생성 + `pip install -r rag/requirements.txt`
- [ ] `.env` 에 `VITE_ANTHROPIC_API_KEY` 설정
- [ ] (chunks/db 미전송 시) `python 1_chunk.py && python 2_embed.py` 로 빌드
- [ ] `uvicorn server:app --host 127.0.0.1 --port 8001` 동작 확인
- [ ] `curl http://127.0.0.1:8001/health` → `{"status":"ok"}` 확인
- [ ] systemd 서비스 등록 / `systemctl start jazzify-rag`
- [ ] nginx 또는 Spring Boot 에서 외부 라우트 노출 (`/rag/chat` 등)
- [ ] 프론트 `VITE_RAG_SERVER` 환경변수 설정 + 재배포
- [ ] CORS / 인증 정책 결정 및 적용

---

## 5. Part B — explanation 콘텐츠를 DB 로 이전

> **언제 진행?** 백엔드 + 프론트 admin 페이지에서 explanation 콘텐츠를 CRUD 하려면 필수. Part A 가 안정화된 뒤 진행해도 무방.

### 5.1 DB 스키마 (PostgreSQL)

```sql
CREATE TABLE explanation_documents (
    id                  BIGSERIAL PRIMARY KEY,
    source_type         VARCHAR(20)  NOT NULL                    -- 'standard' | 'lesson'
                        CHECK (source_type IN ('standard', 'lesson')),
    slug                VARCHAR(100) NOT NULL UNIQUE,            -- 'allofme', 'cherokee', ...
    title               VARCHAR(200) NOT NULL,                   -- 사람이 보는 제목
    content             TEXT         NOT NULL,                   -- 마크다운 원문 전체
    metadata            JSONB,                                   -- { composer, key, form, source, analyzed_songs }
    topic_tags          TEXT[],                                  -- ['secondary-dominant', 'modal-interchange', ...]
    embedding_version   INT          NOT NULL DEFAULT 1,         -- content 바뀔 때 +1, RAG 가 보고 재임베딩 판단
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by          BIGINT,                                  -- FK to users.id (admin)
    updated_by          BIGINT
);

CREATE INDEX idx_explanation_source_type ON explanation_documents(source_type);
CREATE INDEX idx_explanation_updated_at  ON explanation_documents(updated_at DESC);

-- 콘텐츠 자동 갱신 트리거 (embedding_version + updated_at)
CREATE OR REPLACE FUNCTION bump_explanation_version()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.content IS DISTINCT FROM OLD.content THEN
        NEW.embedding_version := OLD.embedding_version + 1;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_explanation_bump
    BEFORE UPDATE ON explanation_documents
    FOR EACH ROW
    EXECUTE FUNCTION bump_explanation_version();
```

#### 컬럼별 상세

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | BIGSERIAL | PK |
| `source_type` | VARCHAR(20) | `'standard'` 또는 `'lesson'`. RAG 검색 시 필터링용 |
| `slug` | VARCHAR(100) UNIQUE | URL-safe id (예: `'allofme'`, `'thedaysofwineandroses'`). 현재 파일명에서 `.txt` 뗀 값과 일치 |
| `title` | VARCHAR(200) | 곡명/강의명 (마크다운 1줄 `## 곡 정보` 다음의 `**곡명:** ...` 또는 직접 입력) |
| `content` | TEXT | 마크다운 원문 통째로. 사이즈는 곡당 5~50KB 정도 |
| `metadata` | JSONB | 파싱 결과 캐시: `{"composer":"Henry Mancini", "key":"F Major", "form":"32마디 ABAC", "source":"준킴뮤직", "analyzed_songs":""}` — 필수 아님, RAG 파이프라인이 본문에서 다시 파싱해도 됨 |
| `topic_tags` | TEXT[] | RAG 검색 시 `tag_filter` 로 사용. 예: `{'secondary-dominant', 'modal-interchange'}`. `1_chunk.py` 의 `TOPIC_TAGS` dict 와 동일한 의미 |
| `embedding_version` | INT | **핵심**: content 가 바뀔 때 +1. RAG 서비스가 마지막으로 처리한 버전을 ChromaDB 메타데이터에 기록하고, 비교해서 변경된 row 만 재임베딩 |
| `created_at` / `updated_at` | TIMESTAMPTZ | 표준 audit |
| `created_by` / `updated_by` | BIGINT | admin user FK (스키마에 user 테이블이 있다면 추가) |

### 5.2 Spring Boot 엔티티 / Repository (Kotlin 예시)

```kotlin
// ExplanationDocument.kt
@Entity
@Table(name = "explanation_documents")
class ExplanationDocument(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    var sourceType: SourceType,

    @Column(nullable = false, unique = true, length = 100)
    var slug: String,

    @Column(nullable = false, length = 200)
    var title: String,

    @Column(nullable = false, columnDefinition = "TEXT")
    var content: String,

    @Type(JsonBinaryType::class)
    @Column(columnDefinition = "jsonb")
    var metadata: MutableMap<String, Any?> = mutableMapOf(),

    @Type(ListArrayType::class)
    @Column(columnDefinition = "text[]")
    var topicTags: MutableList<String> = mutableListOf(),

    @Column(nullable = false)
    var embeddingVersion: Int = 1,

    @Column(nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),

    @Column(nullable = false)
    var updatedAt: Instant = Instant.now(),
)

enum class SourceType { STANDARD, LESSON }
```

### 5.3 REST API 스펙

| Method | Path | 권한 | 설명 |
|---|---|---|---|
| GET | `/v1/admin/explanations` | ADMIN | 목록 조회. `?page=0&size=20&sourceType=standard&q=cherokee` |
| GET | `/v1/admin/explanations/{id}` | ADMIN | 단건 조회 (id) |
| GET | `/v1/admin/explanations/by-slug/{slug}` | ADMIN | 단건 조회 (slug) |
| POST | `/v1/admin/explanations` | ADMIN | 생성. body: `{ sourceType, slug, title, content, metadata, topicTags }` |
| PUT | `/v1/admin/explanations/{id}` | ADMIN | 수정. content 변경 시 `embedding_version` 자동 +1 (DB 트리거) |
| DELETE | `/v1/admin/explanations/{id}` | ADMIN | 삭제. RAG 가 폴링 시 chroma 에서도 정리 |
| POST | `/v1/admin/explanations/{id}/reindex` | ADMIN | (옵션) 수동 재임베딩 트리거 → RAG `/internal/reindex?ids=...` 호출 |
| GET | `/v1/admin/explanations/sync-status` | ADMIN | (옵션) RAG 가 마지막으로 처리한 version 과 DB 의 현재 version 비교 — 동기화 상태 모니터링 |

#### 응답 형식 예시 (목록)
```json
{
  "data": {
    "content": [
      {
        "id": 1,
        "sourceType": "STANDARD",
        "slug": "allofme",
        "title": "All of Me",
        "metadata": { "composer": "Gerald Marks / Seymour Simons", "key": "C Major", "form": "32마디 ABAC", "source": "준킴뮤직" },
        "topicTags": ["secondary-dominant", "extended-secondary", "dim7", "modal-interchange"],
        "embeddingVersion": 3,
        "createdAt": "2026-05-18T10:23:00Z",
        "updatedAt": "2026-05-19T08:12:00Z"
      }
    ],
    "page": 0, "size": 20, "totalElements": 22, "totalPages": 2
  }
}
```
> 목록 API 는 `content` 컬럼은 빼는 게 좋다 (페이로드 절약). 상세 API 에서만 포함.

### 5.4 RAG 서비스 수정 — 파일 → DB SELECT

`1_chunk.py` 의 핵심 변경:

**현재 (파일 시스템):**
```python
DATA_ROOT = "../data/explanation"
STANDARDS_DIR = os.path.join(DATA_ROOT, "standards")
# ...
for fname in sorted(os.listdir(STANDARDS_DIR)):
    with open(os.path.join(STANDARDS_DIR, fname), encoding="utf-8") as f:
        text = f.read()
    # ... 파싱
```

**변경 후 (DB):**
```python
import psycopg2
from psycopg2.extras import RealDictCursor

DB_URL = os.getenv("DATABASE_URL")  # postgresql://user:pass@host:5432/jazzify

def fetch_changed_documents(last_processed_version: int) -> list[dict]:
    """RAG 가 마지막으로 처리한 버전 이후 변경된 문서만 반환."""
    with psycopg2.connect(DB_URL) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, source_type, slug, title, content, metadata,
                       topic_tags, embedding_version
                FROM explanation_documents
                WHERE embedding_version > %s
                ORDER BY id
            """, (last_processed_version,))
            return cur.fetchall()
```

`2_embed.py` 변경: ChromaDB 의 메타데이터에 `db_id`, `embedding_version` 을 추가 저장. 다음 빌드 때 비교해서 변경된 청크만 update/delete/add.

**호출 방식 두 가지:**
1. **Cron (단순)**: 5분마다 `python rebuild_incremental.py` 실행 → DB 폴링, 변경분만 재임베딩
2. **Webhook (정확)**: Spring Boot 가 PUT 성공 시 RAG 의 `POST /internal/reindex?id={id}` 호출 → 즉시 재임베딩

처음에는 cron 추천 (구현 단순). 사용자가 admin 페이지에서 수정 후 즉시 반영을 원하면 webhook 추가.

### 5.5 일회성 마이그레이션 스크립트

기존 22개 `.txt` 파일을 DB 로 옮기는 1회성 스크립트. 백엔드/RAG 어느 쪽에서 실행해도 OK. Python 예시:

```python
# rag/seed_explanations.py
import os, re, glob, json, psycopg2

DB_URL = os.environ["DATABASE_URL"]
DATA_ROOT = "../data/explanation"

# 1_chunk.py 의 TOPIC_TAGS 를 그대로 가져옴
from importlib import import_module
chunk_mod = import_module("1_chunk")  # 또는 직접 dict 복붙
TOPIC_TAGS = chunk_mod.TOPIC_TAGS

def parse_title(text: str) -> str:
    m = re.search(r"\*{0,2}곡명\s*(?:\([^)]*\))?\s*:\*{0,2}\s*(.+)", text)
    return m.group(1).strip() if m else "(제목 없음)"

def parse_metadata(text: str) -> dict:
    out = {}
    for k, pat in chunk_mod.META_PATTERNS.items():
        m = re.search(pat, text)
        out[k] = m.group(1).strip() if m else None
    return out

def seed():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    for sub in ("standards", "lessons"):
        for path in sorted(glob.glob(f"{DATA_ROOT}/{sub}/*.txt")):
            slug = os.path.splitext(os.path.basename(path))[0]
            with open(path, encoding="utf-8") as f:
                content = f.read()
            title = parse_title(content)
            metadata = parse_metadata(content)
            tags = TOPIC_TAGS.get(slug, []) if sub == "standards" else []
            cur.execute("""
                INSERT INTO explanation_documents
                    (source_type, slug, title, content, metadata, topic_tags, embedding_version)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s, 1)
                ON CONFLICT (slug) DO UPDATE
                    SET title = EXCLUDED.title,
                        content = EXCLUDED.content,
                        metadata = EXCLUDED.metadata,
                        topic_tags = EXCLUDED.topic_tags
            """, (
                sub[:-1],  # 'standards' -> 'standard'
                slug, title, content, json.dumps(metadata), tags
            ))
    conn.commit()
    print("seed 완료")

if __name__ == "__main__":
    seed()
```

실행:
```bash
DATABASE_URL=postgresql://... python rag/seed_explanations.py
```

이후 같은 데이터로 1_chunk.py + 2_embed.py 다시 돌려서 ChromaDB 재생성.

### 5.6 Part B 체크리스트

- [ ] PostgreSQL 에 `explanation_documents` 테이블 + 트리거 생성
- [ ] Spring Boot 에 Entity / Repository / Service / Controller 구현
- [ ] admin 권한 가드 (기존 인증 체계 활용)
- [ ] 일회성 마이그레이션 스크립트 실행 (22개 파일 → 22개 row)
- [ ] `1_chunk.py` 를 DB SELECT 방식으로 수정 (또는 별도 `1_chunk_from_db.py` 신규)
- [ ] `2_embed.py` 에 incremental update 로직 추가 (변경된 청크만)
- [ ] cron 또는 webhook 으로 동기화 자동화
- [ ] 프론트 admin 페이지 (목록 / 편집 / 생성 / 삭제) — 마크다운 에디터는 `@uiw/react-md-editor` 등

---

## 6. 통합 환경 변수 정리

배포 시 백엔드 서버에서 관리할 환경 변수:

| 변수 | 사용처 | 예시 | 필수 |
|---|---|---|---|
| `VITE_ANTHROPIC_API_KEY` | RAG `server.py` (Claude API 호출) | `sk-ant-...` | ✅ |
| `DATABASE_URL` | (Part B 이후) RAG 가 DB SELECT 할 때 | `postgresql://user:pw@host:5432/jazzify` | Part B |
| `JAZZIFY_RAG_PORT` | uvicorn 바인딩 (옵션 — systemd 에 박아도 됨) | `8001` | — |
| Spring Boot `rag.base-url` | Spring Boot 가 RAG 로 프록시할 때 | `http://127.0.0.1:8001` | (프록시 쓰면) |
| Spring Boot DB 설정 | Spring Boot 가 PG 접근 | (기존) | ✅ |

프론트:

| 변수 | 사용처 | 예시 |
|---|---|---|
| `VITE_RAG_SERVER` | [src/api/harmorag.ts](../src/api/harmorag.ts) | `https://jazzify.p-e.kr/rag` |

---

## 7. 운영 / 트러블슈팅

### 7.1 자주 발생하는 문제

| 증상 | 원인 / 해결 |
|---|---|
| `/health` 는 OK 인데 `/chat` 이 500 | 환경변수 `VITE_ANTHROPIC_API_KEY` 누락 또는 만료. `journalctl -u jazzify-rag -f` 로 traceback 확인 |
| 첫 부팅이 매우 느림 (수분) | `sentence-transformers` 가 모델 다운로드 중 (~470MB). 한 번만 발생, `~/.cache/huggingface/` 에 저장됨 |
| 검색 결과가 비어 있음 | `rag/db/` 에 ChromaDB 가 없거나 비어있음. `python 2_embed.py` 다시 실행 |
| `chunks.json` 이 없다고 오류 | `python 1_chunk.py` 먼저 실행. `rag/` 디렉토리에서 실행해야 `../data/explanation` 이 잡힘 |
| 프론트가 RAG 응답을 한 번에 받음 (스트리밍 X) | nginx 의 `proxy_buffering` 또는 Spring Boot 의 response buffering 가 활성화됨. 위 4.6 / 4.7 참고 |
| CORS 에러 | `rag/server.py` 의 `allow_origins` 확인. 같은 도메인 프록시면 미들웨어 자체 제거 가능 |
| `chromadb` 에러: `sqlite3 version too old` | 시스템 SQLite ≥ 3.35 필요. Ubuntu 22.04 는 OK. 구버전이면 `pysqlite3-binary` 설치 후 monkey-patch |

### 7.2 비용 / 한도 모니터링

- **Anthropic Claude**: `/chat` 1회 당 약 4096 max_tokens. 평균 답변 1000~2000 토큰 추정. 대시보드: console.anthropic.com 의 Usage
- **임베딩 비용**: 로컬 모델이라 **무료**
- **트래픽**: `/chat` 호출량을 메트릭으로 봐야 함 (남용 방지). Spring Boot 의 rate limit 미들웨어 적용 권장 (사용자 당 분당 N건)

### 7.3 백업

| 대상 | 빈도 | 방법 |
|---|---|---|
| `data/explanation/` (Part A) | git push (수동) | 콘텐츠가 git 에 있음 |
| `explanation_documents` 테이블 (Part B) | DB 정기 백업 | 백엔드 PG 백업 정책에 포함 |
| `rag/chunks/chunks.json` | 빌드 산출물 | 손실 시 재빌드 |
| `rag/db/` (ChromaDB) | 빌드 산출물 | 손실 시 재빌드 (`2_embed.py`) |

### 7.4 로그

- RAG 서비스 로그: `journalctl -u jazzify-rag -f`
- 주요 로그 라인:
  - `[HarmoRAG] 쿼리 N개 → 청크 M개 → top-K (RRF)` — agent 동작 정상
  - `RAG 검색 실패: ...` — ChromaDB 또는 임베딩 모델 오류
  - HTTP 액세스 로그는 uvicorn 기본 출력

---

## 8. 부록 A — 파일별 라인 인덱스 (빠른 참조)

| 위치 | 코드 |
|---|---|
| [rag/server.py:19](../rag/server.py#L19) | `.env` 경로 (`load_dotenv("../.env")`) |
| [rag/server.py:35](../rag/server.py#L35) | Anthropic 클라이언트 초기화 (`VITE_ANTHROPIC_API_KEY`) |
| [rag/server.py:108](../rag/server.py#L108) | `POST /chat` 핸들러 |
| [rag/server.py:147](../rag/server.py#L147) | Claude 모델명: `claude-sonnet-4-6` |
| [rag/server.py:158](../rag/server.py#L158) | `GET /search` 핸들러 |
| [rag/server.py:169](../rag/server.py#L169) | `GET /health` 핸들러 |
| [rag/server.py:176](../rag/server.py#L176) | uvicorn 포트: `8001` |
| [rag/retrieve.py:15-17](../rag/retrieve.py#L15) | ChromaDB 경로 / 컬렉션 / 모델명 |
| [rag/retrieve.py:32](../rag/retrieve.py#L32) | `search(query, n_results, level_filter, song_filter, tag_filter, source_type)` |
| [rag/agent.py:19](../rag/agent.py#L19) | `decompose_query` — chord_context → 멀티 쿼리 분해 |
| [rag/agent.py:147](../rag/agent.py#L147) | `route_and_retrieve` — RRF 융합 |
| [rag/agent.py:196](../rag/agent.py#L196) | `build_context` — 진입점 |
| [rag/1_chunk.py:23](../rag/1_chunk.py#L23) | `DATA_ROOT = "../data/explanation"` |
| [rag/1_chunk.py:29](../rag/1_chunk.py#L29) | `TOPIC_TAGS` dict (곡 → 태그) |
| [rag/2_embed.py:20](../rag/2_embed.py#L20) | 임베딩 모델명 |
| [src/api/harmorag.ts:19](../src/api/harmorag.ts#L19) | 프론트 RAG endpoint URL |

## 9. 부록 B — chord_context 형식 (프론트 → RAG)

[rag/agent.py:19-39](../rag/agent.py#L19) 의 docstring 에 정의된 형식:

```jsonc
{
  "chord": "F7",              // 분석 대상 코드
  "key": "Eb",                // 곡의 키
  "function": "II7",          // 화성 기능 (T/I/V/D/ii/IV/II7 등)
  "is_diatonic": false,
  "secondary_dominant": null, // 또는 { "targetDegree": "ii" }
  "modal_interchange": null,  // 또는 { "sourceMode": "C minor" }
  "group_memberships": [],
  "next_chord": "Fm7",
  "patterns_detected": ["ii7-flat5-not-resolving-to-v", "tritone-sub", "dim7-..."]
}
```

이 객체는 프론트의 rule-based 화성 분석 엔진 출력. RAG 서비스는 이걸 보고 쿼리를 자동 생성한다. **백엔드는 그대로 RAG 로 forward 하면 되고, 직접 해석할 필요 없음.**

## 10. 부록 C — `/chat` 응답 형식

```
[첫 chunk]
\x00RAG_DEBUG\x00
{"queries":[...], "total_retrieved":12, "top_k":5, "fusion":"rrf", "rrf_k":60, "chunks":[...]}
\x00END_DEBUG\x00
[그 후]
... Claude 의 토큰 스트림 (한국어 응답) ...
```

프론트는 `\x00RAG_DEBUG\x00 ... \x00END_DEBUG\x00` 사이를 잘라 JSON 으로 파싱 후 디버그 패널에 표시. 나머지는 Markdown 으로 렌더링.

**프록시 시 이 바이너리 마커가 깨지지 않도록 주의** — `Content-Type: text/plain` 그대로 흘려보내고 텍스트 인코딩 변환 금지.

---

## 끝

질문이나 모호한 부분 있으면 [@benzity](mailto:hi20021120@gmail.com) 에게 물어보면 됨.
