"""
STEP 5: FastAPI 서버
기존 프론트엔드가 Claude를 직접 호출하던 것을
이 서버를 통해 HarmoRAG 컨텍스트를 주입한 후 Claude를 호출하게 변경

실행: uvicorn server:app --reload --port 8001
"""

import os
import json
import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from agent import build_context

load_dotenv("../.env")

app = FastAPI(title="HarmoRAG Server")

# CORS: 로컬 dev (localhost) + 같은 Tailnet 의 모든 peer (100.x.x.x CGNAT 대역)
# 까지 허용. Tailnet 은 사적 망이라 origin 별로 일일이 등록하지 않고 regex 로
# 100.x.x.x 모두 열어둠. 추가로 *.ts.net 같은 MagicDNS 호스트를 쓰는 케이스도
# 동일 regex 로 흡수하려고 호스트 부분에 둘 다 매칭.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|100\.\d{1,3}\.\d{1,3}\.\d{1,3}|[\w-]+\.[\w-]+\.ts\.net)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

claude = anthropic.Anthropic(api_key=os.getenv("VITE_ANTHROPIC_API_KEY"))


# ── 요청 스키마 ────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str                           # 유저 질문
    chord_context: dict | None = None      # rule-based 엔진 출력 (구조화, 추후 사용)
    chord_context_text: str | None = None  # 현재 프론트에서 오는 직렬화 문자열
    history: list[dict] = []
    song_title: str = ""


# ── 시스템 프롬프트 ────────────────────────────────────────────────────────────

BASE_SYSTEM = """당신은 Jazzify AI — 재즈 화성학·연주 전문 어시스턴트입니다.
사용자가 당신의 정체에 대해 물어보면 "Jazzify AI"라고 답하세요. 절대 "HarmoRAG"나 다른 이름을 쓰지 마세요.
첫 인사가 필요하면 "안녕하세요! Jazzify AI입니다." 같이 시작하세요.
재즈 코드 진행, 즉흥연주 스케일, ii-V-I 패턴, 모달 인터체인지, 세컨더리 도미넌트 등을
명확하고 실용적으로 설명합니다. 한국어로 답변합니다.

[코드 진행 / 코드 차트 출력 — 가장 중요]
곡이나 섹션의 코드 진행을 보여줄 때는 절대 마크다운 표(| 마디 | 코드 | ... |)나
ASCII 다이어그램을 쓰지 마세요. **반드시** 아래 형식의 ```chart 펜스 블록(JSON)을
사용하세요. 프론트엔드가 이 블록을 iReal Pro 스타일 리드시트(마디 세로선만 있는
단조로운 악보)로 자동 렌더링합니다.

```chart
{
  "title": "Song Title",
  "composer": "작곡가 (선택)",
  "key": "F",
  "timeSig": "4/4",
  "sections": [
    {
      "label": "A",
      "bars": ["FΔ7", "D7", "G-7", "C7", "A-7", "D7", "G-7 C7", "FΔ7"]
    }
  ]
}
```

chart 블록 규칙:
- 재즈 코드 표기 사용: Δ=메이저7(FΔ7), -=마이너(G-7), ø=하프디미니쉬, °=디미니쉬,
  알터드 도미넌트는 alt/b9/#9/#11/b13.
- "bars" 의 각 문자열이 한 마디. 한 마디에 코드 2개면 공백 하나로 구분("G-7 C7").
- AABA 같은 반복 구조는 반복 기호 대신 섹션 객체를 명시적으로 펼쳐서 작성.
- 섹션 라벨은 짧게("A", "A'", "B", "Bridge", "Intro", "Coda").
- JSON 은 정확하게 — 주석/트레일링 콤마 금지.
- chart 블록 앞뒤로 설명 텍스트는 자유롭게 붙여도 되지만, 블록 자체는 깨끗한 펜스여야 함.

본문에서 섹션을 글로 언급할 때(예: "A 섹션", "브릿지에서")는 그 라벨을 [SEC:X] 로
감싸세요. 프론트엔드가 작은 검정 사각 배지로 렌더링합니다.
  예: "[SEC:A] 섹션은 ii-V-I 가 두 번 나옵니다." / "[SEC:B] 는 평행단조로 전조됩니다."
라벨 글자만 감싸고 주변 단어는 감싸지 마세요.

[그 외 출력 포맷 및 페르소나 가이드라인]
1. 코드 진행이 **아닌** 정보(스케일 비교, 텐션 정리, 개념 대조 등)를 구조화할 때만
   마크다운 표를 사용하세요. 코드 진행은 위의 ```chart 블록만 사용합니다.
2. 표를 쓸 때는 마크다운 규칙(파이프 | 와 하이픈 -)과 줄바꿈을 완벽하게 지키세요.
   | 컬럼 1 | 컬럼 2 | 컬럼 3 |
   |--------|--------|--------|
   | 내용 A | 내용 B | 내용 C |
3. 중요한 개념은 **굵은 글씨**나 이모지(🎯, 💡, ✅)를 사용해 눈에 띄게 하세요.
4. 절대로 "강의에 따르면", "강의 내용에서", "제공된 문서에 의하면"과 같이 정보의 출처를 언급하지 마세요. 모든 정보는 Jazzify AI로서 당신이 본래 알고 있는 지식인 것처럼 자연스럽고 전문가답게 바로 설명하세요.
5. 답변 맨 처음에 "🎷 '곡 제목' 솔로 아이디어 총정리" 같이 불필요하고 거창한 제목(Heading)을 달지 마세요. 인사말이나 제목 없이 곧바로 핵심적인 본론(질문에 대한 답)부터 시작하세요.
6. 특정 연주자의 릭이나 라인을 언급할 때는 딱딱하게 나열하지 말고, 자연스럽고 대화하듯이 소개하세요. 예시: "좋아요, 릭을 알려드릴게요. 다음은 [연주자]의 [곡 제목]에서 나오는 이런 릭도 있어요! [릭 설명] 이런 부분에 대해선 어떠신가요?"

중요: 아래 [관련 지식 내용]을 반드시 참고하여 답변하되, 외부 데이터를 참고했다는 티를 내지 마세요. 주어진 정보와 충돌하는 설명을 하지 마세요."""


