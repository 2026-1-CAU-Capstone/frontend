import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { LickCard } from '../components/notesheet/LickCard';
import { loadUserLicks, deleteUserLick, type LickEntry } from '../data/lickData';

/* ─── styled ───────────────────────────────────────────────────────────── */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'DM Sans', sans-serif;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const BackBtn = styled.button`
  font-size: 0.82rem;
  padding: 4px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  &:hover { background: #f0f0f0; }
`;

const Title = styled.span`
  font-size: 1rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Count = styled.span`
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ListArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const EmptyMsg = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.9rem;
  opacity: 0.5;
`;

/* ─── visibility wrapper ─────────────────────────────────────────────── */

function VisibleLickCard({ lick, width, displayId, onDelete, onClick }: {
  lick: LickEntry; width: number; displayId: number; onDelete: () => void; onClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref}>
      <LickCard lick={lick} width={width} visible={visible} compact displayId={displayId} onDelete={onDelete} onClick={onClick} />
    </div>
  );
}

/* ─── component ────────────────────────────────────────────────────────── */

export default function MyLicksPage() {
  const navigate = useNavigate();
  const [licks, setLicks] = useState<LickEntry[]>([]);

  useEffect(() => {
    loadUserLicks().then(setLicks);
  }, []);

  const handleDelete = useCallback((id: number) => {
    deleteUserLick(id);
    loadUserLicks().then(setLicks);
  }, []);

  /* width tracking */
  const listRef = useRef<HTMLDivElement>(null);
  const [cardWidth, setCardWidth] = useState(800);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setCardWidth(w - 40);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <Page>
      <Header>
        <BackBtn onClick={() => navigate('/lick-input')}>&larr; Lick Tool</BackBtn>
        <Title>My Licks</Title>
        <Count>{licks.length} lick{licks.length !== 1 ? 's' : ''}</Count>
      </Header>

      <ListArea ref={listRef}>
        {licks.length === 0 && (
          <EmptyMsg>No custom licks yet. Use the Lick JSON Tool to create one.</EmptyMsg>
        )}
        {licks.map((lick, i) => (
          <VisibleLickCard
            key={lick.id}
            lick={lick}
            width={cardWidth}
            displayId={i + 1}
            onDelete={() => handleDelete(lick.id)}
            onClick={() => navigate(`/lick-practice/${lick.id}`)}
          />
        ))}
      </ListArea>
    </Page>
  );
}
