# Rule-Based 화성 분석 엔진 백엔드 통합 가이드

> **대상 독자**: 백엔드 개발자 (Spring Boot / Java)
> **목적**: 현재 로컬에서 CLI로만 동작하는 `rule-based/` Python 화성 분석 엔진을 백엔드 인프라에 통합하기 위한 모든 정보 정리.
> **관련 문서**: [RAG_BACKEND_INTEGRATION.md](RAG_BACKEND_INTEGRATION.md), [CLAUDE_BACKEND_INTEGRATION.md](CLAUDE_BACKEND_INTEGRATION.md)

---

## 0. TL;DR

| 항목 | 값 |
|---|---|
| **엔진 종류** | 화성 분석 (Harmonic analysis) — 코드 진행 텍스트 → 각 코드의 기능/관계 JSON |
| **언어** | Python 3 (stdlib only — 외부 의존성 0개) |
| **현재 동작 방식** | CLI 라이브러리 / batch processor. **HTTP 서버 없음.** |
| **현재 통합 형태** | **Offline pre-compute** — `batch.py` 로 곡 분석 → JSON → `src/data/<song>.ts` 의 `LeadSheetData.systems[].bars[].chords[].analysis` 필드에 박아둠 |
| **frontend 가 사용하는 부분** | `src/api/chordContext.ts::buildChordContext` 가 `chord.analysis` 를 텍스트로 직렬화해 RAG / Claude 로 전달 |
| **size** | 코드 ~500KB (analyzers 292K + parsers 108K + models 28K + config 24K) |
| **곡 1개 분석 시간** | ~수십 ms (32마디 기준, 추정) |
| **다루는 분석 종류 (15개)** | ii-V-I / 세컨더리 도미넌트 / 익스텐디드 세컨더리 / 트라이톤 서브 / 디미니쉬드 / 모달 인터체인지 / 크로매틱 어프로치 / 데셉티브 / 페달 / 토니시제이션 / 모드 세그먼트 / 섹션 바운더리 / 모호도 점수 등 |

**마이그레이션 결정 포인트:**
- **사용자 곡 임의 입력 지원 안 함** → 그냥 **batch pre-compute** 그대로 (Option A, 가장 단순)
- **사용자 곡 동적 분석 지원 필요** → **FastAPI 래핑 + HTTP API** (Option B, 추천)
- **분석 결과를 백엔드 DB에서 관리** → **DB 저장 + Spring Boot CRUD** (Option C)

본 문서는 세 옵션 모두 상세히 다룬다.

---

## 1. 엔진 개요 — 무엇을 하는가

### 1.1 입력 / 출력

**입력 (`main.py::analyze`):**
```python
analyze(
    text: str,                   # "Dm7 | G7 | Cmaj7 | Cmaj7 |\nAm7 | D7 | Gmaj7 | Gmaj7 |"
    key: str = "C",              # 키 ("C", "Bb", "F#m" 등)
    title: str = "Untitled",
    time_signature: str = "4/4",
) -> dict
```

**출력 ([rule-based/examples/output_example.json](../rule-based/examples/output_example.json)):**
```jsonc
{
  "song": { "title": "Example", "key": "C", "time_signature": "4/4" },
  "chords": [
    {
      "bar": 1, "beat": 1.0, "symbol": "Dm7", "duration_beats": 4.0,
      "analysis": {
        "root": 2, "root_name": "D",
        "quality": "min7", "normalized_quality": "min7",
        "tensions": [], "bass": null, "bass_name": null,
        "degree": "ii", "is_diatonic": true,
        "functions": [{ "function": "SD", "confidence": 1.0 }],
        "secondary_dominant": null,
        "group_memberships": [
          { "group_id": 1, "group_type": "ii-V-I", "role": "ii", "variant": "standard" }
        ],
        "diminished_function": null,
        "chromatic_approach": null,
        "deceptive_resolution": null,
        "pedal_info": null,
        "modal_interchange": null,
        "mode_segment": "ionian",
        "tonicization": null,
        "ambiguity_flags": []
      }
    },
    /* ... 다음 코드들 ... */
  ],
  "groups": [ /* ii-V-I 등의 그룹 정보 */ ],
  "sections": [ /* 섹션 경계 */ ],
  "engine_version": "0.1.0",
  "coverage": [ /* 분석한 카테고리 목록 */ ]
}
```

### 1.2 처리 파이프라인 ([main.py::analyze](../rule-based/main.py))

