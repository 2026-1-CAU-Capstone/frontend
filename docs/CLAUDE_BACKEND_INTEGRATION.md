# Claude API 백엔드 마이그레이션 가이드

> **대상 독자**: 백엔드 개발자 (Spring Boot / Java)
> **목적**: 현재 프론트엔드 브라우저에서 직접 Anthropic Claude API 를 호출하는 코드를 백엔드(Spring Boot) 경유로 이전. **API 키 노출 차단** + **비용/레이트리밋 관리** 가 목적.
> **선행 문서**: [RAG_BACKEND_INTEGRATION.md](RAG_BACKEND_INTEGRATION.md) — RAG 적용 경로의 Claude 호출은 이미 백엔드(`rag/server.py`)에서 처리 중. 본 문서는 **그 외 직접 호출 경로**를 다룬다.

---

## 0. TL;DR

| 항목 | 값 |
|---|---|
| **문제** | [src/api/claude.ts](../src/api/claude.ts) 가 브라우저에서 `https://api.anthropic.com/v1/messages` 를 직접 호출. `VITE_ANTHROPIC_API_KEY` 가 빌드 번들에 박혀 누구나 dev tools 로 추출 가능 |
| **영향 범위** | `claude.ts` (직접 호출), `harmorag.ts` (RAG 서버 폴백에서 `streamClaudeMessage` 호출), 같은 패턴의 `gemini.ts` |
| **현재 사용 시점** | RAG 서버가 죽거나 응답이 없을 때 fallback 으로만 (정상 시엔 RAG 서버가 처리) |
| **해법** | 백엔드(Spring Boot)에 새 엔드포인트 (`POST /v1/chat/stream`) 추가, 그쪽에서 Anthropic API 호출 + 스트리밍 그대로 프론트로 흘림. 프론트는 그쪽으로 호출. 프론트 `.env` 에서 `VITE_ANTHROPIC_API_KEY` 제거 |
| **모델** | `claude-sonnet-4-20250514` (frontend) / `claude-sonnet-4-6` (RAG server) — 통일 필요 |
| **환경 변수** | `ANTHROPIC_API_KEY` (백엔드 서버 환경변수로). 프론트의 `VITE_ANTHROPIC_API_KEY` 는 제거 |
| **스트리밍 방식** | Anthropic SSE → 백엔드가 passthrough → 프론트가 SSE 파싱 (현재 `claude.ts` 의 파싱 로직 그대로 옮기면 됨) |

**왜 시급한가:**
1. **API 키 노출** — `VITE_*` 환경변수는 Vite 가 빌드 시 번들에 **plaintext** 로 박는다. 사이트 방문자 누구나 dev tools 의 Sources 또는 빌드된 `assets/*.js` 에서 키를 추출 가능. 도난당하면 비용 폭탄 + 어뷰즈.
2. **레이트리밋 / 모더레이션 불가** — 사용자 단위 호출 제한, 일일 한도, 부적절 콘텐츠 필터링이 백엔드 없이는 불가.
3. **Anthropic 도 권고** — 코드에 `anthropic-dangerous-direct-browser-access: true` 헤더가 있는 것 자체가 "위험" 경고. 데모/개발용 헤더지 운영용 아님.

---

## 1. 현재 호출 흐름

### 1.1 Claude 호출 두 갈래

```
[프론트엔드]
   │
   ▼
[harmorag.ts::streamWithRAG]
   │
   ├─ checkServer() 성공 (RAG 살아있음)
   │     │
   │     ▼
   │  POST {RAG_SERVER}/chat
   │     │
   │     ▼
   │  [rag/server.py] → Anthropic API 호출 (백엔드 ✅ 이미 OK)
   │
   └─ checkServer() 실패 또는 /chat 에러
         │
         ▼
      streamClaudeMessage(...)  ←─── [src/api/claude.ts]
         │
         ▼
      POST https://api.anthropic.com/v1/messages  ❌ 브라우저 직접
         + x-api-key: VITE_ANTHROPIC_API_KEY
         + anthropic-dangerous-direct-browser-access: true
```

**RAG 적용 경로는 이미 백엔드 처리.** 문제는 **fallback 경로**.

### 1.2 호출 위치 인덱스