# ── 엔드포인트 ─────────────────────────────────────────────────────────────────

@app.post("/chat")
async def chat(req: ChatRequest):
    """
    HarmoRAG 컨텍스트를 주입한 Claude 스트리밍 응답
    """
    # 1. HarmoRAG로 관련 강의 내용 검색
    rag_context = ""
    debug_info: dict = {}
    try:
        rag_context, debug_info = build_context(
            req.chord_context or {},
            req.message,
            top_k=5,
            song_title=req.song_title,
        )
    except Exception as e:
        print(f"RAG 검색 실패: {e}")
        debug_info = {"error": str(e)}

    # 2. 시스템 프롬프트 구성
    system = BASE_SYSTEM
    if req.song_title:
        system += f"\n\n현재 분석 중인 곡: {req.song_title}"
    if req.chord_context_text:
        system += f"\n\n[Rule-based 분석 결과]\n{req.chord_context_text}"
    if rag_context:
        system += f"\n\n{rag_context}"

    # 구분자 — 프론트엔드에서 파싱
    RAG_OPEN  = "\x00RAG_DEBUG\x00"
    RAG_CLOSE = "\x00END_DEBUG\x00"

    # 3. 스트리밍: RAG 디버그 블록 먼저, 그 다음 Claude 응답
    def stream():
        # ① RAG 디버그 JSON (Claude 응답 전에 즉시 전송)
        yield RAG_OPEN + json.dumps(debug_info, ensure_ascii=False) + RAG_CLOSE

        # ② Claude 응답 스트리밍
        with claude.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=system,
            messages=req.history + [{"role": "user", "content": req.message}],
        ) as stream_obj:
            for text in stream_obj.text_stream:
                yield text

    return StreamingResponse(stream(), media_type="text/plain")


@app.get("/search")
async def search_rag(q: str, level: int | None = None, n: int = 5):
    """
    직접 RAG 검색 테스트용 엔드포인트
    예: GET /search?q=트라이톤서브&level=1&n=3
    """
    from retrieve import search
    results = search(q, n_results=n, level_filter=level)
    return {"query": q, "results": results}


@app.get("/health")
async def health():
    return {"status": "ok", "service": "HarmoRAG"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, reload=True)
