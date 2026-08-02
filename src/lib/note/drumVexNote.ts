/**
 * buildDrumNote — 드럼 보표 VexFlow 음표의 **단일 빌더** (에디터 · 뷰어 공용).
 *
 * 사람 드럼 악보의 통용 규칙을 한 곳에서 책임진다:
 *  - 노트헤드는 **키(구성음)별로** 정한다 — 킥+하이햇 화음이면 킥은 타원,
 *    하이햇만 ✕. (예전엔 화음 전체에 한 종류를 적용해 킥까지 ✕가 됐다.)
 *    VexFlow 의 per-key 글리프 접미(`g/5/x2`)를 쓴다.
 *  - 라이드 벨은 ◆(d2). 예전 `type:'d'` 는 VexFlow codeNoteHead 에 없는
 *    코드라 일반 타원으로 그려졌다.
 *  - 손은 기둥 위(+1), 발(킥 35/36 · 페달 하이햇 44)은 아래(−1).
 *    명시 stem(NoteInfo.stem — MusicXML 수입)이 있으면 그걸 따른다.
 *  - 열린 하이햇(GM 46)은 음표 위에 **○** 를 얹는다(통용 기호).
 *  - 고스트 노트는 노트헤드를 **괄호**로 감싼다 — 스네어 고스트가 드럼 어휘의
 *    핵심이라 ✕(크로스스틱과 혼동)이 아니라 괄호가 맞다.
 *  - 아티큘레이션(악센트 등)·페르마타·다이내믹스·꾸밈음(플램)도 표기한다.
 *
 * keys 는 GM 퍼커션 절대값(vex key 표기) — 임시표·조표의 영향을 받지 않는다.
 */
import {
  StaveNote, GraceNote, Dot, Parenthesis, Articulation, Annotation,
  AnnotationVerticalJustify,
} from 'vexflow';
import { drumDisplayForGm, vexKeyToMidi, DRUM_FOOT_GM, isOpenHihatGm } from './drumNotation';

interface DrumNoteInfo {
  keys: string[];
  duration: string;
  dotted?: boolean;
  doubleDotted?: boolean;
  accidentals?: Record<number, '#' | 'b' | 'n' | '##' | 'bb'>;
  stem?: 'up' | 'down';
  ghost?: boolean;
  grace?: boolean;
  graceSlash?: boolean;
  articulations?: string[];
  fermata?: boolean;
  dynamics?: string;
}

function accShift(acc: string | undefined): number {
  return acc === '#' ? 1 : acc === 'b' ? -1 : acc === '##' ? 2 : acc === 'bb' ? -2 : 0;
}

function buildDur(n: DrumNoteInfo): string {
  let d = n.duration;
  const rest = d.endsWith('r');
  if (rest) d = d.slice(0, -1);
  if (n.doubleDotted) d += 'dd';
  else if (n.dotted) d += 'd';
  return rest ? d + 'r' : d;
}

/** NoteInfo(드럼 파트) → VexFlow 음표. grace 면 GraceNote 를 돌려준다 —
 *  호출부는 다음 실음에 GraceNoteGroup 으로 붙인다(플램). */
export function buildDrumNote(n: DrumNoteInfo): StaveNote {
  const dur = buildDur(n);
  if (n.duration.endsWith('r')) {
    return new StaveNote({ keys: ['b/4'], duration: dur, clef: 'treble' });
  }

  const midis = n.keys.map((k, ki) => vexKeyToMidi(k) + accShift(n.accidentals?.[ki]));
  /* per-key 노트헤드 — 접미로 지정: ✕='x2', ◆='d2'. */
  const keys = midis.map((gm) => {
    const disp = drumDisplayForGm(gm);
    const suffix = disp.head === 'x' ? '/x2' : disp.head === 'd' ? '/d2' : '';
    return disp.displayKey + suffix;
  });
  const isFoot = midis.some((gm) => DRUM_FOOT_GM.has(gm));
  const stemDir = n.stem === 'up' ? 1 : n.stem === 'down' ? -1 : (isFoot ? -1 : 1);

  if (n.grace) {
    const g = new GraceNote({ keys, duration: dur, slash: n.graceSlash !== false, clef: 'treble' });
    g.setStemDirection(stemDir);
    if (n.dotted || n.doubleDotted) Dot.buildAndAttach([g]);
    return g as unknown as StaveNote;
  }

  const note = new StaveNote({ keys, duration: dur, clef: 'treble' });
  note.setStemDirection(stemDir);
  if (n.doubleDotted) { Dot.buildAndAttach([note]); Dot.buildAndAttach([note]); }
  else if (n.dotted) Dot.buildAndAttach([note]);

  /* 고스트 — 노트헤드 괄호. */
  if (n.ghost) { try { Parenthesis.buildAndAttach([note]); } catch { /* noop */ } }

  /* 열린 하이햇 ○ — 음표 위. */
  if (midis.some(isOpenHihatGm)) {
    const ann = new Annotation('○');
    ann.setFont('Pretendard', 9, 'normal');
    ann.setVerticalJustification(AnnotationVerticalJustify.TOP);
    note.addModifier(ann, 0);
  }

  /* 아티큘레이션 — 멜로디 빌더(buildVfNote)와 같은 규칙. 드럼에선 악센트가 핵심. */
  if (n.articulations) {
    const ART_VF: Record<string, string> = {
      staccato: 'a.', staccatissimo: 'av',
      accent: 'a>', tenuto: 'a-',
      marcato: 'a^', 'detached-legato': 'a-.',
    };
    for (const a of n.articulations) {
      const code = ART_VF[a];
      if (!code) continue;
      const forceAbove = a === 'marcato';
      const pos = (forceAbove || stemDir !== 1) ? 3 : 4;
      note.addModifier(new Articulation(code).setPosition(pos), 0);
    }
  }
  if (n.fermata) note.addModifier(new Articulation('a@a').setPosition(3), 0);
  if (n.dynamics) {
    const ann = new Annotation(n.dynamics);
    ann.setVerticalJustification(AnnotationVerticalJustify.BOTTOM);
    note.addModifier(ann, 0);
  }
  return note;
}
