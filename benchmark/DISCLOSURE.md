# Jazzify 벤치마크 — 전체 QA·응답 공개

4개 태스크(A 구조분석 · B 이론팩트 · C 설명 · D 할루시네이션) × 조건별 모든 골드 QA, 모델 응답, 채점을 공개. `gold/*.json` + `results/responses.json`에서 자동 생성(`node benchmark/disclose.mjs`).

- **모델:** `claude-sonnet-4-20250514`  ·  **temperature:** 0
- **조건:** A는 Raw / +Rule / +RAG / +Rule+RAG · B/C/D는 Raw / +RAG
- **이 머신에 있는 응답 (216건):**
  - A / +RAG: 24건
  - A / +Rule: 24건
  - A / +Rule+RAG: 24건
  - A / Raw: 24건
  - B / +RAG: 30건
  - B / Raw: 30건
  - C / +RAG: 8건
  - C / Raw: 8건
  - E / +RAG: 10건
  - E / Raw: 10건
  - F / +RAG: 12건
  - F / Raw: 12건

> ℹ️ 일부 (task, condition)에 응답이 없으면 그 칸은 `(응답 미동기화)`로 표시됩니다. 다른 머신(예: 맥미니)에서 돌린 응답을 가져오려면:
> ```bash
> # 맥미니 → 이 머신
> scp <macmini>:~/<repo>/benchmark/results/responses.json benchmark/results/
> node benchmark/disclose.mjs   # DISCLOSURE.md 재생성
> ```

---

## A · 구조 분석 (24문항)

진행을 0-인덱스로 주고 `{"key":"...", "iiVi":[[i,j,k]], "romans":["..."]}` JSON 답을 받음. 채점: key 집합일치 / ii-V-I micro P·R·F1 / 코드별 로마숫자.

