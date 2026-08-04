/**
 * LickOnsetPage — Charlie Parker 릭 · Omnibook 원본 대조 (검증 페이지).
 *
 * 백엔드 파커 릭 31개와, 인터벌 대조로 특정한 Charlie Parker Omnibook 원본
 * 곡·마디 발췌를 나란히 보여준다. 악보 렌더링·재생·스윙·컴핑·믹서는 릭
 * 데이터베이스 페이지와 완전히 동일하다 — 같은 LickCard 컴포넌트를 그대로
 * 쓰기 때문(자체 렌더러 없음). 데이터는 빌드 산출물이 아니라 스크립트로
 * 생성한 정적 JSON(public/data/licks/omnibook_compare.json)이다.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { LickCard } from '../components/notesheet/LickCard';
import type { LickEntry } from '../data/lickData';
import {
  DetailHeader,
  DetailHeaderRow,
  DetailBackBtn,
  DetailTitle,
} from '../components/projects/sharedStyles';

interface CompareItem {
  p: number;
  pid: string;
  title: string;
  keyRaw: string;
  tier: 'confirmed' | 'weak' | 'none';
  tune: string;
  bar: string;
  run: number;
  pct: number;
  off: number | null;
  ties: string[];
  own: boolean;
  backend: LickEntry;
  segment: LickEntry;
}

const TIER_LABEL: Record<CompareItem['tier'], string> = {
  confirmed: '확실 ≥85%',
  weak: '부분 60–84%',
  none: '약함 <60%',
};

function offLabel(off: number | null): string {
  if (off === null) return '—';
  if (off === 0) return '동일 조';
  if (off === 12 || off === -12) return '옥타브 이동';
  return `조옮김 ${off > 0 ? '+' : ''}${off}반음`;
}

/** 화면에 보일 때만 VexFlow를 그리는 lazy 래퍼 — MyLicksPage와 동일 패턴. */
function VisibleCard({ lick, width }: { lick: LickEntry; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref}>
      <LickCard lick={lick} width={width} visible={visible} compact fitToWidth />
    </div>
  );
}

export default function LickOnsetPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CompareItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/data/licks/omnibook_compare.json')
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d) => setItems(d.items as CompareItem[]))
      .catch((e) => setError(String(e)));
  }, []);

  /* LickCard가 참조하는 feed 폭 — MyLicksPage와 동일하게 ResizeObserver로 추적 */
  const feedRef = useRef<HTMLDivElement>(null);
  const [feedWidth, setFeedWidth] = useState(800);
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setFeedWidth(w - 40);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const counts = { confirmed: 0, weak: 0, none: 0 };
  items.forEach((it) => { counts[it.tier] += 1; });

  return (
    <Page>
      <DetailHeader>
        <DetailHeaderRow>
          <DetailBackBtn type="button" aria-label="뒤로" onClick={() => navigate(-1)}>
            <BackArrow />
          </DetailBackBtn>
          <DetailTitle>Parker 릭 · Omnibook 원본 대조</DetailTitle>
        </DetailHeaderRow>
      </DetailHeader>

      <Feed ref={feedRef}>
        <Intro>
          백엔드 파커 릭 {items.length || 31}개를 Charlie Parker Omnibook 채보 50곡과
          인터벌 대조 + 피치 검증한 결과. 재생·스윙·컴핑은 릭 데이터베이스와 동일.
          {items.length > 0 && (
            <Stats> 확실 {counts.confirmed} · 부분 {counts.weak} · 약함 {counts.none}</Stats>
          )}
        </Intro>
        {error && <Intro>데이터 로드 실패: {error}</Intro>}

        {items.map((it) => (
          <Compare key={it.pid}>
            <MetaRow>
              <DbNum>#{it.p}</DbNum>
              <MetaTitle>{it.title}</MetaTitle>
              <Chip>{it.keyRaw}</Chip>
              <Chip>id {it.pid}</Chip>
              <Badge $tier={it.tier}>{TIER_LABEL[it.tier]}</Badge>
            </MetaRow>
            <MatchLine>
              → Omnibook <b>《{it.tune}》</b> <Bar>m.{it.bar}</Bar> · 연속 일치 {it.run}음 ·{' '}
              <Pct>{it.pct}%</Pct> · {offLabel(it.off)}
              {!it.own && <Faint> (제목과 다른 곡)</Faint>}
              {it.ties.length > 0 && <Faint> · 동률: {it.ties.join(', ')}</Faint>}
            </MatchLine>
            <YtLink
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`Charlie Parker ${it.tune}`)}`}
              target="_blank" rel="noopener noreferrer"
            >
              ▶ 유튜브에서 «{it.tune}» 찾기
            </YtLink>

            <PaneLabel>백엔드 릭 ({it.keyRaw})</PaneLabel>
            <VisibleCard lick={it.backend} width={feedWidth} />

            <PaneLabel>Omnibook 원본 《{it.tune}》 m.{it.bar}</PaneLabel>
            <VisibleCard lick={it.segment} width={feedWidth} />
          </Compare>
        ))}
      </Feed>
    </Page>
  );
}

const BackArrow = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

/* ─── styled ─────────────────────────────────────────────────────────── */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  background: ${({ theme }) => theme.colors.barBelow};
  font-family: 'Pretendard', sans-serif;
`;

const Feed = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 60px;
  max-width: 980px;
  width: 100%;
  margin: 0 auto;
`;

const Intro = styled.p`
  margin: 4px 2px 16px;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Stats = styled.b`
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Compare = styled.section`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  padding: 14px 14px 10px;
  margin: 0 0 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
`;

const MetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const DbNum = styled.span`
  font-weight: 800;
  color: #a9761f;
`;

const MetaTitle = styled.span`
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Chip = styled.span`
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.hover};
  border-radius: 999px;
  padding: 2px 8px;
`;

const Badge = styled.span<{ $tier: CompareItem['tier'] }>`
  margin-left: auto;
  font-size: 0.74rem;
  font-weight: 650;
  padding: 4px 10px;
  border-radius: 999px;
  color: ${({ $tier }) => ($tier === 'confirmed' ? '#8a6a1c' : $tier === 'weak' ? '#8a7a52' : '#8f8778')};
  background: ${({ $tier }) => ($tier === 'confirmed' ? '#f6eed7' : $tier === 'weak' ? '#efeadd' : '#eceae3')};
`;

const MatchLine = styled.div`
  margin: 8px 0 6px;
  font-size: 0.86rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  b { color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const Bar = styled.span`
  color: #a9761f;
  font-weight: 650;
`;

const Pct = styled.span`
  color: #a9761f;
  font-weight: 750;
`;

const Faint = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const YtLink = styled.a`
  display: inline-block;
  margin: 0 0 6px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #a9761f;
  text-decoration: none;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: rgba(169, 118, 31, 0.07);
  border-radius: 999px;
  padding: 4px 10px;
  &:hover { background: rgba(169, 118, 31, 0.15); }
`;

const PaneLabel = styled.div`
  margin: 10px 2px 2px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
