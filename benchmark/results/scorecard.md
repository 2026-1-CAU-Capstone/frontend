# Jazzify 벤치마크 결과 (multi-model)

- models: haiku=`claude-haiku-4-5-20251001`  ·  sonnet=`claude-sonnet-4-6`
- judge: `claude-sonnet-4-6`
- RAG: on (n=5; per-task: F=0.5)
- timestamp: 2026-06-01T10:24:08.301Z

## F · 곡 심층 분석 (LLM-judge)  (n=100)

| 조건 | 종합(1-5) | 정규화 | coverage | specificity | pedagogy | groundedness | faithfulness(RAG) |
|---|---|---|---|---|---|---|---|
| haiku/raw | 2.21 | 30.3% | 1.76 | 2.52 | 2.81 | 1.76 |   —   |
| haiku/+Rule | 2.15 | 28.7% | 1.66 | 2.45 | 2.81 | 1.66 |   —   |
| haiku/+Rule+RAG | 4.33 | 83.2% | 4.31 | 4.39 | 4.43 | 4.18 | 4.10 |
| sonnet/raw | 2.79 | 44.8% | 2.34 | 3.30 | 3.21 | 2.32 |   —   |
| sonnet/+Rule | 2.88 | 46.9% | 2.46 | 3.31 | 3.33 | 2.40 |   —   |
| sonnet/+Rule+RAG | 4.49 | 87.1% | 4.36 | 4.64 | 4.62 | 4.32 | 4.21 |

