import { useState, useEffect, useRef, type ReactNode } from 'react';
import styled, { keyframes, createGlobalStyle } from 'styled-components';

/* ─────────────────────────────────────────────────────────────────────────
 * IntroPage — Jazzify 공개 소개/홍보 랜딩 페이지 (/intro)
 *
 * 실서비스 앱 셸과 완전히 분리된 독립 페이지. 메인 네비게이션/사이드바
 * 어디에서도 링크하지 않으며, 직접 URL(#/intro)로만 접근한다. langflix.io
 * 의 섹션 흐름 + irealpro.com 의 "실제 제품 화면을 그대로 보여주는" 접근을
 * 참고했다. 앱 스크린샷 대신 CSS 로 핵심 화면(코드 차트 / 피아노 / AI 채팅 /
 * 파형 채보)을 목업으로 재현해 의존성 없이 동작한다.
 *
 * 한국어 / English 토글을 지원한다 — 모든 카피는 COPY 객체에 ko/en 으로 보관.
 * ──────────────────────────────────────────────────────────────────────── */

/* ── 팔레트 ──────────────────────────────────────────────────────────── */
const C = {
  gold: '#D4A843',
  goldDark: '#B8860B',
  goldSoft: '#E8C97A',
  ink: '#13110D',            // 거의 검정에 가까운 따뜻한 잉크
  inkSoft: '#2A2620',
  teal: '#163239',           // 앱 아이콘 배경 딥틸
  tealDeep: '#0E2329',
  cream: '#F8F5EF',          // 따뜻한 크림 배경
  creamCard: '#FFFFFF',
  line: '#E7E0D4',
  textOnDark: '#F4EFE6',
  textOnDarkDim: 'rgba(244, 239, 230, 0.62)',
  textPrimary: '#1A1A1A',
  textSecondary: '#6E6A62',
  // 화성 기능 색 (실제 앱 theme 와 동일)
  tonic: '#2D8F5E',
  subdom: '#7B5EA7',
  dominant: '#C45C5C',
};

const FONT_UI = "'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif";
const FONT_CHORD = "'MuseJazz Text', 'Noto Serif', serif";
const FONT_SERIF = "'Noto Serif', serif";

/* ── 카피 (ko / en) ──────────────────────────────────────────────────── */
type Lang = 'ko' | 'en';

