import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

/* ─────────────────────────────────────────────────────────────────────────
 * KeyPicker — 조성 선택 드롭다운. "새 코드 차트 / 악보" 생성 모달에서 공용.
 *
 * 동작:
 *  - 트리거 버튼은 선택값을 "C 장조" / "C 단조" 형태로 보여준다.
 *  - 펼치면 좌측 메이저 4×3, 우측 마이너 4×3 그리드. 셀은 "C", "Cm"처럼 간결.
 *  - 상단 ♯/♭ 토글로 검은건반의 표기(C#↔Db 등)를 미리 고를 수 있다.
 *
 * value/onChange 는 백엔드 enum 문자열('C_MAJOR', 'E_FLAT_MAJOR' …). 코드
 * 프로젝트(CHORD_PROJECT_KEYS)와 악보 프로젝트(KEY_SIGNATURES)가 동일한
 * 30개 enum 집합이라 한 컴포넌트로 양쪽을 모두 커버한다.
 *
 * enum 제약: 일부 음이름은 한쪽 표기의 enum만 존재한다(예: 메이저에 D#은
 * 없어 Eb=E_FLAT_MAJOR만). 그런 칸은 ♯로 보여줘도 enum은 유일한 쪽으로
 * 보낸다(아래 표의 enS/enF 가 같은 값). 음높이는 동일하므로 문제없다.
 * ──────────────────────────────────────────────────────────────────────── */

type Accidental = 'sharp' | 'flat';

interface KeyCell {
  /** ♯ 표기 라벨 */
  sharp: string;
  /** ♭ 표기 라벨 */
  flat: string;
  /** ♯ 선택 시 보낼 enum */
  enS: string;
  /** ♭ 선택 시 보낼 enum */
  enF: string;
}

/* 반음계 순(C → B), 4열 × 3행 = 12음. */
const MAJOR: KeyCell[] = [
  { sharp: 'C',  flat: 'C',  enS: 'C_MAJOR',       enF: 'C_MAJOR' },
  { sharp: 'C#', flat: 'Db', enS: 'C_SHARP_MAJOR', enF: 'D_FLAT_MAJOR' },
  { sharp: 'D',  flat: 'D',  enS: 'D_MAJOR',       enF: 'D_MAJOR' },
  { sharp: 'D#', flat: 'Eb', enS: 'E_FLAT_MAJOR',  enF: 'E_FLAT_MAJOR' }, // D# major 없음 → Eb
  { sharp: 'E',  flat: 'E',  enS: 'E_MAJOR',       enF: 'E_MAJOR' },
  { sharp: 'F',  flat: 'F',  enS: 'F_MAJOR',       enF: 'F_MAJOR' },
  { sharp: 'F#', flat: 'Gb', enS: 'F_SHARP_MAJOR', enF: 'G_FLAT_MAJOR' },
  { sharp: 'G',  flat: 'G',  enS: 'G_MAJOR',       enF: 'G_MAJOR' },
  { sharp: 'G#', flat: 'Ab', enS: 'A_FLAT_MAJOR',  enF: 'A_FLAT_MAJOR' }, // G# major 없음 → Ab
  { sharp: 'A',  flat: 'A',  enS: 'A_MAJOR',       enF: 'A_MAJOR' },
  { sharp: 'A#', flat: 'Bb', enS: 'B_FLAT_MAJOR',  enF: 'B_FLAT_MAJOR' }, // A# major 없음 → Bb
  { sharp: 'B',  flat: 'B',  enS: 'B_MAJOR',       enF: 'B_MAJOR' },
];

const MINOR: KeyCell[] = [
  { sharp: 'Cm',  flat: 'Cm',  enS: 'C_MINOR',       enF: 'C_MINOR' },
  { sharp: 'C#m', flat: 'Dbm', enS: 'C_SHARP_MINOR', enF: 'C_SHARP_MINOR' }, // Db minor 없음 → C#m
  { sharp: 'Dm',  flat: 'Dm',  enS: 'D_MINOR',       enF: 'D_MINOR' },
  { sharp: 'D#m', flat: 'Ebm', enS: 'D_SHARP_MINOR', enF: 'E_FLAT_MINOR' },
  { sharp: 'Em',  flat: 'Em',  enS: 'E_MINOR',       enF: 'E_MINOR' },
  { sharp: 'Fm',  flat: 'Fm',  enS: 'F_MINOR',       enF: 'F_MINOR' },
  { sharp: 'F#m', flat: 'Gbm', enS: 'F_SHARP_MINOR', enF: 'F_SHARP_MINOR' }, // Gb minor 없음 → F#m
  { sharp: 'Gm',  flat: 'Gm',  enS: 'G_MINOR',       enF: 'G_MINOR' },
  { sharp: 'G#m', flat: 'Abm', enS: 'G_SHARP_MINOR', enF: 'A_FLAT_MINOR' },
  { sharp: 'Am',  flat: 'Am',  enS: 'A_MINOR',       enF: 'A_MINOR' },
  { sharp: 'A#m', flat: 'Bbm', enS: 'A_SHARP_MINOR', enF: 'B_FLAT_MINOR' },
  { sharp: 'Bm',  flat: 'Bm',  enS: 'B_MINOR',       enF: 'B_MINOR' },
];

const cellLabel = (c: KeyCell, acc: Accidental) => (acc === 'sharp' ? c.sharp : c.flat);
const cellEnum = (c: KeyCell, acc: Accidental) => (acc === 'sharp' ? c.enS : c.enF);

