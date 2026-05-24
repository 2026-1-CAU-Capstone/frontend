# Jazzify 벤치마크 — LLM raw vs +Rule vs +RAG

LLM 단독(Raw) / 룰 엔진 주입(+Rule) / RAG 검색 주입(+RAG) / 둘 다(+Rule+RAG)를
**같은 모델·같은 질문**으로 돌려, 증강이 정확도에 주는 효과를 정량 비교한다.

## 현재 태스크: 구조 분석 (A)
코드 진행을 주고 → **키 / 모든 ii-V-I(인덱스 triple) / 코드별 로마숫자**를 JSON으로 답하게 한 뒤
골드와 비교. 모델이 프로즈가 아니라 엄격한 JSON으로 답하므로 자동 채점된다.

- 골드: `gold/structural.json` (24문항, 손으로 검증). 각 문항에 `ruleContext`(룰 엔진이 주입할 분석 텍스트) 포함.
- 채점: `scorer.mjs` — key 정확도(멀티키 집합 일치), ii-V-I **micro P/R/F1**(triple 정확 일치), 로마숫자 per-chord 정확도.

## 실행
```bash
# Raw / +Rule (Anthropic 키만 있으면 됨)
ANTHROPIC_API_KEY=sk-... node benchmark/run.mjs
# 또는 앱 .env 재사용:
ANTHROPIC_API_KEY="$(grep '^VITE_ANTHROPIC_API_KEY=' .env | cut -d= -f2-)" node benchmark/run.mjs

# +RAG / +Rule+RAG 까지: 검색(retrieve) 엔드포인트 필요
RAG_RETRIEVE_URL=https://<host>/retrieve  ANTHROPIC_API_KEY=sk-...  node benchmark/run.mjs

# 모델 바꾸기:  MODEL=claude-... node benchmark/run.mjs
# 와이어링만 확인(무호출):  node benchmark/run.mjs --dry
# 채점기 자가테스트:  node benchmark/scorer.mjs --selftest
```
출력: `results/scorecard.md`, `results/details.csv`, `results/responses.json`(원문 — 재채점은 무료).

## 태스크
- **A · 구조 분석** (`gold/structural.json`, 24문항): 키 / ii-V-I triple / 로마숫자. 룰·RAG 관련.
- **B · 이론 팩트** (`gold/theory.json`, 30문항): 객관식 단답 → accept[] 매칭. RAG 관련.
- **C · 설명** (`gold/explanatory.json`, 8문항): 서술형 → LLM-judge 1~5점 (key points 커버리지). RAG 관련.
- **D · 할루시네이션** (`gold/hallucination.json`, 17문항, trap+control 혼합): 함정에서 모델이
  올바르게 거부/정정하는지를 LLM-judge가 채점해 할루시네이션율로 환산. RAG 관련.

## 실행 결과 (claude-sonnet-4-20250514, judge 동일 모델, RAG **on**: 로컬 :8001, 2026-05-23)
| 태스크 | 조건 | 수치 |
|---|---|---|
| A 구조분석 (24) | Raw       | key 70.8% · ii-V-I F1 87.0% (P 80.0 / R 95.2%) · Roman 83.0% |
|                | +Rule     | **key 95.8% · F1 100% · Roman 99.2%** |
|                | +RAG      | key 62.5% · F1 86.4% (P 82.6 / R 90.5%) · Roman **66.4%** |
|                | +Rule+RAG | key 87.5% · F1 100% · Roman 95.3% |
| B 이론팩트 (30) | Raw       | **93.3%** (28/30 — 오답 b25/b28) |
|                | +RAG      | 90.0% (27/30 — b17 추가 오답: Bb7 → F7) |
| C 설명 (8, judge) | Raw     | 4.63 / 5 (90.6%) |
|                  | +RAG    | 4.13 / 5 (78.1%) |
| D 할루시네이션 (17, judge) | Raw | 할루시네이션 0% · 컨트롤 100% |
|                            | +RAG | 할루시네이션 0% · 컨트롤 100% |

**해석:**
1. **A = 룰 레이어의 명백·안정적 승리** (24문항). Raw는 ii-V-I 과잉검출(P 80%), **+Rule이 F1 100% + Roman 99.2%로 교정.** ← 확정.
2. **현재 RAG는 모든 측정 축에서 성능을 떨어뜨림.** A Roman 83→66, B 93.3→90, C 4.63→4.13. **+Rule+RAG < +Rule** 까지 — 완벽한 룰 컨텍스트가 있어도 RAG 노이즈가 흠집을 냄.
3. **B에서 RAG가 깬 단 한 항목 = b17(backdoor → Cmaj7)**: Raw는 Bb7로 정답. RAG 컨텍스트가 `IV→I` 류 설명을 주입해 모델이 "F7"로 잘못 답함. **검색이 잘못된 청크를 가져왔다는 직접 증거.**
4. **D는 sonnet-4가 이미 0%** — 강한 모델에선 fabrication 변별 안 됨(약한 모델/더 적대적 함정이 필요).
5. **추정 원인:** (a) RAG 코퍼스가 한국어 곡-분석 중심이라 영어 추상 이론 질문과 도메인이 어긋남, (b) `n=5` 청크가 길어 산만함, (c) 검색이 키워드 기반이라 관련성 낮은 곡 분석을 끌어옴. **현재 형태 RAG는 배포 비추 — retrieval/필터를 고쳐 재측정 필요.**

> 채점기 주의: normFact가 대시/슬래시/화살표를 제거하도록 수정(`"Cm7 - F7 - BbMaj7"` 같은 정답 오탐 방지). 저장된 `responses.json`으로 API 재호출 없이 재채점 가능.

## RAG 켜는 법
`rag/server.py`를 띄우고 그 URL을 `.env`의 `VITE_RAG_BASE`(또는 `RAG_BASE` env)에 설정 → `node benchmark/run.mjs`.
RAG 컨텍스트는 서버의 기존 `GET /search?q=&n=5` 결과(title+instruction+response)를 주입한다.

## 다음 단계
- [ ] RAG 서버 살려서 +RAG / +Rule+RAG 측정 (인프라는 완료)
- [ ] B/D를 더 어렵게(도메인 특수·obscure) — 베이스 모델 포화 탈출
- [ ] A 골드 ↑ (1460에서 룰 생성 + 인간 검수, 순환성 주의)
- [ ] 지연·비용 로깅, 신뢰구간, judge 인간 캘리브레이션

## 주의
- RAG 조건은 "검색 청크만 주입 + 동일 베이스 LLM"으로 설계(증강 효과 격리). 서버의 `/chat`(엔드투엔드)와는 다름.
- 작은 N → 수치는 방향성 참고용. 상용 주장엔 N 확대 + 인간 검수 필요.
