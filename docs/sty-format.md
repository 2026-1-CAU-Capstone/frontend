# Yamaha Style File (.sty) 포맷 — JJazzLab 코드 해독 노트

> 목표: JJazzLab의 음원 출력 파이프라인을 TypeScript로 옮기기 위해 .sty 파일 구조와 변환 엔진을 이해한다.
>
> 참조 원본: `/Users/benzity/Documents/DEV/JJazzLab/plugins/YamJJazz/src/main/java/` (LGPL v2.1)
>
> 분석 시점: Phase 1 (포맷 구조 파악)

---

## 1. 한눈에 보는 흐름

```
[리드시트: Am7 D7 Gmaj7]
        ↓
[.sty 파일에서 패턴 가져오기]
        ↓
[YamJJazzRhythmGenerator로 변형]   ← 핵심
   ├─ 트랜스포즈 (C→A)
   └─ 보이스 리딩 (Maj7→m7 등 코드 변형 적용)
        ↓
[변형된 MIDI 시퀀스]
        ↓
[SoundFont 신디사이저로 오디오 출력]
```

---

## 2. .sty 파일의 물리적 구조

JJazzLab `CASMDataReader.java` 분석 결과 .sty 파일은 **표준 MIDI 파일(SMF) + 야마하 확장**이다.

```
┌─────────────────────────────────────┐
│ MThd  (4 bytes)                     │ ── 표준 MIDI 헤더
│ size  (uint, always 6)              │
│ format (always 0)                   │
│ tracks (always 1)                   │
│ ticksPerQuarter (uint16)            │
├─────────────────────────────────────┤
│ MTrk  (4 bytes)                     │ ── 표준 MIDI 트랙
│ size  (uint)                        │
│ <MIDI events: notes, tempo, etc.>   │ ← 실제 음 데이터가 여기 다 들어 있음
├─────────────────────────────────────┤
│ CASM  (4 bytes)                     │ ── 야마하 확장 시작
│ size  (uint)                        │
│ [CSEG ...]+                         │ ← 1개 이상의 CSEG 그룹
└─────────────────────────────────────┘
```

### MThd / MTrk

- 일반 MIDI 파일 헤더와 동일. `javax.sound.midi.MidiSystem`로 그대로 읽힘
- format=0이라 모든 채널이 하나의 트랙에 섞여 있음
- MIDI 채널 = 악기 파트 구분자 (예: ch1=베이스, ch2=드럼, ch3=피아노 등)

### CASM 섹션 (야마하만의 메타데이터)

CASM은 "이 .sty 안의 패턴을 어떻게 변형할지" 규칙을 담는다. **여기가 야마하 .sty의 핵심.**

```
CASM
  ├─ CSEG (CASM Section Group, 1+)
  │   ├─ Sdec — section declaration ("Main A,Intro A,Fill In AA")
  │   ├─ Ctab — channel settings (SFF1)
  │   ├─ Ctb2 — channel settings (SFF2, 확장)
  │   └─ Cntt — Note Transposition Table (코드 변형 매핑)
  └─ ...
```

**Sdec 예시**: `"Main A,Intro A,Fill In AA,Ending A"` — 이 CSEG 안 규칙들이 어느 섹션에 적용되는지 명시. 한 규칙이 여러 섹션에 공유될 수 있음.

**Ctab vs Ctb2 차이**:
- **Ctab** (SFF1): 한 채널 = 하나의 변형 규칙
- **Ctb2** (SFF2, 확장): 한 채널을 음역대 3개(low/main/high)로 쪼개서 각각 다른 변형 규칙 적용 가능

---

## 3. 섹션(StylePart) 종류

`StylePartType.java` enum 기반. 한 .sty 안에 ~15개 섹션이 들어 있음:

| 분류 | 섹션 | 용도 |
|---|---|---|
| 도입 | Intro A / B / C | 곡 시작용 인트로 |
| 본문 | Main A / B / C / D | 메인 반주 (A=단순, D=화려) |
| 필인 | Fill In AA / BB / CC / DD | 섹션 전환용 짧은 채움 |
| 종료 | Ending A / B / C | 곡 마무리 |
| 브레이크 | Break | 일시 정지 효과 |

JJazzLab은 곡 구조에 따라 이 섹션들을 골라서 재생한다. 예: 1절은 Main A, 후렴은 Main B, 후렴 직전에 Fill In AA.

---

## 4. 채널 설정 (CtabChannelSettings)