/** enum → { cell, isMinor } 역검색 (♯/♭ enum 양쪽 모두 매칭). */
function findByEnum(enumValue: string): { cell: KeyCell; isMinor: boolean } | null {
  for (const c of MAJOR) if (c.enS === enumValue || c.enF === enumValue) return { cell: c, isMinor: false };
  for (const c of MINOR) if (c.enS === enumValue || c.enF === enumValue) return { cell: c, isMinor: true };
  return null;
}

/** enum 값으로부터 검은건반이면 ♯ enum인지 ♭ enum인지 추론해 토글 초기값을 맞춘다. */
function accidentalOf(enumValue: string): Accidental {
  return enumValue.includes('_FLAT_') ? 'flat' : enumValue.includes('_SHARP_') ? 'sharp' : 'flat';
}

interface Props {
  value: string;
  onChange: (key: string) => void;
  className?: string;
}

export function KeyPicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [acc, setAcc] = useState<Accidental>(() => accidentalOf(value));
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const sel = findByEnum(value);
  /* 트리거 라벨: 마이너는 끝의 'm'을 떼어 "C 단조"처럼 보이게. */
  const triggerRoot = sel ? cellLabel(sel.cell, acc).replace(/m$/, '') : value;
  const triggerQual = sel?.isMinor ? '단조' : '장조';

  const pick = (c: KeyCell) => { onChange(cellEnum(c, acc)); setOpen(false); };

  return (
    <Wrap ref={wrapRef} className={className}>
      <Trigger type="button" onClick={() => setOpen((v) => !v)}>
        {triggerRoot}<Qual>{triggerQual}</Qual>
      </Trigger>
      {open && (
        <Panel>
          <AccRow role="group" aria-label="임시표 표기">
            <AccBtn type="button" $on={acc === 'sharp'} onClick={() => setAcc('sharp')}>♯ 올림표</AccBtn>
            <AccBtn type="button" $on={acc === 'flat'} onClick={() => setAcc('flat')}>♭ 내림표</AccBtn>
          </AccRow>
          <Cols>
            <Col>
              <ColHead>장조</ColHead>
              <Grid>
                {MAJOR.map((c) => {
                  const en = cellEnum(c, acc);
                  return (
                    <Cell key={c.enS} type="button" $active={en === value} onClick={() => pick(c)}>
                      {cellLabel(c, acc)}
                    </Cell>
                  );
                })}
              </Grid>
            </Col>
            <Col>
              <ColHead>단조</ColHead>
              <Grid>
                {MINOR.map((c) => {
                  const en = cellEnum(c, acc);
                  return (
                    <Cell key={c.enS} type="button" $active={en === value} onClick={() => pick(c)}>
                      {cellLabel(c, acc)}
                    </Cell>
                  );
                })}
              </Grid>
            </Col>
          </Cols>
        </Panel>
      )}
    </Wrap>
  );
}

/* ── styles (ProjectCreateModal 의 KeyControl 톤과 일치) ──────────────── */
const KEY_FONT = "'MuseJazz Text', 'Pretendard', sans-serif";

const Wrap = styled.div`position: relative;`;

const Trigger = styled.button`
  height: 38px; box-sizing: border-box; width: 100%;
  display: inline-flex; align-items: center; gap: 2px;
  background: ${({ theme }) => theme.colors.surface}; border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 9px; padding: 0 12px;
  cursor: pointer; font-family: ${KEY_FONT}; font-size: 1.15rem; font-weight: 600; color: ${({ theme }) => theme.colors.textPrimary};
  &:hover { border-color: #B8860B; }
  &::after { content: '▾'; font-size: 0.66em; color: ${({ theme }) => theme.colors.textSecondary}; margin-left: auto; }
`;
const Qual = styled.span`font-size: 0.6em; margin-left: 3px;`;

const Panel = styled.div`
  position: absolute; top: calc(100% + 4px); left: 0;
  background: ${({ theme }) => theme.colors.surface}; border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 10px; padding: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.16); z-index: 100;
  display: flex; flex-direction: column; gap: 9px;
`;

const AccRow = styled.div`display: flex; gap: 4px;`;
const AccBtn = styled.button<{ $on: boolean }>`
  flex: 1; height: 30px; border-radius: 7px; cursor: pointer; white-space: nowrap;
  font-family: ${KEY_FONT}; font-size: 13px; font-weight: 700;
  border: 1.5px solid ${({ $on }) => ($on ? '#B8860B' : '#e6e6ec')};
  background: ${({ $on }) => ($on ? '#fdf6e7' : '#fff')};
  color: ${({ $on }) => ($on ? '#7a5b00' : '#9a9aa3')};
  &:hover { border-color: ${({ $on }) => ($on ? '#B8860B' : '#cfcfd6')}; }
`;

const Cols = styled.div`display: flex; gap: 12px;`;
const Col = styled.div`display: flex; flex-direction: column; gap: 5px;`;
const ColHead = styled.div`
  font-family: 'Pretendard', sans-serif; font-size: 11px; font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary}; text-align: center; letter-spacing: 0.02em;
`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(4, 38px); gap: 3px;`;
const Cell = styled.button<{ $active?: boolean }>`
  height: 34px; border: none; border-radius: 6px; cursor: pointer;
  background: ${({ $active }) => ($active ? '#333' : '#f6f6f7')};
  color: ${({ $active }) => ($active ? '#fff' : '#333')};
  font-family: ${KEY_FONT}; font-size: 1.0rem; font-weight: 600;
  display: flex; align-items: center; justify-content: center; white-space: nowrap;
  &:hover { background: ${({ $active }) => ($active ? '#333' : '#ececee')}; }
`;
