/* 조성 제안 UI — 모달 + (거절 시) 작은 말풍선.
 *
 * 흐름
 *   최초 감지        → 모달로 "조성이 다른 것 같아요" 제안
 *   [나중에] 누르면  → 모달은 닫히고, 키 칩 옆에 작은 말풍선이 계속 남는다
 *   말풍선 ✕ 누르면 → 그 곡·그 추천키 조합은 다시 뜨지 않는다
 *   [바꾸기] 누르면  → onApply(key). 조성이 맞아지므로 shouldSuggest 가 false 가
 *                      되어 자연히 사라진다.
 *
 * 중요 — 이것은 '조옮김(transpose)'이 아니라 '조성 재해석'이다. 코드 심볼은
 * 그대로 두고 분석 기준(도수·다이아토닉·ii-V-I)만 다시 계산한다. 두 개념이
 * 섞이면 사용자가 실수로 곡을 이조시켜 망가뜨리므로, 문구로 명시한다.
 */

import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import type { LeadSheetData } from '../../data/leadSheetTypes';
import { suggestKeys } from './keySuggest';

/* ── 결정 저장 (곡 × 추천키 단위) ─────────────────────────────────────── */

type Decision = 'later' | 'dismissed';
const STORE = 'jazzify.keySuggest.v1';

function slot(storageId: string, key: string): string {
  return `${storageId}::${key}`;
}

function readDecision(storageId: string, key: string): Decision | undefined {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return undefined;
    const map = JSON.parse(raw) as Record<string, Decision>;
    return map[slot(storageId, key)];
  } catch {
    return undefined;
  }
}

function writeDecision(storageId: string, key: string, d: Decision): void {
  try {
    const raw = window.localStorage.getItem(STORE);
    const map = raw ? (JSON.parse(raw) as Record<string, Decision>) : {};
    map[slot(storageId, key)] = d;
    window.localStorage.setItem(STORE, JSON.stringify(map));
  } catch {
    /* private mode / quota — 저장 못 해도 기능은 동작 */
  }
}

/* ── 표시용 포맷 ──────────────────────────────────────────────────────── */

