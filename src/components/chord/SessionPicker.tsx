import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { INSTRUMENT_ICONS, CATEGORIES, instrumentIconUrl, resolveInstrumentIconSlug } from '../../data/instrumentIcons';

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

/** 저장된 값(아이콘 슬러그·레거시 id·GM 사운드폰트 이름) → 아이콘 슬러그. */
function toSlug(v: string): string {
  return resolveInstrumentIconSlug(v) ?? v;
}

interface Props {
  value: SessionInstrument;
  onChange: (v: SessionInstrument) => void;
  /** 목록에 없는 악기를 직접 적을 수 있게 한다(모달 맨 아래 '직접 입력하기'). */
  allowCustom?: boolean;
}

export function SessionPicker({ value, onChange, allowCustom }: Props) {
  const [open, setOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const slug = toSlug(value);
  const known = INSTRUMENT_ICONS.find((i) => i.slug === slug);
  const current = known ?? INSTRUMENT_ICONS.find((i) => i.slug === 'piano')!;
  const currentImg = instrumentIconUrl(current.slug) ?? '';
  /** 목록에 없는 값 = 사용자가 직접 적은 악기. 아이콘 대신 글자로 표시한다. */
  const customLabel = !known && value ? value : null;

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
        {customLabel
          ? <CustomChip>{customLabel}</CustomChip>
          : <TriggerImg src={`${currentImg}?v=${ICON_VER}`} alt={current.ko} />}
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
              {allowCustom && (
                <Section>
                  <SectionTitle>직접 입력하기</SectionTitle>
                  <CustomRow>
                    <CustomInput
                      value={customText}
                      placeholder="목록에 없는 악기 (예: 반도네온)"
                      onChange={(e) => setCustomText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customText.trim()) {
                          onChange(customText.trim()); setCustomText(''); setOpen(false);
                        }
                      }}
                    />
                    <CustomApply
                      type="button"
                      disabled={!customText.trim()}
                      onClick={() => { onChange(customText.trim()); setCustomText(''); setOpen(false); }}
                    >적용</CustomApply>
                  </CustomRow>
                </Section>
              )}
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
  /* 직접 입력한 긴 악기명이 상자를 넘어 옆 글자와 겹치지 않게 잘라낸다. */
  overflow: hidden;
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

/* 직접 입력한 악기는 아이콘이 없으므로 글자 칩으로 보여준다. */
const CustomChip = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  padding: 0 4px;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
`;

const CustomRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const CustomInput = styled.input`
  flex: 1;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  padding: 8px 11px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.textSecondary}; }
`;

const CustomApply = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.88rem;
  font-weight: 700;
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.textPrimary};
  color: ${({ theme }) => theme.colors.bgPrimary};
  cursor: pointer;
  &:disabled { opacity: 0.4; cursor: default; }
`;
