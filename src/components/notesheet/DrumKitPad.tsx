/* ─────────────────────────────────────────────────────────────────────────
 * DrumKitPad — 드럼 파트 입력용 킷 사진 팔레트.
 *
 * `public/EditorDrum.png`(탑다운 5피스 킷 사진, 1536×1024) 위에 투명 히트존을
 * 얹었다. **그 자리를 누르면** 악보에 입력되고 소리가 난다(드럼 소프트웨어의
 * 클릭 킷과 같은 방식). 마우스를 올리면 그 부위가 밝게 표시되고, 커서 옆
 * 말풍선으로 어떤 소리가 입력될지 클릭 전에 알려준다.
 *
 * 한 악기에 두 소리가 나는 곳은 실제 타격 위치로 영역을 나눴다:
 *   · 스네어 헤드=스네어 / 테두리(림)=림샷
 *   · 라이드 보우=라이드 / 가운데 벨=라이드 벨
 *   · 하이햇 안쪽 보우=닫힘 / 바깥 에지=열림
 *
 * 조각(무엇을 저장/재생할지)은 DRUM_PALETTE 가 단일 출처다. 이 파일은 그 조각이
 * 사진 어디에 있는지(KIT 좌표)만 안다. 사진을 바꾸면 KIT 만 다시 잰다.
 *
 * 높이는 피아노 건반(210 × scale 1.28 ≈ 269px)에 맞췄다 — 멜로디 파트와
 * 드럼 파트를 오갈 때 아래 악보가 들썩이지 않아야 한다.
 * ──────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { DRUM_PALETTE, type DrumPaletteItem } from '../../lib/note/drumNotation';
import { preloadDrumKit } from '../../lib/note/drumAudition';

/* ── 사진 좌표 (EditorDrum.png 원본 픽셀 1536×1024) ──────────────────── */
const IMG_W = 1536;
const IMG_H = 1024;
const IMG_SRC = '/EditorDrum.png';

/* ⚠ 눈대중 금지 — 아래 값은 사진 픽셀을 색 마스크(심벌=금색·헤드=밝은 회백색)로
 * 방사형 에지 탐색 + 타원 최소제곱 피팅해 얻고, 오버레이 이미지로 육안 검수까지
 * 마친 **실측 타원**이다. 사진을 바꾸면 같은 절차로 다시 잰다(halo·크롬 반사가
 * 단순 bbox 를 크게 왜곡하므로 마스크 실측이 필수). */
/* 2026-08-02 재실측(알파 인식): 이 PNG 는 배경이 **투명**(alpha 0)이고 그
 * 자리에 옛 배경 RGB(회색·금색 글로우)가 잔상으로 남아 있다. 알파를 무시하고
 * 색만 보면 화면에 안 보이는 글로우까지 부위로 잡혀 존이 좌상단으로 밀린다 —
 * 그래서 마스크에 alpha>128 을 필수로 걸고, 색 마스크(심벌 sat>0.4·R−B>70 /
 * 헤드 V>168·sat<0.2) → 연결 성분 bbox → 흰 배경 합성 오버레이로 육안 검수. */
const KIT = {
  crash:  { cx: 377,  cy: 142, rx: 155, ry: 90 },
  hihat:  { cx: 408,  cy: 346, rx: 122, ry: 58 },
  tomHi:  { cx: 645,  cy: 236, rx: 89,  ry: 72 },
  tomMid: { cx: 913,  cy: 238, rx: 95,  ry: 78 },
  ride:   { cx: 1286, cy: 218, rx: 195, ry: 120, rot: 3, bellCx: 1292, bellCy: 172, bellRx: 48, bellRy: 34 },
  snare:  { cx: 482,  cy: 524, rx: 108, ry: 68 },
  kick:   { cx: 783,  cy: 582, rx: 131, ry: 99 },
  tomLow: { cx: 1116, cy: 521, rx: 139, ry: 85 },
} as const;

/** 스네어 림(금속 후프) 바깥 배율 — 헤드 실측 타원 기준. */
const SNARE_RIM_OUT = 1.12;

/** 스네어 헤드(안) 존 비율 — 실측 헤드 타원의 안쪽. 그 밖 ~ 후프(×1.12)가 림. */
const SNARE_HEAD = 0.94;
/** 하이햇 보우(안쪽=닫힘) 대 에지(바깥=열림) 경계 비율. */
const HIHAT_BOW = 0.66;