const COPY = {
  ko: {
    nav: { features: '기능', how: '시작하기', tools: '도구', launch: '웹에서 시작' },
    hero: {
      badge: '재즈를 위한 올인원 연습 스튜디오',
      title1: '재즈, ',
      titleAccent: '눈으로 듣다',
      title2: '.',
      sub: '코드 진행을 분석하고, 멜로디를 해부하고, AI에게 화성학을 물어보세요. 1,460곡의 재즈 스탠다드와 함께, 연습이 끝나는 지점을 옮겨 드립니다.',
      ctaPrimary: '웹에서 무료로 시작',
      ctaSecondary: 'App Store',
      ctaNote: '설치 없이 브라우저에서 바로 — iOS 앱도 준비 중',
    },
    stats: [
      { n: '1,460+', l: '재즈 스탠다드' },
      { n: '12 keys', l: '전조 연습' },
      { n: '7', l: '연습 도구' },
      { n: 'AI', l: '실시간 재즈 튜터' },
    ],
    featuresHead: {
      kicker: 'WHAT YOU GET',
      title: '연습에 필요한 모든 것, 한 곳에',
      sub: '흩어진 앱과 PDF를 오가지 마세요. 분석부터 채보, 연습, 작보까지 Jazzify 안에서 끝납니다.',
    },
    features: [
      { icon: '𝄢', title: '코드 분석', desc: 'ii–V–I, 세컨더리 도미넌트, 모달 인터체인지를 색으로 한눈에. 화성 기능이 보입니다.' },
      { icon: '♪', title: '노트 분석', desc: '멜로디 한 음 한 음이 어떤 코드 톤·텐션·어보이드인지 피아노 위에서 짚어 드려요.' },
      { icon: '🎷', title: '릭 데이터베이스', desc: '명연주에서 뽑아낸 릭을 12키로 옮겨 가며 손에 익히세요.' },
      { icon: '🎺', title: '솔로 데이터베이스', desc: '전설적인 솔로를 채보·분석된 형태로. 프레이즈가 어떻게 굴러가는지 따라가세요.' },
      { icon: '✎', title: '에디터', desc: '리드시트와 솔로를 직접 작보하고 편집. 그대로 PDF 로 뽑아냅니다.' },
      { icon: '▶', title: 'YouTube 채보', desc: '유튜브 영상의 온셋을 자동으로 잡아 리듬·프레이즈를 악보로 옮깁니다.' },
      { icon: '📄', title: 'OMR 악보 인식', desc: '종이/이미지 악보를 찍어 올리면 디지털 리드시트로 변환합니다.' },
    ],
    deep: {
      chord: {
        kicker: '코드 분석',
        title: '코드가 아니라, 화성의 흐름을 봅니다',
        desc: '모든 코드에 기능을 입혀 색으로 칠합니다. 토닉은 초록, 서브도미넌트는 보라, 도미넌트는 빨강 — ii–V–I 가 어디서 시작해 어디로 풀리는지 한눈에 들어옵니다.',
        bullets: ['ii–V–I 자동 감지 & 브라켓', '세컨더리 도미넌트 / 트라이톤 대리', '모달 인터체인지 하이라이트'],
      },
      note: {
        kicker: '노트 분석',
        title: '이 음이 왜 여기 있는지, 피아노 위에서',
        desc: '멜로디의 각 음을 현재 코드에 비춰 코드 톤·텐션·어보이드 노트로 분류합니다. 솔로를 분석하면 "왜 좋게 들리는지"가 보이기 시작합니다.',
        bullets: ['코드 톤 / 텐션 / 어보이드 색 구분', '실시간 사운드 재생', '키 전조 즉시 반영'],
      },
      ai: {
        kicker: 'AI 재즈 튜터',
        title: '화성학 질문에, 악보로 답하는 AI',
        desc: '"이 진행 왜 이렇게 들려?", "여기 대신 쓸 수 있는 코드는?" — 물어보면 이론과 예시를 함께 설명합니다. 코드를 골라 바로 질문에 붙일 수도 있어요.',
        bullets: ['선택한 코드 첨부 후 질문', '악보·이미지·PDF 첨부 분석', '재즈 이론에 특화된 답변'],
      },
      youtube: {
        kicker: 'YouTube 채보 · 에디터',
        title: '귀로 따던 것을, 자동으로 악보에',
        desc: '유튜브 링크만 넣으면 온셋 감지로 리듬을 잡아 줍니다. 에디터에서 다듬어 12키 연습용 리드시트나 PDF 로 완성하세요.',
        bullets: ['온셋 자동 감지 채보', '리드시트 / 솔로 작보 에디터', '한 번에 PDF 내보내기'],
      },
    },
    how: {
      kicker: 'HOW IT WORKS',
      title: '세 단계면 충분합니다',
      steps: [
        { n: '01', t: '곡을 고르거나 올리세요', d: '1,460곡 스탠다드에서 고르거나, 유튜브 링크·악보 이미지를 던지세요.' },
        { n: '02', t: '분석을 켜세요', d: '코드 기능과 멜로디 노트가 색으로 살아납니다. 궁금하면 AI 에게 물어보고요.' },
        { n: '03', t: '연습하고 내보내세요', d: '12키로 옮겨 손에 익히고, 완성한 악보는 PDF 로 뽑아냅니다.' },
      ],
    },
    finalCta: {
      title: '오늘 연습, Jazzify 와 함께 시작하세요',
      sub: '회원가입 없이 웹에서 바로. 마음에 들면 App Store 에서도 만나요.',
      primary: '웹에서 무료로 시작',
      secondary: 'App Store 에서 보기',
    },
    footer: { tagline: '재즈를 위한 올인원 연습 스튜디오', rights: '© 2026 Jazzify. All rights reserved.', made: '재즈를 사랑하는 마음으로 만들었습니다.' },
  },
  en: {
    nav: { features: 'Features', how: 'How it works', tools: 'Tools', launch: 'Launch web app' },
    hero: {
      badge: 'The all-in-one practice studio for jazz',
      title1: 'See the music ',
      titleAccent: 'you hear',
      title2: '.',
      sub: 'Analyze chord progressions, dissect melodies, and ask an AI about harmony. With 1,460 jazz standards on hand, Jazzify moves where your practice ends.',
      ctaPrimary: 'Start free on the web',
      ctaSecondary: 'App Store',
      ctaNote: 'Right in your browser, no install — iOS app coming soon',
    },
    stats: [
      { n: '1,460+', l: 'Jazz standards' },
      { n: '12 keys', l: 'Transpose drills' },
      { n: '7', l: 'Practice tools' },
      { n: 'AI', l: 'Live jazz tutor' },
    ],
    featuresHead: {
      kicker: 'WHAT YOU GET',
      title: 'Everything you practice with, in one place',
      sub: 'Stop juggling apps and PDFs. Analysis, transcription, drilling and notation all live inside Jazzify.',
    },
    features: [
      { icon: '𝄢', title: 'Chord Analysis', desc: 'ii–V–I, secondary dominants and modal interchange in color. See the harmonic function at a glance.' },
      { icon: '♪', title: 'Note Analysis', desc: 'For every melody note, see whether it is a chord tone, tension or avoid note — right on the keyboard.' },
      { icon: '🎷', title: 'Lick Database', desc: 'Take licks pulled from great players and drill them through all 12 keys.' },
      { icon: '🎺', title: 'Solo Database', desc: 'Legendary solos, transcribed and analyzed. Follow exactly how the phrases unfold.' },
      { icon: '✎', title: 'Editor', desc: 'Write and edit your own lead sheets and solos, then export straight to PDF.' },
      { icon: '▶', title: 'YouTube Transcribe', desc: 'Auto-detect onsets in any YouTube video and turn the rhythm into notation.' },
      { icon: '📄', title: 'OMR', desc: 'Snap a paper or image score and convert it into a digital lead sheet.' },
    ],
    deep: {
      chord: {
        kicker: 'CHORD ANALYSIS',
        title: 'See the flow of harmony, not just chords',
        desc: 'Every chord is colored by function — tonic green, subdominant purple, dominant red. You instantly see where each ii–V–I starts and how it resolves.',
        bullets: ['Automatic ii–V–I detection & brackets', 'Secondary dominants / tritone subs', 'Modal interchange highlighting'],
      },
      note: {
        kicker: 'NOTE ANALYSIS',
        title: 'Why each note belongs — on the keyboard',
        desc: 'Each melody note is measured against the current chord and sorted into chord tone, tension or avoid note. Analyze a solo and you start to see why it sounds good.',
        bullets: ['Chord tone / tension / avoid coloring', 'Real-time sound playback', 'Instant key transposition'],
      },
      ai: {
        kicker: 'AI JAZZ TUTOR',
        title: 'An AI that answers harmony with notation',
        desc: '"Why does this progression sound this way?" "What can I play instead here?" — ask and get theory plus examples. You can even attach the chords you picked.',
        bullets: ['Attach selected chords to your question', 'Analyze attached scores, images & PDFs', 'Answers tuned for jazz theory'],
      },
      youtube: {
        kicker: 'YOUTUBE & EDITOR',
        title: 'Turn what you transcribe by ear into a score',
        desc: 'Drop a YouTube link and onset detection captures the rhythm. Refine it in the editor and finish as a 12-key practice sheet or a PDF.',
        bullets: ['Automatic onset-based transcription', 'Lead sheet / solo notation editor', 'One-click PDF export'],
      },
    },
    how: {
      kicker: 'HOW IT WORKS',
      title: 'Three steps is all it takes',
      steps: [
        { n: '01', t: 'Pick or upload a tune', d: 'Choose from 1,460 standards, or throw in a YouTube link or a score image.' },
        { n: '02', t: 'Turn on analysis', d: 'Chord functions and melody notes come alive in color. Ask the AI whenever you are curious.' },
        { n: '03', t: 'Drill and export', d: 'Transpose through 12 keys to internalize it, then export your sheet as PDF.' },
      ],
    },
    finalCta: {
      title: "Start today's session with Jazzify",
      sub: 'Right in your browser, no sign-up. Love it? Find us on the App Store too.',
      primary: 'Start free on the web',
      secondary: 'View on App Store',
    },
    footer: { tagline: 'The all-in-one practice studio for jazz', rights: '© 2026 Jazzify. All rights reserved.', made: 'Made with love for jazz.' },
  },
} as const;

/* ── 애니메이션 ──────────────────────────────────────────────────────── */
const fadeUp = keyframes`from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); }`;
const floaty = keyframes`0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); }`;
const shimmer = keyframes`0% { background-position: -200% center; } 100% { background-position: 200% center; }`;

