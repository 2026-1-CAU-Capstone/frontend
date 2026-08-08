import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'styled-components';
import { splitChordParts } from '../../lib/jazz-harmony';
import {
  absoluteFret, guitarDbSync, loadGuitarDb, lookupPositions,
  type DbPosition,
} from '../../lib/note/chordDb';

/* ─────────────────────────────────────────────────────────────────────────
 * ChordDiagram — 코드심볼 → 기타 프렛 다이어그램(React SVG).
 *
 * 운지를 계산하지 않는다. `chords-db`(MIT) 의 사람이 검수한 폼을 조회해 그린다
 * (lib/note/chordDb 참조 — 왜 계산을 버렸는지도 거기 적혀 있다).
 *
 * 데이터에 없는 코드는 **아무것도 그리지 않는다.** 가까운 폼을 갖다 붙이면
 * 사용자가 다른 코드를 짚는다.
 *
 * 데이터는 동적 import 라 첫 렌더에는 없다. 받아 오면 리렌더한다 — 그때까지
 * 자리를 차지하지 않으려고 null 을 반환한다(코드 심볼은 이미 위에 있다).
 * ──────────────────────────────────────────────────────────────────────── */

const WINDOW = 4;   // 그리드에 보여줄 프렛 수

interface Props {
  symbol: string;
  /** 그리드 너비(px). 높이는 여기서 파생. */
  width?: number;
  className?: string;
}

export function ChordDiagram({ symbol, width = 44, className }: Props) {
  const theme = useTheme();
  /* 데이터 도착을 기다린다. 이미 받아 뒀으면(다른 코드가 먼저 불렀으면) 즉시 그린다. */
  const [ready, setReady] = useState(() => guitarDbSync() !== null);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadGuitarDb().then(() => { if (alive) setReady(true); }).catch(() => { /* 다이어그램만 안 뜬다 */ });
    return () => { alive = false; };
  }, [ready]);

  const position = useMemo<DbPosition | null>(() => {
    const db = guitarDbSync();
    if (!db) return null;
    /* 코드심볼을 루트 + 퀄리티로 쪼갠다. 분수코드(`/G`)의 베이스는 버린다 —
     * chords-db 의 슬래시 suffix 는 루트별로 정해진 목록이라 임의 조합이 없다. */
    const { base, ext, tension } = splitChordParts(symbol);
    const m = base.match(/^([A-Ga-g][#♯b♭]*)(.*)$/);
    if (!m) return null;
    const qual = `${m[2]}${ext}${tension}`.trim();
    return lookupPositions(db, m[1], qual)[0] ?? null;
  }, [symbol, ready]);

  if (!position) return null;

  /* 데이터는 **6번줄(굵은 E)부터**. 다이어그램 관례는 6번줄이 왼쪽이라 그대로 그린다. */
  const nStr = position.frets.length;
  const colGap = width / (nStr - 1);
  const rowGap = colGap * 0.92;
  const gridH = rowGap * WINDOW;

  const padX = 6;                 // baseFret 라벨/여백
  const markerH = 9;              // ×/○ 마커 줄
  const svgW = width + padX * 2;
  const svgH = markerH + gridH + 4;
  const gx = padX;
  const gy = markerH;
  const openNut = position.baseFret === 1;

  /* SVG 속성으로 직접 칠하므로 CSS 토큰이 아니라 **값**이 필요하다 — 다크에서
   * 격자와 점이 배경에 묻히지 않게 테마에서 잉크를 받는다. */
  const strokeMain = theme.colors.inkSoft;
  const dotFill = theme.colors.textPrimary;

  /** 데이터 프렛 값 → 그리드 행(0-based). 개방·뮤트는 호출부가 걸러 온다. */
  const rowOf = (fret: number) => absoluteFret(fret, position.baseFret) - position.baseFret;

  /* 바레 — 데이터에만 있는 정보다(계산 방식에는 없었다). `barres` 는 **실제 프렛
   * 번호**이고, 그 프렛을 누르는 현 중 가장 바깥 두 개를 잇는 굵은 선으로 그린다. */
  const barreBars = position.barres.map((barreFret) => {
    const cols = position.frets
      .map((f, i) => (f >= 0 && absoluteFret(f, position.baseFret) === barreFret ? i : -1))
      .filter((i) => i >= 0);
    if (cols.length < 2) return null;
    return { fret: barreFret, from: Math.min(...cols), to: Math.max(...cols) };
  }).filter((b): b is { fret: number; from: number; to: number } => b !== null);

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
          {position.baseFret}
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

      {/* 바레 — 도트보다 먼저 깔아 도트가 위에 오게 한다 */}
      {barreBars.map((b) => {
        /* `barres` 는 **이미 절대 프렛**이라 baseFret 만 빼면 행이 된다
         * (rowOf 는 데이터의 상대 프렛 값을 받으므로 여기 쓰면 두 번 변환된다). */
        const y = gy + (b.fret - position.baseFret + 0.5) * rowGap;
        return (
          <line key={`b${b.fret}`}
            x1={gx + b.from * colGap} y1={y}
            x2={gx + b.to * colGap}   y2={y}
            stroke={dotFill} strokeWidth={Math.min(colGap * 0.5, 6)} strokeLinecap="round" />
        );
      })}

      {/* 마커(×/○) + 프렛 도트 */}
      {position.frets.map((fret, i) => {
        const cx = gx + i * colGap;          // 6번줄이 왼쪽 — 데이터 순서 그대로
        if (fret < 0) {
          return (
            <text key={`m${i}`} x={cx} y={gy - 2.5} fontSize={7.5} fontWeight={600}
              textAnchor="middle" fill={strokeMain} fontFamily="'Pretendard', sans-serif">×</text>
          );
        }
        if (absoluteFret(fret, position.baseFret) === 0) {
          return <circle key={`m${i}`} cx={cx} cy={gy - 5} r={2.4} fill="none" stroke={strokeMain} strokeWidth={1} />;
        }
        return (
          <circle key={`m${i}`} cx={cx} cy={gy + (rowOf(fret) + 0.5) * rowGap}
            r={Math.min(colGap * 0.34, 4.4)} fill={dotFill} />
        );
      })}
    </svg>
  );
}
