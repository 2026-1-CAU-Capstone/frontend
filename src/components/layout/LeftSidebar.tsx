import { useCallback, useRef, useState } from 'react';
import type { TocEntry } from '../../data/types';
import {
  SidebarWrapper,
  SidebarContainer,
  SidebarOverlay,
  ResizeHandle,
  ReopenTab,
  SidebarSection,
  SidebarTitle,
  MenuItem,
  TocList,
  TocItem,
} from './LeftSidebar.styles';

const DEFAULT_WIDTH = 200;
const MIN_WIDTH = 80;

interface LeftSidebarProps {
  toc: TocEntry[];
  activePage: number;
  onPageSelect: (page: number) => void;
}

export function LeftSidebar({ toc, activePage, onPageSelect }: LeftSidebarProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const handleRef = useRef<HTMLDivElement>(null);
  const open = width > 0;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    handleRef.current?.classList.add('dragging');

    const onMove = (ev: MouseEvent) => {
      const newWidth = startWidth + (ev.clientX - startX);
      if (newWidth < MIN_WIDTH) {
        setWidth(0);
      } else {
        setWidth(Math.min(400, newWidth));
      }
    };

    const onUp = () => {
      handleRef.current?.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  return (
    <>
      <SidebarOverlay $open={open} onClick={() => setWidth(0)} />
      <SidebarWrapper $width={width}>
        {open ? (
          <>
            <SidebarContainer>
              <SidebarSection>
                <SidebarTitle>메뉴</SidebarTitle>
                <MenuItem>📚 라이브러리</MenuItem>
                <MenuItem>⭐ 라이브러리에서 제거</MenuItem>
                <MenuItem>👥 친구 추천하기</MenuItem>
              </SidebarSection>

              <SidebarSection>
                <SidebarTitle>목차</SidebarTitle>
              </SidebarSection>
              <TocList>
                {toc.map((entry) => (
                  <TocItem
                    key={entry.title}
                    $active={activePage === entry.page}
                    onClick={() => onPageSelect(entry.page)}
                  >
                    ▸ {entry.title} (p.{entry.page})
                  </TocItem>
                ))}
              </TocList>
            </SidebarContainer>

            <ResizeHandle ref={handleRef} onMouseDown={onMouseDown} />
          </>
        ) : (
          <ReopenTab onClick={() => setWidth(DEFAULT_WIDTH)}>▸</ReopenTab>
        )}
      </SidebarWrapper>
    </>
  );
}