/* 스크롤 진입 시 페이드업. IntersectionObserver 로 .in 클래스 부여. */
const Reveal = styled.div<{ $delay?: number }>`
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
  transition-delay: ${({ $delay }) => $delay ?? 0}ms;
  &.in { opacity: 1; transform: translateY(0); }
`;

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }),
      { threshold: 0.12 },
    );
    el.querySelectorAll('[data-reveal]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return ref;
}

/* ── 페이지 전역 ─────────────────────────────────────────────────────── */
/* 앱 전역(global.ts)은 body overflow:hidden + #root 100vh 로 잠겨 있다.
 * 그 순서 싸움을 하지 않고, 아래 Page 가 #root 를 꽉 채우는 자체 스크롤
 * 컨테이너로 동작한다. body 배경만 크림으로 맞춰 오버스크롤 시 흰 띠를 막는다. */
const IntroGlobal = createGlobalStyle`
  body { background: ${C.cream}; }
`;

/* ── 레이아웃 ────────────────────────────────────────────────────────── */
const Page = styled.div<{ $lang: Lang }>`
  /* 디스플레이(제목) 폰트: 한국어는 Pretendard(세리프 한글 깨짐 방지),
   * 영어는 Noto Serif 로 재즈 무드를 살린다. 본문은 항상 Pretendard. */
  --font-display: ${({ $lang }) => ($lang === 'ko' ? FONT_UI : FONT_SERIF)};
  /* 한글 이탤릭은 합성 기울임이라 어색하고 글자 끝이 잘려 normal 로 둔다. */
  --accent-style: ${({ $lang }) => ($lang === 'ko' ? 'normal' : 'italic')};
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  font-family: ${FONT_UI};
  color: ${C.textPrimary};
  background: ${C.cream};
  -webkit-font-smoothing: antialiased;
`;

const Section = styled.section<{ $dark?: boolean; $pad?: string }>`
  padding: ${({ $pad }) => $pad ?? '110px 24px'};
  background: ${({ $dark }) => ($dark ? 'transparent' : 'transparent')};
  @media (max-width: 768px) { padding: 72px 20px; }
`;

const Inner = styled.div`
  max-width: 1140px;
  margin: 0 auto;
`;

/* ── 네비게이션 ──────────────────────────────────────────────────────── */
const Nav = styled.header<{ $scrolled: boolean }>`
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  height: 68px;
  backdrop-filter: saturate(180%) blur(14px);
  background: ${({ $scrolled }) => ($scrolled ? 'rgba(248,245,239,0.82)' : 'rgba(248,245,239,0)')};
  border-bottom: 1px solid ${({ $scrolled }) => ($scrolled ? C.line : 'transparent')};
  transition: background 0.3s, border-color 0.3s;
  @media (max-width: 768px) { padding: 0 18px; height: 60px; }
`;
const NavBrand = styled.button`
  display: flex; align-items: center; gap: 10px;
  background: none; border: none; cursor: pointer; padding: 0;
  img { height: 30px; width: auto; display: block; }
  @media (max-width: 768px) { img { height: 26px; } }
`;
const NavRight = styled.nav`
  display: flex; align-items: center; gap: 28px;
  a { color: ${C.textSecondary}; text-decoration: none; font-size: 0.92rem; font-weight: 500; transition: color 0.15s; cursor: pointer; }
  a:hover { color: ${C.ink}; }
  @media (max-width: 860px) { gap: 14px; a:not(.keep) { display: none; } }
`;
const LangToggle = styled.button`
  display: flex; align-items: center; gap: 5px;
  border: 1px solid ${C.line}; background: ${C.creamCard};
  border-radius: 999px; padding: 6px 12px; cursor: pointer;
  font-family: ${FONT_UI}; font-size: 0.8rem; font-weight: 700; color: ${C.ink};
  letter-spacing: 0.02em; transition: border-color 0.15s, transform 0.1s;
  &:hover { border-color: ${C.gold}; }
  &:active { transform: scale(0.96); }
`;
const NavCta = styled.a`
  display: inline-flex !important; align-items: center; gap: 7px;
  background: ${C.ink}; color: #fff !important; padding: 9px 18px;
  border-radius: 999px; font-weight: 600 !important; font-size: 0.88rem !important;
  transition: transform 0.12s, box-shadow 0.2s;
  &:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(0,0,0,0.18); color: ${({ theme }) => theme.colors.surface} !important; }
`;

/* ── 히어로 ──────────────────────────────────────────────────────────── */
const Hero = styled.section`
  position: relative;
  background:
    radial-gradient(900px 500px at 78% -8%, rgba(212,168,67,0.18), transparent 60%),
    linear-gradient(165deg, ${C.tealDeep} 0%, ${C.teal} 46%, ${C.ink} 100%);
  color: ${C.textOnDark};
  padding: 96px 24px 110px;
  overflow: hidden;
  @media (max-width: 768px) { padding: 56px 20px 64px; }
`;
/* 배경에 흐릿하게 떠다니는 음표/오선 장식 */
const HeroDeco = styled.div`
  position: absolute; inset: 0; pointer-events: none; opacity: 0.07;
  background-image:
    repeating-linear-gradient(to bottom, transparent 0 38px, rgba(244,239,230,0.5) 38px 39px);
  mask-image: radial-gradient(700px 400px at 80% 30%, #000, transparent 75%);
`;
const HeroGrid = styled.div`
  position: relative; z-index: 2;
  max-width: 1140px; margin: 0 auto;
  display: grid; grid-template-columns: 1.02fr 0.98fr; gap: 56px; align-items: center;
  @media (max-width: 940px) { grid-template-columns: 1fr; gap: 44px; }
`;
const HeroBadge = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid rgba(232,201,122,0.4); background: rgba(212,168,67,0.1);
  color: ${C.goldSoft}; border-radius: 999px; padding: 7px 14px;
  font-size: 0.8rem; font-weight: 600; letter-spacing: 0.01em;
  animation: ${fadeUp} 0.6s ease both;
  span.dot { width: 6px; height: 6px; border-radius: 50%; background: ${C.gold}; box-shadow: 0 0 10px ${C.gold}; }
`;
const HeroTitle = styled.h1`
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(2.6rem, 6vw, 4.4rem);
  line-height: 1.04; letter-spacing: -0.02em;
  margin: 22px 0 0;
  animation: ${fadeUp} 0.6s 0.05s ease both;
