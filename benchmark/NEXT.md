# 벤치마크 — 다음 작업 (맥미니에서 바로 이어서)

이 파일만 보고 다음 세션을 바로 시작할 수 있게 정리. (설계·실행법은 `README.md`, 점수는 `results/scorecard.md`)

---

## 0. 현재 상태 (요약)
- 4태스크 완성: **A 구조분석 / B 이론팩트 / C 설명(LLM-judge) / D 할루시네이션(LLM-judge)**
- 조건: **Raw / +Rule / +RAG / +Rule+RAG** (러너가 자동 구성)
- 최신 결과 (claude-sonnet-4, **RAG off** — 튜널 만료로 미측정):

| 태스크 | Raw | +Rule |
|---|---|---|
| A (24) | F1 87% (P80/R95) · key75% · Roman88.3% | **F1 100% · key95.8% · Roman99.2%** |
| B (30) | **93.3%** (오답 b25, b28) | — |
| C (8) | 4.63/5 | — |
| D (17) | 할루시네이션 0% · 컨트롤 100% | — |

- **A = 룰 레이어 정량 승리(확정).** B는 고난도화로 변별 생김(93.3%) → **RAG 헤드룸 존재.** D는 모델이 이미 강해 0%.

---

## 1. ▶ 지금 바로 할 것: RAG 측정 (최우선)

RAG 서버가 죽어서 +RAG/+Rule+RAG를 **아직 못 쟀음.** 맥미니에선 로컬이라 튜널 불필요.

```bash
# (1) RAG 서버 기동 — :8001, GET /search 노출
cd rag && source venv/bin/activate && python server.py     # 백그라운드로 띄워두기
# 헬스 체크
curl -s localhost:8001/health
curl -s "localhost:8001/search?q=tritone%20substitution&n=3" | head -c 400

# (2) 벤치마크 RAG 켜고 실행 (ANTHROPIC 키는 .env에서 자동 로드)
cd /Users/benzity/Documents/DEV/jazzify
RAG_BASE=http://127.0.0.1:8001 node benchmark/run.mjs
#   → A는 4조건(Raw/+Rule/+RAG/+Rule+RAG), B/C/D는 Raw/+RAG 자동 측정
#   특정 태스크만:  RAG_BASE=http://127.0.0.1:8001 node benchmark/run.mjs --task=B,A
```

**볼 것 (성공 기준):**
- **B**: Raw 93.3% → **+RAG 가 올라가나?** 특히 오답이던 **b25**(Barry Harris 6th-dim 추가음=Ab)·**b28**(F장조 V7의 트라이톤 sub=Gb7)를 RAG가 채워주는지.
- **A**: **+Rule+RAG > +Rule** 인가? (룰이 이미 100%라 RAG가 추가로 못 올릴 수도 — 그럼 "룰만으로 충분" 결론).
- **C**: +RAG가 설명 점수(4.63) 올리나? (그라운딩/근거).
- **D**: +RAG가 0%를 유지/개선하나.

> 결과는 `benchmark/results/scorecard.md` + `responses.json`(원문) 자동 갱신.

---

## 2. 다음 단계 (우선순위 체크리스트)

- [ ] **(1) RAG 4조건 측정** ← 위. 가장 임팩트 큼. RAG의 정량 가치 확정.
- [ ] **(2) B를 RAG 헤드룸 문항으로 더 확장** — 훈련에 없을 법한 **도메인 특수 팩트**(특정 곡 분석, 우리 RAG 코퍼스에만 있는 강의 내용). b25/b28처럼 모델이 틀리는 류를 늘려야 RAG 효과가 또렷.
- [ ] **(3) judge 인간 캘리브레이션** — C/D judge 점수를 사람이 20개 정도 직접 채점해 일치율 확인(LLM-judge 신뢰도 입증). 불일치 크면 루브릭 보강.
- [ ] **(4) 지연·비용 로깅** — 조건별 평균 latency / 토큰. "룰=빠르고 쌈, RAG=느리지만 정확" 트레이드오프 표.
- [ ] **(5) D 적대성 강화 or 약한 모델** — 현재 모델이 0%라 변별 안 됨. (a) haiku 등 약한 모델로 D 돌려 RAG 효과 보거나, (b) 더 교묘한 함정.
- [ ] **(6) A 골드 자동 확장** — `jazz1460.json`에서 룰로 후보 생성 + **인간 검수 일부**. ⚠️ 순환성: 룰이 골드이자 +Rule 채점 기준이면 부당 → 골드는 독립 검수본으로.
- [ ] **(7) 신뢰구간** — N 작으니 부트스트랩 CI 또는 항목별 표 제공.
- [ ] **(8) 모델 스윕** — 같은 벤치 haiku/opus/sonnet 비교 표(모델×조건).

