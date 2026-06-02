# Jazzify 벤치마크 결과 (multi-model)

- models: haiku=`claude-haiku-4-5-20251001`  ·  sonnet=`claude-sonnet-4-6`
- judge: `claude-sonnet-4-6`
- RAG: on (n=5; per-task: C=0.65, E=0.5, F=0.5)
- timestamp: 2026-06-01T13:53:04.917Z

## C · 설명 (LLM-judge)  (n=8)

| 조건 | 평균 점수 (1-5) | 정규화 |
|---|---|---|
| haiku/raw | 3.75 | 68.8% |
| haiku/+Rule | 3.88 | 71.9% |
| haiku/+Rule+RAG | 3.75 | 68.8% |
| sonnet/raw | 4.75 | 93.8% |
| sonnet/+Rule | 4.38 | 84.4% |
| sonnet/+Rule+RAG | 4.38 | 84.4% |

## E · 곡-grounded 단답  (n=10)

| 조건 | 이론 팩트 정확도 |
|---|---|
| haiku/raw | 30.0% |
| haiku/+Rule | 40.0% |
| haiku/+Rule+RAG | 90.0% |
| sonnet/raw | 80.0% |
| sonnet/+Rule | 100.0% |
| sonnet/+Rule+RAG | 100.0% |

## F · 곡 심층 분석 (LLM-judge)  (n=100)

| 조건 | 종합(1-5) | 정규화 | coverage | specificity | pedagogy | groundedness | faithfulness(RAG) |
|---|---|---|---|---|---|---|---|
| haiku/raw | 2.20 | 30.0% | 1.77 | 2.46 | 2.81 | 1.76 |   —   |
| haiku/+Rule | 2.16 | 29.0% | 1.81 | 2.41 | 2.78 | 1.65 |   —   |
| haiku/+Rule+RAG | 4.25 | 81.3% | 4.16 | 4.39 | 4.38 | 4.07 | 4.00 |
| sonnet/raw | 2.84 | 46.1% | 2.41 | 3.33 | 3.27 | 2.37 |   —   |
| sonnet/+Rule | 2.82 | 45.5% | 2.40 | 3.28 | 3.21 | 2.38 |   —   |
| sonnet/+Rule+RAG | 4.51 | 87.8% | 4.38 | 4.68 | 4.64 | 4.35 | 4.22 |