`;
const HeroAccent = styled.span`
  display: inline-block;
  /* italic + background-clip:text 에서 마지막 글자 오른쪽 획이 박스 밖으로
   * 나가 잘리는 것을 막는 여유. 한글은 합성 이탤릭이라 더 크게 잡힘. */
  padding-right: 0.14em;
  background: linear-gradient(100deg, ${C.goldSoft}, ${C.gold} 40%, ${C.goldDark} 75%, ${C.goldSoft});
  background-size: 200% auto;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  animation: ${shimmer} 6s linear infinite;
  font-style: var(--accent-style);
`;
const HeroSub = styled.p`
  font-size: clamp(1rem, 1.6vw, 1.18rem); line-height: 1.65;
  color: ${C.textOnDarkDim}; max-width: 540px; margin: 22px 0 0;
  animation: ${fadeUp} 0.6s 0.12s ease both;
`;
const HeroCtas = styled.div`
  display: flex; flex-wrap: wrap; gap: 14px; margin-top: 34px;
  animation: ${fadeUp} 0.6s 0.18s ease both;
`;
const BtnPrimary = styled.a`
  display: inline-flex; align-items: center; gap: 9px;
  background: linear-gradient(135deg, ${C.gold}, ${C.goldDark});
  color: ${C.ink}; text-decoration: none; font-weight: 700; font-size: 1rem;
  padding: 15px 26px; border-radius: 999px; cursor: pointer;
  box-shadow: 0 10px 30px rgba(212,168,67,0.32);
  transition: transform 0.14s, box-shadow 0.2s;
  &:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(212,168,67,0.42); }
  &:active { transform: translateY(0); }
`;
const BtnGhost = styled.a`
  display: inline-flex; align-items: center; gap: 9px;
  background: rgba(244,239,230,0.06); color: ${C.textOnDark}; text-decoration: none;
  font-weight: 600; font-size: 1rem; padding: 15px 24px; border-radius: 999px;
  border: 1px solid rgba(244,239,230,0.22); cursor: pointer;
  transition: background 0.16s, border-color 0.16s, transform 0.14s;
  &:hover { background: rgba(244,239,230,0.12); border-color: rgba(244,239,230,0.4); transform: translateY(-2px); }
`;
const HeroNote = styled.div`
  margin-top: 16px; font-size: 0.84rem; color: ${C.textOnDarkDim};
  animation: ${fadeUp} 0.6s 0.24s ease both;
`;
const HeroVisual = styled.div`
  position: relative; z-index: 2;
  animation: ${fadeUp} 0.7s 0.2s ease both;
  @media (max-width: 940px) { max-width: 560px; margin: 0 auto; width: 100%; }
`;

/* ── 브라우저 프레임(목업 컨테이너) ──────────────────────────────────── */
const Browser = styled.div<{ $float?: boolean }>`
  background: ${C.creamCard};
  border-radius: 16px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.4), 0 4px 14px rgba(0,0,0,0.2);
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.border};
  animation: ${({ $float }) => ($float ? floaty : 'none')} 7s ease-in-out infinite;
