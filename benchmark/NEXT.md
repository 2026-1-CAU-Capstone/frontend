# 벤치마크 — 다음 작업 (맥미니에서 바로 이어서)

이 파일만 보고 다음 세션을 바로 시작할 수 있게 정리. (설계·실행법은 `README.md`, 점수는 `results/scorecard.md`)

---

## 0. 현재 상태 (요약, 2026-05-23)
- 4태스크 완성: **A 구조분석 / B 이론팩트 / C 설명(LLM-judge) / D 할루시네이션(LLM-judge)**
- 4조건 **전부 측정 완료**: Raw / +Rule / +RAG / +Rule+RAG (로컬 RAG :8001)

| 태스크 | Raw | +Rule | +RAG | +Rule+RAG |
|---|---|---|---|---|
| A (24) | F1 87/key 71/Rom 83 | **F1 100/key 96/Rom 99** | F1 86/key 63/Rom **66** | F1 100/key 88/Rom 95 |
| B (30) | **93.3%** | — | 90.0% (-1 = b17) | — |
| C (8)  | 4.63/5 | — | 4.13/5 | — |
| D (17) | 0% · 100% | — | 0% · 100% | — |

**큰 발견 — RAG가 모든 축에서 성능을 떨어뜨림.** A Roman 83→66, B 1문항 뒤집힘(b17 backdoor → F7), C 4.63→4.13. **+Rule+RAG가 +Rule보다 낮음** — 완벽한 룰 컨텍스트에 RAG를 더해도 노이즈가 흠집을 냄. D는 모델이 이미 강해 변별 안 됨.

**추정 원인:** (a) RAG 코퍼스가 한국어 곡-분석 중심 → 영어 추상 이론 질문과 도메인 불일치, (b) `n=5` 청크가 길어 산만, (c) 키워드 검색이 무관한 곡 분석을 끌어옴(b17은 backdoor 질문에 IV→I 청크가 와서 모델이 F7로 흘러감).

---

## 1. ▶ 지금 바로 할 것: RAG retrieval/필터링 고치고 재측정

RAG가 "쓸수록 나빠지는" 상태로 배포 비추. 검색·청크·랭킹을 먼저 손봐야 함.

**진단 → 처방 후보:**
- [ ] **B b17 한 항목으로 디버그** — Raw=Bb7, +RAG=F7로 뒤집힘. `/search?q=backdoor dominant chord that resolves to Cmaj7&n=5` 응답을 직접 보고 어떤 청크가 들어왔는지 확인. 무관 청크면 임베딩/리랭커 문제 확정.
- [ ] **n 줄여보기** — `RAG_N=2` 같은 옵션 추가해 5→2로. 노이즈 ↓.
- [ ] **MMR/리랭커 추가** — 유사도 top-5가 아니라 다양성·정밀도 우선.
- [ ] **언어 매칭** — 질문이 영어/추상이면 영어/이론 청크만, 곡 이름이 들어가면 곡 분석 청크 우선.
- [ ] **컨텍스트 포맷 다듬기** — 현재는 title+instruction+response 합쳐서 `\n---\n`로 이어붙임. 모델이 "이걸 *그대로* 사용해야 한다"고 오해 가능. "참고용·확인 후 사용" 류 wrapper 시도.

```bash
# 한 항목만 빠르게 디버그
curl -s "http://127.0.0.1:8001/search?q=backdoor%20dominant%20chord%20that%20resolves%20to%20Cmaj7&n=5" | jq '.results[]|{title,instruction,response:(.response|.[0:120])}'

# 부분 재실행 (한 태스크만)
cd /Users/benzity/Documents/DEV/jazzify/frontend
RAG_BASE=http://127.0.0.1:8001 node benchmark/run.mjs --task=B
```

---

## 2. 다음 단계 (우선순위 체크리스트)

- [x] **(1) RAG 4조건 측정** ✓ 2026-05-23. **결과: RAG가 성능 떨어뜨림** → retrieval 개선 필요(위).
- [ ] **(2) RAG retrieval 개선 후 재측정** — 위 진단·처방. 가장 임팩트 큼.
- [ ] **(3) B를 RAG 헤드룸 문항으로 더 확장** — 훈련에 없을 법한 **도메인 특수 팩트**(특정 곡 분석, 우리 RAG 코퍼스에만 있는 강의 내용). b25/b28처럼 모델이 틀리는 류를 늘려야 RAG 효과가 또렷.
- [ ] **(4) judge 인간 캘리브레이션** — C/D judge 점수를 사람이 20개 정도 직접 채점해 일치율 확인. 특히 C는 RAG가 4.63→4.13로 떨어졌는데 judge가 RAG 들어간 답을 "사족 많다"고 깐 건지 확인 필요.
- [ ] **(5) 지연·비용 로깅** — 조건별 평균 latency / 토큰. "룰=빠르고 쌈, RAG=느리고 (현재는) 더 나쁨" 트레이드오프 표.
- [ ] **(6) D 적대성 강화 or 약한 모델** — 현재 모델이 0%라 변별 안 됨. (a) haiku 등 약한 모델로 D 돌려 RAG 효과 보거나, (b) 더 교묘한 함정.
- [ ] **(7) A 골드 자동 확장** — `jazz1460.json`에서 룰로 후보 생성 + **인간 검수 일부**. ⚠️ 순환성: 룰이 골드이자 +Rule 채점 기준이면 부당 → 골드는 독립 검수본으로.
- [ ] **(8) 신뢰구간** — N 작으니 부트스트랩 CI 또는 항목별 표 제공.
- [ ] **(9) 모델 스윕** — 같은 벤치 haiku/opus/sonnet 비교 표(모델×조건).

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

- **핵심 주장**: "raw LLM은 구조 분석에서 체계적 오류(ii-V-I 과잉검출, P 80%) → **룰 레이어가 F1 100%로 교정**." = Jazzify 룰 엔진의 정량적 존재이유. ✓ 확정.
- **반(反)직관 발견**: **"검색만 끼우면 좋아진다"는 RAG 통념을 깸.** 현재 코퍼스/검색 설정에선 RAG가 모든 측정 축에서 성능을 낮춤(A Roman 83→66, B 93.3→90, C 4.63→4.13). 심지어 +Rule+RAG < +Rule. **결론: RAG는 "그냥 켜는 것"이 아니라 retrieval 품질과 도메인 매칭이 결정한다.**
- **구체적 실패 사례 b17**: backdoor dominant 질문에 잘못된 청크가 와서 Bb7 → F7로 답이 뒤집힘. 한 항목만으로도 retrieval 품질 문제를 시각적으로 보여줌.
- **방법론 강점**: 객관 자동채점(A/B) + LLM-judge(C/D) + 재현성(temp 0, 원문 저장, 오프라인 재채점) + **negative finding을 솔직하게 공개**.
- **한계 명시**: N 작음(CI 필요), judge 편향(인간 캘리브레이션 필요), D는 강한 베이스 모델에선 포화, RAG는 retrieval 미튜닝 상태.

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
