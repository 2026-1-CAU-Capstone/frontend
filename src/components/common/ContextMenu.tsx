import { useEffect, useRef } from 'react';
import styled from 'styled-components';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  /** 파괴적 동작(제거 등) — 붉게 표시 */
  danger?: boolean;
  disabled?: boolean;
}

/**
 * 우클릭 드롭다운. 클릭한 좌표(viewport 기준)에 뜨고, 바깥 클릭·Esc·스크롤로 닫힌다.
 * 화면 밖으로 넘치면 좌/상단으로 뒤집어 배치한다.
 */
export function ContextMenu({ x, y, items, onClose }: {
  x: number; y: number; items: ContextMenuItem[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // capture 단계 — 아래 요소의 onClick 이 먼저 삼키는 것을 방지
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // 뷰포트 밖으로 나가지 않게 보정 (대략 폭 200 / 항목당 34)
  const w = 200;
  const h = items.length * 34 + 10;
  const left = Math.min(x, window.innerWidth - w - 8);
  const top = Math.min(y, window.innerHeight - h - 8);

  return (
    <Menu ref={ref} style={{ left, top, width: w }} role="menu">
      {items.map((it) => (
        <Item
          key={it.label}
          role="menuitem"
          $danger={it.danger}
          disabled={it.disabled}
          onClick={() => { if (!it.disabled) { it.onSelect(); onClose(); } }}
        >
          {it.label}
        </Item>
      ))}
    </Menu>
  );
}

const Menu = styled.div`
  position: fixed;
  z-index: ${({ theme }) => theme.zIndex.popover};
  padding: 5px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  box-shadow: ${({ theme }) => theme.shadows.md};
  font-family: 'Pretendard', sans-serif;
`;

const Item = styled.button<{ $danger?: boolean }>`
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  text-align: left;
  font-size: 0.82rem;
  color: ${({ $danger, theme }) => ($danger ? '#c0392b' : theme.colors.textPrimary)};
  cursor: pointer;
  &:disabled { opacity: 0.4; cursor: default; }
  &:not(:disabled):hover {
    background: ${({ $danger }) => ($danger ? 'rgba(192,57,43,0.1)' : 'rgba(0,0,0,0.06)')};
  }
`;