`;
const BrowserBar = styled.div`
  display: flex; align-items: center; gap: 7px;
  padding: 11px 14px; background: ${({ theme }) => theme.colors.surfaceSunken}; border-bottom: 1px solid ${C.line};
  span { width: 11px; height: 11px; border-radius: 50%; }
  .r { background: #ED6A5E; } .y { background: #F4BF4F; } .g { background: #61C554; }
  .url { margin-left: 12px; flex: 1; height: 22px; border-radius: 6px; background: ${({ theme }) => theme.colors.surface};
    border: 1px solid ${C.line}; display: flex; align-items: center; padding: 0 10px;
    font-size: 0.7rem; color: ${C.textSecondary}; font-family: ${FONT_UI}; }
`;
const BrowserBody = styled.div`
  padding: 22px 20px; background: ${C.creamCard};
`;

/* ── 코드 차트 목업 ──────────────────────────────────────────────────── */
const ChartTitle = styled.div`
  font-family: var(--font-display); font-weight: 700; font-size: 1.05rem;
  display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; flex-wrap: wrap;
  small { font-family: ${FONT_UI}; font-weight: 500; font-size: 0.72rem; color: ${C.textSecondary}; }
`;
const ChartGrid = styled.div`
  display: grid; grid-template-columns: repeat(4, 1fr);
  border-top: 2px solid ${C.ink}; border-left: 2px solid ${C.ink};
  margin-top: 14px;
`;
const Bar = styled.div`
  border-right: 2px solid ${C.ink}; border-bottom: 2px solid ${C.ink};
  min-height: 62px; padding: 10px 8px 20px; position: relative; overflow: hidden;
`;
const Chord = styled.span<{ $fn?: 'tonic' | 'subdom' | 'dominant' }>`
  font-family: ${FONT_CHORD}; font-size: 1.16rem; color: ${C.ink};
  white-space: nowrap; position: relative; display: inline-block;
  ${({ $fn }) => $fn && `
    &::after { content: ''; position: absolute; left: -2px; right: -2px; bottom: -5px; height: 3px; border-radius: 2px;
      background: ${$fn === 'tonic' ? C.tonic : $fn === 'subdom' ? C.subdom : C.dominant}; }
  `}
`;
/* ii–V–I 브라켓 라벨 */
const Bracket = styled.div<{ $color: string }>`
  position: absolute; left: 6px; bottom: 2px; font-family: ${FONT_UI};
  font-size: 0.58rem; font-weight: 700; color: ${({ $color }) => $color}; letter-spacing: 0.04em;
`;
const Legend = styled.div`
  display: flex; gap: 16px; margin-top: 14px; flex-wrap: wrap;
  span { display: inline-flex; align-items: center; gap: 6px; font-size: 0.74rem; color: ${C.textSecondary}; font-weight: 500; }
  i { width: 12px; height: 4px; border-radius: 2px; display: inline-block; }
`;

/* ── 피아노 목업 ─────────────────────────────────────────────────────── */
const PianoWrap = styled.div`
  position: relative; display: flex; height: 130px; margin-top: 6px;
  user-select: none;
`;
const WhiteKey = styled.div<{ $hl?: 'ct' | 'tn' | 'av' }>`
  flex: 1; background: ${({ $hl }) =>
    $hl === 'ct' ? 'linear-gradient(to bottom, #fff 60%, rgba(45,143,94,0.5))'
    : $hl === 'tn' ? 'linear-gradient(to bottom, #fff 60%, rgba(212,168,67,0.55))'
    : $hl === 'av' ? 'linear-gradient(to bottom, #fff 60%, rgba(196,92,92,0.45))'
    : '#fff'};
  border: 1px solid ${({ theme }) => theme.colors.border}; border-top: none; border-radius: 0 0 5px 5px;
  position: relative; box-shadow: inset 0 -3px 4px rgba(0,0,0,0.04);
`;
const KeyLabel = styled.span`
  position: absolute; bottom: 7px; left: 0; right: 0; text-align: center;
  font-family: ${FONT_UI}; font-size: 0.6rem; font-weight: 700; color: ${C.inkSoft};
`;
const BlackKeys = styled.div`
  position: absolute; top: 0; left: 0; right: 0; height: 62%; pointer-events: none;
`;
const BlackKey = styled.div<{ $left: number }>`
  position: absolute; top: 0; left: ${({ $left }) => $left}%;
  width: 8.5%; height: 100%; background: linear-gradient(to bottom, ${({ theme }) => theme.colors.inkSurface}, #13110D);
  border-radius: 0 0 4px 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.4);
`;

/* ── AI 채팅 목업 ────────────────────────────────────────────────────── */
const ChatWrap = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const ChipRow = styled.div`display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 2px;`;
const Chip = styled.span<{ $fn?: 'tonic' | 'subdom' | 'dominant' }>`
  font-family: ${FONT_CHORD}; font-size: 0.9rem; padding: 3px 10px; border-radius: 8px;
  background: ${({ $fn }) => $fn === 'tonic' ? 'rgba(45,143,94,0.12)' : $fn === 'subdom' ? 'rgba(123,94,167,0.12)' : 'rgba(196,92,92,0.12)'};
  color: ${({ $fn }) => $fn === 'tonic' ? C.tonic : $fn === 'subdom' ? C.subdom : C.dominant};
  border: 1px solid currentColor;
`;
const BubbleUser = styled.div`
  align-self: flex-end; max-width: 80%;
  background: ${C.ink}; color: #fff; padding: 10px 14px; border-radius: 16px 16px 4px 16px;
  font-size: 0.86rem; line-height: 1.5;
`;
const BubbleAI = styled.div`
  align-self: flex-start; max-width: 88%;
  background: ${C.cream}; color: ${C.textPrimary}; padding: 12px 15px;
  border-radius: 16px 16px 16px 4px; font-size: 0.86rem; line-height: 1.62;
  border: 1px solid ${C.line};
  b { color: ${C.goldDark}; }
  .kw-t { color: ${C.tonic}; font-weight: 700; }
  .kw-d { color: ${C.dominant}; font-weight: 700; }
`;
const AiRow = styled.div`display: flex; gap: 9px; align-items: flex-start;`;
const AiAvatar = styled.div`
  flex-shrink: 0; width: 28px; height: 28px; border-radius: 8px;
  background: linear-gradient(135deg, ${C.gold}, ${C.goldDark});
  display: flex; align-items: center; justify-content: center; font-size: 0.9rem;
`;

/* ── 파형(YouTube 채보) 목업 ─────────────────────────────────────────── */
const WaveWrap = styled.div`
  background: ${C.tealDeep}; border-radius: 10px; padding: 16px; position: relative; overflow: hidden;
`;
const WaveRow = styled.div`display: flex; align-items: flex-end; gap: 2px; height: 84px;`;
const WaveBar = styled.div<{ $h: number; $on?: boolean }>`
  flex: 1; height: ${({ $h }) => $h}%; border-radius: 2px;
  background: ${({ $on }) => ($on ? C.gold : 'rgba(244,239,230,0.28)')};
  ${({ $on }) => $on && `box-shadow: 0 0 8px ${C.gold};`}
`;
const Onset = styled.div<{ $left: number }>`
  position: absolute; top: 8px; bottom: 8px; left: ${({ $left }) => $left}%;
  width: 2px; background: ${C.gold}; opacity: 0.85;
  &::before { content: '♪'; position: absolute; top: -2px; left: -5px; color: ${C.gold}; font-size: 0.7rem; }
`;

/* ── stats 스트립 ────────────────────────────────────────────────────── */
const StatStrip = styled.div`
  max-width: 1080px; width: calc(100% - 48px); margin: -44px auto 0; position: relative; z-index: 5;
  background: ${C.creamCard}; border: 1px solid ${C.line}; border-radius: 20px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.1);
  display: grid; grid-template-columns: repeat(4, 1fr);
  padding: 32px 24px;
  @media (max-width: 768px) { grid-template-columns: repeat(2, 1fr); gap: 26px 10px; width: calc(100% - 32px); margin-top: -28px; padding: 26px 18px; }