| 파일 / 라인 | 역할 |
|---|---|
| [src/api/claude.ts:1](../src/api/claude.ts#L1) | `VITE_ANTHROPIC_API_KEY` 환경변수 읽음 |
| [src/api/claude.ts:2](../src/api/claude.ts#L2) | 모델: `claude-sonnet-4-20250514` (⚠️ rag/server.py 와 불일치) |
| [src/api/claude.ts:3](../src/api/claude.ts#L3) | URL: `https://api.anthropic.com/v1/messages` |
| [src/api/claude.ts:145](../src/api/claude.ts#L145) | `streamClaudeMessage` — 본체 |
| [src/api/claude.ts:184-193](../src/api/claude.ts#L184) | `fetch` + SSE 헤더 |
| [src/api/claude.ts:210-237](../src/api/claude.ts#L210) | SSE 파싱 루프 (`data: {...}` → `delta.text`) |
| [src/api/harmorag.ts:107](../src/api/harmorag.ts#L107) | fallback 호출 (RAG 서버 죽음) |
| [src/api/harmorag.ts:189](../src/api/harmorag.ts#L189) | fallback 호출 (RAG `/chat` 에러) |
| [src/api/gemini.ts:1-3](../src/api/gemini.ts#L1) | Gemini 도 같은 패턴 (`VITE_GEMINI_API_KEY`) |

### 1.3 system 프롬프트 / chord chart 출력 규칙

[claude.ts:10-54](../src/api/claude.ts#L10) 의 `BASE_SYSTEM` — 약 50줄짜리 system 프롬프트. **chord chart JSON 펜스 블록(```chart) 출력 규칙**과 **섹션 라벨 `[SEC:X]` 트랜스폼** 포함. 이걸 백엔드에서도 그대로 사용해야 프론트 렌더링이 깨지지 않는다.

`rag/server.py` 의 `BASE_SYSTEM` ([rag/server.py:50-103](../rag/server.py#L50)) 과 거의 동일한 내용 — **백엔드로 옮길 때 두 곳 중 한 곳으로 single source of truth 화 권장**.

### 1.4 카테고리별 system 프롬프트

[claude.ts:56-132](../src/api/claude.ts#L56) 의 `ANALYSIS_CATEGORIES` — 6개 카테고리 (`overview`, `functional`, `iiVI`, `secondary`, `modal`, `improv`). 각 카테고리마다 `prompt` 가 BASE_SYSTEM 에 append 됨.

이 카테고리 시스템은 프론트가 `category` 파라미터로 백엔드에 전달하는 형식으로 옮긴다. 또는 프론트가 직접 prompt 문자열을 만들어서 전송하는 식으로 단순화 가능.

---

## 2. 영향 받는 파일

| 파일 | 변경 내용 |
|---|---|
| [src/api/claude.ts](../src/api/claude.ts) | **완전 재작성** — Anthropic 직접 호출 제거, 백엔드 endpoint 로 fetch. system 프롬프트는 백엔드로 이동 (또는 프론트가 category 만 전달) |
| [src/api/harmorag.ts](../src/api/harmorag.ts) | fallback 의 `streamClaudeMessage(...)` 호출은 그대로 두되, 그 함수가 백엔드로 가게 되므로 자연스럽게 안전 |
| [src/api/gemini.ts](../src/api/gemini.ts) | **선택** — 같이 마이그레이션할지 결정. 현재 어디서 호출되는지 확인 필요 (메모 §8 참고) |
| `.env` (프론트) | `VITE_ANTHROPIC_API_KEY` **제거**. `VITE_GEMINI_API_KEY` 도 (마이그레이션 결정 시) |
| 백엔드 (Spring Boot) | **신규** — `/v1/chat/stream` 엔드포인트 + Anthropic 호출 service + SSE passthrough |
| 백엔드 `.env` / config | `ANTHROPIC_API_KEY` 추가 (기존 RAG `.env` 와 공유 가능) |

---

## 3. 아키텍처

### 3.1 현재

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│                                                              │
│  RAG 서버 살아있음    ──→  POST {RAG_SERVER}/chat            │
│  RAG 서버 죽음 (fallback)                                    │
│      └──→ ❌ POST https://api.anthropic.com  (API key 노출)  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 목표

```
┌──────────────────────────────────────────────────────────────┐
│  Browser                                                      │
│                                                               │
│  RAG 서버 살아있음    ──→ POST {RAG_BASE}/chat                │
│  RAG 서버 죽음 (fallback)                                     │
│      └──→ POST https://jazzify.p-e.kr/v1/chat/stream  ✅      │
│                                                               │
└──────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                  ┌────────────────────────────────┐
                  │  Spring Boot                   │
                  │  /v1/chat/stream               │
                  │  • 인증 / 레이트리밋 가드        │
                  │  • system 프롬프트 조립          │
                  │  • Anthropic API 호출 (SSE)    │
                  │  • SSE passthrough → 프론트    │
                  └────────────────────────────────┘
                                  │
                                  ▼
                       Anthropic API
                       (key = 백엔드 .env)
```

**핵심 효과:**
- API 키가 백엔드 환경변수에만 존재. 브라우저 번들에서 사라짐
- 모든 호출이 백엔드 인증 미들웨어를 통과 — 로그인 안 한 사용자 차단 가능
- 사용자 단위 레이트리밋, 일일 한도, 사용량 메트릭 적용 가능

---

## 4. 마이그레이션 옵션

세 가지 옵션. 가장 추천: **Option A**.

| 옵션 | 어디서 호출 | 작업량 | 운영 |
|---|---|---|---|
| **A (추천)** | Spring Boot 에 신규 `/v1/chat/stream` | 중간 | 게이트웨이 일원화, 인증/로깅 통합 |
| **B** | RAG 서버에 `/chat-direct` 추가 | 소 | RAG 서버 죽으면 fallback 도 죽음 (단일 장애점) |
| **C** | Spring Boot 가 RAG 서버에 /chat-direct 프록시 | 중간 | A 의 인증 + B 의 코드 위치. 호출 두 단계 |

**왜 A 추천?**
- LLM 호출의 단일 진입점이 Spring Boot. 인증/레이트리밋/사용량 로깅 모두 한 곳.
- 운영 분리: RAG 서버는 검색 + RAG-적용 응답만, Spring Boot 는 일반 채팅. RAG 죽어도 일반 chat 은 살아있음.
- Spring Boot 의 인증 체계(`/v1/auth/*`)와 자연스럽게 통합.

**B 가 유리한 경우:** 빠른 임시 조치만 필요하고 RAG 서버 가용성이 충분히 높을 때. 코드 두 줄만 바꾸면 됨.

이하 본문은 **Option A** 기준. B/C 는 §10 참고.

---

## 5. 백엔드 새 엔드포인트 스펙

### 5.1 엔드포인트

```
POST /v1/chat/stream
Content-Type: application/json
Authorization: Bearer <accessToken>   ← 옵션. 비로그인 허용/차단 정책에 따라

Request body:
{
  "message":      "F7 위에서 어떻게 솔로해?",
  "history":      [
    { "role": "user",      "content": "이 곡 분석해줘" },
    { "role": "assistant", "content": "..." }
  ],
  "chordContext": "Eb 키의 II7 코드. 다음 코드는 Fm7. ...",   // optional
  "category":     "improv",                                  // optional, 6개 enum 중 하나
  "songTitle":    "It Could Happen to You"                   // optional
}

Response:
Content-Type: text/event-stream  (또는 text/plain — 현재 rag/server.py 와 통일하려면 text/plain)
Transfer-Encoding: chunked
Cache-Control: no-cache

data: {"type":"text", "text":"F7는 "}
data: {"type":"text", "text":"II7 코드로 "}
...
data: {"type":"done"}
```

> **응답 형식 선택**:
> - **(a) Anthropic SSE 그대로 passthrough** — `event: content_block_delta\ndata: {"delta":{"text":"..."}}` 형식. 프론트 파싱 코드는 [claude.ts:222-236](../src/api/claude.ts#L222) 의 SSE 파서를 그대로 사용 가능.
> - **(b) 단순화 — 토큰만** — `text/plain` 으로 token 만 흘림. rag/server.py 가 이렇게 함. 프론트는 그냥 `reader.read()` 텍스트 누적.
>
> **(b) 추천** — rag/server.py 와 응답 형식이 통일되어 프론트의 두 fallback 분기가 같은 파서를 쓸 수 있다.

### 5.2 카테고리 enum

프론트가 보내는 `category` 값. 백엔드에서 system prompt 조립에 사용:

```kotlin
enum class AnalysisCategory(val prompt: String) {
    OVERVIEW("Provide a concise overview of this chord progression..."),
    FUNCTIONAL("Analyze the functional harmony of this progression..."),
    II_V_I("Identify and explain all ii-V-I patterns..."),
    SECONDARY("Analyze all secondary dominants and dominant chains..."),
    MODAL("Analyze modal interchange and borrowed chords..."),
    IMPROV("Give practical improvisation advice for this progression..."),
}
```

각 카테고리의 `prompt` 본문은 [claude.ts:64-132](../src/api/claude.ts#L64) 에서 복사. 정확히 같은 텍스트를 옮겨야 응답 품질 유지.

### 5.3 system prompt 조립

[claude.ts:10-54](../src/api/claude.ts#L10) 의 `BASE_SYSTEM` 을 그대로 옮긴 뒤:

```kotlin
fun buildSystem(category: AnalysisCategory?, hasChordContext: Boolean): String {
    val parts = mutableListOf<String>()
    parts.add(BASE_SYSTEM)
    if (category != null) {
        parts.add("\n\n[Analysis Focus: ${category.label}]\n${category.prompt}")
    }
    if (hasChordContext) {
        parts.add(
            "\n\n[CONTEXT NOTE] The user is currently viewing the chord chart " +
            "referenced in the [Chord Analysis Context] above. Do NOT emit a " +
            "```chart fenced block for THIS song — they can already see it on " +
            "screen. You may still use ```chart blocks for OTHER songs you reference."
        )
    }
    return parts.joinToString("")
}
```

### 5.4 user 메시지 조립

[claude.ts:158-165](../src/api/claude.ts#L158) 와 동일:

```kotlin
val userContent = buildString {
    if (!chordContext.isNullOrBlank()) {
        append("[Chord Analysis Context]\n")
        append(chordContext)
        append("\n\n[User Question]\n")
    }
    append(message)
}
val messages = history + ChatMessage(role = "user", content = userContent)
```

### 5.5 Anthropic 호출 (Java SDK 기준)

[anthropic-java](https://github.com/anthropics/anthropic-sdk-java) 공식 SDK 또는 raw HTTP. SDK 가 스트리밍 처리 단순함.

**의존성 추가 (Gradle):**
```kotlin
dependencies {
    implementation("com.anthropic:anthropic-java:0.x.x")  // 최신 버전 확인
}
```

**Service:**
```kotlin
@Service
class ClaudeService(
    @Value("\${anthropic.api-key}") private val apiKey: String,
    @Value("\${anthropic.model:claude-sonnet-4-6}") private val model: String,
) {
    private val client = AnthropicOkHttpClient.builder().apiKey(apiKey).build()

    fun streamMessage(
        system: String,
        messages: List<ChatMessage>,
        maxTokens: Int = 16384,
    ): Flux<String> = Flux.create { sink ->
        val params = MessageCreateParams.builder()
            .model(model)
            .maxTokens(maxTokens.toLong())
            .system(system)
            .messages(messages.map { it.toAnthropic() })
            .build()

        try {
            client.messages().createStreaming(params).use { stream ->
                stream.stream().forEach { event ->
                    val delta = event.contentBlockDelta()
                        .flatMap { it.delta().text() }
                        .map { it.text() }
                    if (delta.isPresent) sink.next(delta.get())
                }
                sink.complete()
            }
        } catch (e: Exception) {
            sink.error(e)
        }
    }
}
```

**Controller:**
```kotlin
@RestController
@RequestMapping("/v1/chat")
class ChatController(
    private val claudeService: ClaudeService,
) {
    @PostMapping("/stream", produces = [MediaType.TEXT_PLAIN_VALUE])
    fun stream(
        @AuthenticationPrincipal user: CustomPrincipal?,
        @RequestBody req: ChatStreamRequest,
    ): Flux<String> {
        val system = buildSystem(req.category, !req.chordContext.isNullOrBlank())
        val userContent = buildUserContent(req.message, req.chordContext)
        val messages = req.history + ChatMessage("user", userContent)
        return claudeService.streamMessage(system, messages)
    }
}

data class ChatStreamRequest(
    val message: String,
    val history: List<ChatMessage> = emptyList(),
    val chordContext: String? = null,
    val category: AnalysisCategory? = null,
    val songTitle: String? = null,
)
data class ChatMessage(val role: String, val content: String)
```

### 5.6 application.yml

```yaml
anthropic:
  api-key: ${ANTHROPIC_API_KEY}      # 환경변수 또는 secret manager
  model: claude-sonnet-4-6           # 통일된 모델명 (rag/server.py 와 동일)
```

`ANTHROPIC_API_KEY` 는 systemd EnvironmentFile 또는 K8s secret 으로 주입. **코드 / yaml 에 직접 박지 말 것.**

### 5.7 인증 정책

| 정책 | 설명 |
|---|---|
| **로그인 사용자만** | `@AuthenticationPrincipal CustomPrincipal` 을 `nonNull` 로 → 비로그인은 401. 비용 통제에 유리 |
| **익명 허용 + 레이트리밋** | IP 기반 레이트리밋 (예: Bucket4j) — 비로그인 사용자도 시연용 호출 가능, 단 분당 N 회 |
| **혼합** | 비로그인은 분당 3회, 로그인은 분당 30회 등 |

> 현재 프론트는 비로그인도 채팅 가능한 흐름 — 단기적으론 **혼합** 정책 추천. 장기적으론 모든 LLM 호출 = 로그인 필수.

### 5.8 레이트리밋 (Bucket4j 예시)

```kotlin
@Component
class RateLimitFilter(
    private val redis: RedisTemplate<String, String>,
) : Filter {
    private val proxyManager = LettuceBasedProxyManager(redis.connectionFactory.reactiveConnection)
    private val limit = Bandwidth.simple(30, Duration.ofMinutes(1))

    override fun doFilter(req: ServletRequest, res: ServletResponse, chain: FilterChain) {
        val httpReq = req as HttpServletRequest
        if (!httpReq.requestURI.startsWith("/v1/chat/")) {
            chain.doFilter(req, res); return
        }
        val key = (httpReq.userPrincipal?.name ?: httpReq.remoteAddr).let { "ratelimit:chat:$it" }
        val bucket = proxyManager.builder().build(key) { Bucket.builder().addLimit(limit).build() }
        if (bucket.tryConsume(1)) chain.doFilter(req, res)
        else (res as HttpServletResponse).sendError(429, "Too Many Requests")
    }
}
```

---

## 6. 스트리밍 (passthrough) 처리

### 6.1 Spring Boot 측

위 §5.5 의 `Flux<String>` 가 Spring WebFlux 의 reactive stream. Servlet 기반(Spring MVC)이라면:

```kotlin
@GetMapping("/stream", produces = [MediaType.TEXT_PLAIN_VALUE])
fun stream(...): ResponseEntity<StreamingResponseBody> {
    val body = StreamingResponseBody { out ->
        claudeService.streamMessageBlocking(system, messages) { token ->
            out.write(token.toByteArray(StandardCharsets.UTF_8))
            out.flush()
        }
    }
    return ResponseEntity.ok()
        .contentType(MediaType.TEXT_PLAIN)
        .body(body)
}
```

**중요 — 버퍼링 제거**:
- Spring Boot 자체 버퍼링 OK (작은 chunk).
- 앞단 **nginx 의 `proxy_buffering off`** 필수 ([RAG 문서 §4.6](RAG_BACKEND_INTEGRATION.md#46-nginx-프록시-옵션-1--가장-단순)).
- 응답 헤더에 `X-Accel-Buffering: no` 추가하면 nginx 가 명시적으로 버퍼링 끔.

```kotlin
.header("X-Accel-Buffering", "no")
.header("Cache-Control", "no-cache, no-transform")
```

### 6.2 프론트 측 (변경 후)

[src/api/claude.ts](../src/api/claude.ts) 재작성:

```ts
const BACKEND_BASE = (import.meta.env.VITE_API_BASE as string)
  || 'https://jazzify.p-e.kr';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AnalysisCategory =
  | 'overview' | 'functional' | 'iiVI' | 'secondary' | 'modal' | 'improv';

export async function streamClaudeMessage(
  userMessage: string,
  history: ClaudeMessage[],
  chordContext: string | undefined,
  onChunk: (accumulated: string) => void,
  category?: AnalysisCategory,
): Promise<string> {
  const res = await fetch(`${BACKEND_BASE}/v1/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Authorization: `Bearer ${accessToken}` ← auth 도입 시 추가
    },
    body: JSON.stringify({
      message: userMessage,
      history,
      chordContext,
      category,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    const msg = `[API Error ${res.status}] ${err}`;
    onChunk(msg);
    return msg;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const msg = '[Error] No response stream';
    onChunk(msg);
    return msg;
  }

  const decoder = new TextDecoder();
  let accumulated = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    accumulated += decoder.decode(value, { stream: true });
    onChunk(accumulated);
  }
  return accumulated || '[No response]';
}
```

**제거되는 코드:**
- `ANTHROPIC_API_KEY`, `API_URL`, `MODEL` 상수
- `BASE_SYSTEM`, `ANALYSIS_CATEGORIES`, `getSystemInstruction` — **백엔드로 이동** (또는 백엔드 single source of truth)
- SSE 파싱 루프 — 단순 byte stream 으로 단순화

**보존하는 export:**
- `ClaudeMessage` 타입 (호출자 호환)
- `streamClaudeMessage` 함수 시그니처 (호출자 호환)
- `AnalysisCategory` 타입

### 6.3 응답 형식 통일

| 경로 | 현재 응답 | 변경 후 |
|---|---|---|
| RAG `/chat` (rag/server.py) | `text/plain` + `\x00RAG_DEBUG\x00...` prefix | (그대로 유지) |
| 신규 `/v1/chat/stream` | — | `text/plain` 단순 토큰 스트림 (RAG_DEBUG prefix 없음) |

→ 프론트의 `harmorag.ts` 는 RAG 응답일 때만 RAG_DEBUG 파싱, fallback 응답일 때는 그냥 누적 — 현재 코드 그대로 동작.

---

## 7. 환경 변수 정리

### 7.1 백엔드 서버

| 변수 | 값 | 비고 |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Spring Boot + RAG 서버 공유 가능 |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | (옵션) 모델 변경 시 |
| RAG 서비스의 기존 `VITE_ANTHROPIC_API_KEY` | → `ANTHROPIC_API_KEY` 로 이름 변경 권장 ([rag/server.py:35](../rag/server.py#L35) 수정) | 동일 키 |

### 7.2 프론트

| 변수 | 변경 |
|---|---|
| `VITE_ANTHROPIC_API_KEY` | **삭제** |
| `VITE_GEMINI_API_KEY` | (Gemini 마이그레이션 같이 하면) **삭제** |
| `VITE_API_BASE` 또는 `VITE_BACKEND_URL` | **신규** — 백엔드 base URL (예: `https://jazzify.p-e.kr`) |
| `VITE_RAG_BASE` | (기존) RAG 서버 URL — 그대로 유지 |

### 7.3 빌드 후 검증

배포 빌드 후 번들에서 옛 API 키가 진짜 사라졌는지 확인:
```bash
grep -r "sk-ant-" dist/ 2>/dev/null    # 결과 없어야 OK
grep -r "VITE_ANTHROPIC_API_KEY" dist/ 2>/dev/null   # 결과 없어야 OK
```

번들 안에 키가 남아있으면 마이그레이션 미완 — 어느 import 가 여전히 환경변수를 참조 중인지 grep.

---

## 8. Gemini 도 같이?

[src/api/gemini.ts](../src/api/gemini.ts) 도 동일한 패턴 (`VITE_GEMINI_API_KEY` 직접 호출). Claude 와 같은 보안 문제.

**호출 위치 확인:**
```bash
grep -rn "streamGemini\|from.*api/gemini" src/
```

**현재로선 RAG/harmorag fallback 경로에서 Gemini 는 사용되지 않음 (Claude 만 fallback)** — 즉 Gemini 가 정말 사용 중인지부터 확인. 사용 안 되면 파일 자체 삭제.

**사용 중이면**: 같은 방식으로 백엔드 `/v1/chat/stream-gemini` 또는 단일 `/v1/chat/stream?provider=gemini` 로 통합. Google Generative Language API 의 SSE 도 비슷한 형식이라 같은 패턴 재사용 가능.

---

## 9. 모델 통일

| 위치 | 현재 모델 |
|---|---|
| `rag/server.py:147` | `claude-sonnet-4-6` |
| `src/api/claude.ts:2` | `claude-sonnet-4-20250514` |

**서로 다름.** 어느 응답이 어느 모델인지 사용자가 알기 어렵고, 동작/품질도 다를 수 있음. 마이그레이션 시 한 곳으로 통일 — **백엔드 환경변수 `ANTHROPIC_MODEL` 하나에서 결정** 권장.

`claude-sonnet-4-6` 가 더 최신 (Sonnet 4.6, 2025-09 출시). 그쪽으로 통일 권장.

---

## 10. 옵션 B / C — 대안 자세히

### 10.1 Option B: RAG 서버에 `/chat-direct` 추가

가장 작은 변경. [rag/server.py](../rag/server.py) 에 엔드포인트 한 개 추가:

```python
@app.post("/chat-direct")
async def chat_direct(req: ChatRequest):
    """RAG 컨텍스트 없이 Claude 만 호출. 프론트 fallback 용."""
    system = BASE_SYSTEM
    if req.song_title:
        system += f"\n\n현재 분석 중인 곡: {req.song_title}"
    if req.chord_context_text:
        system += f"\n\n[Rule-based 분석 결과]\n{req.chord_context_text}"

    def stream():
        with claude.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=16384,
            system=system,
            messages=req.history + [{"role": "user", "content": req.message}],
        ) as stream_obj:
            for text in stream_obj.text_stream:
                yield text

    return StreamingResponse(stream(), media_type="text/plain")
```

프론트의 `claude.ts` 는 `${RAG_BASE}/chat-direct` 로 호출.

**장점:** 변경 최소.
**단점:** RAG 서버 죽으면 fallback 도 죽음. Spring Boot 의 인증 체계와 분리.

### 10.2 Option C: Spring Boot 가 RAG 서버 `/chat-direct` 로 프록시

위 B + Spring Boot 가 인증 가드 + 프록시:

```kotlin
@RestController @RequestMapping("/v1/chat")
class ChatProxyController(@Value("\${rag.base-url}") private val ragUrl: String) {
    @PostMapping("/stream")
    fun stream(@AuthenticationPrincipal user: CustomPrincipal, @RequestBody body: Map<String, Any?>) =
        WebClient.create()
            .post().uri("$ragUrl/chat-direct").bodyValue(body)
            .retrieve().bodyToFlux(DataBuffer::class.java)
}
```

**장점:** 인증 게이트 + 코드는 한 곳 (RAG 서버).
**단점:** 호출이 두 hop. 그래도 internal 호출이라 부하는 적음.

---

## 11. 마이그레이션 절차 (Option A 기준)

```
[1] 백엔드 작업
    ├ Anthropic Java SDK 의존성 추가
    ├ application.yml + ANTHROPIC_API_KEY 환경변수
    ├ ChatStreamRequest DTO + ClaudeService + ChatController 구현
    ├ system prompt 상수 (BASE_SYSTEM + CATEGORY_PROMPTS) 복사
    ├ 인증 / 레이트리밋 정책 적용
    └ 스트리밍 동작 + 버퍼링 off 확인 (curl 로 streaming 확인)

[2] 프론트 작업
    ├ src/api/claude.ts 재작성 (백엔드 endpoint 호출로)
    ├ 함수 시그니처 그대로 (streamClaudeMessage) → harmorag.ts 무수정
    ├ .env 에서 VITE_ANTHROPIC_API_KEY 제거
    ├ VITE_API_BASE 또는 VITE_BACKEND_URL 환경변수 추가
    └ 빌드 → dist 에서 'sk-ant-' grep 없는지 확인

[3] 동작 검증
    ├ RAG 서버 죽인 상태에서 채팅 → fallback 으로 백엔드 endpoint 호출 확인
    ├ 카테고리별 (overview/functional/iiVI/secondary/modal/improv) 응답 확인
    ├ chord chart (```chart 펜스) 정상 렌더링
    ├ 섹션 라벨 [SEC:X] 정상 트랜스폼
    └ 스트리밍이 토큰 단위로 도착 (한 번에 모이지 않음)

[4] 키 회전 (선택, 보안 강화)
    └ 마이그레이션 완료 + 배포 후, Anthropic 콘솔에서 옛 API 키 revoke + 새 키 발급
       → 옛 빌드를 캐시한 브라우저가 옛 키로 호출 시도해도 차단됨

[5] gemini.ts 처리
    ├ 호출 위치 확인
    ├ 사용 중이면 같은 패턴으로 마이그레이션 또는 Claude 로 통합
    └ 사용 안 하면 파일 + dependency 삭제
```

---

## 12. 체크리스트

### 12.1 백엔드 개발자

- [ ] `ANTHROPIC_API_KEY` 를 환경변수 / secret manager 에 등록
- [ ] Anthropic Java SDK 의존성 추가 (또는 raw `WebClient` 로 직접 호출)
- [ ] `ClaudeService.streamMessage(system, messages)` 구현 + 스트리밍 동작 확인
- [ ] `POST /v1/chat/stream` controller 추가
- [ ] `BASE_SYSTEM` + `ANALYSIS_CATEGORIES` 6개 prompt 를 [claude.ts:10-132](../src/api/claude.ts#L10) 에서 그대로 복사
- [ ] `[CONTEXT NOTE]` suffix 로직 ([claude.ts:172-174](../src/api/claude.ts#L172)) 포함
- [ ] user content 조립 (chordContext 있으면 `[Chord Analysis Context]` prefix) ([claude.ts:158-165](../src/api/claude.ts#L158))
- [ ] 인증 / 레이트리밋 정책 결정 + 적용
- [ ] nginx `proxy_buffering off` + `X-Accel-Buffering: no` 헤더 (스트리밍 보존)
- [ ] curl 로 스트리밍 동작 확인:
  ```bash
  curl -N -X POST https://jazzify.p-e.kr/v1/chat/stream \
    -H 'Content-Type: application/json' \
    -d '{"message":"안녕"}'
  # → 토큰이 한 글자씩 나와야 OK. 한 덩어리로 오면 버퍼링 문제
  ```

### 12.2 프론트 개발자

- [ ] [src/api/claude.ts](../src/api/claude.ts) 재작성 (위 §6.2 코드)
- [ ] `streamClaudeMessage` 함수 시그니처 보존 (호출자 [harmorag.ts:107, 189](../src/api/harmorag.ts#L107) 무수정)
- [ ] `VITE_API_BASE` 환경변수 사용 (운영/개발/스테이징 분리)
- [ ] `.env` 에서 `VITE_ANTHROPIC_API_KEY` 제거
- [ ] 빌드 후 `grep -r "sk-ant-\|VITE_ANTHROPIC" dist/` 결과 없음 확인
- [ ] 로컬에서 RAG 서버 죽이고 채팅 테스트 → 새 백엔드 endpoint 호출 확인 (Network 탭)
- [ ] 카테고리별 호출 (`category: 'improv'` 등) 동작 확인
- [ ] chord chart 펜스 블록 / `[SEC:X]` 정상 렌더링

### 12.3 운영

- [ ] 옛 Anthropic API 키 revoke (마이그레이션 완료 후)
- [ ] 사용량 메트릭 대시보드 (백엔드에서 `/v1/chat/stream` 호출 수 / 사용자별 / 일별)
- [ ] 비용 알람 (Anthropic 콘솔의 Spend Limit)
- [ ] 로그에 prompt 전체가 박히지 않도록 (개인정보 노출 방지) — system 은 OK, user message 는 truncate

---

## 13. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 응답이 한꺼번에 도착 (스트리밍 X) | nginx `proxy_buffering on` 또는 Spring 의 ResponseEntity 가 응답을 모음. §6.1 의 헤더 / 설정 확인 |
| 401 / 403 | Spring Security 가드가 비로그인 차단 중. 정책 확인 |
| 429 | 레이트리밋 트리거. Bucket4j 의 limit 조정 또는 사용자가 너무 빠르게 호출 |
| 응답에 chord chart 가 안 나옴 | system prompt 가 잘림 / `BASE_SYSTEM` 복사 누락. [claude.ts:10-54](../src/api/claude.ts#L10) 와 비교 |
| `[SEC:X]` 가 본문에 그대로 출력 | 프론트 렌더링 컴포넌트가 트랜스폼 안 함. claude.ts 의 출력은 그대로 BASE_SYSTEM 따라가므로 백엔드도 같은 규칙이면 OK |
| 일부 사용자에게 카테고리별 응답이 일관성 없음 | `ANALYSIS_CATEGORIES` 의 prompt 복사 누락. 6개 모두 정확히 복사 확인 |
| Anthropic 401 | `ANTHROPIC_API_KEY` 누락 / 만료. application.yml + 환경변수 확인 |
| 응답이 잘림 (max_tokens 초과) | 현재 16384. 더 늘리려면 응답 latency 도 같이 증가 — 트레이드오프 |

---

## 14. 보안 추가 메모

### 14.1 왜 브라우저 호출이 위험한가

```
Vite build:
  src/api/claude.ts
    const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY
                              ↓
  dist/assets/index-CRnPHXba.js
    const ANTHROPIC_API_KEY = "sk-ant-xxxxxxxxxxxxxxxx";  ← plaintext
```

배포된 사이트의 dev tools → Sources → `assets/index-*.js` 검색 → 키 추출 → 본인 앱에서 사용. **누구나 가능.**

`anthropic-dangerous-direct-browser-access: true` 헤더는 이 행위가 위험함을 SDK 가 명시적으로 표시하기 위한 것. 운영용 안 됨.

### 14.2 백엔드 이전의 효과

- 키는 서버 환경변수에만 → 외부 노출 불가
- 모든 호출이 인증 → 비로그인 어뷰즈 차단
- 레이트리밋 / 사용량 모니터링
- 비용 추적 가능

### 14.3 추가 권장

- **로깅**: 어느 사용자가 어느 prompt 를 보냈는지 (필요 시 truncated)
- **콘텐츠 필터링**: 욕설/스팸 prompt 차단 (선택)
- **CORS**: `/v1/chat/stream` 은 프론트 origin 만 허용
- **CSRF**: SameSite 쿠키 또는 별도 토큰

---

## 부록 A — 모든 핵심 라인 인덱스

| 위치 | 코드 |
|---|---|
| [src/api/claude.ts:1](../src/api/claude.ts#L1) | API 키 환경변수 |
| [src/api/claude.ts:2](../src/api/claude.ts#L2) | 모델명 (⚠️ rag/server.py 와 불일치) |
| [src/api/claude.ts:3](../src/api/claude.ts#L3) | Anthropic URL |
| [src/api/claude.ts:10-54](../src/api/claude.ts#L10) | `BASE_SYSTEM` |
| [src/api/claude.ts:64-132](../src/api/claude.ts#L64) | `ANALYSIS_CATEGORIES` (6개) |
| [src/api/claude.ts:134-139](../src/api/claude.ts#L134) | `getSystemInstruction` |
| [src/api/claude.ts:145-240](../src/api/claude.ts#L145) | `streamClaudeMessage` 본체 (SSE 파싱 포함) |
| [src/api/harmorag.ts:107](../src/api/harmorag.ts#L107) | fallback 호출 (서버 죽음) |
| [src/api/harmorag.ts:189](../src/api/harmorag.ts#L189) | fallback 호출 (서버 에러) |
| [rag/server.py:35](../rag/server.py#L35) | RAG 서버의 API 키 (이름 통일 필요) |
| [rag/server.py:50-103](../rag/server.py#L50) | RAG 서버의 BASE_SYSTEM (claude.ts 와 거의 동일) |
| [rag/server.py:147](../rag/server.py#L147) | RAG 서버의 모델명 |
| [src/api/gemini.ts](../src/api/gemini.ts) | Gemini 도 동일 패턴 (필요 시 같이 마이그레이션) |

---

## 끝

질문 있으면 [@benzity](mailto:hi20021120@gmail.com) 또는 [RAG_BACKEND_INTEGRATION.md](RAG_BACKEND_INTEGRATION.md) 참고.
