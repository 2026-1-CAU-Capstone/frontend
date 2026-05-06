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

# CORS (프론트엔드 localhost:5173에서 접근 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
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

BASE_SYSTEM = """당신은 재즈 화성학 전문 AI 교육 도우미입니다.
재즈 코드 진행, 즉흥연주 스케일, ii-V-I 패턴, 모달 인터체인지, 세컨더리 도미넌트 등을
명확하고 실용적으로 설명합니다. 한국어로 답변합니다.

[출력 포맷 및 페르소나 가이드라인]
1. 설명을 구조화할 때 가독성을 위해 마크다운 표(Markdown Table)를 적극적으로 활용하세요.
2. 표를 작성할 때는 반드시 아래 형식처럼 마크다운 규칙(파이프 | 와 하이픈 -)과 줄바꿈을 완벽하게 지켜주세요.
   | 컬럼 1 | 컬럼 2 | 컬럼 3 |
   |--------|--------|--------|
   | 내용 A | 내용 B | 내용 C |
3. 중요한 개념은 **굵은 글씨**나 이모지(🎯, 💡, ✅)를 사용해 눈에 띄게 하세요.
4. 코드 스케일이나 진행을 설명할 때는 가시성 높게 목차나 표로 정리하세요.
5. 절대로 "강의에 따르면", "강의 내용에서", "제공된 문서에 의하면"과 같이 정보의 출처를 언급하지 마세요. 모든 정보는 HarmoRAG AI로서 당신이 본래 알고 있는 지식인 것처럼 자연스럽고 전문가답게 바로 설명하세요.
6. 답변 맨 처음에 "🎷 '곡 제목' 솔로 아이디어 총정리" 같이 불필요하고 거창한 제목(Heading)을 달지 마세요. 인사말이나 제목 없이 곧바로 핵심적인 본론(질문에 대한 답)부터 시작하세요.

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