`;
const Stat = styled.div`
  text-align: center; position: relative;
  &:not(:last-child)::after { content: ''; position: absolute; right: 0; top: 12%; height: 76%; width: 1px; background: ${C.line}; }
  @media (max-width: 768px) { &:nth-child(2)::after { display: none; } }
  .n { font-family: var(--font-display); font-weight: 700; font-size: 1.8rem; color: ${C.ink};
    background: linear-gradient(135deg, ${C.goldDark}, ${C.gold}); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .l { font-size: 0.82rem; color: ${C.textSecondary}; margin-top: 4px; font-weight: 500; }
`;

/* ── 섹션 헤더 ───────────────────────────────────────────────────────── */
const Kicker = styled.div`
  font-size: 0.78rem; font-weight: 800; letter-spacing: 0.14em; color: ${C.goldDark};
  text-transform: uppercase; margin-bottom: 14px;
`;
const SecTitle = styled.h2`
  font-family: var(--font-display); font-weight: 700; letter-spacing: -0.02em;
  font-size: clamp(1.9rem, 3.6vw, 2.7rem); line-height: 1.12; margin: 0; color: ${C.ink};
`;
const SecSub = styled.p`
  font-size: 1.05rem; line-height: 1.6; color: ${C.textSecondary}; margin: 16px 0 0; max-width: 620px;
`;
const Centered = styled.div`text-align: center; & ${SecSub} { margin-left: auto; margin-right: auto; }`;

/* ── 기능 그리드 ─────────────────────────────────────────────────────── */
const FeatGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 52px;
  @media (max-width: 900px) { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;
const FeatCard = styled.div`
  background: ${C.creamCard}; border: 1px solid ${C.line}; border-radius: 16px;
  padding: 26px 22px; transition: transform 0.18s, box-shadow 0.22s, border-color 0.18s;
  &:hover { transform: translateY(-4px); box-shadow: 0 18px 40px rgba(0,0,0,0.08); border-color: ${C.goldSoft}; }
`;
const FeatIcon = styled.div`
  width: 48px; height: 48px; border-radius: 13px; display: flex; align-items: center; justify-content: center;
  font-size: 1.5rem; background: linear-gradient(135deg, rgba(212,168,67,0.16), rgba(212,168,67,0.06));
  color: ${C.goldDark}; margin-bottom: 16px;
`;
const FeatTitle = styled.h3`font-size: 1.12rem; font-weight: 700; margin: 0 0 8px; color: ${C.ink};`;
const FeatDesc = styled.p`font-size: 0.92rem; line-height: 1.62; color: ${C.textSecondary}; margin: 0;`;

/* ── 딥다이브(좌우 교차) ─────────────────────────────────────────────── */
/* 딥다이브 목록 — 각 Deep 이 Reveal 래퍼로 감싸지므로 Deep 끼리 인접
 * 선택자(& + &)가 닿지 않는다. 간격은 이 flex 컨테이너의 gap 으로 준다. */
const DeepList = styled.div`
  display: flex; flex-direction: column; gap: 128px;
  @media (max-width: 900px) { gap: 84px; }
`;
const Deep = styled.div<{ $flip?: boolean }>`
  display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center;
  & > .visual { order: ${({ $flip }) => ($flip ? 1 : 2)}; }
  & > .text { order: ${({ $flip }) => ($flip ? 2 : 1)}; }
  @media (max-width: 900px) {
    grid-template-columns: 1fr; gap: 32px;
    & > .visual { order: 2; } & > .text { order: 1; }
  }
`;
const DeepTitle = styled.h3`
  font-family: var(--font-display); font-weight: 700; letter-spacing: -0.015em;
  font-size: clamp(1.6rem, 2.8vw, 2.1rem); line-height: 1.18; margin: 12px 0 0; color: ${C.ink};
`;
const DeepDesc = styled.p`font-size: 1.02rem; line-height: 1.68; color: ${C.textSecondary}; margin: 16px 0 0;`;
const Bullets = styled.ul`
  list-style: none; margin: 22px 0 0; padding: 0; display: flex; flex-direction: column; gap: 11px;
  li { display: flex; align-items: flex-start; gap: 11px; font-size: 0.96rem; color: ${C.textPrimary}; font-weight: 500; }
  .ck { flex-shrink: 0; width: 21px; height: 21px; border-radius: 50%; background: rgba(212,168,67,0.16);
    color: ${C.goldDark}; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 800; margin-top: 1px; }
`;

/* ── HOW 3단계 ───────────────────────────────────────────────────────── */
const Steps = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: 52px;
  @media (max-width: 800px) { grid-template-columns: 1fr; gap: 16px; }
`;
const Step = styled.div`
  background: ${C.creamCard}; border: 1px solid ${C.line}; border-radius: 16px; padding: 30px 26px;
  position: relative; overflow: hidden;
  .num { font-family: var(--font-display); font-weight: 700; font-size: 2.4rem; line-height: 1;
    color: rgba(212,168,67,0.28); }
  h4 { font-size: 1.15rem; font-weight: 700; margin: 16px 0 8px; color: ${C.ink}; }
  p { font-size: 0.92rem; line-height: 1.6; color: ${C.textSecondary}; margin: 0; }
`;

/* ── 최종 CTA ────────────────────────────────────────────────────────── */
const FinalCta = styled.section`
  margin: 0 24px 90px; border-radius: 28px;
  background:
    radial-gradient(700px 360px at 50% -20%, rgba(212,168,67,0.25), transparent 60%),
    linear-gradient(160deg, ${C.teal}, ${C.ink});
  color: ${C.textOnDark}; text-align: center; padding: 80px 28px;
  max-width: 1140px; margin-left: auto; margin-right: auto;
  @media (max-width: 768px) { padding: 56px 22px; margin: 0 16px 64px; }
`;
const FinalTitle = styled.h2`
  font-family: var(--font-display); font-weight: 700; letter-spacing: -0.02em;
  font-size: clamp(1.9rem, 4vw, 2.9rem); line-height: 1.14; margin: 0;
`;
const FinalSub = styled.p`font-size: 1.08rem; color: ${C.textOnDarkDim}; margin: 18px auto 0; max-width: 520px; line-height: 1.6;`;
const FinalCtas = styled.div`display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; margin-top: 34px;`;

/* ── 푸터 ────────────────────────────────────────────────────────────── */
const Footer = styled.footer`
  border-top: 1px solid ${C.line}; padding: 44px 28px 56px;
`;
const FootInner = styled.div`
  max-width: 1140px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap;
  img { height: 26px; width: auto; }
  .tag { font-size: 0.88rem; color: ${C.textSecondary}; }
  .rights { font-size: 0.8rem; color: ${C.textSecondary}; }
`;

/* App Store 배지 (간단 SVG) */
const AppStoreBadge = ({ label }: { label: string }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
    <svg width="20" height="22" viewBox="0 0 24 28" fill="currentColor" aria-hidden>
      <path d="M17.05 14.86c-.03-2.9 2.37-4.3 2.48-4.36-1.35-1.98-3.46-2.25-4.2-2.28-1.79-.18-3.49 1.05-4.4 1.05-.9 0-2.3-1.03-3.79-1-1.95.03-3.75 1.13-4.75 2.88-2.03 3.52-.52 8.74 1.45 11.6.96 1.4 2.11 2.97 3.61 2.92 1.45-.06 2-.94 3.75-.94 1.74 0 2.24.94 3.77.9 1.56-.02 2.55-1.42 3.5-2.83 1.1-1.62 1.56-3.18 1.58-3.26-.03-.02-3.03-1.17-3.06-4.62zM14.2 6.34c.8-.97 1.33-2.32 1.18-3.66-1.15.05-2.53.77-3.35 1.73-.74.85-1.38 2.21-1.2 3.51 1.28.1 2.58-.65 3.37-1.58z"/>
    </svg>
    {label}
  </span>
);

const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z"/></svg>
);
const ArrowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
);

/* ── 메인 컴포넌트 ───────────────────────────────────────────────────── */
const APP_STORE_URL = '#'; // TODO: 실제 App Store 링크로 교체
const WEB_APP_URL = '#/';   // 웹앱 홈 (HashRouter)