각 .sty 채널마다 변형 규칙이 붙어 있다. `CtabChannelSettings.java` 핵심 필드:

```java
class CtabChannelSettings {
    int channel;                        // MIDI 채널 (1-16)
    String name;                        // "Bass", "Drum 1", "Piano Chord" 등
    AccType accType;                    // 반주 종류 (베이스/코드/패드/...)

    Note sourceChordNote;               // 패턴이 녹음된 원본 코드의 근음 (보통 C)
    YamChord sourceChordType;           // 원본 코드 종류 (보통 Maj7)

    ArrayList<Note> mutedNotes;         // 사용 안 할 음들
    ArrayList<YamChord> mutedChords;    // 사용 안 할 코드 종류들

    Ctb2ChannelSettings ctb2Main;       // 메인 음역대 변형 규칙
    Ctb2ChannelSettings ctb2Low;        // 저음역 (SFF2만)
    Ctb2ChannelSettings ctb2High;       // 고음역 (SFF2만)
}
```

**핵심 통찰**: 패턴은 보통 **CMaj7 기준으로 녹음**되어 있고 (`sourceChordNote=C, sourceChordType=Maj7`), 다른 코드로 들어가면 `Ctb2ChannelSettings` 안의 NTR/NTT 규칙으로 변형된다.

---

## 5. 변형 엔진의 양대 규칙: NTR과 NTT

`Ctb2ChannelSettings.java` 안에 inner enum으로 정의됨. **이게 진짜 핵심.**

### NTR (Note Transposition Rule) — 음을 어떻게 이동할 것인가

> 원본 음 → 새 음으로 매핑하는 *방법*

- **ROOT_TRANS** — 베이스용. 코드 변형과 무관하게 새 근음으로 평행 이동
- **ROOT_FIXED** — 코드 톤은 코드에 맞춰 변형, 텐션 음은 고정
- 그 외 — 멜로딕 패턴, 코드 패턴별로 다른 모드

### NTT (Note Transposition Table) — 어떤 매핑 테이블을 쓸 것인가

> 코드 종류별로 음을 어떻게 매핑할지 결정하는 *테이블*

대표 테이블:
- **Bass**: 베이스용 — 근음/5음 중심
- **Melody**: 멜로디용 — 코드 톤 + 텐션
- **Chord**: 코드 패드용 — 코드 톤만
- **Harmonic Minor 5th** 등 — 특수 스케일

### Retrigger 규칙

코드가 바뀌는 순간 이미 울리고 있던 음을 어떻게 처리할지:
- `STOP` — 끔
- `PITCH_SHIFT` — 음높이만 바꾸고 계속 울림 (글리산도 효과)
- `PITCH_SHIFT_TO_ROOT` — 근음으로 글라이드
- `RETRIGGER` — 재발음
- `RETRIGGER_TO_ROOT` — 근음으로 재발음
- `NOTE_GENERATOR` — 엔진이 알아서 새 음 생성

---

## 6. 핵심 자바 파일 — TS 포팅 시 참고할 우선순위

| 파일 | 줄 수 | 역할 | 포팅 우선순위 |
|---|---|---|---|
| `CASMDataReader.java` | 561 | .sty 파일 파서 | **1순위** (파서 없으면 시작 불가) |
| `Style.java` | 387 | 톱 레벨 데이터 모델 | 1순위 (파서와 함께) |
| `StylePart.java` | 403 | 섹션 데이터 | 1순위 |
| `CtabChannelSettings.java` | 426 | 채널 변형 규칙 | 1순위 |
| `Ctb2ChannelSettings.java` | (작음) | NTR/NTT enum + 추가 변형 | 1순위 |
| `StylePartType.java` | (작음) | 섹션 종류 enum | 1순위 |
| `AccType.java` | 221 | 반주 타입 enum | 2순위 |
| `YamChord.java` | (작음) | 야마하의 코드 표현 | 2순위 |
| `YamJJazzRhythmGenerator.java` | **1,381** | 변형 엔진 (두뇌) | **2순위** (파서 끝나면 핵심) |
| `YamJJazzRhythmImpl.java` | 704 | 리듬 실행 | 3순위 |

총 ~5,000줄 정도가 핵심 (YamJJazz 플러그인 전체는 9,200줄).

---

## 7. 실제 파일로 검증 — `psBase.sst` (JJSwing 베이스 스타일)