```
입력 텍스트 + 키
   │
   ▼
[Phase 1] parse_progression_text → 코드 객체 리스트
   │
   ▼
[Phase 2] Layer 1 (개별 코드)
   - chord_normalizer.normalize    (텐션 제거 / 정규화)
   - diatonic_classifier.classify  (다이어토닉 여부)
   - function_labeler.label        (T/SD/D)
   │
   ▼
[Phase 3] Layer 2 (문맥 패턴)
   - ii_v_i_detector              (ii-V-I 그룹)
   - tritone_sub_detector
   - secondary_dominant_detector
   - diminished_classifier        (passing/auxiliary/dominant 분류)
   - chromatic_approach_detector
   - deceptive_resolution_detector
   - pedal_point_detector
   │
   ▼
[Phase 4] Layer 3 (구조)
   - modal_interchange_detector   (aeolian/dorian/phrygian/lydian/mixolydian)
   - mode_segment_detector        (sliding window)
   - tonicization_modulation_detector
   - section_boundary_detector
   │
   ▼
[Phase 5] ambiguity_scorer
   │
   ▼
[Phase 6] aggregator.to_json → 최종 JSON dict
```

### 1.3 디렉토리 구조

```
rule-based/
├── main.py                          # 진입점 — analyze() 함수
├── batch.py                         # 코퍼스(JSON 리스트)를 일괄 분석
├── rule_report.py                   # 우선순위 기반 룰 보고서
├── aggregator.py                    # 분석 결과 → 최종 JSON
├── config_data.py                   # PyYAML 없을 때 fallback dict (function_map, scales, ...)
├── version_tracker.py               # 엔진 버전 기록
├── VERSION.md                       # 지원 기능 명세
├── analyzers/  (15개 .py)           # 각 분석 알고리즘
│   ├── chord_normalizer.py
│   ├── diatonic_classifier.py
│   ├── function_labeler.py
│   ├── ii_v_i_detector.py
│   ├── tritone_sub_detector.py
│   ├── secondary_dominant_detector.py
│   ├── diminished_classifier.py
│   ├── chromatic_approach_detector.py
│   ├── deceptive_resolution_detector.py
│   ├── pedal_point_detector.py
│   ├── modal_interchange_detector.py
│   ├── mode_segment_detector.py
│   ├── tonicization_modulation_detector.py
│   ├── section_boundary_detector.py
│   └── ambiguity_scorer.py  (별도 import — score_ambiguity)
├── parsers/
│   ├── text_parser.py               # "Dm7 | G7 | ..." 형식 파싱
│   ├── ireal_parser.py              # iReal Pro export
│   ├── midi_parser.py               # chord-annotated MIDI
│   └── schema.py
├── models/
│   └── chord.py                     # ParsedChord 데이터 클래스
├── config/  (yaml, optional)        # PyYAML 있을 때 로딩 — 없으면 config_data.py 사용
│   ├── chord_quality.yaml
│   ├── function_map.yaml
│   ├── modal_interchange.yaml
│   ├── scales.yaml
│   └── substitution_rules.yaml
├── tests/  (pytest)
│   ├── test_rule_report.py
│   ├── test_edge_cases.py
│   └── test_all_my_tomorrows.py
└── examples/
    ├── input_example.txt            # "Dm7 | G7 | Cmaj7 | Cmaj7 |..."
    └── output_example.json
```

### 1.4 지원 기능 ([VERSION.md](../rule-based/VERSION.md))

**Layer 1 (개별 코드):** 다이어토닉/논다이어토닉, 스케일 디그리, T/SD/D 기능 (confidence 점수), 코드 정규화
**Layer 2 (문맥 패턴):** ii-V-I (standard/minor/tritone sub/backdoor/incomplete/sus delay), 트라이톤 서브, 세컨더리 도미넌트, 디미니쉬드 분류 (passing/auxiliary/dominant), 크로매틱 어프로치, 데셉티브 해결, 페달 포인트
**Layer 3 (구조):** 모달 인터체인지 (5개 모드), 모드 세그먼트, 토니시제이션 vs 모듈레이션, 섹션 바운더리
**미지원:** Augmented 6 / Upper structure triad / Coltrane changes / Rhythm changes / Blues form / Automatic key detection

**입력 형식:** ✅ Plain text, iReal Pro export, chord-annotated MIDI / ❌ raw MIDI, audio chord estimation

---

## 2. 현재 통합 상태 — Offline Pre-compute

### 2.1 흐름