### A · `p01-cmaj-251`
- **Chords:** `Dm7  G7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: C major. Dm7=ii-7, G7=V7, Cmaj7=Imaj7. Detected 2-5-1: Dm7→G7→Cmaj7 (C major).

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p02-gmaj-251`
- **Chords:** `Am7  D7  Gmaj7`
- **Gold:** keys=`[["G"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: G major. Am7=ii-7, D7=V7, Gmaj7=Imaj7. Detected 2-5-1: Am7→D7→Gmaj7 (G major).

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p03-bbmaj-251`
- **Chords:** `Cm7  F7  Bbmaj7`
- **Gold:** keys=`[["Bb"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: Bb major. Cm7=ii-7, F7=V7, Bbmaj7=Imaj7. Detected 2-5-1: Cm7→F7→Bbmaj7 (Bb major).

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`Bb` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule** | key=`Bb major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`Bb major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`Bb major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p04-dmin-251`
- **Chords:** `Em7b5  A7  Dm7`
- **Gold:** keys=`[["D minor"]]` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i-7"]`
- **Rule context (주입):** Key: D minor. Em7b5=iiø7, A7=V7(alt), Dm7=i-7. Detected minor 2-5-1: Em7b5→A7→Dm7 (D minor).

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`D minor` · iiVi=`[[0,1,2]]` · romans=`["ii°7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=67% |
| **+Rule** | key=`D minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`Dm` · iiVi=`[[0,1,2]]` · romans=`["ii∅7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=67% |
| **+Rule+RAG** | key=`D minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p05-modulating-two-251`
- **Chords:** `Dm7  G7  Cmaj7  Cm7  F7  Bbmaj7`
- **Gold:** keys=`[["C","Bb"]]` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]`
- **Rule context (주입):** Two key centers. C major (bars 1-3): Dm7=ii-7, G7=V7, Cmaj7=Imaj7. Bb major (bars 4-6): Cm7=ii-7, F7=V7, Bbmaj7=Imaj7. Detected 2-5-1 x2.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule** | key=`C major, Bb major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`C major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`C major, Bb major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p06-251-plus-vi`
- **Chords:** `Dm7  G7  Cmaj7  A7`
- **Gold:** keys=`[["C"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7","VI7"]`
- **Rule context (주입):** Key: C major. Dm7=ii-7, G7=V7, Cmaj7=Imaj7, A7=VI7 (secondary dominant V7/ii, turnaround). One 2-5-1: Dm7→G7→Cmaj7.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","VI7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","VI7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","VI7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","VI7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p07-autumn-leaves`
- **Chords:** `Cm7  F7  Bbmaj7  Ebmaj7  Am7b5  D7  Gm7`
- **Gold:** keys=`[["Bb","G minor"]]` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii-7","V7","Imaj7","IVmaj7","iiø7","V7","i-7"]`
- **Rule context (주입):** Relative major/minor. Bb major: Cm7=ii-7, F7=V7, Bbmaj7=Imaj7, Ebmaj7=IVmaj7. G minor: Am7b5=iiø7, D7=V7(alt), Gm7=i-7. Detected 2-5-1 x2.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`Bb major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","IVmaj7","vii7b5","V7/vi","vi7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=57% |
| **+Rule** | key=`Bb major, G minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii-7","V7","Imaj7","IVmaj7","iiø7","V7","i-7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`Bb major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","IVmaj7","vii7b5","V7/vi","vi7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=57% |
| **+Rule+RAG** | key=`Bb major, G minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","IVmaj7","iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p08-blues-no-251`
- **Chords:** `F7  Bb7  F7  F7`
- **Gold:** keys=`[["F"]]` · iiVi=`[]` · romans=`["I7","IV7","I7","I7"]`
- **Rule context (주입):** Key: F major (blues). All dominant chords. F7=I7, Bb7=IV7. No ii-V-I present.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`F` · iiVi=`[]` · romans=`["I7","IV7","I7","I7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule** | key=`F major` · iiVi=`[]` · romans=`["I7","IV7","I7","I7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`Bb` · iiVi=`[]` · romans=`["V7","I7","V7","V7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=0% |
| **+Rule+RAG** | key=`F major` · iiVi=`[]` · romans=`["I7","IV7","I7","I7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p09-fmaj-251`
- **Chords:** `Gm7  C7  Fmaj7`
- **Gold:** keys=`[["F"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: F major. Gm7=ii-7, C7=V7, Fmaj7=Imaj7. Detected 2-5-1: Gm7→C7→Fmaj7 (F major).

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`F major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule** | key=`F major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`F major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`F major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p10-static-vamp`
- **Chords:** `Cmaj7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]`
- **Rule context (주입):** Key: C major. Static Imaj7 vamp. No ii-V-I present.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`C` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p11-secondary-dom-chain`
- **Chords:** `Cmaj7  A7  Dm7  G7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: C major. Cmaj7=Imaj7, A7=VI7 (secondary dominant V7/ii), Dm7=ii-7, G7=V7, Cmaj7=Imaj7. One 2-5-1 at indices 2-3-4 (Dm7→G7→Cmaj7). A7 is NOT a ii.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","V7/ii","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=80% |
| **+Rule** | key=`C major` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`C major` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`C major` · iiVi=`[[2,3,4]]` · romans=`["Imaj7","VI7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p12-modal-interchange-backdoor`
- **Chords:** `Cmaj7  Fm7  Bb7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[]` · romans=`["Imaj7","iv-7","bVII7","Imaj7"]`
- **Rule context (주입):** Key: C major with modal interchange. Cmaj7=Imaj7, Fm7=iv-7 (borrowed from C minor), Bb7=bVII7 (backdoor dominant). Fm7→Bb7 resolves deceptively to Cmaj7 — NOT a ii-V-I in C. No ii-V-I.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","ivm7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=75% |
| **+Rule** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`C major` · iiVi=`[[1,2,3]]` · romans=`["Imaj7","ivm7","bVII7","Imaj7"]` | key=✓ · P=0.00 R=0.00 F1=0.00 · Roman=75% |
| **+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p13-coltrane-ii-v-fragment`
- **Chords:** `Am7  D7  Gmaj7  Bb7`
- **Gold:** keys=`[["G"]]` · iiVi=`[[0,1,2]]`
- **Rule context (주입):** Primary key G major: Am7=ii-7, D7=V7, Gmaj7=Imaj7 (2-5-1). Bb7 is a Coltrane-style secondary dominant pivoting toward Eb (V7/Eb) — not part of a ii-V-I here.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","bIII7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+Rule** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","bIII7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+RAG** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","bIII7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+Rule+RAG** | key=`G major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","bIII7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |

### A · `p14-dorian-vamp`
- **Chords:** `Dm7  Em7  Dm7  Em7`
- **Gold:** keys=`[["D minor"],["D dorian"]]` · iiVi=`[]`
- **Rule context (주입):** Modal: D dorian vamp (Dm7 ↔ Em7, i-7 ↔ ii-7). No dominant, no ii-V-I.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[]` · romans=`["ii7","iii7","ii7","iii7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+Rule** | key=`D dorian` · iiVi=`[]` · romans=`["i7","ii7","i7","ii7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+RAG** | key=`C major` · iiVi=`[]` · romans=`["ii7","iii7","ii7","iii7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+Rule+RAG** | key=`D dorian` · iiVi=`[]` · romans=`["i7","ii7","i7","ii7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |

### A · `p15-attya-opening`
- **Chords:** `Fm7  Bbm7  Eb7  Abmaj7  Dbmaj7  G7  Cmaj7`
- **Gold:** keys=`[["Ab","C"]]` · iiVi=`[[1,2,3]]`
- **Rule context (주입):** Ab major: Fm7=vi-7, Bbm7=ii-7, Eb7=V7, Abmaj7=Imaj7 (2-5-1 at 1-2-3). Then Dbmaj7=IVmaj7 of Ab. G7→Cmaj7 is a V-I into C major (no ii — NOT a ii-V-I). Detected one 2-5-1: Bbm7→Eb7→Abmaj7.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`Ab major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["vi7","ii7","V7","I","IV","V7/vi","vi"]` | key=✗ · P=0.00 R=0.00 F1=0.00 · Roman=— |
| **+Rule** | key=`Ab major` · iiVi=`[[1,2,3]]` · romans=`["vi7","ii7","V7","Imaj7","IVmaj7","V7/V","Vmaj7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+RAG** | key=`Ab major` · iiVi=`[[1,2,3]]` · romans=`["vi7","ii7","V7","Imaj7","IVmaj7","V7/vi","vi7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+Rule+RAG** | key=`Ab major, C major` · iiVi=`[[1,2,3]]` · romans=`["vi7","ii7","V7","Imaj7","IVmaj7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |

### A · `p16-tritone-sub`
- **Chords:** `Dm7  Db7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[]` · romans=`["ii-7","bII7","Imaj7"]`
- **Rule context (주입):** Key: C major. Dm7=ii-7, Db7=bII7 (tritone substitute of G7, subV7/I), Cmaj7=Imaj7. Db7→Cmaj7 is a half-step resolution, NOT the P5 of a standard ii-V-I, so no ii-V-I is counted.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","bII7","Imaj7"]` | key=✓ · P=0.00 R=0.00 F1=0.00 · Roman=100% |
| **+Rule** | key=`C major` · iiVi=`[]` · romans=`["ii7","bII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","bII7","Imaj7"]` | key=✓ · P=0.00 R=0.00 F1=0.00 · Roman=100% |
| **+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["ii7","bII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p17-cmin-251`
- **Chords:** `Dm7b5  G7  Cm7`
- **Gold:** keys=`[["C minor"]]` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i-7"]`
- **Rule context (주입):** Key: C minor. Dm7b5=iiø7, G7=V7(alt), Cm7=i-7. Detected minor 2-5-1: Dm7b5→G7→Cm7.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`Cm` · iiVi=`[[0,1,2]]` · romans=`["ii°7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=67% |
| **+Rule** | key=`C minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`Cm` · iiVi=`[[0,1,2]]` · romans=`["ii∅7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=67% |
| **+Rule+RAG** | key=`C minor` · iiVi=`[[0,1,2]]` · romans=`["iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p18-modulating-g-f`
- **Chords:** `Am7  D7  Gmaj7  Gm7  C7  Fmaj7`
- **Gold:** keys=`[["G","F"]]` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii-7","V7","Imaj7","ii-7","V7","Imaj7"]`
- **Rule context (주입):** Two key centers. G major: Am7=ii-7, D7=V7, Gmaj7=Imaj7. F major: Gm7=ii-7, C7=V7, Fmaj7=Imaj7. Detected 2-5-1 x2.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`G major, F major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule** | key=`G major, F major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`G major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`G major, F major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p19-251-plus-backdoor`
- **Chords:** `Dm7  G7  Cmaj7  Fm7  Bb7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[[0,1,2]]` · romans=`["ii-7","V7","Imaj7","iv-7","bVII7","Imaj7"]`
- **Rule context (주입):** Key: C major. Dm7→G7→Cmaj7 is the 2-5-1. Fm7=iv-7, Bb7=bVII7 (backdoor) resolving to Cmaj7 — NOT a ii-V-I. One 2-5-1 only.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[[0,1,2],[3,4,5]]` · romans=`["ii7","V7","Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=0.50 R=1.00 F1=0.67 · Roman=100% |
| **+Rule** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2]]` · romans=`["ii7","V7","Imaj7","iv7","bVII7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p20-aeolian-vamp`
- **Chords:** `Am7  Dm7  Am7  Dm7`
- **Gold:** keys=`[["A minor"],["A dorian"]]` · iiVi=`[]`
- **Rule context (주입):** Modal: A minor/dorian vamp (i-7 ↔ iv-7). No dominant, no ii-V-I.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[]` · romans=`["vi7","ii7","vi7","ii7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+Rule** | key=`A minor` · iiVi=`[]` · romans=`["i7","iv7","i7","iv7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+RAG** | key=`C major` · iiVi=`[]` · romans=`["vi7","ii7","vi7","ii7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+Rule+RAG** | key=`A minor` · iiVi=`[]` · romans=`["i7","iv7","i7","iv7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |

### A · `p21-coltrane-v-i-cell`
- **Chords:** `Cmaj7  Eb7  Abmaj7  B7  Emaj7`
- **Gold:** keys=`[["C","Ab","E"]]` · iiVi=`[]`
- **Rule context (주입):** Coltrane changes — tonal centers in major thirds. Eb7→Abmaj7 and B7→Emaj7 are V-I motions WITHOUT a preceding ii, so they are NOT ii-V-I. No ii-V-I detected.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","bIII7","bVImaj7","VII7","IIImaj7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+Rule** | key=`C,Ab,E` · iiVi=`[]` · romans=`["Imaj7","bIII7","Imaj7","bVI7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+RAG** | key=`C` · iiVi=`[]` · romans=`["Imaj7","bIII7","bVImaj7","VII7","IIImaj7"]` | key=✗ · P=1.00 R=1.00 F1=1.00 · Roman=— |
| **+Rule+RAG** | key=`C,Ab,E` · iiVi=`[]` · romans=`["Imaj7","bIII7","Imaj7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=— |

### A · `p22-turnaround-no-i`
- **Chords:** `Cmaj7  A7  Dm7  G7`
- **Gold:** keys=`[["C"]]` · iiVi=`[]` · romans=`["Imaj7","VI7","ii-7","V7"]`
- **Rule context (주입):** Key: C major. Dm7=ii-7, G7=V7 but the progression ends on V7 with NO resolving I — an incomplete ii-V (turnaround). No complete ii-V-I.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[[2,3,0]]` · romans=`["Imaj7","V7/ii","ii7","V7"]` | key=✓ · P=0.00 R=0.00 F1=0.00 · Roman=75% |
| **+Rule** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","VI7","ii7","V7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`C major` · iiVi=`[[2,3,0]]` · romans=`["Imaj7","V7/ii","ii7","V7"]` | key=✓ · P=0.00 R=0.00 F1=0.00 · Roman=75% |
| **+Rule+RAG** | key=`C major` · iiVi=`[]` · romans=`["Imaj7","VI7","ii7","V7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p23-two-251-same-key`
- **Chords:** `Dm7  G7  Cmaj7  Am7  Dm7  G7  Cmaj7`
- **Gold:** keys=`[["C"]]` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii-7","V7","Imaj7","vi-7","ii-7","V7","Imaj7"]`
- **Rule context (주입):** Key: C major throughout. Two 2-5-1 cells (indices 0-2 and 4-6); Am7=vi-7 is a passing turnaround chord, not part of either.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`C major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","vi7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule** | key=`C major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","vi7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+RAG** | key=`C major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","vi7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |
| **+Rule+RAG** | key=`C major` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii7","V7","Imaj7","vi7","ii7","V7","Imaj7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=100% |

### A · `p24-amin-251-with-VI`
- **Chords:** `Bm7b5  E7  Am7  Fmaj7  Bm7b5  E7  Am7`
- **Gold:** keys=`[["A minor"]]` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["iiø7","V7","i-7","VImaj7","iiø7","V7","i-7"]`
- **Rule context (주입):** Key: A minor. Bm7b5=iiø7, E7=V7(alt), Am7=i-7 (minor 2-5-1) twice; Fmaj7=VImaj7 between them. Detected minor 2-5-1 x2.

| 조건 | 모델 답 (parsed) | 채점 |
|---|---|---|
| **Raw** | key=`Am` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii°7","V7","i7","♭VI","ii°7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=57% |
| **+Rule** | key=`A minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["iiø7","V7","i7","♭VImaj7","iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=86% |
| **+RAG** | key=`Am` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["ii∅7","V7","i7","♭VImaj7","ii∅7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=57% |
| **+Rule+RAG** | key=`A minor` · iiVi=`[[0,1,2],[4,5,6]]` · romans=`["iiø7","V7","i7","♭VImaj7","iiø7","V7","i7"]` | key=✓ · P=1.00 R=1.00 F1=1.00 · Roman=86% |

## B · 이론 팩트 (30문항)

단답. `{"answer":"..."}` JSON. normFact 정규화 후 accept[] 중 하나라도 매칭이면 정답.

### B · `b01`
- **Q:** What is the tritone substitute of G7?
- **Accept:** `Db7` / `C#7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Db7 | ✓ |
| **+RAG** | Db7 | ✓ |

### B · `b02`
- **Q:** What is the relative minor of Eb major?
- **Accept:** `C minor` / `Cm` / `Cmin`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | C minor | ✓ |
| **+RAG** | C minor | ✓ |

### B · `b03`
- **Q:** Which scale is most commonly played over a C7alt (altered dominant) chord?
- **Accept:** `altered scale` / `super locrian` / `superlocrian` / `diminished whole tone` / `altered`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | C altered scale (C Db Eb E Gb Ab Bb) | ✓ |
| **+RAG** | C altered scale (C Db Eb E Gb Ab Bb) | ✓ |

### B · `b04`
- **Q:** What are the four notes of a Cmaj7 chord (root position)?
- **Accept:** `C E G B` / `CEGB`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | C, E, G, B | ✓ |
| **+RAG** | C, E, G, B | ✓ |

### B · `b05`
- **Q:** What is the V7 chord in the key of D minor?
- **Accept:** `A7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | A7 (A-C#-E-G) | ✓ |
| **+RAG** | A7 (A-C#-E-G) | ✓ |

### B · `b06`
- **Q:** In a Dmaj7#11 chord, which note is the #11?
- **Accept:** `G#` / `Ab`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | G# | ✓ |
| **+RAG** | G# | ✓ |

### B · `b07`
- **Q:** What is the name of the 5th mode of the major scale?
- **Accept:** `Mixolydian`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Mixolydian | ✓ |
| **+RAG** | Mixolydian | ✓ |

### B · `b08`
- **Q:** Name the dominant 7th chord a tritone away from Db7.
- **Accept:** `G7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | G7 | ✓ |
| **+RAG** | G7 | ✓ |

### B · `b09`
- **Q:** What is the relative major of A minor?
- **Accept:** `C major` / `Cmaj` / `C`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | C major | ✓ |
| **+RAG** | C major | ✓ |

### B · `b10`
- **Q:** Which mode/scale fits a half-diminished (m7b5) chord?
- **Accept:** `Locrian`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Locrian mode (7th mode of major scale) | ✓ |
| **+RAG** | Locrian mode (7th mode of major scale) | ✓ |

### B · `b11`
- **Q:** What is the ii chord (ii-7) in the key of Bb major?
- **Accept:** `Cm7` / `Cmin7` / `Cm`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Cm7 (C-Eb-G-Bb) | ✓ |
| **+RAG** | Cm7 (C-Eb-G-Bb) | ✓ |

### B · `b12`
- **Q:** What is the enharmonic equivalent of Gb?
- **Accept:** `F#`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | F# | ✓ |
| **+RAG** | F# | ✓ |

### B · `b13`
- **Q:** Which mode of the melodic minor scale is the 'altered' (super Locrian) scale?
- **Accept:** `7th mode` / `seventh mode` / `7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | The 7th mode of the melodic minor scale is the altered (super Locrian) scale | ✓ |
| **+RAG** | The 7th mode of the melodic minor scale is the altered (super Locrian) scale | ✓ |

### B · `b14`
- **Q:** The Lydian dominant scale is which mode of the melodic minor scale?
- **Accept:** `4th mode` / `fourth mode` / `4`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | 4th mode | ✓ |
| **+RAG** | 4th mode | ✓ |

### B · `b15`
- **Q:** Name the upper-structure triad that gives a 7#11 sound when played over a C7 chord (which major triad on which root).
- **Accept:** `D major` / `D` / `Dmaj`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | F# major triad | ✓ |
| **+RAG** | F# major triad | ✓ |

### B · `b16`
- **Q:** In a minor ii-V-i, the V7 chord typically uses which scale (over e.g. A7 to Dm)?
- **Accept:** `altered` / `harmonic minor` / `phrygian dominant` / `hmp5b` / `harmonic minor perfect 5th below`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | A7 altered scale (or harmonic minor scale from the target key) | ✓ |
| **+RAG** | A7 altered scale (or harmonic minor scale from the target key) | ✓ |

### B · `b17`
- **Q:** What is the 'backdoor' dominant chord that resolves to Cmaj7?
- **Accept:** `Bb7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Bb7 - the bVII7 chord that resolves to Cmaj7 through smooth voice leading, with the Bb moving down to A and F moving down to E | ✓ |
| **+RAG** | Bb7 - the bVII7 chord that resolves to Cmaj7 through smooth voice leading, with the Bb moving down to A and F moving down to E | ✓ |

### B · `b18`
- **Q:** Which collection (scale) do you use over a fully diminished 7th chord, e.g. C°7?
- **Accept:** `whole half diminished` / `diminished scale` / `whole-half` / `octatonic` / `half-whole`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Diminished scale (whole-half or half-whole pattern) | ✓ |
| **+RAG** | Diminished scale (whole-half or half-whole pattern) | ✓ |

### B · `b19`
- **Q:** What is the relative minor of Gb major?
- **Accept:** `Eb minor` / `Ebm` / `Ebmin` / `D# minor` / `D#m`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Eb minor | ✓ |
| **+RAG** | Eb minor | ✓ |

### B · `b20`
- **Q:** A Dm7b5 is the iiø7 in which minor key?
- **Accept:** `C minor` / `Cm` / `Cmin`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | C minor | ✓ |
| **+RAG** | C minor | ✓ |

### B · `b21`
- **Q:** What is the name of the 5th mode of the harmonic minor scale?
- **Accept:** `Phrygian dominant` / `Phrygian major` / `Spanish Phrygian`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Phrygian dominant | ✓ |
| **+RAG** | Phrygian dominant | ✓ |

### B · `b22`
- **Q:** Which mode of the melodic minor scale is the half-diminished scale (Locrian natural 2)?
- **Accept:** `6th mode` / `sixth mode`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | The 6th mode (6th degree) of the melodic minor scale is the half-diminished scale (Locrian natural 2) | ✓ |
| **+RAG** | The 6th mode (6th degree) of the melodic minor scale is the half-diminished scale (Locrian natural 2) | ✓ |

### B · `b23`
- **Q:** In Bb 'rhythm changes', the bridge is a cycle of dominant 7ths. Name the first chord of the bridge.
- **Accept:** `D7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | D7 | ✓ |
| **+RAG** | D7 | ✓ |

### B · `b24`
- **Q:** What is the first chord of John Coltrane's 'Giant Steps'?
- **Accept:** `Bmaj7` / `B major` / `B`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Bmaj7 | ✓ |
| **+RAG** | Bmaj7 | ✓ |

### B · `b25`
- **Q:** Barry Harris's major 6th-diminished scale on C adds which note to the C major scale?
- **Accept:** `Ab` / `G#`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | D♭ | ✗ |
| **+RAG** | D♭ | ✗ |

### B · `b26`
- **Q:** The Lydian augmented scale is which mode of the melodic minor scale?
- **Accept:** `3rd mode` / `third mode`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | 3rd mode | ✓ |
| **+RAG** | 3rd mode | ✓ |

### B · `b27`
- **Q:** What is the leading tone in the key of C# harmonic minor?
- **Accept:** `B#`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | B# (the seventh degree of C# harmonic minor) | ✓ |
| **+RAG** | B# (the seventh degree of C# harmonic minor) | ✓ |

### B · `b28`
- **Q:** What is the tritone substitute for the V7 chord in the key of F major?
- **Accept:** `Gb7` / `F#7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | B7 | ✗ |
| **+RAG** | B7 | ✗ |

### B · `b29`
- **Q:** In 'Autumn Leaves' (G minor), the A section opens with a ii-V-I in Bb major. Give the three chords.
- **Accept:** `Cm7 F7 Bbmaj7` / `Cm7F7Bbmaj7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Cm7 - F7 - BbMaj7 | ✓ |
| **+RAG** | Cm7 - F7 - BbMaj7 | ✓ |

### B · `b30`
- **Q:** Which scale degree is the 'avoid note' when playing the C major (Ionian) scale over a Cmaj7 chord?
- **Accept:** `4th` / `fourth` / `11th` / `F`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | 4th degree (F) | ✓ |
| **+RAG** | 4th degree (F) | ✓ |

## C · 설명 (8문항, LLM-judge 1-5)

LLM judge가 key-point 커버리지 + 정확성을 1~5점으로 채점.

### C · `c01`
- **Q:** Why does a tritone substitution (e.g. Db7 in place of G7 resolving to C) work? Explain the shared notes.
- **Key points (judge 기준):**
  - G7 and Db7 share the tritone (B and F), which are the 3rd and 7th guide tones
  - those guide tones resolve the same way into C (B→C, F→E)
  - creates smooth/chromatic bass motion Db→C
  - both are dominant function toward C

**Raw** — judge **4/5**

> A tritone substitution works because the substitute chord (Db7) shares the two most important notes with the original dominant chord (G7) - the 3rd and 7th, which form the tritone that creates the dominant's characteristic tension. In G7, the 3rd is B and the 7th is F. In Db7, the 3rd is F and the 7th is Cb (enharmonically B). These are the exact same pitches, just with their roles reversed! Since these two notes create the essential dissonance that demands resolution, both chords function identically in pulling toward the tonic (C). The tritone substitution also creates smooth voice leading, as Db moves down by half-step to C (compared to G's leap of a fifth), while maintaining that crucial tritone tension that makes dominant chords so effective.

**+RAG** — judge **4/5**

> A tritone substitution works because the substitute chord (Db7) shares the two most important notes with the original dominant chord (G7) - the 3rd and 7th, which form the tritone that creates the dominant's characteristic tension. In G7, the 3rd is B and the 7th is F. In Db7, the 3rd is F and the 7th is Cb (enharmonically B). These are the exact same pitches, just with their roles reversed! Since these two notes create the essential dissonance that demands resolution, both chords function identically in pulling toward the tonic (C). The tritone substitution also creates smooth voice leading, as Db moves down by half-step to C (compared to G's leap of a fifth), while maintaining that crucial tritone tension that makes dominant chords want to resolve.

---

### C · `c02`
- **Q:** Explain the 'backdoor ii-V' (e.g. Fm7–Bb7 resolving to Cmaj7).
- **Key points (judge 기준):**
  - Fm7–Bb7 is the ii-V of Eb (relative/parallel), borrowed from C minor
  - Bb7 is the bVII7 of C
  - it resolves deceptively/by common tones to Cmaj7 instead of Eb
  - common substitute for the standard ii-V (Dm7-G7)

**Raw** — judge **5/5**

> The backdoor ii-V is a sophisticated harmonic progression that approaches a major chord from a half-step above, creating a smooth and unexpected resolution. In the example Fm7–Bb7→Cmaj7, the Fm7 functions as a ii chord and Bb7 as a V7 chord, but they're borrowed from the key of Eb major (where Fm7 is ii and Bb7 is V7). The magic happens when the Bb7 resolves down by half-step to Cmaj7 instead of resolving to Eb as expected. This works because the Bb7 can be reinterpreted as a bVII7 chord in the key of C, and the voice leading is particularly smooth—the F in Fm7 moves down to E (the 3rd of Cmaj7), while the Bb in the bass drops chromatically to C. This progression is beloved in jazz for its sophisticated sound and appears frequently in standards, offering an elegant alternative to the traditional ii-V-I progression.

**+RAG** — judge **4/5**

> The backdoor ii-V is a chromatic approach to a major chord that uses the bVII7 chord as the dominant, creating a smoother voice-leading alternative to the traditional V7. In your example (Fm7–Bb7–Cmaj7), the Fm7 functions as ii7 of Bb, and Bb7 acts as bVII7 of C major. This progression works because Bb7 contains the notes Bb-D-F-Ab, where the Ab (b7 of Bb7) resolves down by half-step to G (the 5th of Cmaj7), while D moves down to C (the root). This creates a particularly smooth resolution compared to the traditional G7–Cmaj7, where the B natural in G7 creates a more dramatic leading-tone resolution. The backdoor ii-V is especially popular in jazz ballads and provides a more subdued, sophisticated sound while maintaining strong harmonic motion through the cycle of fifths (Fm to Bb) before the chromatic resolution to the target chord.

---

### C · `c03`
- **Q:** Why is the altered scale a good choice over a V7alt chord (e.g. G7alt going to C)?
- **Key points (judge 기준):**
  - it contains the altered tensions b9, #9, #11(b5), b13(#5)
  - it is the 7th mode of the melodic minor (Ab melodic minor over G7)
  - those tensions create maximum tension that resolves strongly to the I
  - it omits the natural 5th and 9th

**Raw** — judge **5/5**

> The altered scale (also called the super Locrian or diminished whole-tone scale) is an excellent choice over V7alt chords because it contains all the essential altered tensions that define the chord's sound. When playing G7alt resolving to C, the G altered scale (G-Ab-Bb-B-Db-Eb-F) provides the b9 (Ab), #9 (Bb), #11 (Db), and b13 (Eb) - all the "outside" tensions that create maximum harmonic tension and demand resolution to the tonic. This scale omits the natural 5th and natural 9th, avoiding any consonant intervals that might weaken the chord's pull toward resolution. The altered scale's symmetrical construction and abundance of tritones create a highly unstable, chromatic sound that perfectly captures the restless, unresolved quality composers and improvisers seek in dominant chords, making the eventual resolution to the tonic chord sound particularly satisfying and inevitable.

**+RAG** — judge **5/5**

> The altered scale (also called the super Locrian or diminished whole-tone scale) is an excellent choice over V7alt chords because it contains all the essential altered tensions that define the chord's sound. Built on the 7th degree of melodic minor, the altered scale provides the chord tones (root, 3rd, b7th) plus all four possible altered extensions: b9, #9, #11, and b13. When playing G7alt resolving to C, this scale (G-Ab-Bb-B-Db-Eb-F) creates maximum harmonic tension through its abundance of chromatic alterations, which then resolve satisfyingly to the stable tones of the tonic chord. The scale's inherent instability—containing both a diminished 5th and augmented 5th—perfectly captures the restless, unresolved quality that makes altered dominants so effective at driving toward resolution.

---

### C · `c04`
- **Q:** Explain modal interchange (borrowed chords) and give a clear example of borrowing iv in a major key.
- **Key points (judge 기준):**
  - borrowing chords from the parallel mode/key (e.g. parallel minor)
  - iv in C major = Fm (or Fm7) borrowed from C minor
  - creates a darker/plagal color, often iv→I
  - common examples: bVII, bVI, iv, iiø7

**Raw** — judge **5/5**

> Modal interchange, also known as borrowed chords, occurs when you temporarily "borrow" chords from the parallel minor key (or other modes) while remaining in a major key context. This creates richer harmonic color and emotional depth by introducing chords that contain notes outside the original key signature.
> 
> A classic example is borrowing the iv chord (minor four) in a major key. In C major, instead of using the diatonic IV chord (F major: F-A-C), you would borrow the iv chord from C minor, giving you F minor (F-Ab-C). The Ab note creates a distinctive, slightly melancholic sound that contrasts beautifully with the brightness of the major key. You might hear this in a progression like C - Am - Fm - G - C, where that Fm chord adds unexpected emotional weight. This borrowed iv chord is extremely common in popular music and jazz, often appearing just before returning to the tonic, creating a poignant "pull" back home.

**+RAG** — judge **5/5**

> Modal interchange, also known as borrowed chords, occurs when you temporarily "borrow" chords from the parallel minor key (or other modes) while remaining in a major key context. This creates richer harmonic color and emotional depth by introducing chords that contain notes outside the original key signature.
> 
> A classic example is borrowing the iv chord (minor four) in a major key. In C major, instead of using the diatonic IV chord (F major: F-A-C), you would borrow the iv chord from C minor, giving you F minor (F-Ab-C). The Ab note creates a distinctive, slightly melancholic sound that contrasts beautifully with the brightness of the major key. You might hear this in a progression like C - Am - Fm - G - C, where that Fm chord adds unexpected emotional weight. This borrowed iv often appears in popular music, classical compositions, and jazz standards, creating a brief "shadow" over the major tonality before resolving back to more stable major key harmony.

---

### C · `c05`
- **Q:** What is the function of a secondary dominant (e.g. V7/V) and how does it create forward motion?
- **Key points (judge 기준):**
  - a dominant chord that targets a chord other than the I (tonicizes it)
  - V7/V in C = D7 targeting G7
  - introduces a chromatic leading tone (F# for D7) outside the key
  - creates momentum/pull toward the target chord

**Raw** — judge **4/5**

> A secondary dominant is a dominant seventh chord that temporarily tonicizes a chord other than the home key's tonic, creating the sound of briefly "visiting" a new key center. For example, V7/V (five-seven of five) is the dominant seventh chord of the dominant, which creates a strong pull toward the V chord rather than back to the original tonic. This generates forward motion through two key mechanisms: first, it introduces chromatic notes that create tension and demand resolution, and second, it establishes a temporary dominant-tonic relationship that pulls the harmony away from the home key. The tritone within the secondary dominant (between the 3rd and 7th of the chord) creates harmonic instability that strongly wants to resolve, while the chromatic voice leading—particularly the raised notes that weren't in the original key—adds momentum that propels the music forward rather than allowing it to settle back into the home key too quickly.

**+RAG** — judge **4/5**

> A secondary dominant is a dominant seventh chord that temporarily tonicizes a chord other than the home key's tonic, creating the sound of briefly "visiting" a new key center. For example, V7/V (five-seven of five) is the dominant seventh chord of the dominant, which creates a strong pull toward the V chord rather than back to the original tonic. This generates forward motion through two key mechanisms: first, it introduces chromatic alterations (notes outside the home key) that create harmonic tension demanding resolution, and second, it establishes a temporary dominant-tonic relationship with its target chord, making that chord sound like a momentary new "home." The tritone within the secondary dominant's structure creates particularly strong voice-leading tendencies—the 3rd wants to resolve up and the 7th wants to resolve down—that propel the harmony forward with greater momentum than diatonic progressions alone. This technique allows composers to create more dynamic harmonic rhythm and a sense of journey through multiple tonal centers while remaining anchored in the original key.

---

### C · `c06`
- **Q:** Why do Coltrane changes (Giant Steps) move by major thirds, and why are they hard to improvise over?
- **Key points (judge 기준):**
  - the tonal centers cycle by major thirds (e.g. B–G–Eb), dividing the octave equally
  - each key center has its own ii-V or V-I, moving very fast
  - rapid key changes leave little time to outline each new tonality
  - requires memorized patterns / strong key-center awareness

**Raw** — judge **5/5**

> Coltrane changes move by major thirds because they create a cycle that divides the octave into three equal parts (4 semitones each), allowing Coltrane to systematically explore all 12 chromatic tones while maintaining strong harmonic motion through dominant-tonic relationships. In "Giant Steps," each major third leap (B-G-Eb-B) is connected by ii-V-I progressions that tonicize each new key center. This creates a constantly shifting tonal landscape that's challenging to improvise over because traditional scalar approaches break down—musicians can't rely on staying in one key or using familiar patterns. The rapid harmonic rhythm (often changing every 1-2 beats) demands that improvisers either think in terms of chord tones and arpeggios, use chromatic/intervallic approaches, or develop new scalar concepts that can navigate the frequent modulations. The changes essentially force musicians to abandon comfortable diatonic thinking and develop more advanced harmonic awareness and technical facility.

**+RAG** — judge **5/5**

> Coltrane changes move by major thirds because they create a cycle that divides the octave into three equal parts (4 semitones each), allowing Coltrane to systematically explore all 12 chromatic tones while maintaining strong harmonic motion through dominant-tonic relationships. In "Giant Steps," the three key centers (B, G, and Eb major) are equidistant, and each is approached by its dominant chord, creating the progression's characteristic sound. These changes are notoriously difficult to improvise over because they move so quickly (often two chords per measure) through distant key centers, requiring musicians to rapidly shift their thinking between three different tonal areas while maintaining melodic coherence. The harmonic rhythm is relentless, and traditional scalar approaches often fall short—players must think in terms of chord tones, arpeggios, and chromatic voice-leading rather than staying in one key, demanding exceptional technical facility and harmonic knowledge to navigate smoothly.

---

### C · `c07`
- **Q:** Explain the difference between a ii-V-i in a minor key vs a ii-V-I in a major key (chord qualities and scales).
- **Key points (judge 기준):**
  - minor: iiø7 (half-diminished), V7(b9/alt), i-(minor)
  - major: ii-7, V7, Imaj7
  - minor V often uses harmonic minor / altered; major V uses mixolydian
  - the ii in minor is m7b5 vs m7 in major

**Raw** — judge **5/5**

> In a major key ii-V-I, the ii chord is minor 7 (built on the 2nd degree), the V is dominant 7, and the I is major 7. For example, in C major: Dm7-G7-Cmaj7. The scales typically used are Dorian for the ii chord, Mixolydian for the V, and Ionian (major) for the I.
> 
> In a minor key ii-V-i, the ii chord is minor 7♭5 (half-diminished), the V is still dominant 7 (often with altered extensions), and the i is minor (maj7 or m6). For example, in C minor: Dm7♭5-G7-Cm(maj7). The scales commonly used are Locrian for the ii chord, harmonic minor (or altered scales) for the V chord, and harmonic or natural minor for the i chord. The key difference is that the minor ii-V-i creates a darker, more tension-filled sound due to the half-diminished ii chord and the resolution to a minor tonic.

**+RAG** — judge **5/5**

> In a major key ii-V-I, the ii chord is minor 7 (built on the 2nd degree), the V is dominant 7, and the I is major 7. For example, in C major: Dm7-G7-Cmaj7. The scales typically used are Dorian for the ii chord, Mixolydian for the V, and Ionian (major) for the I.
> 
> In a minor key ii-V-i, the ii chord is minor 7♭5 (half-diminished), the V is still dominant 7 (often with altered extensions), and the i is minor (maj7 or m6). For example, in C minor: Dm7♭5-G7-Cm(maj7). The scales commonly used are Locrian for the ii chord, harmonic minor (or altered scales) for the V chord, and harmonic or natural minor for the i chord. The key difference is that the minor ii-V-i uses the half-diminished ii chord and resolves to a minor tonic, creating a darker, more tension-filled sound compared to the brighter major ii-V-I progression.

---

### C · `c08`
- **Q:** Explain tension and resolution in a dominant 7th chord using the tritone between its 3rd and 7th.
- **Key points (judge 기준):**
  - the 3rd and 7th of a dominant form a tritone (unstable interval)
  - e.g. in G7 the tritone is B–F
  - the tritone resolves inward/outward to the tonic chord tones (B→C, F→E for C)
  - this drives the V→I resolution

**Raw** — judge **5/5**

> In a dominant 7th chord, the tritone interval between the 3rd and 7th creates a powerful sense of harmonic tension that demands resolution. For example, in a G7 chord (G-B-D-F), the tritone exists between B (the 3rd) and F (the 7th). This dissonant interval creates instability because the tritone divides the octave exactly in half, making it harmonically ambiguous. The tension resolves naturally when the chord moves to its tonic - typically the B resolves upward by half-step to C, while the F resolves downward by half-step to E, landing on the root and 3rd of the C major chord. This voice-leading motion, where the tritone expands outward to a stable consonance, is fundamental to tonal harmony and explains why dominant 7th chords have such a strong pull toward their resolution.

**+RAG** — judge **5/5**

> In a dominant 7th chord, the tritone interval between the 3rd and 7th creates a powerful sense of harmonic tension that demands resolution. For example, in a G7 chord (G-B-D-F), the tritone exists between B (the 3rd) and F (the 7th). This dissonant interval creates instability because the tritone divides the octave exactly in half, making it harmonically ambiguous. The tension resolves naturally when the chord moves to its tonic - typically the B resolves upward by half-step to C, while the F resolves downward by half-step to E, both moving to chord tones of the C major triad. This voice-leading motion, where the tritone resolves inward by half-steps, is fundamental to tonal harmony and explains why dominant 7th chords have such a strong pull toward their resolution, making them essential for establishing key centers and creating satisfying harmonic progressions.

---

## D · 할루시네이션 (17문항: trap + control, LLM-judge)

trap = 거짓 전제/비표준 용어 — 모델이 거부/정정하면 정답(hallucinated=false). control = 정상 질문 — accept[] 중 하나로 답해야 정답.

### D · `d01` (trap)
- **Q:** Explain the 'Hendrix cadence' commonly taught in bebop harmony.
- **Trap — 좋은 답 신호 (참고):** `not a standard`, `not a recognized`, `no such`, `not aware`…

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d02` (trap)
- **Q:** What chord is built on the 9th scale degree of the C major scale?
- **Trap — 좋은 답 신호 (참고):** `only 7`, `only seven`, `seven degrees`, `no 9th degree`…

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d03` (trap)
- **Q:** Which major key signature has 9 sharps?
- **Trap — 좋은 답 신호 (참고):** `no key`, `doesn't exist`, `maximum`, `only 7`…

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d04` (trap)
- **Q:** Describe the harmonic function of the 'Coltrane diminished pivot' chord in standard analysis.
- **Trap — 좋은 답 신호 (참고):** `not a standard`, `no such`, `not a recognized`, `not aware`…

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d05` (trap)
- **Q:** What note is the 14th of a Cmaj chord?
- **Trap — 좋은 답 신호 (참고):** `no 14th`, `doesn't exist`, `only extends to 13`, `beyond the 13th`…

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d06` (control)
- **Q:** Who composed 'Giant Steps'?
- **Accept:** `coltrane` / `john coltrane`

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d07` (control)
- **Q:** How many sharps are in the key signature of D major?
- **Accept:** `2` / `two`

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d08` (control)
- **Q:** What is the V chord in the key of C major?
- **Accept:** `G7` / `G` / `G dominant` / `G major`

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d09` (control)
- **Q:** What is the relative minor of C major?
- **Accept:** `A minor` / `Am` / `Amin`

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d10` (control)
- **Q:** What is the tritone substitute of G7?
- **Accept:** `Db7` / `C#7`

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d11` (trap)
- **Q:** Explain the 'Coltrane pentatonic' — the six-note scale John Coltrane invented for Giant Steps.
- **Trap — 좋은 답 신호 (참고):** `pentatonic means five`, `five notes`, `not six`, `no such`…

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d12` (trap)
- **Q:** Describe the standard 'Barry Harris rule' that every b9 must resolve upward by a half step.
- **Trap — 좋은 답 신호 (참고):** `not a standard rule`, `no such rule`, `not a recognized`, `resolves down`…

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d13` (trap)
- **Q:** Why is the E7#9 'Hendrix chord' also commonly called the 'Lydian cadence'?
- **Trap — 좋은 답 신호 (참고):** `not called`, `not known as`, `no such term`, `not a standard term`…

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d14` (trap)
- **Q:** Explain the rule in jazz harmony that a major 7th chord must always omit its 11th.
- **Trap — 좋은 답 신호 (참고):** `not an absolute`, `not always`, `#11 can`, `can include`…

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d15` (trap)
- **Q:** What is the 'augmented ii-V-I' progression as defined in standard jazz theory?
- **Trap — 좋은 답 신호 (참고):** `not a standard`, `no such`, `not a recognized`, `not aware`…

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d16` (control)
- **Q:** In a major key, what is the chord quality built on the 7th scale degree (the vii chord)?
- **Accept:** `diminished` / `m7b5` / `half-diminished` / `half diminished` / `minor 7 flat 5`

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

### D · `d17` (control)
- **Q:** What are the four notes of a G7 chord?
- **Accept:** `G B D F` / `GBDF`

**Raw** — —

> (no run)

**+RAG** — —

> (no run)

---

## E · 곡 특화 (song-grounded, 10문항)

_Song-specific factual questions about jazz standards that ARE covered in detail in the RAG corpus (frontend/data/explanation/standards/*.txt). Designed to test whether RAG helps when the corpus actually contains the answer — vs. the abstract-theory questions in Task B where the corpus has no direct coverage. Model answers JSON {"answer":"..."}; scored by normalized match against accept[]._

코퍼스에 답이 직접 들어있는 곡 분석 질문 — RAG가 lift를 보여야 마땅한 통제 비교용 태스크.

### E · `e01`
- **Q:** 재즈 스탠더드 Stella by Starlight의 첫 코드는 무엇인가? (정확한 코드 기호로 답하라)
- **Accept:** `Em7b5` / `Em7♭5` / `Eø7` / `Eø` / `E half-diminished` / `E half diminished` / `E-7b5` / `E minor 7 flat 5`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Em7b5 | ✓ |
| **+RAG** | Em7b5 | ✓ |

### E · `e02`
- **Q:** Have You Met Miss Jones의 브릿지는 키 센터들이 어떤 음정 간격으로 이동하는가?
- **Accept:** `major third` / `major thirds` / `장3도` / `장 3도` / `M3` / `장3` / `장 3`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Have You Met Miss Jones의 브릿지는 장3도 간격으로 키 센터가 이동합니다. F major → A major → D♭ major → F major 순서로 진행되어 각각 장3도씩 상행하는 패턴을 보입니다. | ✓ |
| **+RAG** | Have You Met Miss Jones의 브릿지는 장3도 간격으로 키 센터가 이동합니다. F major → A major → D♭ major → F major 순서로 진행되며, 각 키 센터 간의 간격이 장3도입니다. | ✓ |

### E · `e03`
- **Q:** Misty (E♭ major)의 A 섹션에서 AbMaj7이 마이너로 바뀐 후 함께 등장하여 backdoor 케이던스를 이루는 도미넌트 7th 코드는?
- **Accept:** `Db7` / `D♭7` / `Db dominant 7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Db7 | ✓ |
| **+RAG** | Db7 | ✓ |

### E · `e04`
- **Q:** Charlie Parker의 Yardbird Suite는 어떤 키로 연주되는가?
- **Accept:** `C major` / `C` / `Cmaj` / `C 메이저`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | C major | ✓ |
| **+RAG** | C major | ✓ |

### E · `e05`
- **Q:** Roy Hargrove의 Strasbourg / St. Denis는 몇 마디 진행을 반복해서 만들어지는가? (숫자만)
- **Accept:** `8` / `8마디` / `8 bars` / `eight` / `eight bars` / `여덟`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | 8 | ✓ |
| **+RAG** | 8 | ✓ |

### E · `e06`
- **Q:** Oscar Peterson의 Hymn To Freedom A섹션에서 chord IV(EbMaj)가 chord I(Bb)로 진행하는 케이던스의 일반적 이름은 무엇인가?
- **Accept:** `plagal` / `plagal cadence` / `변격종지` / `변격 종지` / `amen cadence` / `변진행`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | plagal cadence (플라갈 케이던스) | ✓ |
| **+RAG** | plagal cadence (플라갈 케이던스) | ✓ |

### E · `e07`
- **Q:** Kenny Dorham의 Blue Bossa는 어느 키로 시작하는가?
- **Accept:** `C minor` / `Cm` / `C-` / `C 마이너` / `C minor key` / `Cmin` / `C 단조`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | C minor | ✓ |
| **+RAG** | C minor | ✓ |

### E · `e08`
- **Q:** Joseph Kosma의 Autumn Leaves가 Bb major와 함께 사용하는 나란한 마이너 키는 무엇인가?
- **Accept:** `G minor` / `Gm` / `G-` / `G 마이너` / `Gmin` / `G minor key`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | G minor | ✓ |
| **+RAG** | G minor | ✓ |

### E · `e09`
- **Q:** Henry Mancini의 Moon River는 몇 박자(time signature)로 작곡되었는가?
- **Accept:** `3/4` / `삼사박자` / `3박자` / `3 4박자` / `waltz` / `왈츠`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | 4/4박자 | ✗ |
| **+RAG** | 4/4박자 | ✗ |

### E · `e10`
- **Q:** Body and Soul (Db major)은 1도(I)가 아닌 어떤 도수(roman numeral)의 코드로 시작하는가?
- **Accept:** `ii` / `ii도` / `ii chord` / `ii-7` / `2도` / `Ebm7` / `E♭m7` / `2`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | 6도(vi) | ✗ |
| **+RAG** | 6도(vi) | ✗ |

## F · 외부 음악이론 벤치 (12문항)

_External music-theory benchmark from a YouTube video that tested GPT-5 / Gemini 2.5 Pro / Claude Opus 4.1. We re-run with our 4 conditions on the SAME questions to compare. Voice-leading (Q12/13) and staff-drawing (Q15/16) are omitted — they aren't shaped as short-answer factual items._

### F · `f01`
- **Q:** A triad is made of the notes G#, C#, and E. What is the root and quality of this chord? (Give root + quality.)
- **Accept:** `C# minor` / `C#minor` / `C#m` / `C#min` / `Csharp minor` / `C-sharp minor`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | C# minor | ✓ |
| **+RAG** | G# major | ✗ |

### F · `f02`
- **Q:** The notes Bb, F, D, and A form a chord. Analyze it in Roman numerals in the context of F major (use the full Roman numeral with quality).
- **Accept:** `IVmaj7` / `IV7` / `IV△7` / `IVΔ7` / `IV maj 7` / `IV M7` / `BbMaj7` / `Bbmaj7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | vi7 | ✗ |
| **+RAG** | V7 | ✗ |

### F · `f03`
- **Q:** In the key of E major, what is the full name of the seventh chord built on the third scale degree?
- **Accept:** `G# minor 7` / `G#m7` / `G#min7` / `G#-7` / `G sharp minor 7` / `Gsharp minor 7` / `Gsharpm7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | G# minor seventh | ✗ |
| **+RAG** | G# minor 7th chord (G#m7) | ✓ |

### F · `f04`
- **Q:** Of the seven modes of the major scale (Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian), which ones contain a minor 7th interval relative to the tonic? List all that qualify.
- **Accept:** `Dorian, Phrygian, Mixolydian, Aeolian, Locrian` / `Dorian Phrygian Mixolydian Aeolian Locrian` / `Dorian, Phrygian, Mixolydian, Aeolian, and Locrian`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Dorian, Phrygian, Mixolydian, Aeolian, Locrian | ✓ |
| **+RAG** | Dorian, Phrygian, Aeolian, and Locrian contain a minor 7th interval relative to the tonic | ✗ |

### F · `f05`
- **Q:** A progression in Bb major is: Bb → G7 → C7 → F. What is the harmonic function of the G7 chord, expressed in Roman numerals?
- **Accept:** `V7/ii` / `V/ii` / `V7 of ii` / `five of two` / `V/2` / `V7/2` / `V(7)/ii`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | vi7 | ✗ |
| **+RAG** | VI7 | ✗ |

### F · `f06`
- **Q:** The notes B, G, F, and A appear together as a chord in F major. Identify the chord (full name) and its harmonic function.
- **Accept:** `V9/V` / `V/V` / `V7/V` / `five of five` / `G9` / `G9(no 5)` / `G9 no 5th` / `G dominant 9`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | G minor 7 chord (Gm7), functioning as ii7 in F major | ✗ |
| **+RAG** | G7 (G dominant seventh) - V7 chord, dominant function | ✗ |

### F · `f07`
- **Q:** In the key of E major, the chord G#7 resolves DECEPTIVELY. To which chord does it resolve? (Answer with the chord name.)
- **Accept:** `A major` / `Amaj7` / `A maj7` / `Amajor` / `Amajor7` / `IV major`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | C#m | ✗ |
| **+RAG** | Am | ✗ |

### F · `f08`
- **Q:** The notes A, D, C, F#, and Eb appear together as a chord in the key of Eb major. Identify the chord (full name) and its function in Roman numerals.
- **Accept:** `V7b9/iii` / `V7♭9/iii` / `V/iii` / `D7b9` / `D7♭9` / `five seven flat nine of three` / `V7(b9)/iii`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | F#dim7 chord, functioning as viio7/vi (leading tone diminished seventh of vi) | ✗ |
| **+RAG** | Eb major 7th chord with added 6th and sharp 11th (EbMaj7#11add6), functioning as IMaj7#11add6 in the key of Eb major | ✗ |

### F · `f09`
- **Q:** A scale is spelled: G, A, Bb, C#, D, E, F. Identify this scale by name (or as a mode of a parent scale).
- **Accept:** `4th mode of D harmonic minor` / `fourth mode of D harmonic minor` / `Ukrainian Dorian` / `Romanian minor` / `Mi sheberach` / `4th mode harmonic minor`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | G Harmonic Minor | ✗ |
| **+RAG** | G Harmonic Minor | ✗ |

### F · `f10`
- **Q:** What is the hidden harmonic function behind the diminished chord G#, F, D, B in the key of E minor? Express it in Roman numerals.
- **Accept:** `vii°7/IV` / `viio7/IV` / `vii dim7/IV` / `vii diminished 7/IV` / `V7b9/IV` / `V/IV` / `V7/IV` / `vii°/IV`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | vii°7/V (leading tone diminished seventh of the dominant) | ✗ |
| **+RAG** | #iv°7 (raised fourth degree diminished seventh chord) | ✗ |

### F · `f11`
- **Q:** In a piece in Ab major, an E7 chord appears. Explain a possible harmonic function of this chord (use a standard theory name or a Roman-numeral analysis).
- **Accept:** `German sixth` / `German 6` / `Ger+6` / `augmented sixth` / `sub V7/V` / `subV/V` / `tritone substitute of Bb7` / `tritone sub for V` / `V/N` / `V of Neapolitan` / `V7/N`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | V7/vi - dominant seventh of the relative minor (F minor) | ✗ |
| **+RAG** | V7/vi - secondary dominant of the vi chord (F minor) | ✗ |

### F · `f14`
- **Q:** Suppose Ebm7 is the ii chord in Db major. Provide a V–I resolution that uses a TRITONE SUBSTITUTION for the V chord — give the three chord symbols ii → subV → I.
- **Accept:** `Ebm7 D7 Dbmaj7` / `Ebm7-D7-Dbmaj7` / `Ebm7 → D7 → Dbmaj7` / `Ebm7, D7, Dbmaj7` / `D7 Dbmaj7` / `D7-Dbmaj7` / `D7 to Dbmaj7`

| 조건 | 답 | 채점 |
|---|---|---|
| **Raw** | Ebm7 → A7 → Db | ✗ |
| **+RAG** | Ebm7 → G7 → DbMaj7 | ✗ |