/** 'Ab' → 'A♭ 장조', 'Gm' → 'G 단조' */
function keyLabel(key: string): string {
  const isMinor = key.endsWith('m');
  const root = (isMinor ? key.slice(0, -1) : key).replace('b', '♭').replace('#', '♯');
  return `${root} ${isMinor ? '단조' : '장조'}`;
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

/* ── 스타일 ───────────────────────────────────────────────────────────── */

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 1200;
  background: ${({ theme }) => theme.colors.scrim};
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
`;

const Card = styled.div`
  width: 100%; max-width: 420px;
  background: ${({ theme }) => theme.colors.surface}; border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
  padding: 22px 22px 18px;
`;

const Title = styled.h3`
  margin: 0 0 6px; font-size: 17px; font-weight: 700; color: #17233a;
`;

const Sub = styled.p`
  margin: 0 0 14px; font-size: 13px; line-height: 1.55; color: ${({ theme }) => theme.colors.textSecondary};
`;

const KeyRow = styled.div`
  display: flex; align-items: center; justify-content: center; gap: 12px;
  margin: 4px 0 14px;
`;

const KeyChip = styled.span<{ $accent?: boolean }>`
  font-size: 15px; font-weight: 700; padding: 7px 14px; border-radius: 9px;
  color: ${(p) => (p.$accent ? '#0b57d0' : '#6b7280')};
  background: ${(p) => (p.$accent ? '#e8f0fe' : '#f3f4f6')};
`;

const Arrow = styled.span`color: ${({ theme }) => theme.colors.textSecondary}; font-size: 15px;`;

const Evidence = styled.ul`
  margin: 0 0 16px; padding: 12px 14px; list-style: none;
  background: ${({ theme }) => theme.colors.surface}; border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 10px;
  font-size: 12.5px; color: #40506a; line-height: 1.7;
  li::before { content: '·'; margin-right: 6px; color: ${({ theme }) => theme.colors.textSecondary}; }
`;

const Note = styled.p`
  margin: 0 0 16px; font-size: 12px; color: ${({ theme }) => theme.colors.textSecondary}; line-height: 1.5;
`;

const Actions = styled.div`display: flex; gap: 8px; justify-content: flex-end;`;

const Btn = styled.button<{ $primary?: boolean }>`
  border: 1px solid ${(p) => (p.$primary ? '#0b57d0' : '#d7dbe0')};
  background: ${(p) => (p.$primary ? '#0b57d0' : '#fff')};
  color: ${(p) => (p.$primary ? '#fff' : '#48505c')};
  font-size: 13.5px; font-weight: 600;
  padding: 9px 16px; border-radius: 9px; cursor: pointer;
  &:hover { filter: brightness(0.97); }
`;

const Bubble = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  margin-left: 6px; padding: 4px 6px 4px 10px;
  background: #fff8e1; border: 1px solid #f2e2ae; border-radius: 999px;
  font-size: 11.5px; color: #7a5d12; white-space: nowrap;
`;

const BubbleLink = styled.button`
  border: 0; background: none; padding: 0;
  font-size: 11.5px; font-weight: 700; color: #0b57d0; cursor: pointer;
  text-decoration: underline;
`;

const BubbleClose = styled.button`
  border: 0; background: none; cursor: pointer;
  width: 16px; height: 16px; line-height: 1;
  color: #a8925a; font-size: 13px; padding: 0;
  &:hover { color: #7a5d12; }
`;

/* ── 컴포넌트 ─────────────────────────────────────────────────────────── */

export interface KeySuggestPromptProps {
  data: LeadSheetData | null;
  /** 결정 저장 스코프. 보통 songId. */
  storageId: string;
  /**
   * 사용자가 이조한 상태(또는 편집 중)면 제안하지 않는다. 이조 중에 조성을
   * 재해석하면 "무엇이 원본인가"가 모호해져 오작동을 부른다.
   */
  enabled: boolean;
  /** 새 조성을 차트에 반영한다(코드는 그대로, 분석만 재계산). */
  onApply: (key: string) => void;
}

export function KeySuggestPrompt({ data, storageId, enabled, onApply }: KeySuggestPromptProps) {
  /* 24키 채점은 수 ms 지만 렌더마다 돌 이유는 없다. */
  const suggestion = useMemo(() => (data && enabled ? suggestKeys(data) : null), [data, enabled]);

  const best = suggestion?.best.key ?? '';
  const active = !!suggestion?.shouldSuggest;

  /* 저장된 결정은 '렌더 중 파생'한다 — effect 안에서 setState 하면 곡이 바뀔 때
   * 한 프레임 동안 낡은 결정으로 렌더된다(그리고 lint 도 이를 금지한다).
   * 이번 세션에서 내린 결정만 override 로 덮어쓰고, 슬롯이 달라지면 자동 무효화. */
  const currentSlot = slot(storageId, best);
  const stored = useMemo(
    () => (active ? readDecision(storageId, best) : undefined),
    [active, storageId, best],
  );
  const [override, setOverride] = useState<{ slot: string; d: Decision } | null>(null);
  const decision: Decision | undefined =
    override && override.slot === currentSlot ? override.d : stored;

  const decide = (d: Decision) => {
    writeDecision(storageId, best, d);
    setOverride({ slot: currentSlot, d });
  };

  /* 모달 열림 중 Esc → '나중에' 로 간주 */
  const modalOpen = active && decision === undefined;
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') decide('later');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, currentSlot]);

  if (!suggestion || !active || decision === 'dismissed') return null;

  const { current, best: bestScore } = suggestion;

  const later = () => decide('later');
  const dismiss = () => decide('dismissed');
  const apply = () => onApply(best);

  /* 거절 후 — 작게 계속 남는 말풍선 */
  if (decision === 'later') {
    return (
      <Bubble role="status">
        <span>{keyLabel(best)} 같은데요?</span>
        <BubbleLink onClick={apply}>바꾸기</BubbleLink>
        <BubbleClose onClick={dismiss} aria-label="이 제안 다시 보지 않기" title="다시 보지 않기">
          ✕
        </BubbleClose>
      </Bubble>
    );
  }

  /* 최초 감지 — 모달 */
  return (
    <Backdrop onClick={later}>
      <Card onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <Title>조성이 다른 것 같아요</Title>
        <Sub>코드 진행을 분석해 보니, 지금 지정된 조성과 잘 맞지 않습니다.</Sub>

        <KeyRow>
          <KeyChip>{keyLabel(current.key)}</KeyChip>
          <Arrow>→</Arrow>
          <KeyChip $accent>{keyLabel(bestScore.key)}</KeyChip>
        </KeyRow>

        <Evidence>
          <li>
            설명되지 않는 코드 {pct(current.unexplainedRatio)} → <b>{pct(bestScore.unexplainedRatio)}</b>
          </li>
          {bestScore.lastCadenceTonic && <li>곡의 마지막 케이던스가 {keyLabel(bestScore.key)}로 해결됩니다</li>}
          {bestScore.tonicCadences > 0 && <li>으뜸화음으로 해결되는 케이던스 {bestScore.tonicCadences}개</li>}
        </Evidence>

        <Note>코드 기호는 바뀌지 않습니다. 도수·다이아토닉·ii-V-I 같은 분석 기준만 다시 계산돼요.</Note>

        <Actions>
          <Btn onClick={later}>나중에</Btn>
          <Btn $primary onClick={apply}>
            {keyLabel(bestScore.key)}로 바꾸기
          </Btn>
        </Actions>
      </Card>
    </Backdrop>
  );
}
