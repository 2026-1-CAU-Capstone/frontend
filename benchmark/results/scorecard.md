# Jazzify 벤치마크 결과 (multi-model)

- models: haiku=`claude-haiku-4-5-20251001`  ·  sonnet=`claude-sonnet-4-6`
- judge: `claude-sonnet-4-6`
- RAG: on (n=5)
- timestamp: 2026-05-27T09:49:19.755Z

## A · 구조 분석  (n=24)

| 조건 | key 정확도 | ii-V-I F1 (micro) | ii-V-I P | ii-V-I R | Roman 정확도 |
|---|---|---|---|---|---|
| haiku/raw | 83.3% | 87.0% | 80.0% | 95.2% | 90.0% |
| haiku/+Rule | 87.5% | 100.0% | 100.0% | 100.0% | 98.2% |
| haiku/+Rule+RAG | 83.3% | 97.7% | 95.5% | 100.0% | 98.7% |
| sonnet/raw | 75.0% | 93.0% | 90.9% | 95.2% | 86.9% |
| sonnet/+Rule | 87.5% | 100.0% | 100.0% | 100.0% | 100.0% |
| sonnet/+Rule+RAG | 91.7% | 100.0% | 100.0% | 100.0% | 100.0% |

## B · 이론 팩트  (n=42)

| 조건 | 이론 팩트 정확도 |
|---|---|
| haiku/raw | 69.0% |
| haiku/+Rule | 71.4% |
| haiku/+Rule+RAG | 59.5% |
| sonnet/raw | 81.0% |
| sonnet/+Rule | 81.0% |
| sonnet/+Rule+RAG | 81.0% |

## C · 설명 (LLM-judge)  (n=8)

| 조건 | 평균 점수 (1-5) | 정규화 |
|---|---|---|
| haiku/raw | 3.75 | 68.8% |
| haiku/+Rule | 4.25 | 81.3% |
| haiku/+Rule+RAG | 4.25 | 81.3% |
| sonnet/raw | 4.88 | 96.9% |
| sonnet/+Rule | 5.00 | 100.0% |
| sonnet/+Rule+RAG | 3.38 | 59.4% |

## D · 할루시네이션 (LLM-judge)  (n=17)

| 조건 | 할루시네이션율 (낮을수록 ↑) | 컨트롤 정확도 |
|---|---|---|
| haiku/raw | 0.0% | 100.0% |
| haiku/+Rule | 0.0% | 100.0% |
| haiku/+Rule+RAG | 0.0% | 100.0% |
| sonnet/raw | 0.0% | 100.0% |
| sonnet/+Rule | 0.0% | 100.0% |
| sonnet/+Rule+RAG | 0.0% | 100.0% |

## E · 곡-grounded 단답  (n=10)

| 조건 | 이론 팩트 정확도 |
|---|---|
| haiku/raw | 30.0% |
| haiku/+Rule | 30.0% |
| haiku/+Rule+RAG | 70.0% |
| sonnet/raw | 90.0% |
| sonnet/+Rule | 100.0% |
| sonnet/+Rule+RAG | 90.0% |

