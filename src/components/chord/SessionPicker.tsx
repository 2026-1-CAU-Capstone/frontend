import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { INSTRUMENT_ICONS, CATEGORIES, instrumentIconUrl, SESSION_ICON_SLUG } from '../../data/instrumentIcons';

/* ─────────────────────────────────────────────────────────────────────────
 * Session picker — the player declares which instrument they're using this
 * chart with. Clicking the icon (right of the key) opens a "세션 변경" modal
 * listing every instrument, grouped by family. Selection only changes the
 * displayed icon for now; instrument-specific behaviours (vocal → lyrics/scat,
 * sax → transpose, drums → section view, …) are wired later.
 *
 * A session value is an icon slug (e.g. 'alto-saxophone'); the icons live in
 * /public/icons/sessions/ (square, transparent). Legacy generic ids
 * ('sax','drums','bass','guitar') are still accepted and normalized to a slug.
 * ──────────────────────────────────────────────────────────────────────── */

export type SessionInstrument = string;

/* Bump when the icon PNGs change so browsers refetch instead of serving the
 * cached copy at the same static URL. */
const ICON_VER = '3';

/** Resolve any stored value (icon slug or legacy generic id) to a canonical slug. */
function toSlug(v: string): string {
  return SESSION_ICON_SLUG[v] ?? v;
}

interface Props {
  value: SessionInstrument;
  onChange: (v: SessionInstrument) => void;
}

export function SessionPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const slug = toSlug(value);
  const current =
    INSTRUMENT_ICONS.find((i) => i.slug === slug) ??
    INSTRUMENT_ICONS.find((i) => i.slug === 'piano')!;
  const currentImg = instrumentIconUrl(current.slug) ?? '';

  const groups = useMemo(
    () =>
      CATEGORIES.map((c) => ({ ...c, items: INSTRUMENT_ICONS.filter((i) => i.cat === c.key) }))
        .filter((g) => g.items.length > 0),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <Trigger type="button" title="세션 변경" aria-label="세션 변경" onClick={() => setOpen(true)}>
        <TriggerImg src={`${currentImg}?v=${ICON_VER}`} alt={current.ko} />
      </Trigger>

      {open && (
        <Backdrop onClick={() => setOpen(false)}>
          <Modal onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="세션 변경">
            <Title>세션 변경</Title>
            <Sub>이 악보를 어떤 악기로 연주하나요?</Sub>
            <Scroll>
              {groups.map((g) => (
                <Section key={g.key}>
                  <SectionTitle>{g.label}</SectionTitle>
                  <Grid>
                    {g.items.map((it) => (
                      <Cell
                        key={it.slug}
                        type="button"
                        $active={it.slug === slug}
                        title={`${it.ko} · ${it.en}`}
                        onClick={() => { onChange(it.slug); setOpen(false); }}
                      >
                        <CellIcon><img src={`${instrumentIconUrl(it.slug)}?v=${ICON_VER}`} alt={it.ko} /></CellIcon>
                        <CellLabel>{it.ko}</CellLabel>
                      </Cell>
                    ))}
                  </Grid>
                </Section>
              ))}
            </Scroll>
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
  z-index: ${({ theme }) => theme.zIndex.modalHigh};
  background: rgba(20, 20, 20, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const Modal = styled.div`
  width: 100%;
  max-width: 540px;
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
  padding: 24px 22px 8px;
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
  margin: 6px 0 16px;
  font-size: 13.5px;
  color: rgba(0, 0, 0, 0.5);
  text-align: center;
`;

const Scroll = styled.div`
  overflow-y: auto;
  padding: 0 6px 18px 2px;
  -webkit-overflow-scrolling: touch;
`;

const Section = styled.section`
  & + & { margin-top: 16px; }
`;

const SectionTitle = styled.h3`
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: ${({ theme }) => theme.colors.gold};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
`;

const Cell = styled.button<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 11px 4px;
  border: 1.5px solid ${({ $active }) => ($active ? '#1a1a1a' : 'rgba(0, 0, 0, 0.1)')};
  border-radius: 12px;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.04)' : '#fff')};
  color: #1a1a1a;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.12s, background 0.12s, transform 0.1s;
  &:hover { border-color: #1a1a1a; background: rgba(0, 0, 0, 0.03); }
  &:active { transform: scale(0.97); }
`;

const CellIcon = styled.span`
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  & img { width: 100%; height: 100%; object-fit: contain; display: block; }
`;

const CellLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
  text-align: center;
  word-break: keep-all;
`;