type Piece = DrumPaletteItem['piece'];

const BY_PIECE = new Map(DRUM_PALETTE.map((d) => [d.piece, d]));

/** 부위별 짧은 힌트 — 커서 말풍선에 이름과 함께 보여준다. */
const ZONE_HINT: Partial<Record<Piece, string>> = {
  'rim': '스네어 테두리를 치면 림샷',
  'ride-bell': '라이드 가운데 컵 = 벨',
  'hihat-open': '하이햇 바깥 에지 = 열림',
  'hihat-closed': '하이햇 안쪽 보우 = 닫힘',
};

/** 타원 한 바퀴 패스. */
function ringPath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
}

/** 도넛(고리) 패스 — evenodd 로 안쪽을 뚫는다. 림·에지 존과 하이라이트에 쓴다. */
function donut(cx: number, cy: number, rxO: number, ryO: number, rxI: number, ryI: number): string {
  return `${ringPath(cx, cy, rxO, ryO)} ${ringPath(cx, cy, rxI, ryI)}`;
}

interface Props {
  /** 패드를 눌렀을 때 — 악보 입력은 호출부가 담당한다(소리는 handleNotePress 쪽). */
  onHit: (item: DrumPaletteItem) => void;
}

export function DrumKitPad({ onHit }: Props) {
  const [hover, setHover] = useState<Piece | null>(null);
  const [flash, setFlash] = useState<{ piece: Piece; n: number } | null>(null);
  /* 커서 말풍선 좌표 — Wrap 기준 px(SVG 스케일과 무관). */
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* 샘플 13개(~6MB)를 미리 받아 둔다 — 첫 타부터 소리가 나야 한다. */
  useEffect(() => { void preloadDrumKit(); }, []);

  const hoverItem = hover ? BY_PIECE.get(hover) ?? null : null;

  /** 존 모양 — 하이라이트·플래시 링이 함께 쓴다. */
  const zoneShape = useMemo(() => {
    const z: Record<string, { cx: number; cy: number; rx: number; ry: number; rot?: number }> = {
      kick: { cx: KIT.kick.cx, cy: KIT.kick.cy, rx: KIT.kick.rx, ry: KIT.kick.ry },
      snare: { cx: KIT.snare.cx, cy: KIT.snare.cy, rx: KIT.snare.rx * SNARE_HEAD, ry: KIT.snare.ry * SNARE_HEAD },
      rim: { cx: KIT.snare.cx, cy: KIT.snare.cy, rx: KIT.snare.rx * SNARE_RIM_OUT, ry: KIT.snare.ry * SNARE_RIM_OUT },
      'tom-high': { cx: KIT.tomHi.cx, cy: KIT.tomHi.cy, rx: KIT.tomHi.rx, ry: KIT.tomHi.ry },
      'tom-mid': { cx: KIT.tomMid.cx, cy: KIT.tomMid.cy, rx: KIT.tomMid.rx, ry: KIT.tomMid.ry },
      'tom-low': { cx: KIT.tomLow.cx, cy: KIT.tomLow.cy, rx: KIT.tomLow.rx, ry: KIT.tomLow.ry },
      'hihat-closed': { cx: KIT.hihat.cx, cy: KIT.hihat.cy, rx: KIT.hihat.rx * HIHAT_BOW, ry: KIT.hihat.ry * HIHAT_BOW },
      'hihat-open': { cx: KIT.hihat.cx, cy: KIT.hihat.cy, rx: KIT.hihat.rx, ry: KIT.hihat.ry },
      ride: { cx: KIT.ride.cx, cy: KIT.ride.cy, rx: KIT.ride.rx, ry: KIT.ride.ry, rot: KIT.ride.rot },
      'ride-bell': { cx: KIT.ride.bellCx, cy: KIT.ride.bellCy, rx: KIT.ride.bellRx, ry: KIT.ride.bellRy },
      crash: { cx: KIT.crash.cx, cy: KIT.crash.cy, rx: KIT.crash.rx, ry: KIT.crash.ry },
    };
    return z;
  }, []);

  const hit = (piece: Piece) => {
    const item = BY_PIECE.get(piece);
    if (!item) return;
    onHit(item);
    setFlash((prev) => ({ piece, n: (prev?.n ?? 0) + 1 }));
  };

  /* 말풍선은 Wrap 기준 좌표로 커서를 따라다닌다. */
  const trackTip = (e: React.PointerEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const handlers = (piece: Piece) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); hit(piece); },
    onPointerEnter: () => setHover(piece),
    onPointerMove: trackTip,
    onPointerLeave: () => { setHover((h) => (h === piece ? null : h)); setTip(null); },
  });

  /** 원판 타격면 — 누르는 순간(pointerdown) 반응해야 드럼처럼 느껴진다. */
  const disc = (piece: Piece, s: { cx: number; cy: number; rx: number; ry: number; rot?: number }) => (
    <ellipse
      key={piece} className="hit" fill="transparent"
      cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry}
      transform={s.rot ? `rotate(${s.rot} ${s.cx} ${s.cy})` : undefined}
      {...handlers(piece)}
    />
  );

  /** 고리 타격면(림·에지) — evenodd 도넛이라 안쪽은 아래 존이 받는다. */
  const ring = (piece: Piece, cx: number, cy: number, rxO: number, ryO: number, rxI: number, ryI: number) => (
    <path key={piece} className="hit" fill="transparent" fillRule="evenodd" d={donut(cx, cy, rxO, ryO, rxI, ryI)} {...handlers(piece)} />
  );

  const hoverShape = hover ? zoneShape[hover] : null;
  const flashShape = flash ? zoneShape[flash.piece] : null;

  /* 사진의 빈 배경을 잘라내는 크롭 viewBox — 킷이 차지하는 영역만 보여줘
   * 같은 렌더 높이에서도 킷이 훨씬 크게 나온다. 존 좌표계(원본 픽셀)는 그대로다. */
  const CROP = { x: 140, y: 18, w: 1372, h: 952 };

  return (
    <Wrap ref={wrapRef}>
      <Svg viewBox={`${CROP.x} ${CROP.y} ${CROP.w} ${CROP.h}`} role="group" aria-label="드럼 킷 입력 패드">
        <image href={IMG_SRC} x="0" y="0" width={IMG_W} height={IMG_H} />

        {/* 호버 하이라이트 — 히트존 아래 레이어(pointer-events 없음).
            림·에지·라이드 보우 같은 고리 존은 고리 모양 그대로 밝힌다. */}
        {hover === 'rim' ? (
          <path className="glow" fillRule="evenodd" d={donut(KIT.snare.cx, KIT.snare.cy, KIT.snare.rx * SNARE_RIM_OUT, KIT.snare.ry * SNARE_RIM_OUT, KIT.snare.rx * SNARE_HEAD, KIT.snare.ry * SNARE_HEAD)} />
        ) : hover === 'hihat-open' ? (
          <path className="glow" fillRule="evenodd" d={donut(KIT.hihat.cx, KIT.hihat.cy, KIT.hihat.rx, KIT.hihat.ry, KIT.hihat.rx * HIHAT_BOW, KIT.hihat.ry * HIHAT_BOW)} />
        ) : hover === 'ride' ? (
          /* 판은 3° 기울어진 타원, 벨 구멍은 판 중심보다 위 — 회전 그룹으로 감싼다
           * (벨 구멍이 그룹 회전으로 ~1px 밀리는 건 육안 무시 수준). */
          <g transform={`rotate(${KIT.ride.rot} ${KIT.ride.cx} ${KIT.ride.cy})`}>
            <path className="glow" fillRule="evenodd" d={
              `${ringPath(KIT.ride.cx, KIT.ride.cy, KIT.ride.rx, KIT.ride.ry)} ${ringPath(KIT.ride.bellCx, KIT.ride.bellCy, KIT.ride.bellRx, KIT.ride.bellRy)}`
            } />
          </g>
        ) : hoverShape ? (
          <ellipse
            className="glow"
            cx={hoverShape.cx} cy={hoverShape.cy} rx={hoverShape.rx} ry={hoverShape.ry}
            transform={hoverShape.rot ? `rotate(${hoverShape.rot} ${hoverShape.cx} ${hoverShape.cy})` : undefined}
          />
        ) : null}

        {/* ── 히트존 — 서브존(림·에지·벨)이 위 레이어 ── */}
        {disc('crash', zoneShape.crash)}
        {disc('tom-high', zoneShape['tom-high'])}
        {disc('tom-mid', zoneShape['tom-mid'])}
        {disc('tom-low', zoneShape['tom-low'])}
        {disc('kick', zoneShape.kick)}
        {disc('snare', zoneShape.snare)}
        {ring('rim', KIT.snare.cx, KIT.snare.cy, KIT.snare.rx * SNARE_RIM_OUT, KIT.snare.ry * SNARE_RIM_OUT, KIT.snare.rx * SNARE_HEAD, KIT.snare.ry * SNARE_HEAD)}
        {disc('hihat-closed', zoneShape['hihat-closed'])}
        {ring('hihat-open', KIT.hihat.cx, KIT.hihat.cy, KIT.hihat.rx, KIT.hihat.ry, KIT.hihat.rx * HIHAT_BOW, KIT.hihat.ry * HIHAT_BOW)}
        {disc('ride', zoneShape.ride)}
        {disc('ride-bell', zoneShape['ride-bell'])}

        {flash && flashShape && (
          <ellipse key={flash.n} className="flash"
            cx={flashShape.cx} cy={flashShape.cy} rx={flashShape.rx} ry={flashShape.ry}
            transform={flashShape.rot ? `rotate(${flashShape.rot} ${flashShape.cx} ${flashShape.cy})` : undefined} />
        )}
      </Svg>

      {/* 커서 말풍선 — 무엇이 입력될지 클릭 전에 알려준다. */}
      {hoverItem && tip && (
        <Tip style={{ left: tip.x + 14, top: tip.y - 36 }}>
          <b>{hoverItem.label}</b>
          {ZONE_HINT[hoverItem.piece as Piece] && <span>{ZONE_HINT[hoverItem.piece as Piece]}</span>}
        </Tip>
      )}

      <Readout>
        {hoverItem ? (
          <><b>{hoverItem.label}</b><span> · GM {hoverItem.gm} · 누르면 악보에 입력되고 소리가 납니다</span></>
        ) : (
          <span className="dim">스네어 테두리 = 림샷 · 라이드 중앙 = 벨 · 하이햇 바깥 = 열린 하이햇</span>
        )}
      </Readout>
    </Wrap>
  );
}