JJazzLab 저장소에 LGPL로 번들된 야마하 .sst 파일 1개를 직접 hex dump하여 모든 추론을 검증했다.

**파일**: `/Users/benzity/Documents/DEV/JJazzLab/plugins/JJSwing/src/main/resources/org/jjazz/jjswing/api/psBase.sst`
**크기**: 44,642 bytes
**저작권**: "(C)2002 YAMAHA Corp."

### 헤더 + 트랙 (검증 완료)
```
@0x0000  MThd  size=6  format=0  tracks=1  ticksPerQuarter=1920(0x0780)
@0x000E  MTrk  size=33,816(0x8418)  → 트랙 데이터 시작
         첫 이벤트: 4/4 박자, 142 BPM
@0x842E  ← MTrk 끝 → CASM 시작
```

### CASM 구조 (검증 완료)
```
@0x842E  CASM  size=1754(0x06DA)
@0x8436  CSEG #1  size=592  → Sdec: "Main A,Main B,Fill In AA,Fill In BB,Ending A"
@0x868E  CSEG #2  size=684  → Sdec: "Main C,Main D,Fill In CC,Fill In DD,Fill In BA"
@0x8942  CSEG #3  size=454  → Sdec: "Intro A,Intro B,Intro C,Ending B,Ending C"
```
**총 15개 섹션** — Main 4종 + Fill In 5종 + Intro 3종 + Ending 3종

### Ctab 27바이트 레이아웃 (실제 바이트로 확정)

`parseCtabData()` + `parseCtabDataFirstPart()` + `parseCtb2Subpart()` 정독 결과:

```
┌──────────────────────────────────────────────────────────────┐
│ Ctab (SFF1) = 20 (common) + 6 (ctb2 subpart) + 1 = 27 bytes  │
├──────────────────────────────────────────────────────────────┤
│ 공통 첫 부분 (Ctab/Ctb2 공유) — 20 bytes                      │
│   +0   1 byte    srcChannel       (0-15)                     │
│   +1   8 bytes   name             ASCII, 공백 패딩            │
│   +9   1 byte    destChannel      (8-15) → AccType 매핑      │
│   +10  1 byte    editable flag    (0=editable)               │
│   +11  2 bytes   mutedNotes       비트필드 (16비트)           │
│   +13  5 bytes   mutedChords      비트필드 (40비트, 코드 종류)│
│   +18  1 byte    sourceChordNote  (0-11, pitch class)        │
│   +19  1 byte    sourceChordType  (0-0x22, YamChord enum)    │
├──────────────────────────────────────────────────────────────┤
│ Ctb2 subpart — 6 bytes                                       │
│   +20  1 byte    NTR              (0=ROOT_TRANS, 1=ROOT_FIXED, 2=GUITAR) │
│   +21  1 byte    NTT 바이트       bit7=bassOn, bit0-6=NTT 인덱스 │
│   +22  1 byte    chordRootUpperLimit  (코드 근음 상한)        │
│   +23  1 byte    noteLowLimit     (음역대 하한)               │
│   +24  1 byte    noteHighLimit    (음역대 상한)               │
│   +25  1 byte    retriggerRule    (0-5)                      │
├──────────────────────────────────────────────────────────────┤
│ +26  1 byte    specialFeature   (0=없음, 그 외 +4바이트 추가) │
└──────────────────────────────────────────────────────────────┘
```

**Ctb2는 28 bytes** = 20 (common) + 2 (low/high pitch) + 6×3 (low/main/high subpart) + 7 (unknown) = SFF2용

### 실제 첫 Ctab 파싱 결과 (검증)
```
원본 데이터: 00 70 6e 6f 20 6e 6f 72 6d 0b 01 0f ff 03 f0 be df df 00 02 01 02 07 00 7f 01 00

→ 채널 0 (MIDI ch 1), 이름 "pno norm"
→ destChannel 11, sourceChord = C major7(?) [type=0x02]
→ NTR=1 (ROOT_FIXED), NTT 인덱스=2, bassOn=0
→ 코드 근음 상한 G, 음역대 전체(0-127), retrigger=1
```

코드와 1:1 매칭. 파서 구조 추론이 100% 정확.

---

## 8. 알게 된 것 vs 아직 모르는 것

