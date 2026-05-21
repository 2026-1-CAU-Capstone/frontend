import { useEffect, useState } from 'react';
import styled from 'styled-components';

/* ─────────────────────────────────────────────────────────────────────────
 * Session picker — the player declares which instrument they're using this
 * chart with. Clicking the icon (right of the key) opens a "세션 변경" modal
 * listing every instrument. Selection only changes the displayed icon for now;
 * instrument-specific behaviours (vocal → lyrics/scat, sax → transpose,
 * drums → section view, …) are wired later.
 *
 * Icons are PNGs sliced from /public/instrument.png, each trimmed and centered
 * on a 256×256 transparent canvas so they render at one consistent size.
 * ──────────────────────────────────────────────────────────────────────── */

export type SessionInstrument =
  | 'vocal' | 'trumpet' | 'sax' | 'piano' | 'drums' | 'bass' | 'guitar';

const INSTRUMENTS: { id: SessionInstrument; label: string; img: string }[] = [
  { id: 'vocal',   label: '보컬',       img: '/icons/sessions/vocal.png' },
  { id: 'trumpet', label: '트럼펫',     img: '/icons/sessions/trumpet.png' },
  { id: 'sax',     label: '색소폰',     img: '/icons/sessions/sax.png' },
  { id: 'piano',   label: '피아노',     img: '/icons/sessions/piano.png' },
  { id: 'drums',   label: '드럼',       img: '/icons/sessions/drums.png' },
  { id: 'bass',    label: '콘트라베이스', img: '/icons/sessions/bass.png' },
  { id: 'guitar',  label: '일렉기타',   img: '/icons/sessions/guitar.png' },
];

/* Bump when the icon PNGs change so browsers refetch instead of serving the
 * cached (old-background) copy at the same static URL. */
const ICON_VER = '2';

interface Props {
  value: SessionInstrument;
  onChange: (v: SessionInstrument) => void;
}

export function SessionPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const current = INSTRUMENTS.find((i) => i.id === value) ?? INSTRUMENTS[3];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <Trigger type="button" title="세션 변경" aria-label="세션 변경" onClick={() => setOpen(true)}>
        <TriggerImg src={`${current.img}?v=${ICON_VER}`} alt={current.label} />
      </Trigger>

      {open && (
        <Backdrop onClick={() => setOpen(false)}>
          <Modal onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="세션 변경">
            <Title>세션 변경</Title>
            <Sub>이 악보를 어떤 악기로 연주하나요?</Sub>
            <Grid>
              {INSTRUMENTS.map(({ id, label, img }) => (
                <Cell
                  key={id}
                  type="button"
                  $active={id === value}
                  onClick={() => { onChange(id); setOpen(false); }}
                >
                  <CellIcon><img src={`${img}?v=${ICON_VER}`} alt={label} /></CellIcon>
                  <CellLabel>{label}</CellLabel>
                </Cell>
              ))}
            </Grid>
          </Modal>
        </Backdrop>
      )}
    </>
  );
}

/* ── styles ────────────────────────────────────────────────────────────── */

const Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Borderless — icon ~matches the adjacent key box height (~32px). */
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: rgba(0, 0, 0, 0.06); }
`;

const TriggerImg = styled.img`
  width: 30px;
  height: 30px;
  object-fit: contain;
  display: block;
`;

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(20, 20, 20, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const Modal = styled.div`
  width: 100%;
  max-width: 440px;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
  padding: 26px 26px 30px;
  font-family: ${({ theme }) => theme.fonts.ui};
`;

const Title = styled.h2`
  margin: 0;
  font-size: 19px;
  font-weight: 800;
  color: #1a1a1a;
  text-align: center;
`;

const Sub = styled.p`
  margin: 6px 0 22px;
  font-size: 13.5px;
  color: rgba(0, 0, 0, 0.5);
  text-align: center;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
`;

const Cell = styled.button<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 6px;
  border: 1.5px solid ${({ $active }) => ($active ? '#1a1a1a' : 'rgba(0, 0, 0, 0.1)')};
  border-radius: 14px;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.04)' : '#fff')};
  color: #1a1a1a;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.12s, background 0.12s, transform 0.1s;
  &:hover { border-color: #1a1a1a; background: rgba(0, 0, 0, 0.03); }
  &:active { transform: scale(0.97); }
`;

const CellIcon = styled.span`
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  & img { width: 100%; height: 100%; object-fit: contain; display: block; }
`;

const CellLabel = styled.span`
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
`;
