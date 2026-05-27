# Jazzify 벤치마크 — 전체 QA·응답 공개 (multi-model)

5개 태스크(A 구조분석 · B 이론팩트 · C 설명 · D 할루시네이션 · E 곡-grounded) × 모델 2개(haiku, sonnet) × 조건 3개(raw / +Rule / +Rule+RAG) — 합 6셀.

- **모델:** `haiku`=`claude-haiku-4-5-20251001` · `sonnet`=`claude-sonnet-4-6`  ·  **judge:** `claude-sonnet-4-6`  ·  **temperature:** 0
- **조건:** raw / +Rule / +Rule+RAG
- **RAG:** on (n=5)
- **timestamp:** 2026-05-27T12:01:57.997Z
- **이 머신에 있는 응답 (606건):**
  - A / haiku/+Rule: 24건
  - A / haiku/+Rule+RAG: 24건
  - A / haiku/raw: 24건
  - A / sonnet/+Rule: 24건
  - A / sonnet/+Rule+RAG: 24건
  - A / sonnet/raw: 24건
  - B / haiku/+Rule: 42건
  - B / haiku/+Rule+RAG: 42건
  - B / haiku/raw: 42건
  - B / sonnet/+Rule: 42건
  - B / sonnet/+Rule+RAG: 42건
  - B / sonnet/raw: 42건
  - C / haiku/+Rule: 8건
  - C / haiku/+Rule+RAG: 8건
  - C / haiku/raw: 8건
  - C / sonnet/+Rule: 8건
  - C / sonnet/+Rule+RAG: 8건
  - C / sonnet/raw: 8건
  - D / haiku/+Rule: 17건
  - D / haiku/+Rule+RAG: 17건
  - D / haiku/raw: 17건
  - D / sonnet/+Rule: 17건
  - D / sonnet/+Rule+RAG: 17건
  - D / sonnet/raw: 17건
  - E / haiku/+Rule: 10건
  - E / haiku/+Rule+RAG: 10건
  - E / haiku/raw: 10건
  - E / sonnet/+Rule: 10건
  - E / sonnet/+Rule+RAG: 10건
  - E / sonnet/raw: 10건

---

## A · 구조 분석 (24문항)

진행을 0-인덱스로 주고 `{"key":"...", "iiVi":[[i,j,k]], "romans":["..."]}` JSON 답을 받음. 채점: key 집합일치 / ii-V-I micro P·R·F1 / 코드별 로마숫자.

