import { useMemo } from 'react';
import { useTheme } from 'styled-components';
import { chordToDiagram } from '../../lib/note/chordDiagram';
import { GUITAR_TUNING } from '../../lib/note/tabFingering';

/* ─────────────────────────────────────────────────────────────────────────
 * ChordDiagram — 코드심볼 → 기타 프렛 다이어그램(React SVG).
 *
 * 기존 chordToDiagram(운지 엔진) 결과를 그대로 그린다. 코드 차트(LeadSheet)의
 * 코드 심볼 아래에 세로로 얹기 위해 (imperative drawFretDiagram 대신) React SVG
 * 로 포팅했다. 코드명은 이미 위에 있으니 여기선 그리드만 그린다.
 *
 * FretDiagram.frets: index 0 = 1번줄(가는 줄) — 다이어그램 관례상 오른쪽 끝.
 * ──────────────────────────────────────────────────────────────────────── */

const WINDOW = 4; // 그리드에 보여줄 프렛 수

interface Props {
  symbol: string;
  /** 그리드 너비(px). 높이는 여기서 파생. */
  width?: number;
  className?: string;
}

export function ChordDiagram({ symbol, width = 44, className }: Props) {
  const theme = useTheme();
  const diagram = useMemo(() => chordToDiagram(symbol, GUITAR_TUNING), [symbol]);
  if (!diagram) return null;

  const nStr = diagram.frets.length;
  const colGap = width / (nStr - 1);
  const rowGap = colGap * 0.92;
  const gridH = rowGap * WINDOW;

  const padX = 6;                 // baseFret 라벨/여백
  const markerH = 9;              // ×/○ 마커 줄
  const svgW = width + padX * 2;
  const svgH = markerH + gridH + 4;
  const gx = padX;                // 그리드 좌상단 x
  const gy = markerH;             // 그리드 좌상단 y
  const openNut = diagram.baseFret === 1;

  /* SVG 속성으로 직접 칠하므로 CSS 토큰이 아니라 **값**이 필요하다 — 다크에서
   * 격자와 점이 배경에 묻히지 않게 테마에서 잉크를 받는다. */
  const strokeMain = theme.colors.inkSoft;
  const dotFill = theme.colors.textPrimary;

  return (
    <svg
      className={className}
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      role="img"
      aria-label={`${symbol} 기타 코드`}
      style={{ display: 'block' }}
    >
      {/* baseFret 라벨 (2프렛 이상 폼) */}
      {!openNut && (
        <text x={gx - 3} y={gy + rowGap * 0.72} fontSize={7.5} fontWeight={600}
          textAnchor="end" fill={strokeMain} fontFamily="'Pretendard', sans-serif">
          {diagram.baseFret}
        </text>
      )}

      {/* 세로줄(현) */}
      {Array.from({ length: nStr }, (_, i) => (
        <line key={`s${i}`} x1={gx + i * colGap} y1={gy} x2={gx + i * colGap} y2={gy + gridH}
          stroke={strokeMain} strokeWidth={1} />
      ))}

      {/* 가로줄(프렛) — 너트는 굵게 */}
      {Array.from({ length: WINDOW + 1 }, (_, f) => (
        <line key={`f${f}`} x1={gx} y1={gy + f * rowGap} x2={gx + width} y2={gy + f * rowGap}
          stroke={strokeMain} strokeWidth={f === 0 && openNut ? 2.4 : 1} />
      ))}

      {/* 마커(×/○) + 프렛 도트 */}
      {diagram.frets.map((fret, i) => {
        const cx = gx + (nStr - 1 - i) * colGap; // 1번줄이 오른쪽
        if (fret === null) {
          return (
            <text key={`m${i}`} x={cx} y={gy - 2.5} fontSize={7.5} fontWeight={600}
              textAnchor="middle" fill={strokeMain} fontFamily="'Pretendard', sans-serif">×</text>
          );
        }
        if (fret === 0) {
          return <circle key={`m${i}`} cx={cx} cy={gy - 5} r={2.4} fill="none" stroke={strokeMain} strokeWidth={1} />;
        }
        const row = fret - diagram.baseFret;
        return (
          <circle key={`m${i}`} cx={cx} cy={gy + (row + 0.5) * rowGap}
            r={Math.min(colGap * 0.34, 4.4)} fill={dotFill} />
        );
      })}
    </svg>
  );
}