export default function IntroPage() {
  const [lang, setLang] = useState<Lang>('ko');
  const [scrolled, setScrolled] = useState(false);
  const t = COPY[lang];
  const revealRef = useReveal();

  /* Page 가 자체 스크롤 컨테이너라 scroll 이벤트는 window 가 아니라 그 위에서
   * 발생한다 — 컨테이너의 scrollTop 으로 네비 그림자 효과를 토글한다. */
  useEffect(() => {
    const el = revealRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 24);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [revealRef]);

  const scrollToTop = () => revealRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  const deepData: Array<{ key: keyof typeof t.deep; flip: boolean; visual: ReactNode }> = [
    { key: 'chord', flip: false, visual: <ChordChartMock /> },
    { key: 'note', flip: true, visual: <PianoMock /> },
    { key: 'ai', flip: false, visual: <ChatMock lang={lang} /> },
    { key: 'youtube', flip: true, visual: <WaveMock /> },
  ];

  return (
    <Page $lang={lang} ref={revealRef as React.RefObject<HTMLDivElement>}>
      <IntroGlobal />

      {/* 네비게이션 */}
      <Nav $scrolled={scrolled}>
        <NavBrand onClick={scrollToTop}>
          <img src="/Jazzify-trimmed.png" alt="Jazzify" />
        </NavBrand>
        <NavRight>
          <a onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>{t.nav.features}</a>
          <a onClick={() => document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' })}>{t.nav.tools}</a>
          <a onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>{t.nav.how}</a>
          <LangToggle className="keep" onClick={() => setLang((l) => (l === 'ko' ? 'en' : 'ko'))}>
            <GlobeIcon /> {lang === 'ko' ? 'EN' : '한국어'}
          </LangToggle>
          <NavCta className="keep" href={WEB_APP_URL}>{t.nav.launch} <ArrowIcon /></NavCta>
        </NavRight>
      </Nav>

      {/* 히어로 */}
      <Hero>
        <HeroDeco />
        <HeroGrid>
          <div>
            <HeroBadge><span className="dot" />{t.hero.badge}</HeroBadge>
            <HeroTitle>
              {t.hero.title1}<HeroAccent>{t.hero.titleAccent}</HeroAccent>{t.hero.title2}
            </HeroTitle>
            <HeroSub>{t.hero.sub}</HeroSub>
            <HeroCtas>
              <BtnPrimary href={WEB_APP_URL}><PlayIcon /> {t.hero.ctaPrimary}</BtnPrimary>
              <BtnGhost href={APP_STORE_URL}><AppStoreBadge label={t.hero.ctaSecondary} /></BtnGhost>
            </HeroCtas>
            <HeroNote>{t.hero.ctaNote}</HeroNote>
          </div>
          <HeroVisual>
            <Browser $float>
              <BrowserBar>
                <span className="r" /><span className="y" /><span className="g" />
                <div className="url">jazzify.ai / chord</div>
              </BrowserBar>
              <BrowserBody>
                <ChordChartMock />
              </BrowserBody>
            </Browser>
          </HeroVisual>
        </HeroGrid>
      </Hero>

      {/* stats */}
      <StatStrip>
        {t.stats.map((s, i) => (
          <Stat key={i}><div className="n">{s.n}</div><div className="l">{s.l}</div></Stat>
        ))}
      </StatStrip>

      {/* 기능 그리드 */}
      <Section id="features">
        <Inner>
          <Centered>
            <Reveal data-reveal><Kicker>{t.featuresHead.kicker}</Kicker></Reveal>
            <Reveal data-reveal $delay={60}><SecTitle>{t.featuresHead.title}</SecTitle></Reveal>
            <Reveal data-reveal $delay={120}><SecSub>{t.featuresHead.sub}</SecSub></Reveal>
          </Centered>
          <FeatGrid>
            {t.features.map((f, i) => (
              <Reveal key={i} data-reveal $delay={i * 60}>
                <FeatCard>
                  <FeatIcon>{f.icon}</FeatIcon>
                  <FeatTitle>{f.title}</FeatTitle>
                  <FeatDesc>{f.desc}</FeatDesc>
                </FeatCard>
              </Reveal>
            ))}
          </FeatGrid>
        </Inner>
      </Section>

      {/* 딥다이브 */}
      <Section id="tools" $pad="64px 24px 120px">
        <Inner>
          <DeepList>
          {deepData.map(({ key, flip, visual }) => {
            const d = t.deep[key];
            return (
              <Reveal key={key} data-reveal>
                <Deep $flip={flip}>
                  <div className="text">
                    <Kicker>{d.kicker}</Kicker>
                    <DeepTitle>{d.title}</DeepTitle>
                    <DeepDesc>{d.desc}</DeepDesc>
                    <Bullets>
                      {d.bullets.map((b, i) => (
                        <li key={i}><span className="ck">✓</span>{b}</li>
                      ))}
                    </Bullets>
                  </div>
                  <div className="visual">
                    <Browser>
                      <BrowserBar>
                        <span className="r" /><span className="y" /><span className="g" />
                        <div className="url">jazzify.ai</div>
                      </BrowserBar>
                      <BrowserBody>{visual}</BrowserBody>
                    </Browser>
                  </div>
                </Deep>
              </Reveal>
            );
          })}
          </DeepList>
        </Inner>
      </Section>

      {/* HOW */}
      <Section id="how" $pad="0 24px 110px">
        <Inner>
          <Centered>
            <Reveal data-reveal><Kicker>{t.how.kicker}</Kicker></Reveal>
            <Reveal data-reveal $delay={60}><SecTitle>{t.how.title}</SecTitle></Reveal>
          </Centered>
          <Steps>
            {t.how.steps.map((s, i) => (
              <Reveal key={i} data-reveal $delay={i * 80}>
                <Step>
                  <div className="num">{s.n}</div>
                  <h4>{s.t}</h4>
                  <p>{s.d}</p>
                </Step>
              </Reveal>
            ))}
          </Steps>
        </Inner>
      </Section>

      {/* 최종 CTA */}
      <Reveal data-reveal>
        <FinalCta>
          <img src="/jazzifylogo.png" alt="" style={{ width: 64, height: 64, borderRadius: 16, marginBottom: 24, boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }} />
          <FinalTitle>{t.finalCta.title}</FinalTitle>
          <FinalSub>{t.finalCta.sub}</FinalSub>
          <FinalCtas>
            <BtnPrimary href={WEB_APP_URL}><PlayIcon /> {t.finalCta.primary}</BtnPrimary>
            <BtnGhost href={APP_STORE_URL}><AppStoreBadge label={t.finalCta.secondary} /></BtnGhost>
          </FinalCtas>
        </FinalCta>
      </Reveal>

      {/* 푸터 */}
      <Footer>
        <FootInner>
          <div>
            <img src="/Jazzify-trimmed.png" alt="Jazzify" />
            <div className="tag" style={{ marginTop: 10 }}>{t.footer.tagline}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="tag" style={{ marginBottom: 6 }}>{t.footer.made}</div>
            <div className="rights">{t.footer.rights}</div>
          </div>
        </FootInner>
      </Footer>
    </Page>
  );
}

const GlobeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

/* ═══════════════════════════════════════════════════════════════════════
 * 목업 컴포넌트들 — 실제 앱 화면을 CSS 로 재현
 * ═══════════════════════════════════════════════════════════════════════ */

/* Autumn Leaves 첫 8마디 — 실제 곡 데이터의 코드 진행 그대로.
 * fn: 화성 기능(tonic/subdom/dominant) → 코드 밑줄 색. */
function ChordChartMock() {
  const bars: Array<{ c: string; fn?: 'tonic' | 'subdom' | 'dominant'; bracket?: { txt: string; color: string } }> = [
    { c: 'Cm7', fn: 'subdom', bracket: { txt: 'ii', color: C.subdom } },
    { c: 'F7', fn: 'dominant', bracket: { txt: 'V', color: C.dominant } },
    { c: 'B♭M7', fn: 'tonic', bracket: { txt: 'I', color: C.tonic } },
    { c: 'E♭M7', fn: 'subdom' },
    { c: 'Am7♭5', fn: 'subdom', bracket: { txt: 'ii°', color: C.subdom } },
    { c: 'D7', fn: 'dominant', bracket: { txt: 'V', color: C.dominant } },
    { c: 'Gm', fn: 'tonic', bracket: { txt: 'i', color: C.tonic } },
    { c: 'Gm', fn: 'tonic' },
  ];
  return (
    <div>
      <ChartTitle>Autumn Leaves <small>Key of G minor · 4/4</small></ChartTitle>
      <ChartGrid>
        {bars.map((b, i) => (
          <Bar key={i}>
            <Chord $fn={b.fn}>{b.c}</Chord>
            {b.bracket && <Bracket $color={b.bracket.color}>{b.bracket.txt}</Bracket>}
          </Bar>
        ))}
      </ChartGrid>
      <Legend>
        <span><i style={{ background: C.tonic }} /> Tonic</span>
        <span><i style={{ background: C.subdom }} /> Subdominant</span>
        <span><i style={{ background: C.dominant }} /> Dominant</span>
      </Legend>
    </div>
  );
}

/* 한 옥타브 피아노 — Cm7 코드 톤(C E♭ G B♭) 강조 + 텐션/어보이드 예시 색.
 * white key: C D E F G A B. hl: ct=코드톤(초록), tn=텐션(골드), av=어보이드(빨강) */
function PianoMock() {
  const whites: Array<{ n: string; hl?: 'ct' | 'tn' | 'av' }> = [
    { n: 'C', hl: 'ct' }, { n: 'D', hl: 'tn' }, { n: 'E' }, { n: 'F', hl: 'av' },
    { n: 'G', hl: 'ct' }, { n: 'A' }, { n: 'B' },
  ];
  // 흑건 위치(%) — C# D# (gap) F# G# A#
  const blacks = [10, 24.3, 52.9, 67.2, 81.5];
  return (
    <div>
      <ChartTitle>Note Analysis <small>over Cm7 — chord tones · tensions · avoid</small></ChartTitle>
      <PianoWrap>
        {whites.map((w, i) => (
          <WhiteKey key={i} $hl={w.hl}><KeyLabel>{w.n}</KeyLabel></WhiteKey>
        ))}
        <BlackKeys>
          {blacks.map((l, i) => <BlackKey key={i} $left={l} />)}
        </BlackKeys>
      </PianoWrap>
      <Legend>
        <span><i style={{ background: C.tonic }} /> Chord tone</span>
        <span><i style={{ background: C.gold }} /> Tension</span>
        <span><i style={{ background: C.dominant }} /> Avoid</span>
      </Legend>
    </div>
  );
}

/* AI 채팅 — 선택한 코드 칩 + 사용자 질문 + 이론 답변 */
function ChatMock({ lang }: { lang: Lang }) {
  const q = lang === 'ko'
    ? '이 ii–V–I 에서 F7 대신 쓸 수 있는 코드는?'
    : 'What can I play instead of F7 in this ii–V–I?';
  return (
    <ChatWrap>
      <ChipRow>
        <Chip $fn="subdom">Cm7</Chip>
        <Chip $fn="dominant">F7</Chip>
        <Chip $fn="tonic">B♭M7</Chip>
      </ChipRow>
      <BubbleUser>{q}</BubbleUser>
      <AiRow>
        <AiAvatar>🎷</AiAvatar>
        {lang === 'ko' ? (
          <BubbleAI>
            <span className="kw-d">F7</span> 자리에 <b>트라이톤 대리</b>인 <span className="kw-d">B7(♭9)</span> 를 넣어 보세요. 베이스가 B♭→A 로 반음 하강하며 <span className="kw-t">B♭M7</span> 으로 더 매끄럽게 풀립니다.
          </BubbleAI>
        ) : (
          <BubbleAI>
            Try the <b>tritone sub</b> <span className="kw-d">B7(♭9)</span> in place of <span className="kw-d">F7</span>. The bass steps down B♭→A and resolves more smoothly into <span className="kw-t">B♭M7</span>.
          </BubbleAI>
        )}
      </AiRow>
    </ChatWrap>
  );
}

/* YouTube 채보 파형 — 온셋 마커가 비트에 찍히는 모습 */
function WaveMock() {
  const heights = [22, 40, 70, 55, 30, 80, 95, 60, 38, 72, 50, 25, 64, 88, 44, 30, 58, 76, 40, 20, 52, 84, 36, 28];
  const onsetIdx = new Set([2, 6, 9, 13, 17, 21]);
  const onsetPct = [10, 26, 39, 55, 71, 87];
  return (
    <div>
      <ChartTitle style={{ color: C.ink }}>YouTube Transcribe <small>onset detection</small></ChartTitle>
      <WaveWrap>
        <WaveRow>
          {heights.map((h, i) => <WaveBar key={i} $h={h} $on={onsetIdx.has(i)} />)}
        </WaveRow>
        {onsetPct.map((l, i) => <Onset key={i} $left={l} />)}
      </WaveWrap>
      <Legend>
        <span><i style={{ background: C.gold }} /> Detected onset (note start)</span>
      </Legend>
    </div>
  );
}
