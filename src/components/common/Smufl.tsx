/**
 * Smufl — 팔레트·툴바 버튼에 **실제 악보 기호**를 찍는 단 하나의 컴포넌트.
 *
 * Bravura(SMuFL 표준 음악 폰트)로 렌더한다. 버튼마다 유니코드 잡문자나 손으로
 * 그린 SVG 를 쓰면 크기·굵기·베이스라인이 제각각이 되므로, 기호는 전부 이걸
 * 거친다.
 *
 * 정렬: SMuFL 글리프는 **오선 중앙(baseline)** 기준으로 그려져 위아래로 크게
 * 삐져나간다. 버튼 안에서 시각적 중앙에 오도록 고정 높이 박스 + flex 중앙
 * 정렬로 감싸고, 글리프 자체는 line-height:1 로 잡는다.
 */
import styled from 'styled-components';
import { SMUFL, glyphFit, type SmuflGlyph } from '../../lib/note/smufl';

export interface SmuflProps {
  glyph: SmuflGlyph;
  /** 글리프 크기(px). 기본 22 — 54px 버튼에서 실제 악보와 비슷한 비율. */
  size?: number;
  /** 미세 수직 보정(px, 양수=아래로). 글리프별 기준선 차이를 잡는다. */
  dy?: number;
  className?: string;
  title?: string;
}

export function Smufl({ glyph, size = 22, dy = 0, className, title }: SmuflProps) {
  /* 글리프마다 원본 크기·기준선이 크게 달라(점 84 유닛 ~ 코다 1056) 광학 보정표로
   * 배수와 세로 중심을 잡는다 — 그래야 버튼마다 크기가 들쭉날쭉하지 않는다. */
  const [scale, center] = glyphFit(glyph);
  const px = size * scale;
  return (
    <Box $size={size} className={className} title={title} aria-hidden>
      <Glyph $size={px} $dy={dy + center * px}>{String.fromCodePoint(SMUFL[glyph])}</Glyph>
    </Box>
  );
}

/** 여러 글리프를 가로로 잇는다(셈여림 sfz, 8va 같은 조합 표기). */
export function SmuflRow({ glyphs, size = 22, dy = 0, gap = 0 }: {
  glyphs: SmuflGlyph[]; size?: number; dy?: number; gap?: number;
}) {
  const [scale, center] = glyphFit(glyphs[0] ?? 'noteheadBlack');
  const px = size * scale;
  return (
    <Box $size={size} aria-hidden>
      <Glyph $size={px} $dy={dy + center * px} style={{ letterSpacing: gap }}>
        {glyphs.map((g) => String.fromCodePoint(SMUFL[g])).join('')}
      </Glyph>
    </Box>
  );
}

const Box = styled.span<{ $size: number }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 글리프가 위아래로 삐져나가도 버튼 레이아웃이 흔들리지 않게 높이를 고정. */
  height: ${({ $size }) => Math.round($size * 0.92)}px;
  line-height: 1;
  overflow: visible;
`;

const Glyph = styled.span<{ $size: number; $dy: number }>`
  font-family: 'Bravura', serif;
  font-size: ${({ $size }) => $size}px;
  line-height: 1;
  transform: translateY(${({ $dy }) => $dy}px);
  /* Bravura 는 볼드체가 없다 — 굵기 상속이 걸리면 합성 볼드로 뭉개진다. */
  font-weight: normal;
  font-style: normal;
  color: currentColor;
  user-select: none;
`;