### A · `p01-cmaj-251`
- **Chords:** `Dm7  G7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: C major. Dm7=ii-7, G7=V7, Cmaj7=Imaj7. Detected 2-5-1: Dm7→G7→Cmaj7 (C major).

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p02-gmaj-251`
- **Chords:** `Am7  D7  Gmaj7`
- **Gold:** keys=`[["G"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: G major. Am7=ii-7, D7=V7, Gmaj7=Imaj7. Detected 2-5-1: Am7→D7→Gmaj7 (G major).

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p03-bbmaj-251`
- **Chords:** `Cm7  F7  Bbmaj7`
- **Gold:** keys=`[["Bb"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: Bb major. Cm7=ii-7, F7=V7, Bbmaj7=Imaj7. Detected 2-5-1: Cm7→F7→Bbmaj7 (Bb major).

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`Bb major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`Bb major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`Bb major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`Bb major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`Bb major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`Bb major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p04-dmin-251`
- **Chords:** `Em7b5  A7  Dm7`
- **Gold:** keys=`[["D minor"]]` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i-7"]`
- **Rule context (주입):** Key: D minor. Em7b5=iiø7, A7=V7(alt), Dm7=i-7. Detected minor 2-5-1: Em7b5→A7→Dm7 (D minor).

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`D minor` · iiVi=`[[0,1,2]]` · romans=`["ii°7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=67% |
| **haiku/+Rule** | key=`D minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7alt","i-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=67% |
| **haiku/+Rule+RAG** | key=`D minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`Dm` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`D minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`D minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p05-modulating-two-251`
- **Chords:** `Dm7  G7  Cmaj7  Cm7  F7  Bbmaj7`
- **Gold:** keys=`[["C","Bb"]]` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]`
- **Rule context (주입):** Two key centers. C major (bars 1-3): Dm7=ii-7, G7=V7, Cmaj7=Imaj7. Bb major (bars 4-6): Cm7=ii-7, F7=V7, Bbmaj7=Imaj7. Detected 2-5-1 x2.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major, B♭ major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`C major, Bb major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C major, Bb major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`C major, Bb major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`C major, Bb major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`C major, Bb major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p06-251-plus-vi`
- **Chords:** `Dm7  G7  Cmaj7  A7`
- **Gold:** keys=`[["C"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7","VI7"]`
- **Rule context (주입):** Key: C major. Dm7=ii-7, G7=V7, Cmaj7=Imaj7, A7=VI7 (secondary dominant V7/ii, turnaround). One 2-5-1: Dm7→G7→Cmaj7.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","VI7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7","VI7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","VI7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","VI7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","VI7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","VI7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p07-autumn-leaves`
- **Chords:** `Cm7  F7  Bbmaj7  Ebmaj7  Am7b5  D7  Gm7`
- **Gold:** keys=`[["Bb","G minor"]]` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii-7","V7","Imaj7","IVmaj7","iiø7","V7","i-7"]`
- **Rule context (주입):** Relative major/minor. Bb major: Cm7=ii-7, F7=V7, Bbmaj7=Imaj7, Ebmaj7=IVmaj7. G minor: Am7b5=iiø7, D7=V7(alt), Gm7=i-7. Detected 2-5-1 x2.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`Bb major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","IVmaj7","ii°7","V7","i7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=86% |
| **haiku/+Rule** | key=`Bb major, G minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii-7","V7","Imaj7","IVmaj7","iiø7","V7","i-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`Bb major, G minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii-7","V7","Imaj7","IVmaj7","iiø7","V7","i-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`Bb major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","IVmaj7","vi∅7","V7/vi","vi7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=57% |
| **sonnet/+Rule** | key=`Bb major, G minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii-7","V7","Imaj7","IVmaj7","iiø7","V7","i-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`Bb major, G minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii-7","V7","Imaj7","IVmaj7","iiø7","V7","i-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p08-blues-no-251`
- **Chords:** `F7  Bb7  F7  F7`
- **Gold:** keys=`[["F"]]` · iiVi=`[]` · romans=`["I7","IV7","I7","I7"]`
- **Rule context (주입):** Key: F major (blues). All dominant chords. F7=I7, Bb7=IV7. No ii-V-I present.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`F` · iiVi=`[]` · romans=`["I7","IV7","I7","I7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`F major (blues)` · iiVi=`[]` · romans=`["I7","IV7","I7","I7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`F major (blues)` · iiVi=`[]` · romans=`["I7","IV7","I7","I7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`Bb major` · iiVi=`[]` · romans=`["IV7","I7","IV7","IV7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=0% |
| **sonnet/+Rule** | key=`F major (blues)` · iiVi=`[]` · romans=`["I7","IV7","I7","I7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`F major (blues)` · iiVi=`[]` · romans=`["I7","IV7","I7","I7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p09-fmaj-251`
- **Chords:** `Gm7  C7  Fmaj7`
- **Gold:** keys=`[["F"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: F major. Gm7=ii-7, C7=V7, Fmaj7=Imaj7. Detected 2-5-1: Gm7→C7→Fmaj7 (F major).

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`F major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`F major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`F major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`F major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`F major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`F major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p10-static-vamp`
- **Chords:** `Cmaj7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]`
- **Rule context (주입):** Key: C major. Static Imaj7 vamp. No ii-V-I present.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`` · iiVi=`[]` · romans=`[]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p11-secondary-dom-chain`
- **Chords:** `Cmaj7  A7  Dm7  G7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: C major. Cmaj7=Imaj7, A7=VI7 (secondary dominant V7/ii), Dm7=ii-7, G7=V7, Cmaj7=Imaj7. One 2-5-1 at indices 2-3-4 (Dm7→G7→Cmaj7). A7 is NOT a ii.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`C major` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C major` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`C major` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`C major` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`C major` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p12-modal-interchange-backdoor`
- **Chords:** `Cmaj7  Fm7  Bb7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[]` · romans=`["Imaj7","iv-7","bVII7","Imaj7"]`
- **Rule context (주입):** Key: C major with modal interchange. Cmaj7=Imaj7, Fm7=iv-7 (borrowed from C minor), Bb7=bVII7 (backdoor dominant). Fm7→Bb7 resolves deceptively to Cmaj7 — NOT a ii-V-I in C. No ii-V-I.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`C` · iiVi=`[]` · romans=`["Imaj7","bIVm7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=75% |
| **sonnet/+Rule** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","iv-7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p13-coltrane-ii-v-fragment`
- **Chords:** `Am7  D7  Gmaj7  Bb7`
- **Gold:** keys=`[["G"]]` · iiVi=`[[0,1,2]]`
- **Rule context (주입):** Primary key G major: Am7=ii-7, D7=V7, Gmaj7=Imaj7 (2-5-1). Bb7 is a Coltrane-style secondary dominant pivoting toward Eb (V7/Eb) — not part of a ii-V-I here.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","bIII7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **haiku/+Rule** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7","V7/Eb"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **haiku/+Rule+RAG** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7","V7/Eb (secondary dominant, pivot)"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/raw** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","bIII7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7","V7/Eb"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule+RAG** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7","V7/Eb"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |

### A · `p14-dorian-vamp`
- **Chords:** `Dm7  Em7  Dm7  Em7`
- **Gold:** keys=`[["D minor"],["D dorian"]]` · iiVi=`[]`
- **Rule context (주입):** Modal: D dorian vamp (Dm7 ↔ Em7, i-7 ↔ ii-7). No dominant, no ii-V-I.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[]` · romans=`["ii7","iii7","ii7","iii7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **haiku/+Rule** | key=`D dorian` · iiVi=`[]` · romans=`["i-7","ii-7","i-7","ii-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **haiku/+Rule+RAG** | key=`D dorian` · iiVi=`[]` · romans=`["i7","ii7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/raw** | key=`C major` · iiVi=`[]` · romans=`["ii7","iii7","ii7","iii7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule** | key=`D dorian` · iiVi=`[]` · romans=`["i7","ii7","i7","ii7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule+RAG** | key=`D dorian` · iiVi=`[]` · romans=`["i7","ii7","i7","ii7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |

### A · `p15-attya-opening`
- **Chords:** `Fm7  Bbm7  Eb7  Abmaj7  Dbmaj7  G7  Cmaj7`
- **Gold:** keys=`[["Ab","C"]]` · iiVi=`[[1,2,3]]`
- **Rule context (주입):** Ab major: Fm7=vi-7, Bbm7=ii-7, Eb7=V7, Abmaj7=Imaj7 (2-5-1 at 1-2-3). Then Dbmaj7=IVmaj7 of Ab. G7→Cmaj7 is a V-I into C major (no ii — NOT a ii-V-I). Detected one 2-5-1: Bbm7→Eb7→Abmaj7.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`Ab major, C major` · iiVi=`[[0,2,3],[1,5,6]]` · romans=`["vi7","ii7","V7","Imaj7","IV maj7","V7","Imaj7"]` | key=✓ · P=0.00 R=0.00 F1=0.00 · Roman=— |
| **haiku/+Rule** | key=`Ab major` · iiVi=`[[1,2,3]]` · romans=`["vi-7","ii-7","V7","Imaj7","IVmaj7","V7/C","Imaj7/C"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **haiku/+Rule+RAG** | key=`Eb major` · iiVi=`[[1,2,3],[0,5,6]]` · romans=`["vi7","ii7","V7","Imaj7","IVmaj7","V7/ii","IImaj7"]` | key=✗ · P=0.50 R=1.00 F1=0.67 · Roman=— |
| **sonnet/raw** | key=`Ab major, C major` · iiVi=`[[1,2,3]]` · romans=`["vi","ii","V","I","IV","V","I"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule** | key=`Ab major` · iiVi=`[[1,2,3]]` · romans=`["vi-7","ii-7","V7","Imaj7","IVmaj7","V7/VI","Imaj7/VI"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule+RAG** | key=`Ab major` · iiVi=`[[1,2,3]]` · romans=`["vi-7","ii-7","V7","Imaj7","IVmaj7","V7/VI","VImaj7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |

### A · `p16-tritone-sub`
- **Chords:** `Dm7  Db7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[]` · romans=`["ii-7","bII7","Imaj7"]`
- **Rule context (주입):** Key: C major. Dm7=ii-7, Db7=bII7 (tritone substitute of G7, subV7/I), Cmaj7=Imaj7. Db7→Cmaj7 is a half-step resolution, NOT the P5 of a standard ii-V-I, so no ii-V-I is counted.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=0.00 R=0.00 F1=0.00 · Roman=67% |
| **haiku/+Rule** | key=`C major` · iiVi=`[]` · romans=`["ii-7","bII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["ii-7","bII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","bII7","Imaj7"]` | key=✓ · P=0.00 R=0.00 F1=0.00 · Roman=100% |
| **sonnet/+Rule** | key=`C major` · iiVi=`[]` · romans=`["ii-7","bII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["ii-7","bII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p17-cmin-251`
- **Chords:** `Dm7b5  G7  Cm7`
- **Gold:** keys=`[["C minor"]]` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i-7"]`
- **Rule context (주입):** Key: C minor. Dm7b5=iiø7, G7=V7(alt), Cm7=i-7. Detected minor 2-5-1: Dm7b5→G7→Cm7.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C minor` · iiVi=`[[0,1,2]]` · romans=`["ii°7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=67% |
| **haiku/+Rule** | key=`C minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`Cm` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`C minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`C minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p18-modulating-g-f`
- **Chords:** `Am7  D7  Gmaj7  Gm7  C7  Fmaj7`
- **Gold:** keys=`[["G","F"]]` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]`
- **Rule context (주입):** Two key centers. G major: Am7=ii-7, D7=V7, Gmaj7=Imaj7. F major: Gm7=ii-7, C7=V7, Fmaj7=Imaj7. Detected 2-5-1 x2.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`G major, F major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`G major, F major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`G major, F major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`G major, F major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`G major, F major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`G major, F major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p19-251-plus-backdoor`
- **Chords:** `Dm7  G7  Cmaj7  Fm7  Bb7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7","iv-7","bVII7","Imaj7"]`
- **Rule context (주입):** Key: C major. Dm7→G7→Cmaj7 is the 2-5-1. Fm7=iv-7, Bb7=bVII7 (backdoor) resolving to Cmaj7 — NOT a ii-V-I. One 2-5-1 only.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✓ · P=0.50 R=1.00 F1=0.67 · Roman=67% |
| **haiku/+Rule** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`` · iiVi=`[]` · romans=`[]` | key=✗ · P=0.00 R=0.00 F1=0.00 · Roman=— |
| **sonnet/+Rule** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p20-aeolian-vamp`
- **Chords:** `Am7  Dm7  Am7  Dm7`
- **Gold:** keys=`[["A minor"],["A dorian"]]` · iiVi=`[]`
- **Rule context (주입):** Modal: A minor/dorian vamp (i-7 ↔ iv-7). No dominant, no ii-V-I.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[]` · romans=`["vi","ii","vi","ii"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **haiku/+Rule** | key=`A minor` · iiVi=`[]` · romans=`["i-7","iv-7","i-7","iv-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **haiku/+Rule+RAG** | key=`C major / A minor` · iiVi=`[]` · romans=`["vi7","ii7","vi7","ii7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/raw** | key=`G major / E minor` · iiVi=`[]` · romans=`["vi7","ii7","vi7","ii7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule** | key=`A minor` · iiVi=`[]` · romans=`["i7","iv7","i7","iv7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule+RAG** | key=`A minor` · iiVi=`[]` · romans=`["i7","iv7","i7","iv7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |

### A · `p21-coltrane-v-i-cell`
- **Chords:** `Cmaj7  Eb7  Abmaj7  B7  Emaj7`
- **Gold:** keys=`[["C","Ab","E"]]` · iiVi=`[]`
- **Rule context (주입):** Coltrane changes — tonal centers in major thirds. Eb7→Abmaj7 and B7→Emaj7 are V-I motions WITHOUT a preceding ii, so they are NOT ii-V-I. No ii-V-I detected.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major, Ab major, E major` · iiVi=`[]` · romans=`["Imaj7","VII7","IVmaj7","VI7","III#maj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **haiku/+Rule** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","V7/IV","IVmaj7","V7/I","Imaj7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **haiku/+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","V7/IV","IVmaj7","V7/I","Imaj7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/raw** | key=`` · iiVi=`[]` · romans=`[]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule** | key=`C major, Ab major, E major` · iiVi=`[]` · romans=`["Imaj7","V7/bVI","bVImaj7","V7/III","IIImaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **sonnet/+Rule+RAG** | key=`C,Ab,E` · iiVi=`[]` · romans=`["Imaj7","V7/Ab","Imaj7(Ab)","V7/E","Imaj7(E)"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |

### A · `p22-turnaround-no-i`
- **Chords:** `Cmaj7  A7  Dm7  G7`
- **Gold:** keys=`[["C"]]` · iiVi=`[]` · romans=`["Imaj7","VI7","ii-7","V7"]`
- **Rule context (주입):** Key: C major. Dm7=ii-7, G7=V7 but the progression ends on V7 with NO resolving I — an incomplete ii-V (turnaround). No complete ii-V-I.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[[2,3,0]]` · romans=`["Imaj7","VI7","ii7","V7"]` | key=✓ · P=0.00 R=0.00 F1=0.00 · Roman=100% |
| **haiku/+Rule** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","VI7","ii7","V7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["I","VI7","ii7","V7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=75% |
| **sonnet/raw** | key=`C major` · iiVi=`[[2,3,0]]` · romans=`["Imaj7","V7/ii","ii7","V7"]` | key=✓ · P=0.00 R=0.00 F1=0.00 · Roman=75% |
| **sonnet/+Rule** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","VI7","ii-7","V7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","VI7","ii-7","V7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p23-two-251-same-key`
- **Chords:** `Dm7  G7  Cmaj7  Am7  Dm7  G7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii-7","V7","Imaj7","vi-7","ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: C major throughout. Two 2-5-1 cells (indices 0-2 and 4-6); Am7=vi-7 is a passing turnaround chord, not part of either.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`C major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","vi7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule** | key=`C major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii-7","V7","Imaj7","vi-7","ii-7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","vi7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`C major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","vi7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule** | key=`C major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","vi7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","vi7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p24-amin-251-with-VI`
- **Chords:** `Bm7b5  E7  Am7  Fmaj7  Bm7b5  E7  Am7`
- **Gold:** keys=`[["A minor"]]` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["iiø7","V7","i-7","VImaj7","iiø7","V7","i-7"]`
- **Rule context (주입):** Key: A minor. Bm7b5=iiø7, E7=V7(alt), Am7=i-7 (minor 2-5-1) twice; Fmaj7=VImaj7 between them. Detected minor 2-5-1 x2.

| 모델/조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **haiku/raw** | key=`A minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii°7","V7","i7","IMaj7","ii°7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=57% |
| **haiku/+Rule** | key=`A minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["iiø7","V7","i7","VImaj7","iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **haiku/+Rule+RAG** | key=`A minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["iiø7","V7","i-7","VImaj7","iiø7","V7","i-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/raw** | key=`A minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii∅7","V7","i7","♭VI maj7","ii∅7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=57% |
| **sonnet/+Rule** | key=`A minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["iiø7","V7","i7","VImaj7","iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **sonnet/+Rule+RAG** | key=`A minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["iiø7","V7","i7","VImaj7","iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

## B · 이론 팩트 (42문항)

단답. `{"answer":"..."}` JSON. normFact 정규화 후 accept[] 중 하나라도 매칭이면 정답.

### B · `b01`
- **Q:** What is the tritone substitute of G7?
- **Accept:** `Db7` / `C#7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Db7 | ✓ |
| **haiku/+Rule** | Db7 (D♭ dominant 7). The tritone substitute shares the same tritone interval (b9 and b13 relative to root) as the original dominant, creating enharmonic equivalence of the guide tones. G7 has F and B as tritone; Db7 has B and F as tritone. Both resolve identically in voice leading to C (or enharmonically equivalent tonic). | ✓ |
| **haiku/+Rule+RAG** | The tritone substitute of G7 is D♭7. Both chords share the same guide tones (3rd and 7th: B/F and F/C♭ enharmonically), allowing D♭7 to function as a dominant substitute. The roots are a tritone apart (G to D♭), and D♭7 resolves by descending a semitone to the target chord, creating a smoother approach than the traditional G7 resolution by descending a fourth. | ✗ |
| **sonnet/raw** | Db7 | ✓ |
| **sonnet/+Rule** | The tritone substitute of G7 is Db7. G and Db are a tritone apart (augmented 4th / diminished 5th). Db7 shares the same guide tones as G7 but inverted: G7 has tritone B(3rd)–F(b7), while Db7 has F(3rd)–Cb/B(b7). In Roman-numeral terms, if G7 = V7 resolving to Cmaj7 (I), then Db7 = subV7 (bII7), a dominant-function chord approaching I by half-step. Scale: Db Lydian Dominant (4th mode of Ab melodic minor). | ✓ |
| **sonnet/+Rule+RAG** | D♭7 (also written C#7). G7 and D♭7 are a tritone apart (G↔D♭), and they share the same guide tones: the 3rd and 7th of G7 (B and F) are enharmonically identical to the 7th and 3rd of D♭7 (C♭=B and F). This shared tritone interval between guide tones is what makes the substitution work — D♭7 resolves down a semitone to C (or Cmaj7) instead of up a fourth, producing the characteristic smooth half-step bass motion. | ✓ |

### B · `b02`
- **Q:** What is the relative minor of Eb major?
- **Accept:** `C minor` / `Cm` / `Cmin`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | C minor | ✓ |
| **haiku/+Rule** | C minor. The relative minor is located 3 semitones below the major key. Eb major and C minor share the same key signature (3 flats). In C minor: Eb major = III (relative major). In Eb major: C minor = vi (relative minor). | ✓ |
| **haiku/+Rule+RAG** | C minor (Cm). The relative minor of E♭ major is always a minor third below: E♭ − 3 semitones = C. Both E♭ major and C minor share the same key signature (3 flats: B♭, E♭, A♭). | ✓ |
| **sonnet/raw** | C minor | ✓ |
| **sonnet/+Rule** | C minor (C natural minor / Aeolian mode, sharing the key signature of 3 flats: Bb, Eb, Ab). In jazz harmony, the tonic chord is Cmin(maj7) or C-7, functioning as i-7 in the key of C Dorian/Aeolian relative to Eb major. | ✓ |
| **sonnet/+Rule+RAG** | C minor | ✓ |

### B · `b03`
- **Q:** Which scale is most commonly played over a C7alt (altered dominant) chord?
- **Accept:** `altered scale` / `super locrian` / `superlocrian` / `diminished whole tone` / `altered`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | C7alt is most commonly played over the Super Locrian bb7 mode (7th mode of Db melodic minor) or C Altered Scale (C Phrygian Dominant with raised 4th and lowered 5th). The Altered Scale (derived from C melodic minor starting from the 7th degree) is the primary choice, containing all possible alterations: b9, #9, #11, and b13. | ✓ |
| **haiku/+Rule** | C altered scale (7th mode of C melodic minor, also called C super-locrian ♭♭7). This scale contains all the characteristic altered extensions: ♭9, ♯9, ♯11, ♭13. Alternative: C diminished whole-tone scale (symmetrical diminished). Both are standard; altered scale is most pedagogically common. | ✓ |
| **haiku/+Rule+RAG** | C altered (7th mode of C melodic minor), also called C super-Locrian ♯7. It contains C–D♭–E♭–F♭(E)–G♭–A♭–B♭ and emphasizes the characteristic altered tensions: ♭9, ♯9, ♭13, ♯11. Enharmonically equivalent to the parent melodic minor a half-step above (B melodic minor). This is the standard choice for C7alt resolving to any target chord. | ✓ |
| **sonnet/raw** | C altered scale (C super-locrian / 7th mode of Db melodic minor) | ✓ |
| **sonnet/+Rule** | The C altered scale, which is the 7th mode of Db melodic minor (Db melodic minor played from C to C). It contains b9, #9, b5(#11), and b13(#5) — all four altered tensions — making it the definitive choice over C7alt. Roman numeral context: C7 typically functions as V7 resolving to Fmaj7 (I), and the altered scale maximizes chromatic tension toward that resolution. | ✓ |
| **sonnet/+Rule+RAG** | The altered scale — the 7th mode of C melodic minor (C♭ melodic minor raised a half step, i.e., D♭ melodic minor) — is the most commonly used scale over C7alt. It is built: C, D♭, E♭, F♭(E), G♭, A♭, B♭, C, and supplies all altered tensions: ♭9, ♯9, ♯11(♭5), ♭13(♯5). Roman-numeral context: C7alt functions as V7alt resolving to Fm(aj7) (i.e., V7/iv in F minor). Scale name: C altered = 7th mode of D♭ melodic minor. | ✓ |

### B · `b04`
- **Q:** What are the four notes of a Cmaj7 chord (root position)?
- **Accept:** `C E G B` / `CEGB`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | C, E, G, B | ✓ |
| **haiku/+Rule** | C, E, G, B (root, major third, perfect fifth, major seventh) | ✓ |
| **haiku/+Rule+RAG** | C–E–G–B (root, major third, perfect fifth, major seventh) | ✓ |
| **sonnet/raw** | C, E, G, B | ✓ |
| **sonnet/+Rule** | C, E, G, B | ✓ |
| **sonnet/+Rule+RAG** | C, E, G, B | ✓ |

### B · `b05`
- **Q:** What is the V7 chord in the key of D minor?
- **Accept:** `A7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | A7 (A dominant seventh chord) | ✓ |
| **haiku/+Rule** | A7 (A–C#–E–G). Function: dominant. In D minor, the V7 chord is built on scale degree 5 (A) with a major triad plus minor 7th. The C# is the raised 3rd of the A triad (from harmonic minor), creating the tritone (C#–G) that resolves to the tonic D minor chord. | ✓ |
| **haiku/+Rule+RAG** | A7 (or A7♭9 in harmonic minor context). In D minor, the V chord is A, and the dominant seventh is A7. When borrowing from D harmonic minor, A7♭9 (with the ♭9 = B♭) provides the leading tone (C♯) and characteristic darkening for minor-key resolution to Dm. | ✓ |
| **sonnet/raw** | A7 | ✓ |
| **sonnet/+Rule** | The V7 chord in D minor is A7 (A–C#–E–G). Roman numeral: V7. Function: dominant. The raised 7th scale degree (C#) is borrowed from D harmonic minor (or melodic minor ascending), creating the leading tone necessary for dominant function. Recommended scale: A Mixolydian b9 b13 (5th mode of D harmonic minor), also called the 'harmonic minor dominant' scale. | ✓ |
| **sonnet/+Rule+RAG** | A7 (A7♭9 in harmonic minor context) — built on scale degree 5 (A), functioning as the dominant V7 in D minor. It borrows the leading tone C♯ and ♭9 (B♭) from D harmonic minor, giving the standard minor-key dominant sound. Roman numeral: V7 (or V7♭9). Scale: 5th mode of D harmonic minor (Phrygian dominant). | ✓ |

### B · `b06`
- **Q:** In a Dmaj7#11 chord, which note is the #11?
- **Accept:** `G#` / `Ab`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | G# | ✓ |
| **haiku/+Rule** | G# (G-sharp). In Dmaj7#11, the notes are D-F#-A-C#-G#. The #11 is the raised 11th scale degree above D, which is G# (an augmented 11th, enharmonically equivalent to A5 but spelled as #11 to indicate its function as an altered extension). | ✓ |
| **haiku/+Rule+RAG** | G# (G-sharp). In Dmaj7#11, the notes are D (root), F# (3rd), A (5th), C# (7th), E (9th), and G# (#11). The #11 is the raised 11th scale degree above D, which is G natural raised by a semitone to G#. | ✓ |
| **sonnet/raw** | G# | ✓ |
| **sonnet/+Rule** | G# (Ab enharmonically). In Dmaj7#11, the chord tones are D (root), F# (maj3), A (P5), C# (maj7), and the #11 is G# — the raised 11th above D, enharmonically equivalent to Ab. This chord is characteristic of Lydian mode (4th mode of A major, or simply D Lydian). | ✓ |
| **sonnet/+Rule+RAG** | G# | ✓ |

### B · `b07`
- **Q:** What is the name of the 5th mode of the major scale?
- **Accept:** `Mixolydian`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Mixolydian | ✓ |
| **haiku/+Rule** | Mixolydian (5th mode of major scale, also called dominant mode) | ✓ |
| **haiku/+Rule+RAG** | Mixolydian | ✓ |
| **sonnet/raw** | Mixolydian | ✓ |
| **sonnet/+Rule** | Mixolydian | ✓ |
| **sonnet/+Rule+RAG** | Mixolydian | ✓ |

### B · `b08`
- **Q:** Name the dominant 7th chord a tritone away from Db7.
- **Accept:** `G7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | G7 | ✓ |
| **haiku/+Rule** | G7. The tritone (augmented 4th/diminished 5th) from Db is G. Db7 and G7 are tritone substitutes (subV7), sharing the same tritone interval (F–B) that defines the dominant function. G7 can substitute for Db7 in resolving to Cmaj7. | ✓ |
| **haiku/+Rule+RAG** | G7. The tritone substitute of Db7 is G7, since D and G are a tritone apart (6 semitones). Both chords share the same guide tones (F#/C ≈ C/Gb) and function as dominant chords resolving down by semitone to their respective tonics (Db7→C and G7→C). | ✓ |
| **sonnet/raw** | G7 | ✓ |
| **sonnet/+Rule** | The chord a tritone away from Db7 is G7. (Db/C# to G is a tritone: C#-D#-E#-F#-G# vs G-A-B-C#-D, and the interval Db to G = augmented 4th/diminished 5th = tritone.) G7 functions as the subV7 (tritone substitute) relationship: Db7 and G7 share the same guide tones (F and Cb/B are enharmonically the tritone pair), making them interchangeable dominant 7th chords. | ✓ |
| **sonnet/+Rule+RAG** | G7 | ✓ |

### B · `b09`
- **Q:** What is the relative major of A minor?
- **Accept:** `C major` / `Cmaj` / `C`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | C major | ✓ |
| **haiku/+Rule** | C major. A minor and C major share the same key signature (no sharps or flats) and are relative keys. A minor is the vi chord in C major, and C major is the relative major of A minor. | ✓ |
| **haiku/+Rule+RAG** | C major. A minor and C major share the same key signature (no sharps or flats) and the same notes. C major is the relative major of A minor; conversely, A minor is the relative minor of C major. | ✓ |
| **sonnet/raw** | C major | ✓ |
| **sonnet/+Rule** | C major | ✓ |
| **sonnet/+Rule+RAG** | C major | ✓ |

### B · `b10`
- **Q:** Which mode/scale fits a half-diminished (m7b5) chord?
- **Accept:** `Locrian`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Locrian mode (the 7th mode of major scale). For example, C Locrian (C-Db-Eb-F-Gb-Ab-Bb) fits a Cm7b5 chord, derived from Bb major scale. | ✓ |
| **haiku/+Rule** | A half-diminished (m7♭5) chord is the ii chord in major and the viiø7 in harmonic minor. It naturally fits the Locrian mode (2nd mode of major: e.g., C Locrian = B♭ major's 2nd mode). It also appears as the ii chord in melodic minor. The m7♭5 quality itself is built on scale degree 2 of major (Locrian) or degree 7 of harmonic minor (Locrian ♮7). For functional harmony, m7♭5 typically serves subdominant or pre-dominant function, especially in the ii–V–I progression. | ✓ |
| **haiku/+Rule+RAG** | ```json {   "answer": "A half-diminished chord (m7♭5, also written ø7) appears naturally in two contexts: (1) As the ii … | ✓ |
| **sonnet/raw** | Locrian mode (the 6th mode of major scale); the chord tones 1, b3, b5, b7 are all diatonic to Locrian. Also fits Locrian #2 (6th mode of melodic minor) for a slightly less tense sound. | ✓ |
| **sonnet/+Rule** | The primary scale for a half-diminished chord (ø7, m7b5) is Locrian mode (6th mode of the major scale). For example, Bø7 uses B Locrian (parent: C major). A superior-sounding option is Locrian #2 (also called Locrian natural 2), which is the 6th mode of melodic minor (e.g., B Locrian #2 uses D melodic minor). Locrian #2 raises the b9 tension to a natural 9, producing a smoother, less dissonant color preferred in modern jazz. Function: ø7 typically acts as ii of a minor key (e.g., iiø7 in a ii-V-i progression), carrying subdominant/pre-dominant function. | ✓ |
| **sonnet/+Rule+RAG** | {"answer":"A half-diminished chord (m7♭5, also called ø7) is most commonly associated with the Locrian mode (6th mode of… | ✓ |

### B · `b11`
- **Q:** What is the ii chord (ii-7) in the key of Bb major?
- **Accept:** `Cm7` / `Cmin7` / `Cm`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Cm7 (C minor 7) | ✓ |
| **haiku/+Rule** | C-7 (C minor 7). Roman numeral: ii-7. Function: subdominant. Built on the second scale degree of Bb major (C-D-E-F-G-A-B-C), with a minor triad (C-E♭-G) plus minor seventh (B♭). | ✓ |
| **haiku/+Rule+RAG** | In B♭ major, the ii chord is Cm7 (C minor 7). Roman numeral: ii-7. Function: subdominant. Scale source: C Dorian (2nd mode of B♭ major). | ✓ |
| **sonnet/raw** | C-7 | ✗ |
| **sonnet/+Rule** | The ii-7 in Bb major is C-7 (C minor 7). Roman numeral: ii-7. Function: subdominant. Built on scale degree 2 (C), with notes C–Eb–G–Bb. Recommended scale: Dorian mode (2nd mode of Bb major). | ✓ |
| **sonnet/+Rule+RAG** | Cm7 | ✓ |

### B · `b12`
- **Q:** What is the enharmonic equivalent of Gb?
- **Accept:** `F#`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | F# | ✓ |
| **haiku/+Rule** | F# (F sharp). Gb and F# are enharmonic equivalents—same pitch, different notation. In jazz harmony, context determines usage: Gb preferred in flat keys, F# in sharp keys. | ✓ |
| **haiku/+Rule+RAG** | F# (F sharp). Gb and F# are enharmonically equivalent—they represent the same pitch but are spelled differently. Gb is the flattened seventh scale degree in Ab major/minor contexts, while F# is the raised fourth scale degree in C major/minor contexts. | ✓ |
| **sonnet/raw** | F# | ✓ |
| **sonnet/+Rule** | F# | ✓ |
| **sonnet/+Rule+RAG** | F# | ✓ |

### B · `b13`
- **Q:** Which mode of the melodic minor scale is the 'altered' (super Locrian) scale?
- **Accept:** `7th mode` / `seventh mode` / `7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | The 7th mode of the melodic minor scale is the altered (super Locrian) scale | ✓ |
| **haiku/+Rule** | The 7th mode of melodic minor is the altered scale (super Locrian). It contains all nine altered extensions (b9, #9, #11, b13) and functions as a dominant substitute, typically notated as V7alt or V7(b9). | ✓ |
| **haiku/+Rule+RAG** | The 7th mode of melodic minor is the altered scale (also called super Locrian). It contains all the alterations: ♭9, ♯9, ♯11, ♭13 relative to the parent major scale, making it ideal for dominant 7♯5♭9 and V7alt chords. | ✓ |
| **sonnet/raw** | The 7th mode of the melodic minor scale | ✓ |
| **sonnet/+Rule** | The altered scale (super Locrian) is the 7th mode of the melodic minor scale. For example, C altered = C D♭ E♭ F♭ G♭ A♭ B♭, derived from D♭ melodic minor (one half-step above the root). | ✓ |
| **sonnet/+Rule+RAG** | The altered scale (super Locrian) is the 7th mode of the melodic minor scale. For example, G altered = G super Locrian = 7th mode of A♭ melodic minor. | ✓ |

### B · `b14`
- **Q:** The Lydian dominant scale is which mode of the melodic minor scale?
- **Accept:** `4th mode` / `fourth mode` / `4`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | The Lydian dominant scale is the 4th mode of the melodic minor scale | ✓ |
| **haiku/+Rule** | The Lydian dominant scale is the 4th mode of the melodic minor scale. It is also called the 4th mode of ascending melodic minor, or the Lydian ♭7 mode. It contains the intervals: root, major 2nd, major 3rd, augmented 4th (♯4), perfect 5th, major 6th, minor 7th. | ✓ |
| **haiku/+Rule+RAG** | The Lydian dominant scale is the 4th mode of the melodic minor scale. It combines the raised 4th (♯4/♯11) characteristic of Lydian with the dominant 7th quality (minor 7th), making it useful for V7sus♯11 and altered dominant chords. | ✓ |
| **sonnet/raw** | The 4th mode of the melodic minor scale | ✓ |
| **sonnet/+Rule** | The Lydian dominant scale is the 4th mode of the melodic minor scale. Starting on the 4th degree of a melodic minor scale produces a scale with the formula 1, 2, 3, #4, 5, 6, b7, which defines the Lydian dominant sound. For example, F Lydian dominant (F, G, A, B, C, D, Eb) is the 4th mode of C melodic minor. In functional terms it typically appears as a dominant 7th chord with a #11 (b5) alteration, functioning as a V7#11 or as a tritone substitute (subV7). | ✓ |
| **sonnet/+Rule+RAG** | The Lydian dominant scale is the 4th mode of the melodic minor scale (e.g., F Lydian dominant = 4th mode of C melodic minor). It contains a raised 4th (♯4/♯11) and a minor 7th, and functions as a tritone-sub dominant (subV7) or unresolved dominant color. | ✓ |

### B · `b15`
- **Q:** Name the upper-structure triad that gives a 7#11 sound when played over a C7 chord (which major triad on which root).
- **Accept:** `D major` / `D` / `Dmaj`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | F# major triad (F# major over C7) | ✓ |
| **haiku/+Rule** | F major triad (F-A-C) played over C7. The F major triad contains the notes F, A, and C. When stacked over C7 (C-E-G-Bb), the F (root of upper structure) functions as the #11 (enharmonically E#) above the C7 root, creating the C7#11 sound (C-E-G-Bb-F). This is the standard upper-structure voicing for dominant 7#11 chords in jazz. | ✓ |
| **haiku/+Rule+RAG** | F major triad (F–A–C) played over C7 bass. The F is the #11 (enharmonic to B♯). This upper structure creates the characteristic bright, altered dominant sound used in modern jazz and fusion. | ✓ |
| **sonnet/raw** | D major triad over C7 | ✓ |
| **sonnet/+Rule** | D major triad over C7: the D major triad (D, F#, A) supplies the 9, #11, and 13 above C7 (C, E, Bb), producing the C7#11 (Lydian dominant) sound. This is the upper-structure triad UST II (major triad built on the major 2nd/9th of the dominant chord). | ✓ |
| **sonnet/+Rule+RAG** | D major triad (D–F#–A) over C7: the F# is the #11, A is the 13, and D is the 9, producing a C7#11 (Lydian dominant) sound. | ✓ |

### B · `b16`
- **Q:** In a minor ii-V-i, the V7 chord typically uses which scale (over e.g. A7 to Dm)?
- **Accept:** `altered` / `harmonic minor` / `phrygian dominant` / `hmp5b` / `harmonic minor perfect 5th below`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Harmonic minor scale (the 5th mode, also called Phrygian dominant or Spanish Phrygian) | ✓ |
| **haiku/+Rule** | In a minor ii-V-i (e.g., Em7♭5–A7–Dm), the V7 chord (A7) typically uses the Mixolydian mode (5th mode of major), specifically the parent major key one perfect fifth above the minor tonic. For A7 resolving to Dm, use A Mixolydian (from D major). Alternatively, A7alt (altered scale = 7th mode of melodic minor) is common in jazz for color and tritone substitution effects. Standard choice: A Mixolydian; jazz choice: A altered. | ✓ |
| **haiku/+Rule+RAG** | Over A7 resolving to Dm in a minor ii-V-i (Dm7♭5–A7–Dm), use A altered (7th mode of melodic minor) or A half-whole diminished scale. A altered provides the characteristic ♭9, ♯9, ♯11, ♭13 tensions that resolve smoothly into D natural minor or D harmonic minor. Half-whole diminished (A–B–C–D♭–E♭–E–F♯–G) also yields the ♭9 and leading tone G♯ for strong resolution to D. | ✓ |
| **sonnet/raw** | Harmonic minor scale (specifically the 5th mode of D harmonic minor, also known as Phrygian Dominant: A B C D E F G#) | ✓ |
| **sonnet/+Rule** | {"answer":"Over A7 resolving to Dm (minor ii-V-i: Eø7 - A7 - Dm), the V7 chord (A7) typically uses the Altered scale (al… | ✓ |
| **sonnet/+Rule+RAG** | Over A7 resolving to Dm (V7 of i in D minor), the standard scale choices are: (1) A altered scale (7th mode of B♭ melodic minor), which provides ♭9, ♯9, ♭13 and strong chromatic tension toward Dm; (2) A half-whole diminished (octatonic), which yields ♭9, ♯9, ♮13 and a slightly less dissonant color. The altered scale is the primary recommendation for a minor ii-V-i context, as its ♭13 (F♮) aligns with the D natural/harmonic minor tonic and maximizes dominant tension before resolution. | ✓ |

### B · `b17`
- **Q:** What is the 'backdoor' dominant chord that resolves to Cmaj7?
- **Accept:** `Bb7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Bm7b5 - E7alt (or E7b9) resolves to Cmaj7. The backdoor dominant uses the VII chord (B) as the root of a dominant 7th chord, approaching Cmaj7 from a half-step above rather than a perfect fifth below like a traditional V7. | ✗ |
| **haiku/+Rule** | bVII7 (Bb7) resolving to Cmaj7. The 'backdoor dominant' is a flatted VII7 chord that approaches the tonic from below by half-step, functioning as a subdominant-colored dominant substitute. It uses the Mixolydian mode of the flatted VII scale degree and creates a plagal-dominant hybrid effect rather than the traditional V7→I resolution. | ✓ |
| **haiku/+Rule+RAG** | B♭7 (♭VII7 of C). In the context of C major, B♭7 functions as a backdoor dominant—a borrowed chord from C minor/Dorian that resolves up a half step to Cmaj7. This is a modal interchange dominant, darker and more oblique than a traditional V7→I cadence. | ✗ |
| **sonnet/raw** | Bb7 | ✓ |
| **sonnet/+Rule** | The backdoor dominant resolving to Cmaj7 is bVII7, which is Bb7. It is built on the flattened seventh scale degree (Bb in the key of C). Function: dominant substitute. It resolves by half-step contrary motion: Bb (root) steps down to A (maj7 of Cmaj7) while F (5th of Bb7) steps down to E (3rd of Cmaj7). Scale: Bb Mixolydian (4th mode of F major). Roman numeral analysis in C: bVII7 → Imaj7. Note: the backdoor dominant is distinct from the tritone substitute (subV7 = Db7); bVII7 approaches from a whole step below rather than a half step above. | ✓ |
| **sonnet/+Rule+RAG** | G7 is not a backdoor dominant — it is the standard V7 of C major that resolves to Cmaj7. The backdoor dominant to Cmaj7 would be Bb7 (bVII7 of C), which resolves up a whole step to Cmaj7. In the Misty context described, G7 → Cmaj7 is a conventional V7 → Imaj7 resolution in the key of C, not a backdoor cadence. | ✓ |

### B · `b18`
- **Q:** Which collection (scale) do you use over a fully diminished 7th chord, e.g. C°7?
- **Accept:** `whole half diminished` / `diminished scale` / `whole-half` / `octatonic` / `half-whole`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Locrian ♮2 (also called Locrian #2 or Super Locrian ♮2). For C°7, use C Locrian ♮2: C D ♭E ♭F ♭G ♭A ♭B. Alternatively, use the diminished scale (whole-half or half-whole pattern), which contains the chord tones and provides chromatic passing tones. | ✓ |
| **haiku/+Rule** | Over C°7 (fully diminished 7th), use the **8th mode of melodic minor** (also called **diminished scale** or **octatonic scale**). Specifically, the half-step/whole-step diminished scale: C–D♭–E♭–E–F♯–G–A–B♭–C. This scale contains the chord tones (C–E♭–G♭–B♭♭/A) and provides chromatic passing tones. Alternatively, use **Locrian ♮2** (3rd mode of melodic minor from E♭) or any transposition of the octatonic scale that fits the harmonic context. The diminished scale is standard because it preserves the symmetrical tritone structure of the °7 chord. | ✓ |
| **haiku/+Rule+RAG** | ```json {   "answer": "A fully diminished 7th chord (C°7 = C–E♭–G♭–B♭♭/A) is built on scale degree vii of a harmonic min… | ✗ |
| **sonnet/raw** | The diminished (octatonic) scale — alternating whole and half steps (or half and whole steps). For C°7, you would use the half-whole diminished scale (H-W-H-W-H-W-H-W): C, Db, Eb, E, F#, G, A, Bb, C. This scale is symmetric and repeats every minor third, matching all four notes of the fully diminished 7th chord. | ✓ |
| **sonnet/+Rule** | {"answer":"The standard choice is the diminished (octatonic) scale — specifically the half-whole diminished scale (alter… | ✓ |
| **sonnet/+Rule+RAG** | ```json {"answer":"Over a fully diminished 7th chord (e.g., C°7 = C–E♭–G♭–B♭♭/A), use the diminished (octatonic) scale —… | ✓ |

### B · `b19`
- **Q:** What is the relative minor of Gb major?
- **Accept:** `Eb minor` / `Ebm` / `Ebmin` / `D# minor` / `D#m`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Eb minor | ✓ |
| **haiku/+Rule** | Eb minor. Gb major and Eb minor share the same key signature (9 flats). Eb minor is the relative minor, located a minor third (3 semitones) below Gb major. | ✓ |
| **haiku/+Rule+RAG** | The relative minor of Gb major is Ebm (Eb natural minor). Relative minor is always 3 semitones below the major key: Gb - 3 semitones = Eb. | ✓ |
| **sonnet/raw** | Eb minor | ✓ |
| **sonnet/+Rule** | The relative minor of Gb major is Eb minor. Both share the same key signature (6 flats: Bb, Eb, Ab, Db, Gb, Cb). The relative minor is found on the 6th scale degree of the major scale: Gb(1) Ab(2) Ab(3) Bb(4) Cb(5) Db(6) — so the 6th degree is Eb, giving Eb natural minor (Eb Dorian b2... correction: Eb Aeolian, the 6th mode of Gb major). | ✓ |
| **sonnet/+Rule+RAG** | The relative minor of Gb major is Eb minor (Ebm). Eb is the 6th scale degree of Gb major (Gb–Ab–Bb–Cb–Db–Eb–F), and Ebm shares the same key signature of 6 flats. | ✓ |

### B · `b20`
- **Q:** A Dm7b5 is the iiø7 in which minor key?
- **Accept:** `C minor` / `Cm` / `Cmin`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | C minor | ✓ |
| **haiku/+Rule** | Dm7b5 is the iiø7 in C minor. The iiø7 chord is built on scale degree 2 of the harmonic minor scale, so if Dm7b5 is iiø7, the parent minor key is C minor (D is scale degree 2 of C minor). | ✓ |
| **haiku/+Rule+RAG** | Dm7♭5 is the iiø7 in C minor (and also in B♭ major, its relative major). In C minor, Dm7♭5 = ii-half-diminished. In B♭ major, Dm7♭5 = iii-half-diminished. The standard reference is C minor. | ✓ |
| **sonnet/raw** | C minor | ✓ |
| **sonnet/+Rule** | C minor. Dm7b5 (D–F–Ab–C) functions as iiø7 in C minor, where D is scale degree 2, and the chord is built on the 2nd degree of the C natural minor (or harmonic/melodic minor) scale. Its function is subdominant, typically resolving to G7 (V7) in a ii°7–V7–i progression in C minor. | ✓ |
| **sonnet/+Rule+RAG** | C minor (Dm7♭5 = iiø7 in C minor, functioning as subdominant in a minor ii-V: Dm7♭5 → G7 → Cm) | ✓ |

### B · `b21`
- **Q:** What is the name of the 5th mode of the harmonic minor scale?
- **Accept:** `Phrygian dominant` / `Phrygian major` / `Spanish Phrygian`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Lydian Dominant | ✗ |
| **haiku/+Rule** | Dominant (or Dominant b9). The 5th mode of harmonic minor is also called Phrygian Dominant or Spanish Phrygian. It functions as a dominant chord quality (e.g., V7b9) and contains the characteristic raised 7th of harmonic minor. | ✓ |
| **haiku/+Rule+RAG** | Dominant (or Dominant b9b13) | ✗ |
| **sonnet/raw** | Phrygian Dominant | ✓ |
| **sonnet/+Rule** | The 5th mode of the harmonic minor scale is called Phrygian Dominant (also known as Phrygian Major or Spanish Phrygian). Its formula is 1 b2 3 4 5 b6 b7. It is the scale built on the 5th degree of the harmonic minor, and it is the characteristic scale used over a V7 chord resolving to a minor tonic (e.g., E Phrygian Dominant over E7 resolving to Am). It contains a natural 3rd (major third) above the root, which provides the dominant-function leading tone, combined with a b2 giving it its characteristic Spanish/Middle-Eastern sound. | ✓ |
| **sonnet/+Rule+RAG** | Phrygian Dominant (also called Phrygian ♮3 or the 5th mode of harmonic minor). It is built on the 5th degree of the harmonic minor scale and produces the interval pattern 1, ♭2, 3, 4, 5, ♭6, ♭7. It is the scale used over a V7(♭9,♭13) chord resolving to a minor tonic — e.g., E Phrygian Dominant (5th mode of A harmonic minor) over E7(♭9) → Am. | ✓ |

### B · `b22`
- **Q:** Which mode of the melodic minor scale is the half-diminished scale (Locrian natural 2)?
- **Accept:** `6th mode` / `sixth mode`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | The seventh mode of the melodic minor scale is the half-diminished scale (Locrian natural 2), also called Locrian ♮2. | ✗ |
| **haiku/+Rule** | The half-diminished scale (Locrian ♮2) is the 2nd mode of melodic minor. It is built on the second scale degree of its parent melodic minor. For example, C Locrian ♮2 derives from B♭ melodic minor (B♭–C–D♭–E♭–F–G–A). | ✗ |
| **haiku/+Rule+RAG** | The half-diminished scale (Locrian ♮2) is the 2nd mode of the melodic minor scale. If C is the root of Locrian ♮2 (C–D–E♭–F–G–A♭–B♭), then B♭ melodic minor is the parent: B♭–C–D♭–E♭–F–G–A, and C is its 2nd mode. | ✗ |
| **sonnet/raw** | The 6th mode of the melodic minor scale | ✓ |
| **sonnet/+Rule** | The half-diminished scale (Locrian ♮2, also called Locrian #2) is the 6th mode of the melodic minor scale. Example: C half-diminished (C Locrian ♮2) derives from E♭ melodic minor. | ✓ |
| **sonnet/+Rule+RAG** | Locrian ♮2 is the 6th mode of the melodic minor scale. For example, D Locrian ♮2 derives from F melodic minor (F–G–A♭–B♭–C–D–E♭), starting on its 6th degree (D). | ✓ |

### B · `b23`
- **Q:** In Bb 'rhythm changes', the bridge is a cycle of dominant 7ths. Name the first chord of the bridge.
- **Accept:** `D7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | F7 | ✗ |
| **haiku/+Rule** | F7 (V7/Bb, functioning as the first chord in a cycle of dominant 7ths descending by whole step: F7–Bb7–Eb7–Ab7) | ✗ |
| **haiku/+Rule+RAG** | F7 (V7 in Bb major). In rhythm changes, the bridge modulates up a perfect fourth from the home key. From Bb, this lands on F, making F7 the dominant 7th that opens the bridge cycle. The bridge then typically cycles through secondary dominants (F7 – B♭7 – E♭7 – A♭7) or a similar chain of dominant 7ths, each resolving down by perfect fourths. | ✗ |
| **sonnet/raw** | D7 | ✓ |
| **sonnet/+Rule** | D7 (V7/V of Bb, functioning as III7 — the bridge begins on D7, which is the dominant of G7, starting a cycle-of-fifths sequence: D7 \| G7 \| C7 \| F7, each functioning as a secondary dominant resolving to the next, ultimately returning to Bb. D7 is labeled V7/vi in Bb major, or more precisely the start of a descending-fifths chain of dominant 7ths.) | ✓ |
| **sonnet/+Rule+RAG** | D7 (V7/V/V/V — the cycle of dominants in Bb rhythm changes runs D7 – G7 – C7 – F7, each a fifth apart, with D7 as the first chord) | ✓ |

### B · `b24`
- **Q:** What is the first chord of John Coltrane's 'Giant Steps'?
- **Accept:** `Bmaj7` / `B major` / `B`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | B major (Bmaj7) | ✓ |
| **haiku/+Rule** | Bmaj7 (Imaj7 in B major). Function: tonic. The tune begins in B major; this is the I chord establishing the home key center. | ✓ |
| **haiku/+Rule+RAG** | BMaj7 (I in B major). The tune begins in B major, though it immediately modulates through a cycle of major thirds (B → G → E♭) every few measures, establishing the characteristic 3-tonic system of the composition. | ✓ |
| **sonnet/raw** | Bmaj7 | ✓ |
| **sonnet/+Rule** | Bmaj7 — Roman numeral: Imaj7 in B major — Function: tonic — Scale: Ionian (B major). This is the opening chord of the B–D–G tonal cycle ('Coltrane changes'), establishing B major as the first of three equidistant tonal centers a major third apart. | ✓ |
| **sonnet/+Rule+RAG** | Bmaj7 | ✓ |

### B · `b25`
- **Q:** Barry Harris's major 6th-diminished scale on C adds which note to the C major scale?
- **Accept:** `Ab` / `G#`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Ab (the flat 6th) | ✓ |
| **haiku/+Rule** | Barry Harris's major 6th-diminished scale on C adds the diminished 7th (B♭) to the C major scale (C D E F G A B). The complete scale is: C D E F G A B♭ B. This creates an eight-note scale used for improvisation over major 6th chords and dominant 7th chords. | ✓ |
| **haiku/+Rule+RAG** | Barry Harris's major 6th-diminished scale on C adds A♭ (the ♭6) to the C major scale. The scale is C–D–E–F–G–A♭–A–B, creating an 8-note scale that alternates whole and half steps (W–W–H–W–W–H–W–H). This ♭6 degree enables smooth voice-leading through diminished passing chords and provides a chromatic bridge between the major 6th (A♮) and the 5th (G). | ✓ |
| **sonnet/raw** | A diminished 7th chord tone added between scale degrees, specifically the note C# (or Db) — actually the scale adds a chromatic passing tone: the major 6th diminished scale on C is C D E F G A Bb B, adding Bb (b7) to the C major scale | ✓ |
| **sonnet/+Rule** | Barry Harris's major 6th diminished scale on C takes the C major scale (C D E F G A B C) and adds a passing diminished tone between the 6th and 5th scale degrees: specifically, A♭ (or G#), inserted between A and G. This creates an 8-note scale: C D E F G A♭ A B (or equivalently C D E F G G# A B), allowing smooth voice-leading where the tonic triad (or maj6 chord) and a diminished 7th chord alternate on strong and weak beats. | ✓ |
| **sonnet/+Rule+RAG** | The Barry Harris major 6th-diminished scale on C is an 8-note scale built by inserting a chromatic passing tone between scale degrees 6 and 5. Specifically, it adds A♭ (♭6) to the C major scale, giving: C – D – E – F – G – A♭ – A – B (the diminished chord tones C, E, G, B alternate with major-scale tones, and the ♭6/A♭ is the added note that creates the symmetrical diminished pattern). | ✓ |

### B · `b26`
- **Q:** The Lydian augmented scale is which mode of the melodic minor scale?
- **Accept:** `3rd mode` / `third mode`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | The Lydian augmented scale is the 3rd mode of the melodic minor scale | ✓ |
| **haiku/+Rule** | The Lydian augmented scale is the 3rd mode of melodic minor. It contains the intervals: root, major 2nd, major 3rd, augmented 4th, perfect 5th, major 6th, major 7th. Example: C Lydian augmented = C D E F# G A B, which is the 3rd mode of Ab melodic minor (Ab Bb Cb Db Eb F G). | ✓ |
| **haiku/+Rule+RAG** | Lydian augmented is the 3rd mode of melodic minor. It contains the raised 4th (Lydian characteristic) and raised 5th (augmented characteristic). For example, C Lydian augmented = Eb melodic minor's 3rd mode. | ✓ |
| **sonnet/raw** | 3rd mode | ✓ |
| **sonnet/+Rule** | The Lydian augmented scale is the 3rd mode of the melodic minor scale. Starting on the 3rd degree of any melodic minor scale produces the Lydian augmented mode (scale degrees: 1, 2, 3, #4, #5, 6, 7), characterized by a raised 4th and raised 5th. For example, C Lydian augmented = 3rd mode of A melodic minor. | ✓ |
| **sonnet/+Rule+RAG** | The Lydian augmented scale is the 3rd mode of the melodic minor scale (built on the 3rd degree of melodic minor). | ✓ |

### B · `b27`
- **Q:** What is the leading tone in the key of C# harmonic minor?
- **Accept:** `B#`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | B# (enharmonically C) | ✓ |
| **haiku/+Rule** | B# (enharmonically C natural). In C# harmonic minor, the leading tone is the seventh scale degree, which is B#. It lies a half-step below the tonic C#. Enharmonically equivalent to C natural, but correctly spelled as B# to maintain proper scale-degree naming conventions. | ✓ |
| **haiku/+Rule+RAG** | B♯ (enharmonically C♮). In C# harmonic minor, the leading tone is the 7th scale degree, one semitone below the tonic. C# harmonic minor contains: C#–D#–E–F#–G#–A–B♯. B♯ resolves upward to C#. | ✗ |
| **sonnet/raw** | B# | ✓ |
| **sonnet/+Rule** | The leading tone in C# harmonic minor is B# (the raised 7th scale degree). In C# harmonic minor the scale is C#, D#, E, F#, G#, A, B#. The natural minor would have B♮, but harmonic minor raises the 7th by a half step, producing B#, which is a half step below the tonic C# and functions as the leading tone, creating the characteristic V7 dominant function (G#7: G#, B#, D#, F#). | ✓ |
| **sonnet/+Rule+RAG** | The leading tone in C# harmonic minor is B# (the raised 7th scale degree, a half step below the tonic C#). | ✓ |

### B · `b28`
- **Q:** What is the tritone substitute for the V7 chord in the key of F major?
- **Accept:** `Gb7` / `F#7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | B7 (or B♭7 enharmonically written as A#7). The tritone substitute shares the same tritone interval as V7, so in F major where V7 is C7, the tritone substitute is F#7 (or G♭7). | ✓ |
| **haiku/+Rule** | The tritone substitute for V7 in F major is bII7 (B♭7). V7 in F major is C7. Its tritone substitute shares the same tritone (B♮-F) and resolves enharmonically to the same tonic, functioning as subV7/I. B♭7 contains the pitches B♭-D-F-A♭, which enharmonically shares the tritone with C7 (C-E-G-B♭). | ✗ |
| **haiku/+Rule+RAG** | The V7 chord in F major is C7. Its tritone substitute is F#7 (or Gb7). Both C7 and F#7 share the same guide tones (E/Bb ≈ Bb/E enharmonically), allowing F#7 to function as a dominant substitute that resolves down a semitone to F major (F#7 → FMaj7), creating the characteristic half-step approach characteristic of tritone substitution. | ✓ |
| **sonnet/raw** | Db7 | ✗ |
| **sonnet/+Rule** | In F major, the V7 chord is C7 (C–E–G–Bb). Its tritone substitute (subV7) is the dominant 7th chord whose root lies a tritone away from C, which is Gb. Therefore, the tritone substitute is Gb7 (Gb–Bb–Db–Fb). Function: dominant (subV7 of F major). The shared tritone is E/Fb and Bb, which swap roles between the two chords. Gb7 typically resolves down by half step to Fmaj7. Scale: Gb Lydian dominant (4th mode of Db melodic minor). | ✓ |
| **sonnet/+Rule+RAG** | The V7 in F major is C7. Its tritone substitute is G♭7 (the root moves a tritone: C → G♭). Both chords share the same guide tones: C7 has E (3rd) and B♭ (7th); G♭7 has B♭/A♯ (3rd) and E/F♭ (7th) — enharmonically identical. G♭7 resolves down a semitone to FMaj7, functioning as subV7 (substitute dominant) with subdominant/dominant function. | ✗ |

### B · `b29`
- **Q:** In 'Autumn Leaves' (G minor), the A section opens with a ii-V-I in Bb major. Give the three chords.
- **Accept:** `Cm7 F7 Bbmaj7` / `Cm7F7Bbmaj7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Cm7 - F7 - Bbmaj7 | ✓ |
| **haiku/+Rule** | In G minor, the A section of 'Autumn Leaves' modulates to Bb major. The ii-V-I progression in Bb major consists of: (1) Cm7 [ii-7 in Bb], (2) F7 [V7 in Bb], (3) Bbmaj7 [Imaj7 in Bb]. Functions: subdominant → dominant → tonic (in the local key of Bb major). | ✗ |
| **haiku/+Rule+RAG** | The A section of Autumn Leaves in G minor opens with a ii-V-I in Bb major: Cm7 (ii) → F7 (V7) → BbMaj7 (I). These three chords establish the parent major key (Bb major) before the section modulates to its relative minor (Gm7) via the secondary ii-V-i progression Am7♭5 → D7 → Gm7. | ✗ |
| **sonnet/raw** | Cm7 - F7 - Bbmaj7 | ✓ |
| **sonnet/+Rule** | Local key center: Bb major. The ii-V-I consists of: (1) Cm7 — ii-7, subdominant function, Dorian mode (2nd mode of Bb major); (2) F7 — V7, dominant function, Mixolydian mode (5th mode of Bb major); (3) Bbmaj7 — Imaj7, tonic function, Ionian mode (1st mode of Bb major). | ✗ |
| **sonnet/+Rule+RAG** | Cm7 (ii-7 in Bb major) → F7 (V7 in Bb major) → BbMaj7 (Imaj7 in Bb major) | ✗ |

### B · `b30`
- **Q:** Which scale degree is the 'avoid note' when playing the C major (Ionian) scale over a Cmaj7 chord?
- **Accept:** `4th` / `fourth` / `11th` / `F`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | 4th degree (F) | ✓ |
| **haiku/+Rule** | The 4th scale degree (F) is the primary avoid note when playing C major (Ionian) over Cmaj7. F creates a dissonant major 11th interval above the root C and clashes with the major 3rd (E) in the chord. Secondary avoid note: the 7th scale degree (B) can also be problematic in certain contexts, though it's less critical than the 4th. | ✓ |
| **haiku/+Rule+RAG** | The 4th scale degree (F) is the avoid note when playing C major (Ionian) over Cmaj7. F is the 11th of the chord and creates a dissonant clash with the major 7th (B). Use C Lydian (raising the 4th to F♯) or simply avoid F in that register to maintain the bright, open quality of Cmaj7. | ✓ |
| **sonnet/raw** | The 4th scale degree (F natural) is the avoid note, as it creates a minor 9th interval against the major 3rd (E) of the Cmaj7 chord. | ✓ |
| **sonnet/+Rule** | The avoid note in C Ionian over Cmaj7 is scale degree 4 (F natural). It creates a minor 9th clash against the major 3rd (E), destabilizing the tonic major quality. All other diatonic tones (1, 2, 3, 5, 6, 7) are considered chord tones or color tones safe for emphasis. | ✓ |
| **sonnet/+Rule+RAG** | The 4th degree (F natural) is the avoid note over Cmaj7 in C Ionian. It creates a minor 9th clash with the major 3rd (E), disrupting the tonic-major function. Avoid sounding it on strong beats; use it as a passing tone only. | ✓ |

### B · `f01`
- **Q:** A triad is made of the notes G#, C#, and E. What is the root and quality of this chord? (Give root + quality.)
- **Accept:** `C# minor` / `C#minor` / `C#m` / `C#min` / `Csharp minor` / `C-sharp minor`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | C# major | ✓ |
| **haiku/+Rule** | Root: C#, Quality: major triad (C#maj or C#). The notes G# (major 5th), C# (root), and E (major 3rd) form a C# major triad. | ✓ |
| **haiku/+Rule+RAG** | Root: G#, Quality: major triad (G#maj or G#). Intervals from root: major 3rd (C#) and perfect 5th (E). | ✗ |
| **sonnet/raw** | C# major | ✓ |
| **sonnet/+Rule** | Root: C#, Quality: minor (C# minor triad) | ✓ |
| **sonnet/+Rule+RAG** | C# major triad (root: C#, quality: major). The notes C#–E–G# form a major triad: major third (C#–E = 4 semitones) plus minor third (E–G# = 4 semitones), totaling a perfect fifth (C#–G#). | ✓ |

### B · `f02`
- **Q:** The notes Bb, F, D, and A form a chord. Analyze it in Roman numerals in the context of F major (use the full Roman numeral with quality).
- **Accept:** `IVmaj7` / `IV7` / `IV△7` / `IVΔ7` / `IV maj 7` / `IV M7` / `BbMaj7` / `Bbmaj7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | ii7 (F major context: Bb-F-D-A = G minor 7th chord built on scale degree 2) | ✗ |
| **haiku/+Rule** | In F major: Bbmaj7#11 = IVmaj7#11. Function: subdominant. The chord contains F (root), Bb (perfect 4th), D (major 6th), A (major 3rd). Enharmonically respelled as a suspended/extended subdominant with added 11th above the root position F. | ✓ |
| **haiku/+Rule+RAG** | In F major, the chord Bb–F–D–A is **IVmaj7** (B♭maj7). Root position: B♭ (IV), F (I), D (III), A (VII). Quality: major 7th. Function: subdominant. This chord is diatonic to F major and typically serves as a subdominant preparation before dominant or tonic resolution. | ✓ |
| **sonnet/raw** | IVmaj7 | ✓ |
| **sonnet/+Rule** | Imaj7 (tonic function) — Bb, D, F, A = Bbmaj7, which in F major is IVmaj7 (subdominant function). Wait, re-examining: notes Bb, F, D, A. Root position stacking in thirds: Bb-D-F-A = Bbmaj7. In F major, Bb is scale degree 4, so this chord is IVmaj7 (subdominant function). | ✓ |
| **sonnet/+Rule+RAG** | In F major, the notes B♭, F, D, A form a B♭maj7 chord (B♭ = scale degree 4, D = 6, F = 8/1, A = 3 of B♭maj7). Roman numeral: IVmaj7. Function: subdominant. | ✓ |

### B · `f03`
- **Q:** In the key of E major, what is the full name of the seventh chord built on the third scale degree?
- **Accept:** `G# minor 7` / `G#m7` / `G#min7` / `G#-7` / `G sharp minor 7` / `Gsharp minor 7` / `Gsharpm7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | G# minor 7 flat 5 (G#m7b5) | ✓ |
| **haiku/+Rule** | iii-maj7 (G# minor major seventh). Built on the third scale degree of E major (G#), this chord contains the notes G#–B–D#–F## (enharmonically G#–B–D#–G). Function: tonic (relative minor tonic). The chord quality is minor triad with major seventh. | ✗ |
| **haiku/+Rule+RAG** | iii-7 (G#m7) — the third scale degree of E major is G#, and the diatonic seventh chord built on it is G#m7 (minor seventh). Full name: G sharp minor seven. | ✓ |
| **sonnet/raw** | G# minor 7 | ✓ |
| **sonnet/+Rule** | G#-7b5 (G-sharp half-diminished seventh chord), built on scale degree 3 (G#) in E major: iii∅7 — tonic function, Locrian mode (3rd mode of E major = B Locrian... correction: G# Locrian, 3rd mode of E major). Chord tones: G#–B–D#–F#. Roman numeral: iiiø7. | ✓ |
| **sonnet/+Rule+RAG** | G#m7 — built on scale degree 3 (G#) of E major: G#–B–D#–F#. Roman numeral: iii-7 (minor 7th chord). Function: tonic. Scale: G# Phrygian (3rd mode of E major). | ✓ |

### B · `f04`
- **Q:** Of the seven modes of the major scale (Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian), which ones contain a minor 7th interval relative to the tonic? List all that qualify.
- **Accept:** `Dorian, Phrygian, Mixolydian, Aeolian, Locrian` / `Dorian Phrygian Mixolydian Aeolian Locrian` / `Dorian, Phrygian, Mixolydian, Aeolian, and Locrian`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Dorian, Mixolydian, Aeolian, Locrian | ✗ |
| **haiku/+Rule** | Dorian, Phrygian, Aeolian, and Mixolydian contain a minor 7th (10 semitones) above the tonic. Ionian contains a major 7th. Lydian contains a major 7th. Locrian contains a minor 7th. | ✗ |
| **haiku/+Rule+RAG** | Dorian, Phrygian, Aeolian, and Locrian all contain a minor 7th interval (♭7) relative to the tonic. These are the four modes of the major scale with a lowered 7th degree. | ✗ |
| **sonnet/raw** | Dorian, Phrygian, Mixolydian, Aeolian, Locrian | ✓ |
| **sonnet/+Rule** | Dorian (b7), Phrygian (b7), Mixolydian (b7), Aeolian (b7), Locrian (b7). These five modes contain a minor 7th (b7) above the tonic. Ionian and Lydian contain a major 7th and therefore do not qualify. | ✗ |
| **sonnet/+Rule+RAG** | Dorian (mode 2), Phrygian (mode 3), Mixolydian (mode 5), Aeolian (mode 6), and Locrian (mode 7) all contain a minor 7th (♭7) relative to their own tonic. Ionian (mode 1) and Lydian (mode 4) have a major 7th, so they do not qualify. | ✗ |

### B · `f05`
- **Q:** A progression in Bb major is: Bb → G7 → C7 → F. What is the harmonic function of the G7 chord, expressed in Roman numerals?
- **Accept:** `V7/ii` / `V/ii` / `V7 of ii` / `five of two` / `V/2` / `V7/2` / `V(7)/ii`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | V7/V | ✗ |
| **haiku/+Rule** | VI7 (secondary dominant); function: dominant. G7 is the V7/ii, tonicizing the ii chord (Cm) that follows in the implied progression, but in the stated progression Bb→G7→C7→F, G7 functions as VI7 in Bb major with secondary dominant character, preparing the C7 (V7/V) that follows. | ✓ |
| **haiku/+Rule+RAG** | In B♭ major, G7 is vi7 (diminished quality implied by the dominant seventh on the vi scale degree). Functionally, G7 is a secondary dominant: V7/ii, preparing the resolution to Cm7 (ii). The progression Bb → G7 → C7 → F is a descending-fifths chain where each seventh chord acts as a dominant to the next chord down the circle of fifths. | ✓ |
| **sonnet/raw** | VI7 (secondary dominant V7/ii, functioning as V7 of Cm) | ✓ |
| **sonnet/+Rule** | In Bb major, G7 is VI7 (or V7/ii), functioning as a secondary dominant — specifically the dominant of ii (Cm7). It temporarily tonicizes the ii chord (C minor), giving it a dominant function within the local context. Roman numeral: V7/ii. | ✓ |
| **sonnet/+Rule+RAG** | In B♭ major, G7 is VI7 — a secondary dominant functioning as V7/ii (the dominant of Cm7, the ii chord). It prepares C7, which in turn functions as V7/V, creating an extended dominant chain: G7 (V7/ii) → C7 (V7/V) → F7 (V7) → B♭ (I). | ✓ |

### B · `f06`
- **Q:** The notes B, G, F, and A appear together as a chord in F major. Identify the chord (full name) and its harmonic function.
- **Accept:** `V9/V` / `V/V` / `V7/V` / `five of five` / `G9` / `G9(no 5)` / `G9 no 5th` / `G dominant 9`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Gm7b5 (G half-diminished seventh); Function: ii chord (supertonic) in F major | ✗ |
| **haiku/+Rule** | Chord: Gm7♭5 (G half-diminished seventh) \| Roman numeral: ii-ø7 in F major \| Function: subdominant (pre-dominant). The notes G-B♭-D♭-F form the ii-ø7 chord built on scale degree 2 of F major, serving a subdominant function to prepare dominant or tonic resolution. | ✗ |
| **haiku/+Rule+RAG** | Gm7 (ii-7); function: subdominant. In F major, the notes G–B♭–D–F form the ii chord. G is the root, B is the third (enharmonically B♭), F is the seventh, and A is absent—the chord is Gm7, the second scale degree. Harmonically, ii-7 functions as subdominant, typically leading to V or I in cadential progressions. | ✗ |
| **sonnet/raw** | The chord is G minor 7 (Gm7), built on the second scale degree of F major (G-Bb-D-F), but with the notes B, G, F, and A: G(root), B(major third - wait, B natural is not in F major). Re-examining: In F major the notes are F,G,A,Bb,C,D,E. B natural is not in F major. However, if we interpret B as Bb (the fourth scale degree), then Bb-D-F-A forms a Bbmaj7 chord (IV maj7), the subdominant with a major seventh, which has a subdominant harmonic function. The chord is BbMaj7 (B♭ major seventh), functioning as the IV chord (subdominant) in F major. | ✗ |
| **sonnet/+Rule** | {"answer":"Local key center: F major. Notes B, G, F, A (enharmonically respelled as needed) form the chord G-B-F-A (reor… | ✗ |
| **sonnet/+Rule+RAG** | The notes B, G, F, A form G-B-F-A (root G, major 3rd B, minor 7th F, major 9th... wait — reordering: G(root), B(major 3rd), F(minor 7th), A(major 9th)). This is G7 (dominant 7th), or with the A included, G9. In the key of F major, G7 is V7/V — the secondary dominant of the V chord (C7). Its harmonic function is secondary dominant, creating a momentary tonicization of C before resolving to C7 or FMaj7. Scale: G Mixolydian (5th mode of C major) for G7; if treated as G9, same scale applies. | ✓ |

### B · `f07`
- **Q:** In the key of E major, the chord G#7 resolves DECEPTIVELY. To which chord does it resolve? (Answer with the chord name.)
- **Accept:** `A major` / `Amaj7` / `A maj7` / `Amajor` / `Amajor7` / `IV major`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | A major | ✓ |
| **haiku/+Rule** | A major (vi chord in E major) | ✓ |
| **haiku/+Rule+RAG** | Cmaj7 | ✗ |
| **sonnet/raw** | C#m | ✗ |
| **sonnet/+Rule** | C#m7 | ✗ |
| **sonnet/+Rule+RAG** | C#m7 | ✗ |

### B · `f08`
- **Q:** The notes A, D, C, F#, and Eb appear together as a chord in the key of Eb major. Identify the chord (full name) and its function in Roman numerals.
- **Accept:** `V7b9/iii` / `V7♭9/iii` / `V/iii` / `D7b9` / `D7♭9` / `five seven flat nine of three` / `V7(b9)/iii`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Chord: Ebmaj7#11 (or Cmaj7b5). Function: IV (subdominant) in Eb major. The notes Eb-F#-A-C-D form a quartal/quintal structure built on the IV degree. | ✗ |
| **haiku/+Rule** | In Eb major: A, D, C, F# = Cmaj7#11 (enharmonically respelled as Cmaj7#11). Roman numeral: VI maj7#11. Function: secondary tonic or chromatic alteration. The F# is the raised 11th (chromatic upper structure). This chord is non-diatonic to Eb major and functions as a chromatic embellishment or secondary harmony, not a primary functional chord in the key. | ✗ |
| **haiku/+Rule+RAG** | The chord is Cmaj7#11 (or Cmaj7♯11). In the key of E♭ major, this is IVmaj7♯11. Function: subdominant with raised 11th (Lydian quality). The notes break down as: C (root), E (3rd), G (5th), B (7th), F♯ (♯11). This chord borrows the ♯11 from C Lydian mode, creating a bright subdominant color. It does NOT function as a diatonic chord in E♭ major (which would be IVmaj7 = Fmaj7); instead, it is a modal interchange or chromatic alteration of the subdominant. | ✗ |
| **sonnet/raw** | Let me analyze these notes: A, D, C, F#, Eb  Reordering: Eb, A, C, D, F#  Wait, let me think about this more carefully. … | ✗ |
| **sonnet/+Rule** | I need to analyze the chord built from notes A, D, C, F#, Eb in the key of Eb major.  Let me identify the chord: Notes: … | ✗ |
| **sonnet/+Rule+RAG** | {"answer":"The notes A, D, C, F# form a D7 chord (D dominant 7th: D–F#–A–C). Adding E♭ is enharmonically D#, which would… | ✗ |

### B · `f09`
- **Q:** A scale is spelled: G, A, Bb, C#, D, E, F. Identify this scale by name (or as a mode of a parent scale).
- **Accept:** `4th mode of D harmonic minor` / `fourth mode of D harmonic minor` / `Ukrainian Dorian` / `Romanian minor` / `Mi sheberach` / `4th mode harmonic minor`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | G Altered Scale (G7alt) / G Super Locrian bb7 | ✗ |
| **haiku/+Rule** | This scale cannot be identified as a standard jazz or classical scale. The spelling G, A, Bb, C#, D, E, F contains both Bb and C# (enharmonically B natural), which creates an augmented second (Bb to C#) and violates the structure of all standard modes, melodic minor derivatives, and altered scales. This is either a microtonal construct, a notational error, or a non-functional synthetic scale. If C# was intended as Bbb or Bb as B natural, clarification is needed. | ✗ |
| **haiku/+Rule+RAG** | ```json {   "answer": "This scale cannot be identified as a standard jazz scale. The spelling G, A, Bb, C#, D, E, F cont… | ✗ |
| **sonnet/raw** | Let me analyze the intervals:  G to A: whole step A to Bb: half step Bb to C#: augmented second (3 semitones) C# to D: h… | ✗ |
| **sonnet/+Rule** | {"answer":"This scale (G, A, Bb, C#, D, E, F) does not correspond to any standard diatonic mode, melodic minor mode, har… | ✗ |
| **sonnet/+Rule+RAG** | {"answer":"This is the G Hungarian Minor scale (also called G Double Harmonic Minor or G Gypsy Minor). Spelled: G, A, B♭… | ✗ |

### B · `f10`
- **Q:** What is the hidden harmonic function behind the diminished chord G#, F, D, B in the key of E minor? Express it in Roman numerals.
- **Accept:** `vii°7/IV` / `viio7/IV` / `vii dim7/IV` / `vii diminished 7/IV` / `V7b9/IV` / `V/IV` / `V7/IV` / `vii°/IV`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | vii°7/V (G# diminished 7th functioning as leading tone chord to the dominant A minor in E minor) | ✗ |
| **haiku/+Rule** | G#-F-D-B is a viiø7/V (half-diminished seventh, secondary dominant function) in E minor. G# is the leading tone to A (the dominant), F is the minor seventh, D is the perfect fifth, and B is the minor third. Function: dominant preparation. Roman numeral: viiø7/V. | ✗ |
| **haiku/+Rule+RAG** | In E minor, the diminished chord G♯–F–D–B is vii°7/V (diminished seventh chord built on the leading tone of B, the dominant). It functions as a secondary dominant preparation, leading to B7 or Bm. Roman numeral: vii°7/V. Function: secondary dominant (leading-tone diminished seventh). | ✗ |
| **sonnet/raw** | VII°7 (vii°7) — the fully diminished seventh chord built on the leading tone (D#/Eb enharmonically respelled), functioning as a leading-tone diminished seventh (vii°7) resolving to i in E minor. In Roman numerals: vii°7 | ✗ |
| **sonnet/+Rule** | {"answer":"In E minor, the chord G#-B-D-F (enharmonically Ab-B-D-F) is a fully-diminished 7th chord. It functions as a s… | ✗ |
| **sonnet/+Rule+RAG** | ```json {"answer":"In E minor, the chord G#–B–D–F (enharmonically G#dim7 or viidim7) functions as a fully diminished sev… | ✗ |

### B · `f11`
- **Q:** In a piece in Ab major, an E7 chord appears. Explain a possible harmonic function of this chord (use a standard theory name or a Roman-numeral analysis).
- **Accept:** `German sixth` / `German 6` / `Ger+6` / `augmented sixth` / `sub V7/V` / `subV/V` / `tritone substitute of Bb7` / `tritone sub for V` / `V/N` / `V of Neapolitan` / `V7/N`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | V7/IV - a secondary dominant chord that resolves to the IV chord (Eb major). E7 is the dominant seventh of Eb, functioning as a chromatic approach to the subdominant in Ab major. | ✗ |
| **haiku/+Rule** | In Ab major, E7 is a secondary dominant: V7/ii. It functions as a dominant chord resolving to the ii chord (Bbm7). The E7 chord (E-G#-B-D) contains the tritone G#-D, which resolves inward to the third and seventh of Bbm7 (B-F). This is a standard secondary dominant function, tonicizing the ii chord temporarily before resolution. | ✗ |
| **haiku/+Rule+RAG** | E7 in Ab major is a secondary dominant: V7/ii. It functions as a dominant 7th resolving to Bbm7 (the ii chord of Ab major). Roman numeral: V7/ii. Function: dominant (secondary). The E7 uses the mixolydian ♭9♭13 scale (E mixolydian with lowered 9th and 13th) or the altered scale (7th mode of E melodic minor) to approach the minor ii chord. Alternative: if E7 resolves deceptively or to another chord, it could be V7/V (toward Eb7) or part of a diminished axis substitution, but V7/ii is the most direct reading. | ✗ |
| **sonnet/raw** | {"answer":"The E7 chord in Ab major functions as a Secondary Dominant, specifically V7/V (five-seven of five). Ab major'… | ✗ |
| **sonnet/+Rule** | {"answer":"In Ab major, E7 functions as the subV7 (substitution dominant / tritone substitute) of V. The diatonic domina… | ✓ |
| **sonnet/+Rule+RAG** | {"answer":"Local key center: A♭ major. The E7 chord (root a major 3rd above the tonic A♭/G♯) is most readily explained a… | ✓ |

### B · `f14`
- **Q:** Suppose Ebm7 is the ii chord in Db major. Provide a V–I resolution that uses a TRITONE SUBSTITUTION for the V chord — give the three chord symbols ii → subV → I.
- **Accept:** `Ebm7 D7 Dbmaj7` / `Ebm7-D7-Dbmaj7` / `Ebm7 → D7 → Dbmaj7` / `Ebm7, D7, Dbmaj7` / `D7 Dbmaj7` / `D7-Dbmaj7` / `D7 to Dbmaj7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Ebm7 → G7 → Dbmaj7 | ✗ |
| **haiku/+Rule** | Ebm7 → A7 → Dbmaj7. The ii chord (Ebm7) resolves through a tritone substitution dominant (A7, which is subV7/I in Db major) to the tonic (Dbmaj7). A7 is the tritone substitute for Eb7, sharing the same tritone (G–B) that defines the V7→I resolution. | ✗ |
| **haiku/+Rule+RAG** | Ebm7 → G7 → DbMaj7. In Db major, Ebm7 is ii. The diatonic V is Ab7. The tritone substitute of Ab7 is Eb7 (enharmonically D#7), but the functional tritone sub that resolves smoothly to DbMaj7 is G7. G7 shares the tritone (G–B and Db–F) with Ab7, and G7 → DbMaj7 resolves by semitone voice-leading: G→Db (down 5), B→Db (up m3), D→Db (down 2), F→Db (down 5). This is the standard tritone substitution: ii → subV7/I → I. | ✗ |
| **sonnet/raw** | Ebm7 → Ab7 → Dbmaj7 uses normal V. With tritone substitution, the V chord Ab7 is replaced by D7 (tritone away). So: Ebm7 → D7 → Dbmaj7 | ✓ |
| **sonnet/+Rule** | Local key: Db major. The diatonic ii–V–I is Ebm7 → Ab7 → Dbmaj7. The tritone substitute of Ab7 is D7 (root a tritone away, sharing the same guide tones: C#/Db and G). Progression: Ebm7 (ii-7) → D7 (subV7) → Dbmaj7 (Imaj7). Scale for D7: Db melodic minor (7th mode = altered scale, a.k.a. 'super-Locrian'). | ✗ |
| **sonnet/+Rule+RAG** | Ebm7 → G7 → Dbmaj7. Local key: Db major. Ebm7 = ii-7 (subdominant function). The diatonic V7 is Ab7; its tritone substitute (subV7) is G7 (root a tritone away from Ab). G7 resolves by half-step bass motion (G→Db) to Dbmaj7 (Imaj7, tonic function). Scale over G7: G Lydian dominant (4th mode of Db melodic minor / melodic minor a half-step above the target). | ✗ |

## C · 설명 (8문항, LLM-judge 1-5)

LLM judge가 key-point 커버리지 + 정확성을 1~5점으로 채점.

### C · `c01`
- **Q:** Why does a tritone substitution (e.g. Db7 in place of G7 resolving to C) work? Explain the shared notes.
- **Key points (judge 기준):**
  - G7 and Db7 share the tritone (B and F), which are the 3rd and 7th guide tones
  - those guide tones resolve the same way into C (B→C, F→E)
  - creates smooth/chromatic bass motion Db→C
  - both are dominant function toward C

**haiku/raw** — judge **5/5**

> # Tritone Substitution: Shared Notes Explanation
> 
> A tritone substitution works because the two dominant chords share the same tritone interval, which is the most important harmonic element defining a dominant chord's function. In your example, G7 (G-B-D-F) and Db7 (Db-F-Ab-Cb/B) both contain the tritone F-B, which creates the characteristic tension that resolves to the third and root of the target chord C. When Db7 resolves to C, the F resolves down to E (the third of C) and B resolves up to C (the root)—the same resolution as G7 would provide. The tritone is the dominant's defining feature because it demands resolution; the other chord tones (the root and fifth) are less critical to the sound. This is why Db7 feels like a natural substitute: it delivers the same harmonic tension and resolution despite being a tritone away from G7, making it useful for voice leading, chromatic movement, or simply adding harmonic color.

**haiku/+Rule** — judge **5/5**

> # Tritone Substitution: Shared Notes and Function
> 
> A tritone substitution works because the two dominant chords share the same **tritone interval**, which is the most essential voice-leading element in V7 resolution. In your example: **G7 (G–B–D–F) and Db7 (Db–F–A–C)** both contain the tritone **B–F** (enharmonically F–B). This tritone is the defining dissonance that demands resolution—B resolves up to C, and F resolves down to C, creating the characteristic V7→I pull.
> 
> The **shared notes** are F and B (the tritone itself), which remain stationary while the root moves down a half-step (G→Db). This smooth voice-leading—keeping the tritone fixed while substituting the root—makes the substitution sound natural and functional. Functionally, both chords are **dominant function** (V7 and subV7/I, the tritone substitute), so Db7 can seamlessly replace G7 before resolving to Cmaj7. The tritone substitution is particularly useful in jazz for creating chromatic bass lines and adding harmonic color while maintaining the same underlying tension-and-resolution logic.

**haiku/+Rule+RAG** — judge **5/5**

> # Tritone Substitution: Shared Guide Tones
> 
> A tritone substitution works because **the two dominant chords share the same 3rd and 7th**—the guide tones that define a dominant's harmonic identity and resolution tendency.
> 
> **Example: G7 vs. D♭7 resolving to CMaj7**
> 
> - **G7** contains B (3rd) and F (7th)
> - **D♭7** contains F (3rd) and C♭/B (7th)
> 
> Both chords have the same guide-tone dyad: **B and F** (enharmonically C♭). When G7 resolves to C, the B wants to move up to C and the F wants to move down to E. When D♭7 substitutes for it, those same guide tones follow the identical resolution path—so the ear hears the same harmonic function, even though the root moved a tritone down (G → D♭).
> 
> **The bonus:** D♭7's root descends by semitone into C, creating a smoother bass line than G7's ascending fourth. This is why tritone subs sound "hipper" and more modern—they preserve harmonic logic while adding voice-leading elegance. The substitution works for *any* dominant (V7, V7/ii, V7/IV, etc.) because the guide-tone principle is universal.

**sonnet/raw** — judge **5/5**

> A tritone substitution works primarily because the two dominant seventh chords a tritone apart share the same two most harmonically active notes — the **third and seventh** — just with their roles swapped. In a G7 chord, the third is B and the seventh is F; these two notes form a tritone interval, and they are the ones that create the tension demanding resolution to C. In a Db7 chord, the third is F and the seventh is Cb (enharmonically B) — the exact same two pitches, just with their functions exchanged. Since those critical guide tones are identical, the ear hears the same essential tension and accepts the same resolution to Cmaj. As a bonus, the Db7 also offers smooth **chromatic voice leading** in the bass: Db moves down a half step to C, which is even more stepwise and satisfying than the G's descending fifth resolution. So the substitution works on two levels — shared tritone content and elegant bass motion.

**sonnet/+Rule** — judge **5/5**

> ## Tritone Substitution: Why It Works
> 
> **Local key center: C major. G7 = V7; Db7 = subV7 (tritone substitute).**
> 
> The tritone substitution works because **G7 and Db7 share the same tritone interval**, just with the two voices swapped in function. In G7, the tritone is formed by the **third (B) and seventh (F)**. In Db7, the third is **F** and the seventh is **Cb (= B enharmonically)**. Those are the exact same two pitches — B and F — which are the critical **tendency tones** that resolve into the tonic chord: B resolves up a half step to C (the root of Imaj7), and F resolves down a half step to E (the third of Imaj7). Because both dominant seventh chords contain this identical tritone, both produce the same voice-leading resolution into Cmaj7.
> 
> The additional advantage is that **Db7 introduces smooth chromatic bass motion**: Db moves down by half step to C, rather than G leaping down a fifth. This creates a **descending semitone bass line** (Db → C), which is smoother and more linear than the authentic cadence bass motion.
> 
> **Formally:** Db7 is labeled **subV7/I** — a substitute dominant functioning as a **dominant-function chord**, built on the tritone (b2̂) of the local key, using the **7th mode of melodic minor (altered scale)** or Lydian dominant as its associated scale.

**sonnet/+Rule+RAG** — judge **1/5**

> 

---

### C · `c02`
- **Q:** Explain the 'backdoor ii-V' (e.g. Fm7–Bb7 resolving to Cmaj7).
- **Key points (judge 기준):**
  - Fm7–Bb7 is the ii-V of Eb (relative/parallel), borrowed from C minor
  - Bb7 is the bVII7 of C
  - it resolves deceptively/by common tones to Cmaj7 instead of Eb
  - common substitute for the standard ii-V (Dm7-G7)

**haiku/raw** — judge **2/5**

> # The Backdoor ii-V
> 
> The backdoor ii-V is a chromatic approach to a major chord that mimics the traditional ii-V-I progression but approaches from *below*. Instead of the expected V chord a perfect fifth above your target (G7 to Cmaj7), you use a dominant chord a half-step *above* the target (Bb7), preceded by its ii chord (Fm7). So Fm7–Bb7–Cmaj7 creates smooth voice leading: the Bb7 resolves down by half-step to the C, and the tritone (F–B) in Bb7 resolves inward to the third and root of Cmaj7. It's called "backdoor" because you're sneaking in from the chromatic back entrance rather than the traditional diatonic front door. This substitution works beautifully in ballads and standards, offering a sophisticated, unexpected harmonic color while maintaining strong resolution.

**haiku/+Rule** — judge **3/5**

> # The Backdoor ii–V
> 
> The **backdoor ii–V** is a chromatic dominant substitution that approaches the tonic from *below* rather than above. In your example (Fm7–Bb7→Cmaj7 in C major):
> 
> - **Fm7** functions as a **iv-7** (subdominant, built on the ♭VI scale degree)
> - **Bb7** functions as a **♭VII7** (a tritone substitute for the V7, or equivalently, the subV7/I—the "backdoor" dominant)
> - Together they create a **iv-7–♭VII7** progression that resolves deceptively to **Imaj7**
> 
> **Why "backdoor"?** The ♭VII7 chord is enharmonically related to the V7 (they share the same tritone), but it approaches the tonic by descending a half-step rather than rising a perfect fifth. This gives it a smoother, more chromatic voice-leading quality—especially in the bass (Bb→C is a half-step up, but the chord quality moves downward).
> 
> **Scales involved:** Fm7 uses the 4th mode of C major (F Dorian), while Bb7 borrows from C Phrygian dominant (the 5th mode of F harmonic minor), creating a bluesy, modal-interchange flavor common in jazz standards and blues.

**haiku/+Rule+RAG** — judge **3/5**

> # The Backdoor ii–V
> 
> The **backdoor ii–V** is a chromatic dominant substitution that approaches the tonic from *below* rather than above. In your example (Fm7–Bb7→Cmaj7 in C major):
> 
> - **Fm7** functions as a **iv-7** (subdominant, built on the ♭VI scale degree)
> - **Bb7** functions as a **♭VII7** (a tritone substitute for the V7, or equivalently, the subV7/I—the "backdoor" dominant)
> - Together they create a **iv-7–♭VII7** progression that resolves deceptively to **Imaj7**
> 
> **Why "backdoor"?** The ♭VII7 chord is enharmonically related to the V7 (they share the same tritone), but it approaches the tonic by descending half-step in the bass (Bb→C) rather than the traditional V7 ascending fifth resolution (G→C). This gives it a smoother, more oblique character—common in blues, funk, and modern jazz.
> 
> The scales involved: Fm7 uses **F Dorian** (4th mode of C major); Bb7 uses **Bb Mixolydian** (5th mode of Eb major) or **Bb altered** depending on extensions. The progression feels bluesy and contemporary precisely because it sidesteps the leading-tone pull of traditional V–I harmony.

**sonnet/raw** — judge **4/5**

> ## The Backdoor ii-V
> 
> The backdoor ii-V is a substitution that approaches a major tonic chord from a half-step **above** rather than from the standard dominant a fifth above. In the key of C major, instead of the diatonic Dm7–G7–Cmaj7, you use **Fm7–Bb7–Cmaj7**. The Fm7 and Bb7 are borrowed from the parallel minor key (C minor/Eb major), making Bb7 the bVII7 chord of C major. What gives it its characteristic sound and resolution logic is the **Bb7's voice leading**: its third (D) resolves up a half step to E (the major third of Cmaj7), and crucially, its **b7 (Ab) resolves down a half step to G** (the fifth of Cmaj7) — mirroring the way a standard dominant 7th resolves, just from a different direction. The name "backdoor" reflects the idea that you're sneaking into the tonic from an unexpected angle. It's a smooth, bluesy-sounding resolution frequently heard in jazz and R&B, and it works especially well because the Bb7 can be thought of as a tritone substitute for E7, the secondary dominant of A, creating a chain of half-step resolutions.

**sonnet/+Rule** — judge **5/5**

> ## The Backdoor ii–V
> 
> **Local key center: C major**
> 
> | Chord | Roman Numeral | Function |
> |-------|--------------|----------|
> | Fm7 | iv-7 | Subdominant (borrowed, parallel minor) |
> | Bb7 | bVII7 | Dominant substitute (backdoor dominant) |
> | Cmaj7 | Imaj7 | Tonic |
> 
> ---
> 
> ### Analysis
> 
> **Fm7** is borrowed from C minor (iv-7), giving it a subdominant function. **Bb7** is the bVII7 — a dominant-functioning chord that resolves up a **whole step** to the tonic, rather than down a fifth like a conventional V7. Together, Fm7–Bb7 form a **ii–V relationship in the key of Eb major** (ii-7–V7 of Eb), making Bb7 a **subV7** only in the sense that it substitutes for the dominant, though technically it is more precisely labeled **bVII7** rather than a tritone substitution of V7 (those are distinct concepts — don't conflate them).
> 
> ### Scale Choice
> - **Bb7** typically takes **Bb Mixolydian** (4th mode of F major), since the resolution is smooth and diatonic tension is preferred — **not** the altered scale, which would create unnecessary chromatic friction against Cmaj7.
> 
> ### Why It Works
> The Bb7→Cmaj7 resolution is smooth because **Bb and Eb** (the 7th and 3rd of Bb7) resolve by **half step and whole step** into the chord tones of Cmaj7, providing strong voice-leading despite the uncon

**sonnet/+Rule+RAG** — judge **5/5**

> ## The Backdoor ii–V
> 
> **Local key center: C major**
> 
> | Chord | Roman Numeral | Function |
> |-------|--------------|----------|
> | Fm7 | iv-7 | Subdominant (borrowed, parallel minor) |
> | Bb7 | bVII7 | Dominant substitute (backdoor dominant) |
> | Cmaj7 | Imaj7 | Tonic |
> 
> ---
> 
> ### Analysis
> 
> **Fm7** is borrowed from C minor (iv-7), giving it a subdominant-minor color. **Bb7** is the bVII7 — a dominant-function chord that resolves up a **whole step** to Imaj7, rather than down a fifth like a conventional V7. This is the defining voice-leading signature of the backdoor: the **b7 of Bb7 (Ab) resolves down by half step to G (the 5th of Cmaj7)**, while the **3rd (D) resolves up to E**, mimicking the leading-tone pull of a standard V7–I despite the unconventional root motion.
> 
> Bb7 functions as a **subV7/I** only if approached as a tritone substitute for F7 (V7/IV area) — but more precisely, the backdoor label emphasizes its **bVII7 identity**, not tritone substitution. The appropriate scale over Bb7 in this context is **Mixolydian (b7 mode of Eb major)**, not the altered scale, preserving the Ab that creates the smooth voice leading into Cmaj7.

---

### C · `c03`
- **Q:** Why is the altered scale a good choice over a V7alt chord (e.g. G7alt going to C)?
- **Key points (judge 기준):**
  - it contains the altered tensions b9, #9, #11(b5), b13(#5)
  - it is the 7th mode of the melodic minor (Ab melodic minor over G7)
  - those tensions create maximum tension that resolves strongly to the I
  - it omits the natural 5th and 9th

**haiku/raw** — judge **3/5**

> # The Altered Scale and V7alt
> 
> The altered scale is an excellent choice over V7alt because it contains all the altered extensions (b9, #9, #11, b13) that define the chord's sound, while the natural scale degrees don't. When playing G7alt resolving to C, the altered scale (G Bb Db Eb F Ab B) gives you those characteristic dissonant tensions—like the b9 (Ab) and #11 (B)—that create strong pull toward the resolution. This makes the scale perfectly aligned with the chord's harmonic function: it emphasizes the exact color the chord is meant to have. Plus, the altered scale's half-step relationships (like B down to C) reinforce voice-leading smoothness into the tonic, making it both theoretically sound and practically musical for soloing or comping.

**haiku/+Rule** — judge **3/5**

> # Altered Scale Over V7alt
> 
> The **altered scale (7th mode of melodic minor)** is an excellent choice over V7alt because it contains *all nine chromatic alterations* the dominant chord can accommodate: ♯9, ♭9, ♯11, and ♭13. 
> 
> When G7alt resolves to Cmaj7, playing G altered (G–A–B♭–B♮–C♯–D♯–E–F♯) gives you:
> - **Chord tones**: G (root), B (3rd), D (5th), F (♭7)
> - **Altered extensions**: A (♯9), B♭ (♭9), C♯ (♯11), D♯ (♭13)
> 
> This creates maximum harmonic tension and color while remaining consonant with the underlying V7 function. The scale's half-step leading tones (E→F, C♯→C, D♯→E) reinforce the pull toward the tonic, making the resolution feel inevitable. It's functionally superior to playing the parent major scale (which lacks alterations) or the diminished scale (which obscures the dominant's root and 3rd).

**haiku/+Rule+RAG** — judge **4/5**

> # Why Altered Scale Works Over V7alt
> 
> The **altered scale** (7th mode of melodic minor, built a half-step above the target root) is the ideal choice over V7alt because it contains all the upper-structure tensions the dominant demands while resolving smoothly to the tonic.
> 
> Over **G7alt → C**, use **A♭ melodic minor** (G altered). This scale gives you the tritone (B–F), the ♭9 (A♭), ♯9 (A♯), ♭5 (D♭), and ♯5 (D♯)—all the "altered" color tones. Crucially, every tension has a clear resolution: the tritone resolves inward (B→C, F→E), the ♭9 and ♯9 resolve by half-step, and the raised/lowered 5ths pull toward chord tones of Cmaj7. The altered scale is *built* for this resolution, so it feels inevitable rather than random. In contrast, playing G Mixolydian (natural 9, natural 5) over G7alt would contradict the chord's altered identity. The altered scale is the harmonic language that matches the V7alt's function: maximum tension, maximum directed release.

**sonnet/raw** — judge **5/5**

> The altered scale works perfectly over a V7alt chord because it contains all the altered tensions that give the chord its characteristic tension and color. Built from the 7th mode of the melodic minor (so G altered comes from Ab melodic minor), it provides the root, b7, and major 3rd that define the dominant 7th chord, while also including the b9, #9, b5 (#11), and b13 — every possible altered tension simultaneously. These altered tones create maximum harmonic tension and dissonance, which makes the resolution to the I chord (C major or C minor) feel especially strong and satisfying. Because the scale is so tense and "outside" sounding, the ear craves the release that the tonic chord provides, reinforcing the fundamental tension-resolution dynamic that drives jazz harmony forward.

**sonnet/+Rule** — judge **5/5**

> ## The Altered Scale Over V7alt
> 
> **Local key center: C major. Chord function: G7 = V7 (dominant).**
> 
> ---
> 
> The altered scale is the **7th mode of melodic minor** — specifically, starting on G, it derives from **Ab melodic minor**. Its intervallic content is: `1, b2, #2, 3, b5, #5, b7` (equivalently: b9, #9, b5/#11, b13 alongside the essential tritone of 3 and b7).
> 
> This makes it an ideal match for V7alt because **every available tension is an altered tension** — there are no natural 9, 11, or 13 present to create ambiguity or clash. The scale simultaneously supplies:
> 
> - **b9 and #9** (both altered ninths)
> - **#11/b5** (altered eleventh, reinforcing tritone substitution color)
> - **b13/#5** (altered thirteenth)
> 
> Crucially, the scale **preserves the defining dominant tritone** (B and F, the 3rd and b7 of G7), so the chord's dominant *function* and its pull toward resolution to Cmaj7 remain fully intact. You get maximum chromatic tension and voice-leading pressure — particularly the **b13→5 and b9→root** half-step resolutions into C — while never undermining the chord's functional identity. The altered scale is therefore the most *efficiently tense* scale available over a dominant chord.

**sonnet/+Rule+RAG** — judge **1/5**

> 

---

### C · `c04`
- **Q:** Explain modal interchange (borrowed chords) and give a clear example of borrowing iv in a major key.
- **Key points (judge 기준):**
  - borrowing chords from the parallel mode/key (e.g. parallel minor)
  - iv in C major = Fm (or Fm7) borrowed from C minor
  - creates a darker/plagal color, often iv→I
  - common examples: bVII, bVI, iv, iiø7

**haiku/raw** — judge **4/5**

> # Modal Interchange (Borrowed Chords)
> 
> Modal interchange occurs when you borrow chords from the parallel minor key (same root, different mode) to add color and emotional depth to a major key progression. Since C major and C minor share the same root but different scales, you can "borrow" chords from C minor and use them in C major, even though they don't naturally occur there.
> 
> ## Example: Borrowing iv in C Major
> 
> In **C major**, the iv chord doesn't naturally exist—you'd normally have IV (F major). However, you can borrow **iv (F minor)** from C minor to create a darker, more melancholic sound. A typical progression might be: **C major – F minor – G – C major** (I – iv – V – I). The F minor chord creates emotional tension that resolves when you return to C major, giving the progression more sophistication than a standard I–IV–V–I. This technique is common in pop, rock, and jazz to add harmonic interest without modulating away from the home key.

**haiku/+Rule** — judge **4/5**

> # Modal Interchange & Borrowed Chords
> 
> **Modal interchange** (also called borrowed chords or modal mixture) occurs when a chord from the parallel minor key is borrowed and used in a major key—or vice versa. This enriches harmonic color by temporarily accessing the darker, more introspective palette of the parallel mode.
> 
> **Mechanism:** In C major, the parallel minor is C natural minor (C Aeolian). Chords available in C minor but not C major include iv-7 (F-A♭-C-E♭), vi°7 (A°7), and ♭VI (F major). When you use one of these in C major, you're borrowing from the parallel mode.
> 
> **Clear example—iv in major:** In C major, the iv-7 chord (F-A♭-C-E♭) is borrowed from C natural minor. Functionally, it acts as a **subdominant**, often appearing before V7 or I. A typical progression: **Imaj7 | iv-7 | V7 | Imaj7**. The A♭ (lowered 6th scale degree) creates a poignant, introspective color while maintaining forward harmonic motion. This is extremely common in jazz ballads and standards—it adds emotional depth without modulating away from the home key.

**haiku/+Rule+RAG** — judge **4/5**

> # Modal Interchange (Borrowed Chords) in Jazz
> 
> **Modal interchange** is borrowing chords from parallel modes of the same root. In a major key, you can borrow from the natural minor (Aeolian), Dorian, Phrygian, and other modes of that root. The most common borrowed chord is **iv** (minor subdominant) from the natural minor mode—for example, in F major, borrowing **Bbm7** from F natural minor. This iv functions as a subdominant-minor color, adding warmth and darkness before resolving to V or I.
> 
> **Clear example in C major:**
> - Center key: **C major**
> - Borrowed chord: **Fm7** (iv from C natural minor/Aeolian)
> - Function: Subdominant-minor
> - Typical progression: **Cmaj7 | Fm7 | Bbmaj7 | Cmaj7** or **Cmaj7 | Fm7 | B♭7 | Cmaj7**
> 
> The Fm7 creates a modal interchange color without leaving C major's harmonic orbit. More dramatic borrowings include ♭VII (from Dorian) and ♭II (from Phrygian), but iv is the foundational and most musical choice in jazz standards.

**sonnet/raw** — judge **5/5**

> ## Modal Interchange (Borrowed Chords)
> 
> Modal interchange is the technique of temporarily borrowing chords from a parallel mode — a mode that shares the same root but has a different scale structure — and inserting them into a progression in your home key. The borrowed chord creates a colorful contrast because it contains notes foreign to the home key, yet the tonic center remains clear, so the ear accepts the "visitor" before returning home. The most common source in a major key is the parallel natural minor (Aeolian), which supplies several darkened, flattened chords.
> 
> ---
> 
> **Example: Borrowing iv in C major**
> 
> In C major, the diatonic iv chord would normally be a **minor iv** only in minor keys. The home key gives us **IV = F major (F–A–C)**. But borrowing from **C natural minor (C Aeolian)**, we get **iv = F minor (F–A♭–C)**. A classic progression using this:
> 
> > **I → IV → iv → I**
> > **C major → F major → F minor → C major**
> 
> The moment F minor arrives, the A♭ creates a poignant, bittersweet pull that the ear immediately feels as "darker," yet the return to C major feels completely natural. You hear this move constantly in pop, jazz, and classical music — it's one of the most emotionally effective borrowed chords available.

**sonnet/+Rule** — judge **5/5**

> ## Modal Interchange (Borrowed Chords)
> 
> **Modal interchange** (also called *modal mixture*) is the practice of temporarily borrowing chords from the **parallel mode** — a mode sharing the same tonic but a different scale structure — and inserting them into a progression without fully modulating. The tonic pitch center remains stable; only the chord quality shifts, creating a coloristic darkening or brightening effect.
> 
> ---
> 
> ### Classic Example: Borrowing **iv-7** in C Major
> 
> **Local key center: C major**
> 
> | Chord | Roman Numeral | Source | Function |
> |-------|--------------|--------|----------|
> | Cmaj7 | **Imaj7** | C Ionian | Tonic |
> | F-7 | **iv-7** | C Aeolian (parallel minor) | Subdominant — *borrowed* |
> | G7 | **V7** | C Ionian / Mixolydian | Dominant |
> | Cmaj7 | **Imaj7** | C Ionian | Tonic |
> 
> The **iv-7** (F minor 7) is borrowed from **C Aeolian** (the 6th mode of E♭ major). Its defining color is the **♭6 scale degree** (A♭), which replaces the diatonic A♮ of C major. This creates a poignant, bittersweet pull — the iv-7 retains subdominant function but with a distinctly darker, more plaintive quality before resolving back through V7 to the tonic.

**sonnet/+Rule+RAG** — judge **5/5**

> ## Modal Interchange (Borrowed Chords)
> 
> **Modal interchange** means borrowing a chord from a parallel mode — a different mode built on the *same root* as your home key. In a major key (Ionian), the most common source is the **parallel natural minor (Aeolian)**, though you can also borrow from parallel Dorian, Phrygian, Lydian, or Mixolydian. The borrowed chord temporarily introduces chromatic color without abandoning the tonal center, because the root stays fixed.
> 
> ---
> 
> ### Classic Example: Borrowing **iv-7** in C Major
> 
> **Local key center: C major**
> 
> | Chord | Roman Numeral | Source | Function |
> |-------|--------------|--------|----------|
> | Cmaj7 | **Imaj7** | C Ionian | Tonic |
> | Fm7 | **iv-7** | C Aeolian (= E♭ major key) | Subdominant minor |
> | G7 | **V7** | C Ionian | Dominant |
> | Cmaj7 | **Imaj7** | C Ionian | Tonic |
> 
> The **Fm7** (iv-7) is borrowed from **C natural minor**. Its defining color is the **♭6 (A♭)**, which is absent from C major. This A♭ creates a darker, more yearning subdominant quality compared to the diatonic **IVmaj7 (Fmaj7)**. The voice-leading is especially smooth: A♭ resolves down a half step to G in the V7, then B (the leading tone) resolves up to C — a beautifully chromatic inner-voice

---

### C · `c05`
- **Q:** What is the function of a secondary dominant (e.g. V7/V) and how does it create forward motion?
- **Key points (judge 기준):**
  - a dominant chord that targets a chord other than the I (tonicizes it)
  - V7/V in C = D7 targeting G7
  - introduces a chromatic leading tone (F# for D7) outside the key
  - creates momentum/pull toward the target chord

**haiku/raw** — judge **3/5**

> # Secondary Dominants and Forward Motion
> 
> A secondary dominant (like V7/V) is a dominant seventh chord that resolves to a chord other than the tonic—in this case, the V chord. It functions by **temporarily tonicizing** a non-tonic chord, treating it as a temporary tonal center. This creates forward motion because the V7/V chord carries the same strong pull toward resolution that a regular V7 has toward I, but instead of resolving home, it propels the harmony toward the next chord (V), which then continues the progression. Essentially, it borrows the dominant-to-tonic relationship and applies it mid-phrase, creating a sense of harmonic momentum and preventing stagnation. The listener hears the V7/V as a "detour" that adds urgency and interest while keeping the music moving toward the eventual resolution, making the overall progression feel more dynamic and sophisticated than simple diatonic harmony alone.

**haiku/+Rule** — judge **4/5**

> # Secondary Dominant Function & Forward Motion
> 
> A **secondary dominant** (e.g., V7/V) is a dominant chord that resolves to a chord *other than the tonic*—in this case, the V chord. Its function is **dominant**, but applied locally to a non-tonic goal. It creates forward motion through two mechanisms:
> 
> 1. **Harmonic tension & resolution**: The V7/V contains a tritone (between its 3rd and 7th) that demands resolution. When it resolves down a half-step to the V chord, that tritone resolves inward, satisfying the ear's expectation and propelling the harmony forward.
> 
> 2. **Tonicization**: By treating the V chord momentarily as a "local tonic," the secondary dominant creates a brief harmonic detour that feels like a mini-modulation. This breaks up static harmony and generates momentum toward the actual tonic resolution that typically follows.
> 
> **Example**: In C major, a ii–V7/V–V–I progression feels more energized than ii–V–I alone, because the V7/V "announces" the V chord's arrival, making the final I resolution feel earned and inevitable. This is why secondary dominants are essential in jazz comping and improvisation—they add harmonic interest and propel the line forward without leaving the home key.

**haiku/+Rule+RAG** — judge **3/5**

> # Secondary Dominant Function & Forward Motion
> 
> A **secondary dominant** (e.g., V7/V, V7/ii, V7/vi) is a dominant 7th chord built on *any scale degree other than 1*, resolving to that target chord as if it were a temporary tonic. Its function is **dominant**—it creates harmonic tension and *demands* resolution down the cycle of fifths.
> 
> **How it drives forward motion:**
> 
> 1. **Tonicization**: V7/V treats the V chord momentarily as a local tonic, creating a mini V-I cadence *within* the larger key. This adds urgency and direction.
> 
> 2. **Cycle-of-fifths momentum**: Each secondary dominant pulls the ear toward its target by the strongest harmonic gravity in jazz—the perfect fifth. A7 → D, F7 → Bb, G7 → C all feel inevitable.
> 
> 3. **Tension stacking**: When secondary dominants chain together (as in the examples above—A7 → D7 → G7 → C, or Em7♭5–A7 → Dm7♭5–G7 → Cm7♭5–F7), each resolution becomes the *next* dominant, creating a cascading descent that propels the solo forward until final resolution to the tonic.
> 
> 4. **Altered extensions** (♭9, ♭13) amplify this tension, making the resolution feel more earned and satisfying.
> 
> In short: secondary dominants are **harmonic accelerators**—they bypass the diatonic path and force chromatic, goal-directed motion.

**sonnet/raw** — judge **5/5**

> A **secondary dominant** is a dominant seventh chord built on a scale degree other than the tonic, temporarily treating a chord other than the tonic as if it were a local "I." For example, in the key of C major, the V7/V (D7) borrows from the world of G major, acting as the dominant of the dominant (G). What creates the forward motion is the same tension-resolution mechanism that makes any V7–I progression compelling: the tritone interval between the third and seventh of the dominant seventh chord (in D7, that's F# and C) creates intense harmonic tension that *demands* resolution — the F# wants to rise to G and the C wants to fall to B, pulling the ear strongly toward the G chord. This process is called **tonicization** — you're briefly making the listener feel like G is a temporary home — and it injects a burst of momentum and color that a plain diatonic chord simply can't provide. In jazz, secondary dominants are everywhere, often appearing in chains (like III7–VI7–II7–V7–I) that create a cascading sense of forward pull through a series of interlocking dominant resolutions.

**sonnet/+Rule** — judge **5/5**

> ## Secondary Dominants: Function and Forward Motion
> 
> A **secondary dominant** is a dominant-quality chord (major triad or dominant 7th) built on a scale degree other than the fifth, temporarily tonicizing a diatonic chord that is not the tonic. The most common example is **V7/V** — in the key of C major, that is **D7** (the dominant of G), which then resolves to **Vmaj/V7 (G or G7)**.
> 
> ### Function
> Its function is **secondary dominant** — a localized, momentary dominant function aimed at a *target chord* that itself may carry tonic, subdominant, or dominant function in the home key. It does **not** modulate; it merely *tonicizes* the target briefly before the home key reasserts itself.
> 
> ### How It Creates Forward Motion
> The forward drive comes from two acoustic forces working simultaneously:
> 
> 1. **Tritone tension** — the chord contains a tritone (between its 3rd and ♭7th) that demands resolution by half-step contrary motion (the 3rd resolves up, the ♭7th resolves down).
> 2. **Chromatic voice leading** — secondary dominants typically introduce a chromatic pitch (e.g., F♯ in D7 within C major) that creates a *leading-tone pull* into the target chord, intensifying the sense of directed motion.
> 
> The result is a **chain of dominant energy**: each secondary dominant borrows the strongest resolution gesture in tonal music and redirects it toward an intermediate goal, propelling the harmony forward with heightened urgency before the phrase concludes.

**sonnet/+Rule+RAG** — judge **4/5**

> ## Secondary Dominants and Forward Motion
> 
> A **secondary dominant** is a dominant 7th chord built on a scale degree other than V, temporarily tonicizing a chord within the key other than the tonic. The most common example is **V7/V** — a dominant 7th chord whose root lies a perfect fifth above the primary dominant. In C major, that means **D7 → G7 → Cmaj7**: D7 acts as the "V of V," creating a *chain* of dominant resolutions down the cycle of fifths.
> 
> **What drives the forward motion** is the tritone tension inherent in every dominant 7th chord — the interval between its 3rd and 7th demands resolution by half-step contrary motion. A secondary dominant *imports* that same urgency onto a non-tonic chord, making it feel like a temporary goal. The result is a **telescoping effect**: instead of one dominant-to-tonic pull, you get two (or more) consecutive dominant resolutions, each one intensifying the momentum toward the final tonic. In the 1–6–2–5–1 example above, converting Am7→Dm7→G7 into **A7→D7→G7→C** turns a diatonic progression into a relentless cycle-of-fifths chain, where each chord is simultaneously *resolving* the previous tension and *generating* new tension toward the next target — a compounding forward drive that a purely diatonic progression cannot match.

---

### C · `c06`
- **Q:** Why do Coltrane changes (Giant Steps) move by major thirds, and why are they hard to improvise over?
- **Key points (judge 기준):**
  - the tonal centers cycle by major thirds (e.g. B–G–Eb), dividing the octave equally
  - each key center has its own ii-V or V-I, moving very fast
  - rapid key changes leave little time to outline each new tonality
  - requires memorized patterns / strong key-center awareness

**haiku/raw** — judge **3/5**

> # Coltrane Changes: Major Thirds and Difficulty
> 
> Coltrane chose major thirds (four semitones apart) because they divide the octave into three equal parts, creating a symmetrical harmonic structure that sounds exotic and unstable compared to traditional progressions. In "Giant Steps," the chords move B major → G major → Eb major → B major, cycling through all 12 pitches efficiently while avoiding a tonal center. This is hard to improvise over because:
> 
> 1. **No familiar landmarks** — your ear expects chord progressions to move by fourths/fifths (like ii-V-I), so major-third movement feels disorienting
> 2. **Rapid harmonic rhythm** — chords change every 2 bars, giving you little time to establish a melodic idea
> 3. **Chromatic voice leading** — the root movement doesn't align with scalar patterns, forcing you to think in three separate harmonic zones rather than one key
> 4. **Tritone relationships** — the symmetry creates ambiguous harmonic gravity, so traditional jazz phrasing and targeting chord tones becomes less intuitive
> 
> Mastering it requires thinking in blocks of three keys simultaneously and developing a different melodic vocabulary than standard bebop.

**haiku/+Rule** — judge **5/5**

> # Coltrane Changes: Structure and Challenge
> 
> **Why major thirds?** Giant Steps cycles through three tonal centers a major third apart (B, G, Eb), creating a symmetrical harmonic structure. Each center gets a ii-V-I progression: B major (ii-V-I), G major (ii-V-I), Eb major (ii-V-I). This equal division of the octave (12 semitones ÷ 3 = 4 semitones per step) maximizes harmonic distance and avoids a single gravitational center—a radical departure from functional tonality.
> 
> **Why difficult to improvise?** The rapid modulation (every 2 bars) demands constant mental recalibration. Improvisers must either: (1) think in three parallel keys simultaneously, (2) use chromatic/symmetrical scales (diminished, whole-tone, or altered dominants) that work across all three centers, or (3) employ arpeggios and guide-tone lines that navigate the chord changes literally. Traditional scalar thinking (Dorian over ii-7, Mixolydian over V7) breaks down because the tonal centers shift too quickly to establish modal gravity. The changes essentially force *harmonic* rather than *scalar* improvisation—you're outlining chords, not inhabiting modes.

**haiku/+Rule+RAG** — judge **5/5**

> # Coltrane Changes: Major-Third Symmetry & Improvisational Challenge
> 
> **The Structure:** Coltrane's "Giant Steps" cycles through three tonal centers a major third apart—B, G, and E♭—creating a symmetrical harmonic architecture. Each center is approached via its own ii-V: F#m7–B7–BMaj7, Dm7–G7–GMaj7, Bbm7–Eb7–E♭Maj7. This three-way division of the octave (every 4 semitones) is theoretically elegant but creates **no single parent key**—no diatonic home.
> 
> **Why It's Difficult:** Traditional jazz soloing relies on scalar thinking within one key center. Here, you cannot sustain one scale across the entire form; the moment you land on B, you're already preparing to leave it. The rapid key shifts (every 2 bars) demand either: (1) **strict chord-tone soloing** with arpeggios that outline each triad cleanly, or (2) **anticipatory thinking**—playing the *next* key's color before the chord change arrives, using guide-tone lines (3rds and 7ths descending in half-steps) that naturally bridge the shifts. The tritone substitutions and chromatic voice-leading that Coltrane embedded make linear scalar improvisation feel clumsy; you must think in **harmonic blocks and voice-leading logic**, not mode-to-mode shifts.

**sonnet/raw** — judge **5/5**

> Coltrane changes divide the octave into three equal parts by moving through key centers a major third apart — in Giant Steps, that's B major, G major, and E♭ major. Since three major thirds stack up to exactly 12 semitones (4+4+4), these three tonal centers perfectly partition the octave, creating a symmetrical harmonic system. Coltrane used ii-V-I progressions to connect these centers, so the changes move through keys very rapidly, often with a new tonal center arriving every one or two beats. This is what makes them so difficult to improvise over: the harmonic rhythm is extremely fast, the key centers are distant from one another (unlike the more gradual circle-of-fifths motion jazz musicians are trained to navigate), and there's very little time to establish or resolve any single tonality before the next one arrives. An improviser can't rely on a single scale or comfortable melodic pattern — they must either outline each chord's arpeggio with precision, or find melodic ideas that work across all three tonal centers simultaneously, which requires deep internalization of the harmony rather than reactive, ear-based playing.

**sonnet/+Rule** — judge **5/5**

> ## Coltrane Changes: Major-Third Root Motion and Improvisational Challenges
> 
> ### Why Major Thirds?
> 
> Coltrane partitions the octave into **three equal divisions of a major third (4 semitones)**, exploiting the symmetry of the augmented triad: **B – G – E♭ (= D#)**. Each tonal center is a major third apart, so three II–V–I cycles exhaust all three key centers and return to the origin after one octave of root motion. In *Giant Steps*, the three tonic centers are **B major, G major, and E♭ major**, each approached by its own V7. Formally, each pivot chord functions simultaneously as **Imaj7 of the departing key** and as **III maj7 (or a chromatic mediant)** of the arriving key — a rapid, non-diatonic tonal substitution with no shared diatonic function in conventional terms.
> 
> ### Why Are They Hard to Improvise Over?
> 
> The difficulty is **velocity of harmonic rhythm** combined with **absence of a stable tonic**. Changes move as fast as **one chord per two beats** at ♩ = 286 bpm, giving the improviser roughly **one beat per chord**. Each V7 demands its own **Mixolydian or altered scale** (7th mode of melodic minor), and each Imaj7 demands **Ionian or Lydian** — with no common-tone thread connecting them. There is no prolonged tonic to "rest" on, no ii–V–I that resolves before the next key center arrives. The player must **pre-hear and finger three independent key centers in real time**, making scalar and motivic continuity extremely difficult to maintain.

**sonnet/+Rule+RAG** — judge **1/5**

> 

---

### C · `c07`
- **Q:** Explain the difference between a ii-V-i in a minor key vs a ii-V-I in a major key (chord qualities and scales).
- **Key points (judge 기준):**
  - minor: iiø7 (half-diminished), V7(b9/alt), i-(minor)
  - major: ii-7, V7, Imaj7
  - minor V often uses harmonic minor / altered; major V uses mixolydian
  - the ii in minor is m7b5 vs m7 in major

**haiku/raw** — judge **5/5**

> # ii-V-i vs ii-V-I: Minor vs Major
> 
> In a **minor key (ii-V-i)**, the progression uses: ii°7b5 (half-diminished) → V7alt (dominant with alterations) → i (minor). The ii°7b5 comes from the harmonic minor scale and contains the characteristic tritone with the V. Over this progression, you'd typically use **harmonic minor** for the i chord, **Phrygian dominant** or **altered scale** over the V7, and **Dorian or harmonic minor** over the ii°7b5.
> 
> In a **major key (ii-V-I)**, you get: ii7 (minor 7th) → V7 (dominant 7th) → I (major). Both chords derive naturally from the major scale. You'd use **major scale** over the I and ii7, and **mixolydian** over the V7 (or the major scale itself). The ii7 is a diatonic chord, making the progression feel more stable and "inside" compared to the darker, more chromatic quality of minor ii-V-i progressions.

**haiku/+Rule** — judge **5/5**

> # ii-V-i (Minor) vs ii-V-I (Major)
> 
> **Minor key (ii-V-i):** The progression uses iiø7 (half-diminished: root-♭3-♭5-♭7), V7alt or V7(♭9♯9), and i-maj7 or i-6. The ii-V-i in minor typically employs the **harmonic minor scale** for the V7 chord, which naturally contains the ♭9 and ♯5 alterations. The iiø7 comes from harmonic minor's 2nd degree. Functionally, iiø7 acts as subdominant, V7 as dominant, and i as tonic.
> 
> **Major key (ii-V-I):** The progression uses ii-7 (minor seventh: root-♭3-perfect 5-♭7), V7, and Imaj7. These chords derive from the **major scale**. The ii-7 is subdominant, V7 is dominant, and I is tonic. The V7 in major typically uses the **mixolydian mode** (5th mode of major), giving it a natural ♭7 without the chromatic alterations common in minor.
> 
> **Key difference:** Minor's iiø7 has a diminished fifth (unstable, pulling toward resolution), while major's ii-7 has a perfect fifth (stable). Minor's V7 often includes alterations from harmonic minor; major's V7 is typically diatonic. Both function identically in terms of harmonic progression, but the chord qualities and available scales differ fundamentally.

**haiku/+Rule+RAG** — judge **5/5**

> # Minor ii-V-i vs. Major ii-V-I
> 
> **Chord Quality Difference:**
> In a **major ii-V-I**, all chords derive from the major scale: ii-7 (minor 7), V7 (dominant 7), I-maj7 (major 7). In a **minor ii-V-i**, the harmonic minor scale reshapes the progression: ii-ø7 (half-diminished, m7♭5), V7 (dominant 7 with ♭9), i-7 (minor 7). The critical shift is the ii chord becoming half-diminished and the V gaining a ♭9 from harmonic minor's ♭6 scale degree.
> 
> **Scale and Sound:**
> Major ii-V-I uses the major scale throughout, creating a bright, open sound. Minor ii-V-i is built on harmonic minor, giving it a darker, more introspective character. The ♭9 in the V chord (absent in major) is essential—it creates the strong gravitational pull toward the minor i and naturally suggests altered or diminished improvisation colors.
> 
> **Example:**
> *Blue Bossa*: Dm7♭5 → G7(♭9) → Cm7 is the textbook minor ii-V-i. Compare it to a major progression like Dm7 → G7 → Cmaj7, and you hear the harmonic difference immediately.

**sonnet/raw** — judge **5/5**

> ## ii-V-I in Major vs ii-V-i in Minor
> 
> In a **major key**, the ii-V-I uses a **minor 7th chord** (ii⁷), a **dominant 7th chord** (V⁷), and a **major 7th chord** (Imaj7) — for example, Dm7 - G7 - Cmaj7 in C major. The scales typically used are **Dorian** over the ii, **Mixolydian** (or altered) over the V, and **Ionian** over the I. In a **minor key**, the chords shift in quality: the ii chord becomes a **half-diminished chord** (iiø7, also called a minor 7♭5), the V becomes a **dominant 7th with a raised 7th degree** pulled from the harmonic minor scale (making it a standard V7, e.g., G7 in C minor), and the i is a **minor major 7th or minor 7th chord** — for example, Dm7♭5 - G7 - Cm. The scales commonly used are **Locrian** or **Locrian ♮2** over the iiø7, the **harmonic minor** (starting from the 5th degree, also called Phrygian dominant) over the V7, and **harmonic or melodic minor** over the i. The key distinction is that the harmonic minor scale is what gives the minor ii-V-i its characteristic darker, more tense sound.

**sonnet/+Rule** — judge **5/5**

> ## ii-V-I in Major vs ii-V-i in Minor
> 
> **Local key center stated first for each.**
> 
> ---
> 
> ### Major Key (e.g., C major)
> 
> | Function | Symbol | Chord | Scale |
> |----------|--------|-------|-------|
> | Subdominant | **ii-7** | Dm7 | D Dorian (2nd mode of C major) |
> | Dominant | **V7** | G7 | G Mixolydian (5th mode of C major) |
> | Tonic | **Imaj7** | Cmaj7 | C Ionian (C major) |
> 
> The V7 chord contains a **tritone** (B–F) that resolves by half-step into the Imaj7. Everything diatonic; no borrowed tones required.
> 
> ---
> 
> ### Minor Key (e.g., C minor)
> 
> | Function | Symbol | Chord | Scale |
> |----------|--------|-------|-------|
> | Subdominant | **iiø7** | Dø7 (Dm7♭5) | D Locrian (2nd mode of C natural minor) |
> | Dominant | **V7** | G7 | G altered (7th mode of Ab melodic minor) |
> | Tonic | **i-maj7 or i-7** | Cm(maj7)/Cm7 | C melodic or natural minor |
> 
> **Critical distinctions:** The ii chord becomes **half-diminished** (iiø7) because the 5th is flatted (D–F–A♭–C). The V7 chord requires a **raised 7th degree** (B♮) borrowed from harmonic/melodic minor to

**sonnet/+Rule+RAG** — judge **5/5**

> ## Major ii-V-I vs. Minor ii-V-i
> 
> **Local key assumed for both examples: C major / C minor.**
> 
> ---
> 
> ### Major ii-V-I (C major)
> 
> | Chord | Symbol | Quality | Function | Scale |
> |-------|--------|---------|----------|-------|
> | ii | Dm7 | minor 7 | Subdominant | D Dorian (2nd mode of C major) |
> | V | G7 | dominant 7 | Dominant | G Mixolydian (5th mode of C major) |
> | I | Cmaj7 | major 7 | Tonic | C Ionian |
> 
> ---
> 
> ### Minor ii-V-i (C minor)
> 
> | Chord | Symbol | Quality | Function | Scale |
> |-------|--------|---------|----------|-------|
> | ii° | Dm7♭5 | half-diminished | Subdominant | D Locrian (6th mode of F major) or D Locrian ♮2 (6th mode of E♭ melodic minor) |
> | V | G7(♭9,♭13) | dominant 7 with ♭9 | Dominant | G altered (7th mode of A♭ melodic minor) or G HW diminished |
> | i | Cm7 | minor 7 | Tonic | C Dorian / Aeolian |
> 
> ---
> 
> ### The Two Decisive Differences
> 
> 1. **The ii chord becomes half-diminished (m7♭5)** — the fifth is flatted, giving it a darker, more unstable color derived from the harmonic minor scale.
> 2. **The V chord carries a

---

### C · `c08`
- **Q:** Explain tension and resolution in a dominant 7th chord using the tritone between its 3rd and 7th.
- **Key points (judge 기준):**
  - the 3rd and 7th of a dominant form a tritone (unstable interval)
  - e.g. in G7 the tritone is B–F
  - the tritone resolves inward/outward to the tonic chord tones (B→C, F→E for C)
  - this drives the V→I resolution

**haiku/raw** — judge **5/5**

> # Tension and Resolution in the Dominant 7th
> 
> The dominant 7th chord (V7) creates tension primarily through the **tritone interval** between its 3rd and 7th scale degrees. For example, in C major, a G7 chord contains B (the 3rd) and F (the 7th)—a tritone apart. This interval is inherently unstable and dissonant, creating a strong pull toward resolution. The tritone *wants* to resolve inward: the B naturally rises to C, while the F naturally falls to E, both moving to chord tones of the I chord (C major). This voice-leading resolution is so powerful that it defines functional harmony itself. Without the tritone, a dominant chord loses much of its urgency; with it, the listener experiences clear tension that demands the satisfying release of returning home to the tonic. This tension-resolution cycle is fundamental to jazz harmony and creates the forward momentum that drives harmonic progressions.

**haiku/+Rule** — judge **5/5**

> # Tension and Resolution in the Dominant 7th Tritone
> 
> A dominant 7th chord (V7) contains a tritone between its 3rd and 7th scale degrees—for example, in C major, G7 has B (3rd) and F (7th), which are six semitones apart. This interval is inherently unstable: the two notes are equidistant from any tonal center, creating maximum harmonic tension. In V7, the B "wants" to resolve upward to C (the tonic's 3rd), while the F "wants" to resolve downward to E (the tonic's 3rd as well, enharmonically the leading tone's resolution). This dual pull creates urgency.
> 
> When V7 resolves to I (Imaj7), both tritone voices move inward by half-step—B→C and F→E—satisfying the listener's expectation and releasing tension. This voice-leading is so strong that even if the V7 is secondary (like V7/ii), the tritone still demands resolution to its target chord. The tritone's acoustic "roughness" combined with its elegant resolution makes it the primary engine of harmonic momentum in jazz and classical music alike.

**haiku/+Rule+RAG** — judge **5/5**

> # Tension and Resolution in the Dominant 7th Tritone
> 
> The dominant 7th chord (V7) contains a **tritone between its 3rd and 7th**—for example, in G7, the B and F form an interval of six semitones. This tritone is inherently unstable and creates maximum harmonic tension because it divides the octave symmetrically, pulling equally in opposite directions. When G7 resolves to CMaj7, that tritone *must* resolve: the B (3rd of G7) pulls up a semitone to C, while the F (7th of G7) pulls down a semitone to E. This inward half-step motion of the guide tones is what defines dominant function and creates the sense of inevitable resolution. The tritone substitution (e.g., Db7 instead of G7 to C) works because Db7 contains the same tritone (F and B), so it resolves identically—just with the root a tritone away, giving a smoother half-step descent (Db → C) instead of the usual fourth (G → C). This is why the tritone is the "soul" of dominant tension: its symmetry forces resolution, and its guide tones lock the ear into expecting the tonic.

**sonnet/raw** — judge **5/5**

> In a dominant 7th chord, the most harmonically charged relationship is the **tritone** — an interval of an augmented fourth or diminished fifth — that exists between the chord's **3rd and 7th**. In a G7 chord, for example, the 3rd is B and the 7th is F, and these two notes are a tritone apart. This interval is inherently unstable and dissonant, creating a strong sense of tension that demands resolution. The beauty of it is that both notes have a natural tendency to move by half step in contrary motion: the B (the leading tone) wants to resolve **upward** to C, while the F wants to resolve **downward** to E. This contrary motion pulls the tritone inward, collapsing it into a third — specifically the 3rd and root of the tonic chord (C major, in this case). This is why the dominant 7th chord is such a powerful harmonic engine; the tritone essentially *programs* the ear to expect and crave the resolution to the tonic, making the V7–I progression one of the most satisfying and fundamental movements in all of tonal music, including jazz.

**sonnet/+Rule** — judge **5/5**

> ## Tension and Resolution in the Dominant 7th Chord
> 
> The dominant 7th chord (V7) contains a **tritone** — an interval of an augmented 4th/diminished 5th — formed between its **major 3rd (the leading tone)** and its **minor 7th**. In the key of C major, G7 contains the tritone **B–F**: B is the 7th scale degree (leading tone, a half step below the tonic), and F is the 4th scale degree (a half step above the 3rd of the tonic chord). These two pitches carry **maximum instability** because each one has a strong half-step pull toward a chord tone of the resolution target: **B resolves upward by half step to C** (the root of Imaj7), and **F resolves downward by half step to E** (the 3rd of Imaj7). This **contrary-motion, inward resolution** of the tritone is the acoustic and voice-leading engine of tonal jazz harmony. The V7 chord therefore carries **dominant function** — maximum tension demanding resolution to the **tonic (I)** — and this tritone mechanism is precisely why the **subV7 (♭II7)** works as a substitute: it shares the *same tritone* (enharmonically respelled), resolving by the same half-step logic to the same Imaj7.

**sonnet/+Rule+RAG** — judge **5/5**

> ## Tension and Resolution in the Dominant 7th Chord
> 
> The dominant 7th chord's powerful pull toward the tonic comes almost entirely from the **tritone interval between its 3rd and 7th**. In G7, for example, the 3rd is B and the 7th is F — exactly three whole tones apart, the most dissonant interval in tonal music. These two pitches are called the **guide tones**, and each one has a strong voice-leading obligation: B (the leading tone) wants to resolve **upward by a half step to C**, while F (the chordal 7th) wants to resolve **downward by a half step to E**. Together they converge inward onto the root and 3rd of CMaj7, creating a satisfying contrary-motion resolution. This is also why **tritone substitution works so elegantly** — D♭7 contains the notes F and C♭ (=B enharmonically), the exact same tritone as G7, just respelled, so it carries identical voice-leading tension and resolves to the same CMaj7 target. The tritone is therefore not merely a colorful dissonance; it is the **engine of harmonic motion** in tonal and jazz harmony alike.

---

## D · 할루시네이션 (17문항: trap + control, LLM-judge)

trap = 거짓 전제/비표준 용어 — 모델이 거부/정정하면 정답(hallucinated=false). control = 정상 질문 — accept[] 중 하나로 답해야 정답.

### D · `d01` (trap)
- **Q:** Explain the 'Hendrix cadence' commonly taught in bebop harmony.
- **Trap — 좋은 답 신호 (참고):** `not a standard`, `not a recognized`, `no such`, `not aware`…

**haiku/raw** — ✓ correctly flagged

> 

**haiku/+Rule** — ✓ correctly flagged

> The "Hendrix cadence" isn't a standard jazz harmony term with a formal definition in bebop pedagogy. You may be thinking of either: (1) the **bVII–I cadence** (flat-VII to tonic), which appears in rock/funk and some modal jazz contexts, or (2) a **chromatic approach or tritone substitution** used in bebop lines. If you can specify the chord progression or context you're referencing, I can give you a precise Roman numeral analysis and functional label.

**haiku/+Rule+RAG** — ✓ correctly flagged

> I need to say plainly: **"Hendrix cadence" is not a standard term in jazz harmony or bebop theory.** You may be thinking of the **"Hendrix chord"** (a dominant 7#9 voicing like E7#9), but that's a sonority, not a cadence, and it's not specifically a bebop concept—it's named after Jimi Hendrix's rock usage.
> 
> If you're referring to a specific cadential progression from bebop practice, could you clarify which chord progression you mean? The materials you've provided focus on bebop scales, voicings, and ii-V-I progressions, but don't mention a "Hendrix cadence."

**sonnet/raw** — ✓ correctly flagged

> The term "Hendrix cadence" is not a standard concept in bebop harmony pedagogy. You may be thinking of the **Hendrix chord** (a dominant 7#9 chord associated with Jimi Hendrix), but that's a guitar voicing/color concept, not a cadential motion taught in bebop theory. If you can clarify what you're referring to, I'm happy to help.

**sonnet/+Rule** — ✓ correctly flagged

> The term "Hendrix cadence" is not standard terminology in bebop harmony pedagogy — it's a non-standard label that doesn't appear in canonical jazz theory sources (e.g., Levine, Russell, Nettles/Graf). The "Hendrix chord" itself refers to a **7#9 sonority** (dominant 7th with raised 9th), but it is associated with rock/blues guitar voicing, not a specific cadential formula in bebop.
> 
> If you're asking about the **7#9 chord in jazz function**, it operates as a standard **V7 with altered tensions** (functioning as a dominant), with the #9 available from the **altered scale (7th mode of melodic minor)** or the **half-whole diminished scale**. No distinct "cadence" bearing that name exists in formal bebop theory.

**sonnet/+Rule+RAG** — ✓ correctly flagged

> 

---

### D · `d02` (trap)
- **Q:** What chord is built on the 9th scale degree of the C major scale?
- **Trap — 좋은 답 신호 (참고):** `only 7`, `only seven`, `seven degrees`, `no 9th degree`…

**haiku/raw** — ✓ correctly flagged

> This question rests on a false premise. The C major scale has only 7 scale degrees (C-D-E-F-G-A-B), so there is no 9th scale degree within the scale itself. The "9th" in jazz typically refers to an extension of a chord (the note that's an octave plus a second above the root), not a scale degree.

**haiku/+Rule** — ✓ correctly flagged

> This question rests on a false premise: the major scale has only 7 scale degrees, so there is no 9th scale degree within C major itself. If you're asking about the 9th *interval* above C (which would be D an octave higher), that's simply D; if you mean the 2nd scale degree (D), that would be ii-7 (D-F-A-C) in the key of C major.

**haiku/+Rule+RAG** — ✓ correctly flagged

> This question rests on a false premise: the major scale has only 7 scale degrees, so there is no 9th scale degree within C major itself. If you're asking about the 9th *interval* above C (which would be D an octave higher), that's simply D; if you mean the 2nd scale degree (D), that would be ii-7 (D-F-A-C) in the key of C major, functioning as subdominant.

**sonnet/raw** — ✓ correctly flagged

> The C major scale only has 7 distinct scale degrees; there is no 9th scale degree in that sense. If you're thinking of the note a major ninth above C (which is D), you could build a chord on D, which would be a D minor 7th chord (Dm7) as the ii chord in C major. The "9th" is an extension added *to* a chord, not a scale degree on which a chord is built.

**sonnet/+Rule** — ✓ correctly flagged

> The premise contains an error. The C major scale has only 7 distinct scale degrees (C, D, E, F, G, A, B). There is no 9th scale degree — the 9th (D) is an octave extension of the 2nd degree, not a separate scale degree on which a diatonic chord is "built." The chord built on that pitch class is simply **ii-7 (Dm7)**, functioning as a **subdominant** chord in C major.

**sonnet/+Rule+RAG** — ✓ correctly flagged

> The premise contains an error. The C major scale has only 7 distinct scale degrees (C, D, E, F, G, A, B). There is no 9th scale degree — the 9th (D) is simply a compound restatement of the 2nd degree. The chord built on that degree in C major is **ii-7 (Dm7)**, functioning as **subdominant**, with D as its root regardless of whether you call it scale degree 2 or 9.

---

### D · `d03` (trap)
- **Q:** Which major key signature has 9 sharps?
- **Trap — 좋은 답 신호 (참고):** `no key`, `doesn't exist`, `maximum`, `only 7`…

**haiku/raw** — ✓ correctly flagged

> No major key signature has 9 sharps. The maximum number of sharps in any major key signature is 7 (C# major). Key signatures with sharps go: C (0), G (1), D (2), A (3), E (4), B (5), F# (6), and C# (7).

**haiku/+Rule** — ✓ correctly flagged

> This question rests on a false premise: no major key signature has 9 sharps. The maximum number of sharps in a major key signature is 7 (C major), and beyond that, enharmonic equivalents are used (e.g., B major has 5 sharps, C# major has 7 sharps). A theoretical key with 9 sharps would be F## major, which is non-standard and impractical.

**haiku/+Rule+RAG** — ✓ correctly flagged

> This question rests on a false premise. There is no major key signature with 9 sharps in standard Western music theory. The maximum number of sharps in a major key signature is 7 (C# major), and the maximum flats is 7 (C♭ major); beyond that, enharmonic equivalents are used instead.

**sonnet/raw** — ✓ correctly flagged

> No major key signature has 9 sharps. Standard key signatures go up to 7 sharps (C# major). Beyond that, you move into theoretical keys that are more practically notated as their enharmonic equivalents (e.g., C# major = Db major).

**sonnet/+Rule** — ✓ correctly flagged

> No major key signature has 9 sharps. Standard Western key signatures contain a maximum of 7 sharps (C# major / B# major is theoretical). 9 sharps falls outside the conventional system of key signatures.

**sonnet/+Rule+RAG** — ✓ correctly flagged

> No major key signature has 9 sharps. Standard key signatures range from 0 to 7 sharps (C major through C# major). A key with 9 sharps would be enharmonically redundant and does not exist in conventional tonal theory.

---

### D · `d04` (trap)
- **Q:** Describe the harmonic function of the 'Coltrane diminished pivot' chord in standard analysis.
- **Trap — 좋은 답 신호 (참고):** `not a standard`, `no such`, `not a recognized`, `not aware`…

**haiku/raw** — ✓ correctly flagged

> I'm not aware of a standard jazz theory term called the "Coltrane diminished pivot" chord. While John Coltrane certainly used diminished chords creatively in his harmonic language, this specific terminology doesn't appear in established jazz theory literature. If you're referring to a particular harmonic technique from Coltrane's work, could you provide more context about which recording or passage you mean?

**haiku/+Rule** — —

> The term "Coltrane diminished pivot" is non-standard and not found in formal jazz harmony pedagogy. While Coltrane famously used diminished seventh chords as chromatic passing chords and pivot devices (especially in sheets like "Giant Steps"), there is no established analytical term by that specific name. If you're referring to his use of diminished sevenths to modulate between distant keys, I'd be happy to analyze a specific chord progression with Roman numerals and functional labels.

**haiku/+Rule+RAG** — ✓ correctly flagged

> I need to flag that "Coltrane diminished pivot" is not a standard jazz theory term, even though the reference material discusses diminished substitution and axis concepts.
> 
> **What is standard:** The diminished axis (or diminished substitution axis) shows that one V7 chord shares diminished chord tones with three other V7 chords a minor third apart—and tritone substitution is a subset of this. A diminished chord *can* function as a pivot when its enharmonic spelling allows it to belong to two different keys simultaneously, but this is typically called a **diminished pivot chord** or **enharmonic pivot**, not a "Coltrane" pivot.
> 
> **The function:** When a diminished chord pivots between keys, it serves a **modulation function**—it belongs diatonically (or by substitution) to both the old and new key centers, allowing smooth voice-leading between distant harmonic areas.
> 
> If you're asking abo…

**sonnet/raw** — ✓ correctly flagged

> "Coltrane diminished pivot" is not a standard term in jazz theory or harmonic analysis. You may be thinking of Coltrane's use of **tritone substitutions**, **chromatic mediant relationships**, or the **"Coltrane changes"** (his cyclic major-third root movements), none of which specifically involve a chord by that name. Could you clarify what you're referring to, or where you encountered this term?

**sonnet/+Rule** — ✓ correctly flagged

> "Coltrane diminished pivot" is a non-standard term that does not correspond to an established concept in jazz harmony theory. Coltrane is associated with **Coltrane changes** (chromatic third-relation substitutions cycling through major thirds, e.g., I → ♭III → ♭VI → I) and with specific uses of diminished harmony, but "Coltrane diminished pivot" as a named, codified device does not exist in standard analytical literature. If you're describing a specific chord progression or voicing you've encountered under that label, please provide the actual chords and key context so I can give you a precise Roman-numeral analysis.

**sonnet/+Rule+RAG** — ✓ correctly flagged

> ## The "Coltrane Diminished Pivot" — A Non-Standard Term
> 
> "Coltrane diminished pivot" is not a term found in standard jazz harmony literature, so I won't fabricate a canonical definition for it. What *is* well-documented is Coltrane's use of **diminished-axis substitution**: a dominant 7th chord can be replaced by any of the three other dominant 7ths whose roots are a minor 3rd away, because all four share the same diminished 7th chord tones (e.g., C7, E♭7, F♯7, A7 all contain D♭/C♯, E, G, B♭).
> 
> If you're referring to a **pivot chord that is itself a diminished quality** (e.g., a viiø7 or a fully diminished chord functioning as a common-chord pivot between two key areas), that is standard practice and I can analyze a specific instance precisely — just supply

---

### D · `d05` (trap)
- **Q:** What note is the 14th of a Cmaj chord?
- **Trap — 좋은 답 신호 (참고):** `no 14th`, `doesn't exist`, `only extends to 13`, `beyond the 13th`…

**haiku/raw** — ✓ correctly flagged

> A Cmaj chord doesn't have a "14th" in standard jazz terminology. The chord tones only go up to the 13th (C-E-G-B-D-F-A). If you're asking about extensions beyond the 13th, you'd be repeating the octave cycle—the 14th would be the same pitch class as the 2nd (D), just an octave higher.

**haiku/+Rule** — ✓ correctly flagged

> This question uses a non-standard term. Jazz harmony doesn't have a "14th" of a chord—we use intervals up to the 13th (which repeats the 6th an octave higher). If you mean the 14th semitone above C, that's B (enharmonically the same as the 7th of the chord). Could you clarify what you're asking about?

**haiku/+Rule+RAG** — ✓ correctly flagged

> This question uses a non-standard term. Jazz harmony doesn't use "14th" intervals in the traditional sense—we work with extensions up to the 13th (which repeats the 6th an octave higher). If you mean the 7th scale degree two octaves above the root (which would be a 14th in strict interval counting), that would be **B natural** in a Cmaj context. However, clarify whether you're asking about chord extensions, upper structure voicings, or something else.

**sonnet/raw** — ✓ correctly flagged

> A major chord (or even an extended major chord) doesn't have a 14th — chord extensions only go up to the 13th before you're simply repeating chord tones. The 13th is the highest recognized extension in jazz harmony.

**sonnet/+Rule** — ✓ correctly flagged

> The premise is flawed. Chord extensions stop at the 13th (7th above the root when stacking thirds). There is no "14th" of any chord in standard jazz harmony — the 14th would simply be a re-spelling of the major 7th (one octave higher), and it is not recognized as a distinct chord tone or extension.

**sonnet/+Rule+RAG** — ✓ correctly flagged

> The term "14th" is non-standard in jazz harmony. Extensions repeat in octaves, so after the 13th (the 6th an octave up), the next step would enharmonically be the root again (the 14th would equal the major 7th, or depending on counting, the root). No standard jazz theory recognizes a "14th" as a distinct chord tension — the system stops at the 13th.

---

### D · `d06` (control)
- **Q:** Who composed 'Giant Steps'?
- **Accept:** `coltrane` / `john coltrane`

**haiku/raw** — ✓ correct

> John Coltrane composed "Giant Steps" in 1960. It's one of the most famous jazz compositions, known for its rapid chord changes and challenging harmonic progression.

**haiku/+Rule** — ✓ correct

> John Coltrane composed "Giant Steps" in 1960. This is a factual question about composition history rather than a jazz harmony analysis question, so the analytical framework you've outlined doesn't apply here.

**haiku/+Rule+RAG** — ✓ correct

> John Coltrane composed "Giant Steps" in 1960. This question doesn't involve jazz harmony analysis, so the analytical framework you've outlined doesn't apply here—it's a straightforward factual question about composition attribution.

**sonnet/raw** — ✓ correct

> "Giant Steps" was composed by John Coltrane. It was recorded in 1959 and released on the album *Giant Steps* in 1960, and it is famous for its innovative harmonic progression known as "Coltrane changes."

**sonnet/+Rule** — ✓ correct

> John Coltrane composed *Giant Steps*, released on the album of the same name in 1960.

**sonnet/+Rule+RAG** — ✓ correct

> John Coltrane composed *Giant Steps*, released on the album of the same name in 1960.

---

### D · `d07` (control)
- **Q:** How many sharps are in the key signature of D major?
- **Accept:** `2` / `two`

**haiku/raw** — ✓ correct

> D major has 2 sharps (F# and C#).

**haiku/+Rule** — ✓ correct

> D major has **2 sharps** (F# and C#).
> 
> This is a basic music theory fact, not a jazz harmony question, but the answer is straightforward: D major is built on the major scale D-E-F#-G-A-B-C#-D.

**haiku/+Rule+RAG** — ✓ correct

> D major has **two sharps** (F# and C#).
> 
> This is a straightforward music theory fact unrelated to the jazz harmony concepts in your reference material, but it's worth noting: D major is the relative major of B minor, and understanding key signatures is foundational before applying the advanced harmonic analysis you've outlined above.

**sonnet/raw** — ✓ correct

> D major has **2 sharps**: F♯ and C♯.

**sonnet/+Rule** — ✓ correct

> D major has **2 sharps**: F♯ and C♯.

**sonnet/+Rule+RAG** — ✓ correct

> D major has **2 sharps**: F# and C#.

---

### D · `d08` (control)
- **Q:** What is the V chord in the key of C major?
- **Accept:** `G7` / `G` / `G dominant` / `G major`

**haiku/raw** — ✓ correct

> The V chord in the key of C major is G major (G-B-D). It's built on the fifth scale degree and functions as the dominant chord, which naturally pulls back to the I chord (C major).

**haiku/+Rule** — ✓ correct

> In C major, the V chord is **G major (G-B-D)**, or **G7 (G-B-D-F)** in a dominant seventh context.
> 
> In Roman numeral analysis: **V** or **V7**, with dominant function—it pulls toward resolution to the I chord (C major). The V7 is the most common jazz voicing, adding the minor seventh (F) to create tritone tension with the third of the tonic.

**haiku/+Rule+RAG** — ✓ correct

> The V chord in C major is **G7** (or GMaj7 in diatonic context, but typically **G7** in jazz standards).
> 
> In C major, the V chord built on scale degree 5 is G, and in jazz harmony it's almost always voiced as a **dominant seventh (G7)** to create tension and pull back to the I chord (CMaj7). This is the standard cadential dominant: V7 → I.

**sonnet/raw** — ✓ correct

> The V chord in the key of C major is **G major** (G–B–D). In a jazz context, it is most commonly voiced as a **G dominant 7th chord** (G7: G–B–D–F), which creates strong tension that resolves to the I chord (C major).

**sonnet/+Rule** — ✓ correct

> **Local key center: C major**
> 
> The V chord is **G dominant 7 (V7 = G–B–D–F)**, functioning as the **dominant**, and it typically resolves to **Imaj7 (Cmaj7)**. The associated scale is **G Mixolydian** (5th mode of C major).

**sonnet/+Rule+RAG** — ✓ correct

> In the key of C major, the V chord is **G7** (Roman numeral: **V7**), built on the 5th scale degree (G), with the notes G–B–D–F. It functions as the **dominant**, creating tension that resolves back to the tonic CMaj7 (I).

---

### D · `d09` (control)
- **Q:** What is the relative minor of C major?
- **Accept:** `A minor` / `Am` / `Amin`

**haiku/raw** — ✓ correct

> The relative minor of C major is A minor. They share the same key signature (no sharps or flats) but have different tonal centers—C is the tonic of the major key, while A is the tonic of the minor key.

**haiku/+Rule** — ✓ correct

> The relative minor of C major is A minor (A natural minor / A Aeolian). Both keys share the same key signature (no sharps or flats), with A minor built on the 6th scale degree of C major.

**haiku/+Rule+RAG** — ✓ correct

> The relative minor of C major is **A minor** (Am).
> 
> C major and A minor share the exact same notes (no sharps or flats), so A minor is built on the 6th scale degree of C major. In Roman numeral analysis, the relative minor chord is labeled **vi** when functioning within the parent major key.

**sonnet/raw** — ✓ correct

> The relative minor of C major is **A minor**. They share the same key signature (no sharps or flats), with A minor's natural form using the same seven notes as C major but starting on A.

**sonnet/+Rule** — ✓ correct

> **A minor** (A natural minor / Aeolian mode, 6th mode of C major).
> 
> It shares the same key signature (no sharps or flats) and its tonic chord functions as **i** (A-7 or Am) — the tonic function within the relative minor context.

**sonnet/+Rule+RAG** — ✓ correct

> The relative minor of C major is **A minor**. They share the same key signature (no sharps or flats), and Am7 functions as **vi-7** in C major — a tonic-function chord.

---

### D · `d10` (control)
- **Q:** What is the tritone substitute of G7?
- **Accept:** `Db7` / `C#7`

**haiku/raw** — ✓ correct

> The tritone substitute of G7 is Db7. This works because Db7 and G7 share the same tritone interval (between their third and seventh), so they have the same guide tones (F and B), making them interchangeable in many harmonic contexts—particularly as dominant chords resolving down by half-step.

**haiku/+Rule** — ✓ correct

> The tritone substitute of G7 is **Db7** (a dominant seventh chord built on the flatted-fifth of G).
> 
> Both chords share the same tritone interval (B-F in G7; F-B in Db7), which creates voice-leading efficiency: G7 resolves up by half-step to C, while Db7 resolves down by half-step to C, making them functionally interchangeable as V7 substitutes in the key of C major.

**haiku/+Rule+RAG** — ✓ correct

> The tritone substitute of G7 is **D♭7**.
> 
> Both chords share the same guide tones (3rd and 7th): G7 has B and F, while D♭7 has F and C♭ (enharmonically B and F). This shared tritone allows D♭7 to resolve down a half-step to the same target that G7 would resolve to by descending a fourth—creating a smoother, more chromatic voice-leading alternative.

**sonnet/raw** — ✓ correct

> The tritone substitute of G7 is **D♭7**. This works because D♭ is a tritone away from G, and the two chords share the same tritone interval (the B/C♭ and F notes swap roles as the 3rd and 7th).

**sonnet/+Rule** — ✓ correct

> ## Tritone Substitute of G7
> 
> The tritone substitute of **G7** is **D♭7**.
> 
> G and D♭ are a tritone apart (6 half steps), and D♭7 shares the same guide tones as G7 — the 3rd and 7th simply swap roles: **F = 3rd of D♭7 / 7th of G7**, and **C♭(B) = 7th of D♭7 / 3rd of G7**.
> 
> **Function:** In the context of a ii–V–I in C major, D♭7 acts as **subV7/I** (substitute dominant), typically approached from ii-7 (D-7) and resolving by half-step to **Cmaj7**. The associated scale is **Lydian Dominant** (4th mode of melodic minor, i.e., D♭ Lydian Dominant).

**sonnet/+Rule+RAG** — ✓ correct

> D♭7 is the tritone substitute of G7. Their roots are a tritone apart (G–D♭), and they share the same guide tones: the 3rd and 7th of G7 (B and F) are enharmonically equivalent to the 7th and 3rd of D♭7 (C♭ and F), allowing seamless substitution resolving to Cmaj7.

---

### D · `d11` (trap)
- **Q:** Explain the 'Coltrane pentatonic' — the six-note scale John Coltrane invented for Giant Steps.
- **Trap — 좋은 답 신호 (참고):** `pentatonic means five`, `five notes`, `not six`, `no such`…

**haiku/raw** — ✓ correctly flagged

> This question contains a false premise. Coltrane didn't invent a "six-note scale" for Giant Steps, and there's no standard jazz theory term called the "Coltrane pentatonic." What Coltrane did use in Giant Steps was rapid chord changes (moving through distant keys) and practiced playing through those changes using existing scales and arpeggios—a technique that influenced how musicians approach complex harmonic movement, but it wasn't a new scale invention.

**haiku/+Rule** — ✓ correctly flagged

> The "Coltrane pentatonic" is not a standard or documented term in jazz theory, and there's no evidence Coltrane "invented" a specific six-note scale for Giant Steps. Coltrane used **symmetrical harmonic movement** (cycling through distant key centers a major third apart: B, G, Eb) and improvised over those changes using **chromatic approach notes, arpeggios, and scalar runs** drawn from the existing harmonic minor and altered scales. If you're referring to a specific pedagogical concept or a particular source's terminology, please clarify—otherwise, this appears to be a false premise.

**haiku/+Rule+RAG** — ✓ correctly flagged

> I need to say plainly: **there is no established "Coltrane pentatonic" or six-note scale that Coltrane "invented" for Giant Steps.** This premise is false.
> 
> What *is* true: Coltrane used **tonic systems** (cycling through key centers a major third apart—B, G, E♭—connected by ii-V progressions) and improvised using **chord scales** (Mixolydian for dominants, Dorian for ii-minors) and **chromatic approach notes**. The reference materials you've provided discuss these harmonic strategies, not a named "Coltrane pentatonic."
> 
> If you're asking about a specific scale or technique from Giant Steps, please clarify which passage or source you're referencing.

**sonnet/raw** — ✓ correctly flagged

> The term "Coltrane pentatonic" isn't a standard or well-established concept in jazz theory, and the description contains a couple of issues worth flagging. First, a pentatonic scale has five notes, not six. Second, Coltrane didn't invent a new scale for *Giant Steps* — the innovation there was a harmonic one: a system of chord progressions cycling through three tonal centers a major third apart (now called "Coltrane changes"). If you've encountered this term somewhere specific, I'd be happy to help clarify what the source might actually be referring to.

**sonnet/+Rule** — ✓ correctly flagged

> The term "Coltrane pentatonic" is non-standard and the premise contains two errors. First, a six-note scale is by definition a **hexatonic** scale, not a pentatonic (five-note) scale. Second, Coltrane did not invent a named scale for *Giant Steps* — the harmonic innovation there involves **chromatic major-third root motion** (B maj → G maj → E♭ maj), cycling through three tonal centers a major third apart, which theorists analyze as movement through the **augmented triad axis** (B/G/E♭).
> 
> The improvisational vocabulary Coltrane developed over those changes draws on standard **major and dominant bebop scales and arpeggios** targeting chord tones at each rapid harmonic change — not a proprietary invented scale.
> 
> If you encountered this term in a specific source, I'd recommend verifying it, as it may be a misattribution or a colloquial/informal label not recognized in formal

**sonnet/+Rule+RAG** — ✓ correctly flagged

> The term "Coltrane pentatonic" is non-standard, and the premise contains two false claims: it is not a six-note scale (that would be a hexatonic), and Coltrane did not invent a named pentatonic scale associated with *Giant Steps*. What Coltrane is documented to have used are standard pentatonic scales superimposed over the 3-tonic (major-third cycle) key centers — B, G, and E♭ — along with the ii-V approach chords connecting them.

---

### D · `d12` (trap)
- **Q:** Describe the standard 'Barry Harris rule' that every b9 must resolve upward by a half step.
- **Trap — 좋은 답 신호 (참고):** `not a standard rule`, `no such rule`, `not a recognized`, `resolves down`…

**haiku/raw** — ✓ correctly flagged

> I'm not aware of a standard "Barry Harris rule" stating that every b9 must resolve upward by a half step. While Barry Harris is a respected jazz educator known for his harmonic concepts and diminished scale applications, this particular formulation doesn't match established jazz theory conventions. If you're thinking of a specific concept from Harris's teaching, I'd need more context to help clarify it accurately.

**haiku/+Rule** — ✓ correctly flagged

> This premise is false. There is no standard "Barry Harris rule" requiring every b9 to resolve upward by half step. Barry Harris is known for his diminished scale concepts and his teaching on jazz improvisation, but this specific rule about b9 resolution doesn't reflect his documented pedagogy or standard jazz harmony practice. The b9 (as in a V7b9 chord) typically resolves downward to the root or third of the target chord, not upward.

**haiku/+Rule+RAG** — ✓ correctly flagged

> I need to say plainly: **the "Barry Harris rule" as you've stated it is not standard jazz theory terminology, and the premise appears to be false.** Barry Harris is a legendary jazz educator known for his work on diminished scales and harmonic concepts, but there is no widely recognized "Barry Harris rule" requiring all b9s to resolve upward by half step. 
> 
> In actual jazz practice, a b9 (or ♭9) on a dominant chord is an *available tension* that may resolve downward (as part of the altered scale), and its resolution depends on voice-leading context, not a fixed rule. If you're referencing a specific Harris teaching, please clarify the source.

**sonnet/raw** — ✓ correctly flagged

> The "Barry Harris rule" as you've described it is not a standard concept from Barry Harris's actual teachings. Barry Harris's well-known theoretical contributions center on his sixth diminished scale system, chord voicings, and bebop harmony — not a rule specifically mandating that b9 intervals resolve upward by a half step. You may be thinking of general voice-leading principles about tendency tones, but attributing this specific rule to Barry Harris would be inaccurate.

**sonnet/+Rule** — ✓ correctly flagged

> ## Clarification Required
> 
> The premise contains a non-standard formulation. There is no single codified "Barry Harris rule" stating that **every b9 must resolve upward by a half step**.
> 
> Barry Harris's actual pedagogical system centers on **sixth diminished scales** (major 6th chord alternating with a diminished 7th chord), voice-leading through diminished symmetry, and the principle that **dominant chords resolve by their guide tones moving correctly** — but he did not isolate the b9 as a universal rule in that phrasing.
> 
> The **standard voice-leading principle you may be thinking of** is simply conventional: the b9 of a V7b9 chord (scale degree b2 over the dominant) has a strong tendency to resolve **downward by a half step** to the root of the tonic — not upward. Upward resolution to the 9th (natural) is a different, less conventional motion.
> 
> If you encountered this "rule" in a specif…

**sonnet/+Rule+RAG** — ✓ correctly flagged

> The "Barry Harris rule" as you've phrased it — that every ♭9 must resolve upward by a half step — is a non-standard formulation. Barry Harris's well-documented pedagogical principles center on sixth-chord/diminished-chord voice leading, chord scales built from the harmonic minor, and specific rules about how diminished chords function as dominant substitutes; a blanket rule stating "every ♭9 resolves upward by half step" is not an established part of his documented method.
> 
> The conventional jazz-theory principle you may be thinking of is that the ♭9 (an avoid/tension tone on a dominant chord) typically resolves **downward** by half step to the root of the tonic chord — e.g., A♭ over G7 resolving down to G over Cmaj7 — not upward.
> 
> If you have a specific source attributing this rule to Harris, please share it and I can evaluate it directly.

---

### D · `d13` (trap)
- **Q:** Why is the E7#9 'Hendrix chord' also commonly called the 'Lydian cadence'?
- **Trap — 좋은 답 신호 (참고):** `not called`, `not known as`, `no such term`, `not a standard term`…

**haiku/raw** — ✓ correctly flagged

> It's not commonly called a "Lydian cadence" — that's not standard jazz terminology. The E7#9 is called the "Hendrix chord" because Jimi Hendrix popularized it, but there's no established connection to Lydian mode or cadential function that would justify calling it a Lydian cadence. You may be conflating different concepts or encountering non-standard usage.

**haiku/+Rule** — ✓ correctly flagged

> This premise is false. The E7#9 is not commonly called a "Lydian cadence"—that's a non-standard term. The E7#9 is famously called the "Hendrix chord" because Jimi Hendrix popularized it, and it functions as a dominant chord (V7#9) with an altered extension, not as a cadential or modal device. "Lydian cadence" isn't established jazz terminology for any chord.

**haiku/+Rule+RAG** — ✓ correctly flagged

> This premise is **false**. The E7#9 is not commonly called a "Lydian cadence"—that's a non-standard term.
> 
> E7#9 is famously called the **"Hendrix chord"** because Jimi Hendrix popularized it, but it has no standard association with Lydian mode or cadential function. The #9 (F##/G natural) creates an altered dominant sound (from the altered scale, the 7th mode of melodic minor), not a Lydian characteristic. A Lydian cadence would involve the #4 (raised 4th degree), which is Lydian's defining feature—not present in E7#9.

**sonnet/raw** — ✓ correctly flagged

> The term "Lydian cadence" is not a standard jazz theory term, and I'm not aware of it being a common name for the E7#9 or any dominant 7#9 chord. The E7#9 is widely called the "Hendrix chord" due to its prominent use by Jimi Hendrix, but I don't want to invent a connection to "Lydian cadence" that I can't verify. You may be thinking of a different concept, such as the Lydian Dominant scale (the 4th mode of melodic minor) used over altered dominant chords.

**sonnet/+Rule** — ✓ correctly flagged

> The premise is false. "Lydian cadence" is not a standard or common name for the E7#9 chord. The E7#9 is widely known as the "Hendrix chord" due to its association with Jimi Hendrix, and in formal harmony it functions as a dominant seventh chord with an added #9 (enharmonically a minor third), implying the **altered scale** (7th mode of melodic minor) or a blues context where major and minor thirds coexist. If you've encountered the term "Lydian cadence" somewhere specific, that source is using non-standard terminology.

**sonnet/+Rule+RAG** — ✓ correctly flagged

> The term "Lydian cadence" is not a standard jazz theory term, and it is not a recognized name for the E7#9 ("Hendrix chord"). The Hendrix chord is a dominant 7th with a raised (augmented) ninth, functioning as a bluesy tonic-dominant hybrid. If you've encountered "Lydian cadence" in a specific source, please share the context, as it may be a non-standard or mistaken usage.

---

### D · `d14` (trap)
- **Q:** Explain the rule in jazz harmony that a major 7th chord must always omit its 11th.
- **Trap — 좋은 답 신호 (참고):** `not an absolute`, `not always`, `#11 can`, `can include`…

**haiku/raw** — ✓ correctly flagged

> This isn't a standard rule in jazz harmony. Major 7th chords can include an 11th—in fact, Cmaj7#11 and Cmaj7(11) are common voicings in jazz. The 11th is often raised (#11) to avoid clashing with the major 3rd, but there's no requirement to omit it entirely. You may be thinking of a specific voicing preference or a rule from a particular method book, but it's not a universal principle.

**haiku/+Rule** — ✓ correctly flagged

> This premise is false. There is no such rule in jazz harmony. Major 7th chords (Imaj7, IVmaj7, etc.) frequently include the 11th—it's a common and desirable extension that adds harmonic richness without creating dissonance, since the major 3rd and natural 11th are compatible intervals. The 11th is omitted only when a specific voicing choice or context calls for it, not as a standing requirement.

**haiku/+Rule+RAG** — ✓ correctly flagged

> This premise is **false**. There is no such rule in jazz harmony.
> 
> A major 7th chord (e.g., CMaj7: C–E–G–B) can absolutely include an 11th. In fact, CMaj7(#11) or CMaj7(11) is common in modern jazz voicings—the #11 (F#) is particularly popular because it avoids the dissonant natural 11th (F) that would clash with the major 3rd (E). The choice to include or omit the 11th depends on context, voicing preference, and melodic line, not on a blanket rule.

**sonnet/raw** — ✓ correctly flagged

> There is no such rule in jazz harmony. Major 7th chords can and frequently do include the natural 11th, though the raised 11th (♯11, the Lydian sound) is often preferred to avoid the half-step clash between the 3rd and the natural 11th. Whether to include or omit the 11th is a matter of voicing choice and context, not a fixed rule.

**sonnet/+Rule** — ✓ correctly flagged

> This premise is false. There is no such rule in jazz harmony.
> 
> The 11th (the natural 4th) is typically **avoided** on major 7th chords because it creates a minor 9th clash with the major 3rd, which is acoustically harsh and obscures the chord's tonic function — but this is a **voice-leading guideline**, not an absolute rule. The **#11 (lydian sound)** is in fact a standard and idiomatic color tone on maj7 chords (producing a maj7#11, drawn from the Lydian mode or the 4th mode of melodic minor), and even a natural 11 may appear in specific voicings or contexts where the clash is acceptable or desired.

**sonnet/+Rule+RAG** — ✓ correctly flagged

> This is a false premise. There is no absolute rule in jazz harmony that a major 7th chord *must* omit its 11th. The common **practical guideline** is that the natural 11th (4th) clashes harshly with the major 3rd (a minor 9th interval), so it is typically avoided or raised to a ♯11, giving a Maj7(♯11) chord drawn from the Lydian mode. Omission is one option, but raising it is equally standard and widely used.

---

### D · `d15` (trap)
- **Q:** What is the 'augmented ii-V-I' progression as defined in standard jazz theory?
- **Trap — 좋은 답 신호 (참고):** `not a standard`, `no such`, `not a recognized`, `not aware`…

**haiku/raw** — ✓ correctly flagged

> There is no standard jazz theory term called "augmented ii-V-I." You may be thinking of either: (1) a ii-V-I with an augmented chord substitution somewhere in the progression, or (2) a ii-V-I where the V chord is altered with augmented extensions (like #5 or #11). If you can clarify what specific chord qualities or alterations you're asking about, I can give you a more precise answer.

**haiku/+Rule** — ✓ correctly flagged

> This term is not standard in jazz theory literature. The ii-V-I is a foundational progression (typically ii-7, V7, Imaj7), but "augmented ii-V-I" has no established definition in authoritative sources like Levine's *Jazz Theory Book* or Slonimsky's *Thesaurus of Scales*.
> 
> You may be thinking of: (1) a ii-V-I with chromatic alterations or extensions, (2) a progression using an augmented chord as a passing sonority, or (3) a secondary ii-V-I. Could you clarify what you mean?

**haiku/+Rule+RAG** — ✓ correctly flagged

> This term is not standard in jazz theory. There is no established concept called an "augmented ii-V-I" progression in formal jazz harmony.
> 
> You may be thinking of one of these: (1) a ii-V-I with an augmented chord substitution (like using an augmented triad as a passing chord), (2) a progression featuring a V7♯5 or V7♯11 (altered dominant), or (3) a chromatic approach using augmented harmony. Could you clarify what you mean, or provide an example?

**sonnet/raw** — ✓ correctly flagged

> The "augmented ii-V-I" is not a standard, formally defined term in jazz theory. You may be thinking of related concepts such as the **tritone substitution** (where the V7 is replaced by a chord a tritone away), or a ii-V-I where the V7 chord contains an augmented fifth (e.g., G7#5), but neither of these is standardly labeled an "augmented ii-V-I." Could you clarify where you encountered this term?

**sonnet/+Rule** — ✓ correctly flagged

> "Augmented ii-V-I" is not a standard or widely recognized term in jazz harmony pedagogy. No such named progression appears in authoritative sources like Levine's *The Jazz Theory Book*, Rawlins & Bahha's *Jazzology*, or Russell's *Lydian Chromatic Concept*.
> 
> You may be thinking of a **tritone substitution ii-V-I** (e.g., ii-7 → subV7 → Imaj7), a **iiø7-V7alt-i** minor ii-V-I, or a progression involving an **augmented dominant** (V7♯5). If you can provide the specific chord voicings or a source, I can analyze it precisely.

**sonnet/+Rule+RAG** — ✓ correctly flagged

> "Augmented ii-V-I" is not a standard term in jazz harmony theory. You may be thinking of related but distinct concepts: a **subV7** (tritone substitute dominant), a **V7alt** (altered dominant using the altered scale), or a progression involving an **augmented chord** as a passing harmony. Please clarify what you have in mind, and I can give you a precise analysis.

---

### D · `d16` (control)
- **Q:** In a major key, what is the chord quality built on the 7th scale degree (the vii chord)?
- **Accept:** `diminished` / `m7b5` / `half-diminished` / `half diminished` / `minor 7 flat 5`

**haiku/raw** — ✓ correct

> In a major key, the vii chord is a **half-diminished 7th chord** (viiø7) when you include the seventh, or a **diminished triad** (vii°) if you're building just a triad. This chord naturally occurs because the 7th scale degree is a half step below the tonic, creating the characteristic diminished quality.

**haiku/+Rule** — ✓ correct

> In a major key, the vii chord built on the 7th scale degree is **viiø7** (half-diminished seventh)—or **vii°7** (fully diminished seventh) if you add another minor third above.
> 
> The diatonic seventh chord is **viiø7**, which functions as a dominant substitute (it shares the tritone with V7) and typically resolves to I. The fully diminished **vii°7** occurs when you use the raised 7th from harmonic minor or add chromatic alteration, making it a secondary dominant function.

**haiku/+Rule+RAG** — ✓ correct

> In a major key, the vii chord is **viiø7** (half-diminished 7th), built on the 7th scale degree with a diminished triad plus a minor 7th.
> 
> For example, in C major: B-D-F-A♭ = Bø7. This chord functions as a secondary dominant substitute (related ii to V) and typically resolves to I, though it rarely appears as a standalone diatonic chord in jazz without chromatic alteration or functional reinterpretation.

**sonnet/raw** — ✓ correct

> In a major key, the chord built on the 7th scale degree is a **diminished triad** (half-diminished if you extend it to a seventh chord, giving you a minor 7♭5). For example, in C major, the vii chord is B diminished (B–D–F).

**sonnet/+Rule** — ✓ correct

> ## vii° in Major — Formal Analysis
> 
> **Local key: C major (as representative example)**
> 
> The chord built on the 7th scale degree (B) using diatonic thirds yields **B–D–F**, which is a **diminished triad**.
> 
> - **Roman numeral:** **vii°**
> - **Quality:** Diminished triad (minor third + diminished fifth / tritone above root)
> - **Function:** **Dominant function** — it shares two tones with G7 (the V7): namely B (the leading tone) and F (the chordal seventh of V7), making vii° a rootless V7 and giving it strong dominant pull toward I.
> 
> > If extended to a seventh chord, the diatonic quality becomes **viiø7** (half-diminished) in major — e.g., B–D–F–A — which is the more common jazz voicing, still carrying dominant function.

**sonnet/+Rule+RAG** — ✓ correct

> In a major key, the triad built on the 7th scale degree is a **diminished triad** (e.g., in C major: B–D–F = B°), labeled **vii°**. As a seventh chord it becomes a **half-diminished seventh** (viiø7, e.g., B–D–F–A), which functions as a **dominant-function** chord — it shares three notes with V7 and typically resolves to I.

---

### D · `d17` (control)
- **Q:** What are the four notes of a G7 chord?
- **Accept:** `G B D F` / `GBDF`

**haiku/raw** — ✓ correct

> A G7 (dominant seventh) chord contains four notes: G (root), B (major third), D (perfect fifth), and F (minor seventh).

**haiku/+Rule** — ✓ correct

> G7 is a dominant seventh chord with four notes: **G (root), B (major third), D (perfect fifth), and F (minor seventh)**.
> 
> In Roman numeral analysis, this would be labeled **V7** when functioning as a dominant chord resolving to C major/minor, with the function of creating tension that expects resolution to the tonic.

**haiku/+Rule+RAG** — ✓ correct

> The four notes of a G7 chord are: **G (root), B (major 3rd), D (perfect 5th), F (minor 7th)**.

**sonnet/raw** — ✓ correct

> The four notes of a G7 (G dominant seventh) chord are **G, B, D, and F**. These consist of the root (G), major third (B), perfect fifth (D), and minor seventh (F).

**sonnet/+Rule** — ✓ correct

> **G7 (G dominant seventh):** G – B – D – F
> 
> - **Root:** G
> - **Major third:** B
> - **Perfect fifth:** D
> - **Minor seventh:** F
> 
> Function: typically **V7** in the key of C major, carrying dominant function and resolving to **Imaj7 (Cmaj7)**. The tritone between B (3rd) and F (♭7) drives the resolution.

**sonnet/+Rule+RAG** — ✓ correct

> In the key of C major, **G7** (G dominant seventh) contains: **G – B – D – F**.
> 
> These are the root (G), major third (B), perfect fifth (D), and minor seventh (F), making it the V7 chord functioning as the dominant of C major.

---

## E · 곡 특화 (song-grounded, 10문항)

_Song-specific factual questions about jazz standards that ARE covered in detail in the RAG corpus (frontend/data/explanation/standards/*.txt). Designed to test whether RAG helps when the corpus actually contains the answer — vs. the abstract-theory questions in Task B where the corpus has no direct coverage. Model answers JSON {"answer":"..."}; scored by normalized match against accept[]._

코퍼스에 답이 직접 들어있는 곡 분석 질문 — RAG가 lift를 보여야 마땅한 통제 비교용 태스크.

### E · `e01`
- **Q:** 재즈 스탠더드 Stella by Starlight의 첫 코드는 무엇인가? (정확한 코드 기호로 답하라)
- **Accept:** `Em7b5` / `Em7♭5` / `Eø7` / `Eø` / `E half-diminished` / `E half diminished` / `E-7b5` / `E minor 7 flat 5`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Cm(maj7) | ✗ |
| **haiku/+Rule** | ```json {   "answer": "Cmaj7 (또는 곡의 버전에 따라 C-maj7). Stella by Starlight는 B♭ 장조로 시작하는 경우가 많으므로, B♭maj7 또는 B♭-maj7일 수 있습니다… | ✗ |
| **haiku/+Rule+RAG** | ```json {   "answer": "Cmaj7 (또는 분석에 따라 Imaj7 in C major)",   "analysis": "Stella by Starlight는 B♭ 메이저 키에서 시작하지만, 첫 코드는 … | ✗ |
| **sonnet/raw** | Em7b5 | ✓ |
| **sonnet/+Rule** | Em7b5 (iiø7 in F장조 / Eø7, E반감화음 — 곡의 첫 코드는 Em7♭5(Eø7)이며, 기능적으로는 B♭장조의 iiø7 또는 C장조의 iiø7/vi 등 다양한 해석이 가능하나, 리드시트 기준 첫 코드는 Em7♭5) | ✓ |
| **sonnet/+Rule+RAG** | Em7♭5 (E half-diminished 7, iiø7 in the key of D minor / functioning as iiø7 → V7 toward Cm or as part of the opening iiø7–V7 sequence) | ✓ |

### E · `e02`
- **Q:** Have You Met Miss Jones의 브릿지는 키 센터들이 어떤 음정 간격으로 이동하는가?
- **Accept:** `major third` / `major thirds` / `장3도` / `장 3도` / `M3` / `장3` / `장 3`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Have You Met Miss Jones의 브릿지는 반음(semitone) 간격으로 키 센터가 이동합니다. 원래 키(F major)에서 시작하여 반음씩 상행하며 F → F# → G → G# → A로 진행되는 크로매틱 모듈레이션 구조를 가지고 있습니다. | ✗ |
| **haiku/+Rule** | ```json {   "answer": "Have You Met Miss Jones의 브릿지는 반음(semitone) 상행으로 키 센터가 이동합니다. 원곡이 C장조라면 브릿지는 C#장조로 modulation되며, 이… | ✗ |
| **haiku/+Rule+RAG** | ```json {   "answer": "Have You Met Miss Jones의 브릿지는 장3도(major third) 간격으로 키 센터가 이동합니다. B♭ 장조 → G♭ 장조 → D 장조로 진행하며, 각 키는… | ✓ |
| **sonnet/raw** | 장3도(Major Third) 간격으로 이동한다. B♭ → G♭ → D → B♭ 순서로 각 키 센터가 장3도씩 하행하며 순환한다. | ✓ |
| **sonnet/+Rule** | {"answer":"Have You Met Miss Jones의 브릿지는 세 개의 키 센터가 장3도(Major 3rd) 간격으로 하강 이동한다. 구체적으로 Bb장조 → Gb장조 → D장조 → Bb장조로 복귀하며, 각… | ✓ |
| **sonnet/+Rule+RAG** | 장3도(major third) 간격으로 이동합니다. 세 키 센터 B♭, G♭, D가 각각 장3도씩 아래로 이동하며 옥타브를 3등분합니다. | ✓ |

### E · `e03`
- **Q:** Misty (E♭ major)의 A 섹션에서 AbMaj7이 마이너로 바뀐 후 함께 등장하여 backdoor 케이던스를 이루는 도미넌트 7th 코드는?
- **Accept:** `Db7` / `D♭7` / `Db dominant 7`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | EbMaj7 | ✗ |
| **haiku/+Rule** | Eb7 (Ebdom7). Misty A섹션의 로컬 키센터 Ab major에서: AbMaj7(Imaj7) → Eb7(V7/IV의 서브도미넌트 기능)이 backdoor cadence를 형성. Eb7은 Ab major의 iv도(Abm)로 해석되는 AbMaj7 다음에 나타나 ♭VII7 → I의 전형적 backdoor 진행을 완성. | ✗ |
| **haiku/+Rule+RAG** | Db7 (♭VII7 of Eb). AbMaj7(IV)이 Abm7(iv)로 변환된 후, Db7이 짝을 이루어 backdoor cadence를 형성하며, Db7은 Eb 메이저 기준 ♭VII7 도미넌트로 기능하여 한 음 위로 상행 해결(Db7 → EbMaj7)된다. | ✓ |
| **sonnet/raw** | B♭7 | ✗ |
| **sonnet/+Rule** | {"answer":"Backdoor 케이던스는 ♭VII7 → Imaj7 진행입니다. E♭ major에서 AbMaj7(IVmaj7)이 Ab-7(iv-7)로 마이너화된 후, 이와 함께 등장하는 도미넌트 7th 코드는 D… | ✓ |
| **sonnet/+Rule+RAG** | D♭7 | ✓ |

### E · `e04`
- **Q:** Charlie Parker의 Yardbird Suite는 어떤 키로 연주되는가?
- **Accept:** `C major` / `C` / `Cmaj` / `C 메이저`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | F major (F 장조) | ✗ |
| **haiku/+Rule** | F 메이저 키. Yardbird Suite는 F 메이저로 작곡되었으며, 헤드(주제)와 코드 진행이 F 메이저 톤알리티를 중심으로 전개됩니다. | ✗ |
| **haiku/+Rule+RAG** | Yardbird Suite는 F 메이저 키로 연주됩니다. 이는 Charlie Parker의 대표적인 비�op 컴포지션으로, F 메이저를 중심으로 한 ii-V-I 진행과 secondary dominant를 활용한 구조를 특징으로 합니다. | ✓ |
| **sonnet/raw** | C장조 (C Major) | ✓ |
| **sonnet/+Rule** | {"answer":"Yardbird Suite (Charlie Parker, 1946)는 C장조(C major)로 연주됩니다. 로컬 키 센터: C major. 주요 화성 진행은 Imaj7(Cmaj7) → vi-7(A… | ✓ |
| **sonnet/+Rule+RAG** | Yardbird Suite는 C장조(C Major)로 연주된다. | ✓ |

### E · `e05`
- **Q:** Roy Hargrove의 Strasbourg / St. Denis는 몇 마디 진행을 반복해서 만들어지는가? (숫자만)
- **Accept:** `8` / `8마디` / `8 bars` / `eight` / `eight bars` / `여덟`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | 16 | ✗ |
| **haiku/+Rule** | 정보 부족 - Roy Hargrove의 'Strasbourg / St. Denis' 정확한 반복 마디 수를 확인할 수 없음 | ✗ |
| **haiku/+Rule+RAG** | 정보 부족 - Roy Hargrove의 'Strasbourg / St. Denis' 악곡 구조에 대한 구체적 데이터 없음 | ✗ |
| **sonnet/raw** | 8 | ✓ |
| **sonnet/+Rule** | 8 | ✓ |
| **sonnet/+Rule+RAG** | 4 | ✗ |

### E · `e06`
- **Q:** Oscar Peterson의 Hymn To Freedom A섹션에서 chord IV(EbMaj)가 chord I(Bb)로 진행하는 케이던스의 일반적 이름은 무엇인가?
- **Accept:** `plagal` / `plagal cadence` / `변격종지` / `변격 종지` / `amen cadence` / `변진행`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | Subdominant to Tonic (IV-I) 진행, 또는 Plagal Cadence(성가풍 종지) | ✓ |
| **haiku/+Rule** | Plagal Cadence (또는 Amen Cadence). IV에서 I로의 진행은 전통적 재귀 화성 진행으로, subdominant 기능에서 tonic으로의 해결을 나타냅니다. 재즈 문맥에서는 종종 modal interchange 또는 blues-influenced harmony로도 해석될 수 있습니다. | ✓ |
| **haiku/+Rule+RAG** | Plagal cadence (IV–I), also known as the 'Amen cadence' or 'church cadence'. In this piece, Peterson disguises it by inserting a passing E°7 between Eb and Bb/F, creating chromatic bass motion (Eb → E → F) before resolving to root-position Bb. | ✓ |
| **sonnet/raw** | plagal cadence (플라갈 케이던스) | ✓ |
| **sonnet/+Rule** | plagal cadence (플라갈 케이던스). 로컬 키 Bb장조에서 IVmaj7(EbMaj7) → Imaj7(BbMaj7) 진행이며, 기능적으로 subdominant → tonic 해결이다. 'Amen cadence'라고도 불린다. | ✓ |
| **sonnet/+Rule+RAG** | 표절 종지 (Plagal Cadence) — IV→I 진행으로, 교회 음악의 '아멘' 종지라고도 불린다. | ✓ |

### E · `e07`
- **Q:** Kenny Dorham의 Blue Bossa는 어느 키로 시작하는가?
- **Accept:** `C minor` / `Cm` / `C-` / `C 마이너` / `C minor key` / `Cmin` / `C 단조`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | C 메이저 키 | ✓ |
| **haiku/+Rule** | C major. Blue Bossa는 C major 키로 시작하며, 첫 번째 코드는 Cmaj7 (Imaj7)입니다. | ✓ |
| **haiku/+Rule+RAG** | C 마이너(C minor). Blue Bossa는 C 마이너 키로 시작하며, 후반부에서 ♭II 메이저(D♭ 메이저)로 잠시 전조한 후 다시 C 마이너로 복귀한다. | ✓ |
| **sonnet/raw** | C단조(Cm) | ✓ |
| **sonnet/+Rule** | C단조(C minor)로 시작합니다. 첫 번째 섹션은 Cm7(i-7) → Fm7(iv-7) → Dm7b5(iiø7) → G7(V7) の진행으로 C Dorian / C minor tonality를 확립합니다. | ✓ |
| **sonnet/+Rule+RAG** | C 마이너(Cm)로 시작한다. 전반부 8마디는 C 마이너 키 중심으로 Cm7 → Fm7 → Dm7♭5 → G7 → Cm7 진행이 이루어진다. | ✓ |

### E · `e08`
- **Q:** Joseph Kosma의 Autumn Leaves가 Bb major와 함께 사용하는 나란한 마이너 키는 무엇인가?
- **Accept:** `G minor` / `Gm` / `G-` / `G 마이너` / `Gmin` / `G minor key`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | G minor | ✓ |
| **haiku/+Rule** | Bb major의 나란한 마이너 키(relative minor)는 G minor입니다. Autumn Leaves는 Bb major에서 시작하여 G minor(vi)로 모듈레이션하며, 이는 relative minor 관계입니다. | ✓ |
| **haiku/+Rule+RAG** | ```json {   "answer": "G minor (G 마이너). Bb major의 relative minor는 G minor이며, Autumn Leaves는 Bb major 다이아토닉을 중심으로 분석하되 G … | ✓ |
| **sonnet/raw** | G minor | ✓ |
| **sonnet/+Rule** | {"answer":"Bb major의 나란한 마이너 키는 G minor입니다. Autumn Leaves는 Bb major와 그 관계 단조인 G minor를 함께 사용하며, 두 조성은 같은 조표(2♭: Bb, Eb)를… | ✓ |
| **sonnet/+Rule+RAG** | G minor (G 마이너) | ✓ |

### E · `e09`
- **Q:** Henry Mancini의 Moon River는 몇 박자(time signature)로 작곡되었는가?
- **Accept:** `3/4` / `삼사박자` / `3박자` / `3 4박자` / `waltz` / `왈츠`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | 4/4 (Common Time) | ✗ |
| **haiku/+Rule** | Moon River는 4/4 박자(common time)로 작곡되었습니다. | ✗ |
| **haiku/+Rule+RAG** | 4/4 (Common time). Moon River는 표준 4/4 박자로 작곡되었습니다. | ✗ |
| **sonnet/raw** | 3/4박자 (왈츠) | ✓ |
| **sonnet/+Rule** | 3/4박자 (왈츠) | ✓ |
| **sonnet/+Rule+RAG** | 3/4박자 (왈츠) | ✓ |

### E · `e10`
- **Q:** Body and Soul (Db major)은 1도(I)가 아닌 어떤 도수(roman numeral)의 코드로 시작하는가?
- **Accept:** `ii` / `ii도` / `ii chord` / `ii-7` / `2도` / `Ebm7` / `E♭m7` / `2`

| 모델/조건 | 답 | 채점 |
|---|---|---|
| **haiku/raw** | vi (F minor) | ✗ |
| **haiku/+Rule** | ```json {   "answer": "Dbmaj7은 vi-7(b5) / Bbm7(b5)로 시작합니다. Db 장조에서 vi도수는 Bbm7(b5) (반감7화음)이며, Body and Soul의 첫 코드 Dbmaj7은… | ✗ |
| **haiku/+Rule+RAG** | ii (E♭m7) — Body and Soul은 D♭ major에서 I(DbMaj7)이 아닌 ii(E♭m7)로 시작한다. 이는 지연된 토닉 오프닝(delayed-tonic opening)으로, 청자를 즉시 토닉에 안착시키지 않고 ii-V-I 진행으로 끌어당겨 '귀향하는' 갈망의 감정을 만든다. | ✓ |
| **sonnet/raw** | II7 (IIm7 또는 Ebm7, 즉 ii7)로 시작합니다. Db major 기준으로 ii7에 해당하는 Ebm7 코드로 시작합니다. | ✓ |
| **sonnet/+Rule** | Body and Soul (Db장조)는 ii-7(Eb-7)로 시작합니다. 즉, 으뜸음(I)이 아닌 ii-7(서브도미넌트 기능)로 곡이 시작됩니다. | ✓ |
| **sonnet/+Rule+RAG** | ii (Ebm7) | ✓ |