```
[개발자가 수동으로]
   batch.py 실행 → results/<song>.json 생성
                              │
                              ▼
                  결과를 src/data/<song>.ts 의
                  LeadSheetData 객체에 통합
                              │
                              ▼
                  Git commit + 프론트 빌드
                              │
                              ▼
[브라우저]
   LeadSheetData 로딩
   ├ chord.analysis 필드에 사전 분석 결과 (rule-based 출력)
   │
   ▼
[chordContext.ts::buildChordContext]
   chord.analysis 를 사람이 읽는 텍스트로 직렬화
   "Bar 1: Dm7  degree=ii  diatonic  fn=[Subdominant(100%)]  ii-V-I.role=ii"
   │
   ▼
[harmorag.ts::streamWithRAG]
   chord_context_text 로 RAG/Claude 에 전달
   │
   ▼
[rag/server.py /chat]
   system 프롬프트에 chord_context_text 주입
   → Claude 응답
```

**증거:**
- [src/data/allofme_analysis.json](../src/data/allofme_analysis.json) — rule-based batch 결과 그대로
- [src/data/allOfMe.ts](../src/data/allOfMe.ts) — LeadSheetData 안에 `chord.analysis` 박힘
- [src/data/leadSheetTypes.ts:35](../src/data/leadSheetTypes.ts#L35) — `analysis?: LeadSheetChordAnalysis` 타입 정의
- [src/api/chordContext.ts](../src/api/chordContext.ts) — chord.analysis → 텍스트 직렬화

### 2.2 현 상태 한계

| 한계 | 의미 |
|---|---|
| **사용자 임의 곡 분석 불가** | 신곡은 개발자가 batch 돌려서 미리 박아둬야 함. iReal/Editor 같은 곳에서 사용자가 입력한 코드 진행은 분석 불가 |
| **rule-based가 frontend/RAG runtime에서 호출되지 않음** | LeadSheet의 `chord.analysis` 가 비어있으면 chord_context_text 가 비거나 매우 빈약 |
| **chord_context 객체가 RAG agent로 안 들어감** | [rag/agent.py::decompose_query](../rag/agent.py#L19) 는 `chord_context.function`, `secondary_dominant`, `patterns_detected` 등을 보고 쿼리를 분해하는데, 현재 frontend 는 `chord_context_text` 만 보내고 객체 자체는 안 보냄. **즉 agent 의 chord-specific 쿼리 분해 로직이 사실상 작동 안 함** |
| **batch 운영이 수동** | 개발자가 직접 corpus JSON 작성 + batch.py 실행 + 결과 통합 |

→ **온라인 동적 분석을 원하면 마이그레이션 필수.** 안 원하면 현 상태 그대로도 OK.

---

## 3. 마이그레이션 옵션 비교

| 옵션 | 어디서 | 동적 분석 | 작업량 | RAG agent 풀활용 |
|---|---|---|---|---|
| **A. 현 상태 유지 (offline batch)** | 개발자 PC | ❌ | 0 | ❌ |
| **B. FastAPI 래핑** (추천 if 동적 필요) | 백엔드 서버에 Python 서비스 | ✅ | 중 | ✅ |
| **C. Pre-compute + DB 저장** | 백엔드 batch job + PostgreSQL | ❌ (재배치만 빠름) | 중 | ✅ |
| **D. TS/Kotlin 포팅** | Spring Boot 안에 직접 | ✅ | **매우 큼** | ✅ |

**추천 의사결정:**
- 사용자 입력 곡 분석 필요 X → **A** (현 상태 유지, RAG 서버 옆에 batch 도구로만 두기)
- 사용자 입력 곡 분석 필요 + 변경 잦음 → **B** (FastAPI)
- 사용자 입력 곡 분석 필요 + 결과를 백엔드 다른 곳에서도 join 필요 → **B + C 하이브리드**
- D는 Python 엔진을 완전 대체할 강력한 이유가 있을 때만

이하는 **Option B (FastAPI 래핑)** 를 핵심으로, A/C 도 같이 다룬다.

---

## 4. Option A — 현 상태 유지 (백엔드 서버에 batch 도구로만)

### 4.1 의미

rule-based 를 백엔드 서버에 복사만 해두고, **개발자가 SSH 들어가서 batch.py 실행 → 결과 JSON 을 git/DB 로 떨궈서 운영**.

### 4.2 배치 디렉토리

```
/opt/jazzify-rule-engine/         ← 백엔드 서버 위치 (RAG와 같은 호스트 OK)
├── rule-based/                   (rsync 로 통째로 복사)
└── (선택) outputs/               batch 결과 저장
```

### 4.3 의존성

**없음.** Python 3.9+ 만 있으면 됨. venv 도 사실상 불필요 (stdlib only). 다만 관리상 venv 권장:
```bash
python3.10 -m venv venv
source venv/bin/activate
pip install pytest      # 테스트 실행 시만
```

> ⚠️ `config/*.yaml` 파일이 있지만 코드는 `config_data.py` 의 fallback dict 만 사용 (PyYAML import 안 함). yaml 파일은 휴먼 reference 용. **PyYAML 설치 불필요.**

### 4.4 사용

```bash
cd /opt/jazzify-rule-engine/rule-based

# 단일 곡 분석
python main.py --input chords.txt --key Ab --title "All The Things You Are"

# 코퍼스 일괄
python batch.py --corpus songs.json --output results/
```

코퍼스 JSON 형식:
```json
[
  {"title": "Autumn Leaves", "key": "C",  "chords": "Dm7 | G7 | Cmaj7 | ..."},
  {"title": "Blue Bossa",    "key": "Cm", "chords": "Cm7 | Cm7 | Fm7 | ..."}
]
```

### 4.5 Option A 체크리스트

- [ ] rule-based 디렉토리를 백엔드 서버로 rsync
- [ ] Python 3.9+ 확인
- [ ] `python main.py --input examples/input_example.txt --key C` 로 동작 확인
- [ ] (선택) pytest 실행: `cd rule-based && python -m pytest tests/`

→ 이게 전부. **RAG / Spring Boot / frontend 변경 없음.**

---

## 5. Option B — FastAPI 래핑 (추천)

### 5.1 신규 파일: `rule-based/server.py`

```python
"""HTTP wrapper for the rule-based harmonic analyzer.

실행: uvicorn server:app --host 0.0.0.0 --port 8002 --reload
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from main import analyze
from aggregator import to_json   # 디버그용 (str 변환)
from parsers.ireal_parser import parse_ireal  # iReal 입력 지원 시
from parsers.midi_parser import parse_midi    # MIDI 입력 지원 시

app = FastAPI(title="Jazzify Rule Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|100\.\d+\.\d+\.\d+|[\w-]+\.[\w-]+\.ts\.net)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    text: str                        # "Dm7 | G7 | Cmaj7 | ..."
    key: str = "C"
    title: str = "Untitled"
    time_signature: str = "4/4"


class AnalyzeIRealRequest(BaseModel):
    url: str                          # iReal Pro url-encoded export
    title: str = "Untitled"


@app.post("/analyze")
async def analyze_endpoint(req: AnalyzeRequest) -> dict:
    """Run the full analysis pipeline. Returns the same dict as main.analyze."""
    try:
        result = analyze(req.text, key=req.key, title=req.title,
                         time_signature=req.time_signature)
        if "error" in result:
            raise HTTPException(400, result["error"])
        return result
    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {e}")


@app.post("/analyze-ireal")
async def analyze_ireal_endpoint(req: AnalyzeIRealRequest) -> dict:
    """Optional — iReal Pro url 직접 입력."""
    try:
        song, chords, key, ts = parse_ireal(req.url, title=req.title)
        # main.analyze 의 chunks 활용을 위해 text 재조립 또는 analyze 분리 호출
        # (간단 구현은 생략 — text 로 분해하면 됨)
        ...
    except Exception as e:
        raise HTTPException(500, f"iReal parse failed: {e}")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "RuleEngine", "version": "0.1.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002, reload=True)
```

### 5.2 requirements.txt (신규)

```
fastapi>=0.115.0
uvicorn>=0.32.0
pydantic>=2.0.0
# 기존 rule-based는 stdlib only — 추가 의존성 없음
```

### 5.3 배포 디렉토리

```
/opt/jazzify-rule-engine/
├── rule-based/
│   ├── server.py          ← 신규
│   ├── requirements.txt   ← 신규 (위 §5.2)
│   ├── main.py, batch.py, analyzers/, parsers/, ...
├── venv/
└── .env (선택, env 필요 시)
```

### 5.4 systemd 서비스

`/etc/systemd/system/jazzify-rule.service`:
```ini
[Unit]
Description=Jazzify rule-based harmonic analyzer
After=network.target

[Service]
Type=simple
User=jazzify
WorkingDirectory=/opt/jazzify-rule-engine/rule-based
ExecStart=/opt/jazzify-rule-engine/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8002
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable jazzify-rule
sudo systemctl start jazzify-rule
curl http://127.0.0.1:8002/health
# → {"status":"ok","service":"RuleEngine","version":"0.1.0"}
```

> `--host 127.0.0.1` 권장 — 외부 노출 대신 nginx 또는 Spring Boot 가 프록시.

### 5.5 nginx 프록시 (옵션 1)

```nginx
location /rule/ {
    proxy_pass http://127.0.0.1:8002/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_read_timeout 60s;
}
```

→ 프론트가 `https://jazzify.p-e.kr/rule/analyze` 호출.

### 5.6 Spring Boot 프록시 (옵션 2 — 인증 가드 + 캐싱 가능)

```kotlin
@RestController
@RequestMapping("/v1/analysis")
class RuleEngineProxyController(
    @Value("\${rule.base-url:http://127.0.0.1:8002}") private val ruleBaseUrl: String,
    private val webClient: WebClient = WebClient.create(),
    private val cache: AnalysisCache,    // 옵션 - Redis 또는 Caffeine
) {
    @PostMapping("/analyze")
    suspend fun analyze(
        @AuthenticationPrincipal user: CustomPrincipal?,
        @RequestBody req: AnalyzeRequest,
    ): Map<String, Any?> {
        val cacheKey = hash(req)
        cache.get(cacheKey)?.let { return it }
        val result = webClient.post()
            .uri("$ruleBaseUrl/analyze")
            .bodyValue(req)
            .retrieve()
            .awaitBody<Map<String, Any?>>()
        cache.put(cacheKey, result)
        return result
    }
}

data class AnalyzeRequest(
    val text: String,
    val key: String = "C",
    val title: String = "Untitled",
    val timeSignature: String = "4/4",
)
```

**캐싱 권장** — 같은 입력은 같은 결과. (text + key + time_signature) 해시를 키로 결과 캐싱하면 분석 비용 절감 + latency 개선.

### 5.7 RAG agent 와 통합 (chord_context 풀활용)

현재 [rag/server.py::chat](../rag/server.py#L108) 은 `chord_context_text` 만 받고 `chord_context` 객체는 받지 않음. **rule-based 가 동적으로 호출 가능해지면** agent.decompose_query 가 풀 동작:

**옵션 1 — frontend 가 직접 분석 호출 + RAG 로 전달:**
```typescript
// 곡 진입 시 또는 코드 변경 시
const res = await fetch('/rule/analyze', {
  method: 'POST',
  body: JSON.stringify({ text: chordProgressionText, key, title })
});
const analysis = await res.json();  // rule-based 출력 그대로

// RAG 호출 시 chord_context 객체로 함께 전송
await fetch('/rag/chat', {
  method: 'POST',
  body: JSON.stringify({
    message,
    chord_context: analysis.chords[currentChordIndex].analysis,  // ← 객체
    chord_context_text: serializeForHuman(analysis),             // 텍스트도
    song_title: title,
  })
});
```

**옵션 2 — RAG 서버가 내부적으로 rule-based 호출:**
```python
# rag/server.py 수정
import httpx
RULE_URL = os.getenv("RULE_BASE_URL", "http://127.0.0.1:8002")

@app.post("/chat")
async def chat(req: ChatRequest):
    if req.chord_context_text and not req.chord_context:
        # 객체가 없으면 rule-based 에 직접 분석 요청
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{RULE_URL}/analyze",
                                  json={"text": req.chord_context_text, "key": "C", "title": req.song_title})
            if r.status_code == 200:
                req.chord_context = derive_current_chord_context(r.json())
    # ... 기존 로직
```

옵션 2 가 단일 책임 (frontend 는 raw 만 보냄, RAG 가 분석/검색 책임). 다만 frontend 가 어느 코드를 사용자가 보고 있는지 알려야 하므로 약간 보강 필요.

---

## 6. Option C — Pre-compute + DB 저장

표준곡들을 미리 분석해서 DB 에 저장 → 백엔드 API 로 곡 분석 결과 제공.

### 6.1 DB 스키마

```sql
CREATE TABLE song_analyses (
    id              BIGSERIAL PRIMARY KEY,
    slug            VARCHAR(100) NOT NULL UNIQUE,    -- 'allofme', 'cherokee'
    title           VARCHAR(200) NOT NULL,
    key_root        VARCHAR(10)  NOT NULL,           -- 'C', 'Bb', 'F#m'
    time_signature  VARCHAR(10)  DEFAULT '4/4',
    chords_text     TEXT         NOT NULL,           -- 분석 입력 (원본 진행)
    analysis        JSONB        NOT NULL,           -- rule-based 출력 통째로
    engine_version  VARCHAR(20)  NOT NULL,           -- '0.1.0' — 엔진 업그레이드 추적
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_song_analyses_slug ON song_analyses(slug);
CREATE INDEX idx_song_analyses_engine_version ON song_analyses(engine_version);
```

### 6.2 Spring Boot API

```
GET  /v1/songs/{slug}/analysis              # 단건 (분석 결과 그대로)
GET  /v1/songs/{slug}/analysis/chord/{idx}  # 특정 코드 시점 (decompose_query 입력용)
POST /v1/admin/songs/{slug}/reanalyze       # 재분석 (rule-based 서비스 호출 후 갱신)
GET  /v1/admin/songs/analyses?engineVersion=0.1.0  # 엔진 버전별 카운트 (re-batch 판단용)
```

### 6.3 Batch 동기화

```bash
# rule-based 엔진 업데이트 후
python rule-based/batch.py --corpus songs.json --output /tmp/results/
python sync_to_db.py --input /tmp/results/ --engine-version 0.2.0
# → 모든 곡 재분석 결과를 DB UPSERT
```

또는 trigger 패턴: `engine_version` 컬럼이 현재 엔진보다 낮으면 자동 재배치.

### 6.4 장점 vs 단점

**장점:**
- 표준곡 분석 결과를 빠르게 제공 (DB SELECT)
- Spring Boot 의 다른 테이블 (예: lick, solo) 과 JOIN 가능
- 엔진 버전 추적 가능

**단점:**
- 사용자 임의 입력 곡은 별도 처리 (Option B 같이 운영 필요)
- batch 동기화 운영 부담

→ **B + C 하이브리드 권장**: 표준곡은 C 캐싱, 사용자 곡은 B 동적 분석.

---

## 7. 환경 변수 / 의존성 정리

### 7.1 백엔드 서버 (Option B 기준)

| 변수 | 용도 | 예시 |
|---|---|---|
| `RULE_BASE_URL` | RAG 또는 Spring Boot 가 rule-based 호출 시 | `http://127.0.0.1:8002` |
| `DATABASE_URL` | (Option C) Spring Boot / batch 가 PG 접근 | `postgresql://...` |

### 7.2 의존성

| 항목 | 버전 |
|---|---|
| Python | 3.9+ (3.10 권장) |
| (FastAPI 모드만) fastapi | ≥0.115 |
| (FastAPI 모드만) uvicorn | ≥0.32 |
| (FastAPI 모드만) pydantic | ≥2.0 |
| (테스트만) pytest | latest |
| **그 외 외부 의존성 없음** | rule-based 자체는 stdlib only |

### 7.3 RAG 서버 와의 관계

| | RAG (rag/) | Rule Engine (rule-based/) |
|---|---|---|
| 포트 | 8001 | 8002 |
| 외부 의존 | Anthropic API | 없음 (stdlib only) |
| 책임 | 컨텍스트 검색 + LLM 응답 | 코드 진행 → 화성 분석 JSON |
| 호출 관계 | RAG 가 rule-based 호출 (옵션, 위 §5.7) | rule-based 는 RAG 모름 |

같은 호스트에 두 서비스 띄우는 게 자연스러움.

---

## 8. 마이그레이션 절차 (Option B 기준)

```
[1] 서버 준비
    ├ Python 3.10+ 설치
    ├ /opt/jazzify-rule-engine/ 디렉토리 생성
    └ rsync rule-based/ 디렉토리 전송

[2] FastAPI 래퍼 추가
    ├ rule-based/server.py 작성 (위 §5.1)
    ├ rule-based/requirements.txt 생성 (위 §5.2)
    └ venv 생성 + pip install

[3] 서비스 등록
    ├ /etc/systemd/system/jazzify-rule.service (위 §5.4)
    ├ systemctl enable + start
    └ curl http://127.0.0.1:8002/health 확인

[4] 노출 경로 결정
    ├ Option 1: nginx /rule/ 프록시 → 프론트 직접 호출
    └ Option 2: Spring Boot /v1/analysis/* → 인증 + 캐싱 + 프록시

[5] (선택) RAG 통합
    ├ rag/server.py 에 RULE_BASE_URL 환경변수
    ├ /chat 핸들러에서 rule-based 호출 → chord_context 보강
    └ 효과: agent.decompose_query 의 chord-specific 쿼리 분해 활성화

[6] 프론트 통합
    ├ 사용자 입력 곡 분석 UI (Editor 등) 에서 /rule/analyze 호출
    ├ 결과를 LeadSheetData.systems[].bars[].chords[].analysis 로 매핑
    └ buildChordContext 가 자동으로 그 결과 사용

[7] 검증
    ├ examples/input_example.txt 로 동일 결과 확인 (output_example.json 과 비교)
    ├ pytest tests/ 통과
    └ 사용자 임의 곡 입력 → 분석 결과 LeadSheet 에 반영 확인
```

---

## 9. 체크리스트

### 9.1 백엔드 개발자

- [ ] Python 3.10+ 설치
- [ ] rule-based 디렉토리를 서버에 배치
- [ ] (Option B) `server.py` 작성 + `requirements.txt` 생성
- [ ] (Option B) venv + `pip install -r requirements.txt`
- [ ] (Option B) systemd 서비스 등록 + 동작 확인
- [ ] (Option B) `curl POST http://127.0.0.1:8002/analyze -d '{"text":"Dm7|G7|Cmaj7","key":"C"}'` 로 응답 확인
- [ ] (Option B) Spring Boot 에 RuleEngineProxyController 추가 + 캐싱
- [ ] (Option C) `song_analyses` 테이블 + Entity / Repository / sync 스크립트
- [ ] (RAG 통합 시) rag/server.py 에 `RULE_BASE_URL` 환경변수 + 호출 로직
- [ ] 모니터링: rule-based 호출 수 / latency / 캐시 hit ratio

### 9.2 프론트 개발자

- [ ] 사용자 입력 곡 분석이 필요한 UI (Editor 등) 에서 백엔드 엔드포인트 호출
- [ ] 응답을 `LeadSheetData.systems[].bars[].chords[].analysis` 로 매핑
- [ ] (선택) `harmorag.ts::streamWithRAG` 가 `chord_context` 객체도 같이 보내도록 ([rag/server.py:42](../rag/server.py#L42) 가 받음)

---

## 10. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| `python main.py` 가 ImportError | `sys.path.insert(0, os.path.dirname(__file__))` 확인. 또는 `cd rule-based` 후 실행 |
| `/analyze` 가 항상 빈 chords 반환 | text 파싱 실패. `parse_progression_text` 의 형식 확인 — 마디 구분자 `|`, 공백 분리 |
| `chord.analysis.functions` 가 비어있음 | `key` 가 잘못된 형식. `"C"`, `"Bb"`, `"F#m"` 형식 확인. 마이너는 `m` 접미. |
| 분석은 잘 되는데 RAG 가 chord_context 활용 안 함 | frontend 가 `chord_context_text` 만 보내고 `chord_context` 객체를 안 보냄. harmorag.ts 수정 (위 §5.7 옵션 1) |
| systemd 가 실패 | 로그: `journalctl -u jazzify-rule -f`. 흔한 원인: venv 경로 / WorkingDirectory 불일치 |
| analyze 응답이 느림 (>500ms) | 곡이 매우 길거나, FastAPI cold start. 일반 32마디 곡은 수십 ms 이내 |
| pytest 가 실패 | 엔진 버전 변경 시 expected output 도 같이 갱신해야. `tests/test_*` 파일 확인 |

---

## 11. 부록 A — 모든 핵심 라인 인덱스

| 위치 | 코드 |
|---|---|
| [rule-based/main.py:36](../rule-based/main.py#L36) | `analyze()` — 메인 진입점 |
| [rule-based/main.py:1-30](../rule-based/main.py#L1) | analyzer import 들 (전체 파이프라인 순서) |
| [rule-based/batch.py](../rule-based/batch.py) | 코퍼스 일괄 분석 |
| [rule-based/aggregator.py:114](../rule-based/aggregator.py#L114) | `to_json` — 결과 직렬화 |
| [rule-based/aggregator.py:7](../rule-based/aggregator.py#L7) | `ENGINE_VERSION = "0.1.0"` |
| [rule-based/config_data.py](../rule-based/config_data.py) | PyYAML fallback (function_map, scales, etc.) |
| [rule-based/parsers/text_parser.py](../rule-based/parsers/text_parser.py) | "Dm7 | G7 | ..." 파싱 |
| [rule-based/parsers/ireal_parser.py](../rule-based/parsers/ireal_parser.py) | iReal Pro export 파싱 |
| [rule-based/analyzers/](../rule-based/analyzers/) | 15개 분석 모듈 |
| [rule-based/examples/input_example.txt](../rule-based/examples/input_example.txt) | 입력 예시 |
| [rule-based/examples/output_example.json](../rule-based/examples/output_example.json) | 출력 예시 (전체 JSON 구조) |
| [src/data/leadSheetTypes.ts:35](../src/data/leadSheetTypes.ts#L35) | frontend 의 `analysis` 타입 정의 |
| [src/data/allofme_analysis.json](../src/data/allofme_analysis.json) | rule-based batch 결과 (예시) |
| [src/api/chordContext.ts](../src/api/chordContext.ts) | analysis → human text 직렬화 |
| [rag/agent.py:19](../rag/agent.py#L19) | RAG agent 의 `chord_context` 사용처 — decompose_query |
| [rag/server.py:42](../rag/server.py#L42) | RAG 가 받는 ChatRequest 스키마 (chord_context 필드 있음, 현재 unused) |

---

## 12. 부록 B — 분석 출력 JSON 풀스키마

(자세한 예시는 [output_example.json](../rule-based/examples/output_example.json))

```typescript
interface RuleEngineOutput {
  song: { title: string; key: string; time_signature: string };
  chords: Array<{
    bar: number;
    beat: number;
    symbol: string;             // 원문 코드 ("Dm7", "G7(b9)", "F/A")
    duration_beats: number;
    analysis: {
      root: number;             // 0~11 (C=0)
      root_name: string;        // "C", "Bb", "F#"
      quality: string;          // "min7", "dom7", "maj7", "dim7", "halfdim7", ...
      normalized_quality: string;
      tensions: string[];       // ["b9", "#11"]
      bass: number | null;
      bass_name: string | null;
      degree: string;           // "I", "ii", "V", "bII", "#IV" ...
      is_diatonic: boolean;
      functions: Array<{
        function: "T" | "SD" | "D" | "T_substitute" | "D_mediant" | ...;
        confidence: number;     // 0.0~1.0
        note?: string;          // 설명
      }>;
      secondary_dominant: null | {
        targetDegree: string;   // "ii", "V" 등
        resolved: boolean;
        label?: string;
      };
      group_memberships: Array<{
        group_id: number;
        group_type: "ii-V-I" | "ii-V" | "tritone-sub" | ...;
        role: "ii" | "V" | "I" | "sub" | ...;
        variant: "standard" | "minor" | "tritone_sub" | "backdoor" | "incomplete";
      }>;
      diminished_function: null | "passing" | "auxiliary" | "dominant";
      chromatic_approach: null | { /* ... */ };
      deceptive_resolution: null | { /* ... */ };
      pedal_info: null | { /* ... */ };
      modal_interchange: null | {
        sourceMode: "aeolian" | "dorian" | "phrygian" | "lydian" | "mixolydian";
        confidence: number;
      };
      mode_segment: "ionian" | "dorian" | ...;
      tonicization: null | { /* ... */ };
      ambiguity_flags: string[];
    };
  }>;
  groups: Array<{
    group_id: number;
    group_type: string;
    members: Array<{ bar: number; role: string }>;
    variant: string;
  }>;
  sections: Array<{
    bar_start: number;
    bar_end: number;
    label?: string;
  }>;
  engine_version: string;      // "0.1.0"
  coverage: string[];          // 분석 카테고리 목록
}
```

---

## 13. 부록 C — frontend `LeadSheetData.analysis` 와 rule-based 출력 매핑

frontend 의 `LeadSheetChordAnalysis` ([src/data/leadSheetTypes.ts](../src/data/leadSheetTypes.ts)) 는 rule-based 출력의 부분집합. 매핑:

| rule-based 키 | frontend 키 |
|---|---|
| `analysis.degree` | `analysis.degree` |
| `analysis.is_diatonic` | `analysis.isDiatonic` |
| `analysis.functions[]` | `analysis.functions[]` (`function`, `confidence`, `note`) |
| `analysis.secondary_dominant` | `analysis.secondaryDominant` |
| `analysis.group_memberships[]` | `analysis.groupMemberships[]` |
| `analysis.modal_interchange` | `analysis.modalInterchange` |
| `analysis.diminished_function` | `analysis.diminishedFunction` |
| ... | ... |

→ Python snake_case 를 frontend camelCase 로 변환하는 작은 어댑터가 필요 (자동 변환 라이브러리 또는 수동 매핑).

이 어댑터를 백엔드 (Spring Boot) 에 두면 프론트는 깨끗한 camelCase 만 보면 됨.

---

## 끝

질문 있으면 [@benzity](mailto:hi20021120@gmail.com) 또는 [RAG_BACKEND_INTEGRATION.md](RAG_BACKEND_INTEGRATION.md) / [CLAUDE_BACKEND_INTEGRATION.md](CLAUDE_BACKEND_INTEGRATION.md) 참고.