---

## 3. 운영 메모 (gotchas)

- **RAG 컨텍스트 소스**: 서버의 기존 `GET /search?q=&n=5` 결과(`results[].{title,instruction,response}`)를 합쳐 주입. 별도 엔드포인트 불필요.
- **env 자동 로드**: `run.mjs`가 repo 루트 `.env`를 읽어 `VITE_ANTHROPIC_API_KEY`·`VITE_RAG_BASE` 자동 사용. CLI로 `RAG_BASE=...` 주면 우선.
  - 단 `.env`의 `VITE_RAG_BASE`는 **죽은 임시 Cloudflare 튜널** → 맥미니에선 `RAG_BASE=http://127.0.0.1:8001`로 덮어쓰기.
- **재채점은 무료**: `results/responses.json`에 모델 원문 저장됨 → 채점기 고치면 API 재호출 없이 재채점 가능. 예:
  ```bash
  node -e 'import("./benchmark/scorer.mjs").then(({scoreTheory,aggregateTheory})=>{const r=require("./benchmark/results/responses.json").responses;const g=require("./benchmark/gold/theory.json").items;const s=r.filter(x=>x.task==="B").map(x=>{const gi=g.find(i=>i.id===x.id);let a="";try{a=(JSON.parse((x.reply.match(/\{[\s\S]*\}/)||[""])[0])||{}).answer||x.reply;}catch{a=x.reply;}return scoreTheory({answer:a},gi);});console.log(aggregateTheory(s));});'
  ```
- **채점기 수정 이력**: normFact가 대시/슬래시/화살표(`-–—→/`)도 제거하도록 고침(`"Cm7 - F7 - BbMaj7"` 정답 오탐 방지). key는 다중정답 집합(`gold.keys`=acceptable sets; 전조=모두 필요, 이명동음=택일).
- **judge**: D/C는 `JUDGE_MODEL`(기본=`MODEL`)이 채점. judge가 키워드보다 정확함(D 키워드 20% 오탐 → judge 0%).
- **모델 바꾸기**: `MODEL=claude-... node benchmark/run.mjs`. judge만 따로: `JUDGE_MODEL=...`.

---

## 4. 결과 해석 가이드 (논문/포트폴리오용 스토리)

- **핵심 주장**: "raw LLM은 구조 분석에서 체계적 오류(ii-V-I 과잉검출, 정밀도 80%) → **룰 레이어가 100% 교정**." = Jazzify 룰 엔진의 정량적 존재이유.
- **RAG 주장(측정 후)**: "도메인 특수 팩트(b25/b28류)에서 raw가 틀리는 걸 **RAG 검색이 채운다**." ← (1) 측정으로 확정.
- **방법론 강점**: 객관 자동채점(A/B) + LLM-judge(C/D) + 재현성(temp 0, 원문 저장, 오프라인 재채점).
- **한계 명시**: N 작음(CI 필요), judge 편향(인간 캘리브레이션 필요), D는 강한 베이스 모델에선 포화.

---

## 5. 파일 맵
```
benchmark/
├─ NEXT.md          ← 이 파일 (다음 작업)
├─ README.md        설계·실행법·최신 결과
├─ run.mjs          러너 (.env 로더 · 4태스크 · judge · RAG /search)
├─ scorer.mjs       A/B 채점 + C/D 집계 + 카드
├─ gold/            structural(24) · theory(30) · explanatory(8) · hallucination(17)
└─ results/         scorecard.md · responses.json (원문, 재채점용)
```