/* ── styles ──────────────────────────────────────────────────────────── */

const flashPop = keyframes`
  0%   { opacity: 0.9; transform: scale(0.74); }
  100% { opacity: 0;   transform: scale(1.2); }
`;

const Wrap = styled.div`
  position: relative;   /* 커서 말풍선(Tip)의 기준 */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 10px 0;
  min-width: 0;
`;

const Svg = styled.svg`
  /* 드럼 킷은 건반보다 훨씬 크게 — 부위 히트존을 정확히 누를 수 있어야 한다.
   * (파트 전환 시 악보 높이가 달라지는 건 감수 — 사용자 요청으로 크기 우선.) */
  height: 430px;
  width: auto;
  max-width: 100%;
  display: block;
  touch-action: manipulation;
  border-radius: 10px;

  .glow {
    fill: rgba(255, 244, 200, 0.32);
    stroke: rgba(255, 214, 110, 0.95);
    stroke-width: 4;
    pointer-events: none;
  }

  .hit { cursor: pointer; }

  .flash {
    fill: none;
    stroke: #ffe89a;
    stroke-width: 9;
    transform-box: fill-box;
    transform-origin: center;
    animation: ${flashPop} 0.32s ease-out forwards;
    pointer-events: none;
  }
`;

/* 커서 옆 말풍선 — 어떤 부위인지 클릭 전에 보여준다. */
const Tip = styled.div`
  position: absolute;
  z-index: 5;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px 9px;
  border-radius: 8px;
  background: rgba(24, 24, 28, 0.92);
  color: #fff;
  white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);

  b { font-size: 0.74rem; font-weight: 800; line-height: 1.2; }
  span { font-size: 0.62rem; color: #cfcfd6; line-height: 1.2; }
`;

const Readout = styled.div`
  font-size: 0.72rem;
  color: #555;
  height: 15px;
  line-height: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;

  b { font-weight: 800; color: #222; }
  span { color: #888; }
  .dim { color: #a0a0a8; }
`;
