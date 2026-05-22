# Jazzify 벤치마크 — LLM raw vs +Rule vs +RAG

LLM 단독(Raw) / 룰 엔진 주입(+Rule) / RAG 검색 주입(+RAG) / 둘 다(+Rule+RAG)를
**같은 모델·같은 질문**으로 돌려, 증강이 정확도에 주는 효과를 정량 비교한다.

## 현재 태스크: 구조 분석 (A)
코드 진행을 주고 → **키 / 모든 ii-V-I(인덱스 triple) / 코드별 로마숫자**를 JSON으로 답하게 한 뒤
골드와 비교. 모델이 프로즈가 아니라 엄격한 JSON으로 답하므로 자동 채점된다.

- 골드: `gold/structural.json` (10문항, 손으로 검증). 각 문항에 `ruleContext`(룰 엔진이 주입할 분석 텍스트) 포함.
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
- **A · 구조 분석** (`gold/structural.json`, 16문항): 키 / ii-V-I triple / 로마숫자. 룰·RAG 관련.
- **B · 이론 팩트** (`gold/theory.json`, 12문항): 객관식 단답 → accept[] 매칭. RAG 관련.
- **D · 할루시네이션** (`gold/hallucination.json`, 10문항): 함정(거짓 전제) vs 컨트롤. 함정에서 모델이
  올바르게 거부/정정하는지(goodSignals 키워드)로 할루시네이션율 측정. RAG 관련.

## 실행 결과 (claude-sonnet-4-20250514, judge 동일 모델, RAG off)
| 태스크 | 조건 | 수치 |
|---|---|---|
| A 구조분석 (24) | Raw | key 75% · ii-V-I F1 87% (P 80% / R 95.2%) · Roman 88.3% |
|  | +Rule | key 95.8% · F1 100% · Roman 99.2% |
| B 이론팩트 (30) | Raw | 93.3% (28/30) |
| C 설명 (8, judge) | Raw | 4.63 / 5 (90.6%) |
| D 할루시네이션 (17, judge) | Raw | 할루시네이션 0% · 컨트롤 100% |

**해석:**
1. **A = 룰 레이어의 명백·안정적 승리** (24문항). Raw는 ii-V-I 과잉검출(정밀도 80%), **+Rule이 100% 교정** + key 95.8%/Roman 99.2%.
2. **B는 고난도화로 변별 발생** (100%→93.3%). 진짜 오답: b25(Barry Harris 6th-dim 추가음), b28(F장조 V7의 트라이톤 sub) — **도메인 특수/심화 팩트 = RAG가 도울 여지**.
3. **D는 더 어려운(참+거짓 혼합) 함정에도 0%** — claude-sonnet-4가 fabrication에 매우 강함. 이 모델에선 할루시네이션이 RAG 효과 보일 축이 아님(약한 모델/더 적대적 함정이라야).
4. **LLM-judge가 키워드 채점보다 정확** (이전 D 키워드 20% 오탐 → judge 0%).
5. **RAG 미측정** — `VITE_RAG_BASE`(임시 튜널) 만료. 서버 살리면 즉시 +RAG/+Rule+RAG.

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