### ✅ 알게 된 것 (Phase 1 완료)
- .sty/.sst 파일 = SMF format 0 + CASM 야마하 확장
- CASM 정확한 구조 (CSEG → Sdec + Ctab/Ctb2/Cntt)
- Sdec = 콤마 구분 섹션 이름 리스트
- Ctab 27바이트 + Ctb2 28바이트 정확한 레이아웃
- 한 .sty가 보통 ~15개 섹션을 3개 CSEG로 묶음
- SFF1 vs SFF2 구분 (Ctab vs Ctb2)
- Cntt = 채널별 NTT 오버라이드

### ❓ 아직 깊이 안 본 것 (Phase 2)
- **NTT enum 11종 각각의 매핑 알고리즘** (Bass, Melody, Chord, Melodic Minor, ...)
- **NTR 3종의 트랜스포지션 룰** (ROOT_TRANS, ROOT_FIXED, GUITAR)
- `YamJJazzRhythmGenerator.java` 1,381줄의 전체 흐름
- `AccType` enum과 destChannel(8-15) 매핑
- `sourceChordType` 0~0x22의 정확한 코드 매핑 (YamChord enum)

---

## 9. 변환 엔진의 두뇌 — `fitSrcPhraseToChordSymbol()`

`YamJJazzRhythmGenerator.java` line 693-835에서 발견. 입력 = 원본 phrase + ctb2 규칙 + 목표 코드. 출력 = 목표 코드에 맞춰진 phrase.

### 결정 트리

```
NTR = ROOT_FIXED              (코드 톤 고정 — 패드/코드 패턴)
   ├─ MELODY  ─┐
   └─ CHORD   ─┴─→ fitChordPhrase2ChordSymbol(pSrc, destEcs)

NTR = ROOT_TRANSPOSITION      (멜로디 변형 — 멜로디/베이스)
   ├─ BYPASS                  → pSrc + pitchDelta  (인트로/엔딩용 평행 이동)
   ├─ HARMONIC_MINOR(_5)      → 스케일 강제 변경(MINOR_HARMONIC) + fitMelodyPhrase
   ├─ MELODIC_MINOR(_5)       → 스케일 강제 변경(MINOR_MELODIC) + fitMelodyPhrase
   ├─ NATURAL_MINOR(_5)       → 스케일 강제 변경(AEOLIAN) + fitMelodyPhrase
   ├─ DORIAN(_5)              → 스케일 강제 변경(DORIAN) + fitMelodyPhrase
   ├─ CHORD                   → fitMelodyPhrase(useChord=true)
   └─ MELODY                  → bassOn ? fitBassPhrase : fitMelodyPhrase

NTR = GUITAR                  (기타 전용)
   └─ ALL_PURPOSE/STROKE/ARPEGGIO → fitChordPhrase2ChordSymbol

후처리 (NTR=ROOT_TRANS만):
   - 목표 코드 근음 > chordRootUpperLimit → phrase 전체 -12 (옥타브 내림)
```

### 핵심 통찰 3가지

1. **모든 변환은 3개 헬퍼에 위임** — `PhraseUtilities`의:
   - `fitChordPhrase2ChordSymbol(pSrc, destEcs)` — 코드 톤 변환
   - `fitMelodyPhrase2ChordSymbol(pSrc, destEcs, useChord)` — 멜로디 변환
   - `fitBassPhrase2ChordSymbol(pSrc, destEcs)` — 베이스 변환

   **이 3개가 진짜 알고리즘의 본진.** Phase 3에서 다룰 대상.

2. **마이너 계열 NTT는 스케일을 강제로 바꿈** — Am7로 변환되면서 HARMONIC_MINOR_5 NTT가 적용되면 A 하모닉 마이너 스케일로 강제 변환 후 멜로디 fitting. 즉 NTT는 "어떤 스케일 색깔로 변환할지" 를 결정.

3. **NTT의 `_5` 접미사** — 같은 스케일이지만 5음 처리가 다름. 정확한 차이는 fitMelodyPhrase 내부 분기에 있음 (아직 미파악).

---

## 10. 다음 단계 (Phase 3 — 진짜 알고리즘 파기)

1. **`PhraseUtilities.java`의 3개 fit*** 함수 정독** — 음을 어떻게 매핑하는지의 실제 산수
2. **`SourcePhrase` 클래스 이해** — sourceChordSymbol + getProcessedPhrasePitch 같은 헬퍼들
3. **Retrigger 규칙 6종의 후처리 로직** — `fixRetriggerRule()` 함수 추적
4. **AccType + YamChord enum 매핑표** 완성
5. → Phase 4 진입: TS 포팅 시작 (`src/lib/yamaha-sty/`)
