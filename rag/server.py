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

중요: 아래 [관련 강의 내용]을 반드시 참고하여 답변하세요.
강의 내용과 충돌하는 설명을 하지 마세요."""


# ── 엔드포인트 ─────────────────────────────────────────────────────────────────

@app.post("/chat")
async def chat(req: ChatRequest):
    """
    HarmoRAG 컨텍스트를 주입한 Claude 스트리밍 응답
    """
    # 1. HarmoRAG로 관련 강의 내용 검색
    rag_context = ""
    try:
        rag_context = build_context(
            req.chord_context or {},
            req.message,
            top_k=5,
            song_title=req.song_title,
        )
    except Exception as e:
        print(f"RAG 검색 실패: {e}")

    # 2. 시스템 프롬프트 구성
    system = BASE_SYSTEM
    if req.song_title:
        system += f"\n\n현재 분석 중인 곡: {req.song_title}"
    if req.chord_context_text:
        system += f"\n\n[Rule-based 분석 결과]\n{req.chord_context_text}"
    if rag_context:
        system += f"\n\n{rag_context}"

    # 3. Claude 스트리밍 호출
    def stream():
        with claude.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=1024,
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
