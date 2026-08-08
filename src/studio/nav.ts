/* ─────────────────────────────────────────────────────────────────────────
 * 스튜디오 내비게이션 — **단일 소스**.
 *
 * 예전에는 이 목록이 우측 하단 `AdminToolsDock` 드롭업 안에 있었다. 그 독은
 * 실서비스 화면 위에 얹혀 있었기 때문에 임시 런처일 수밖에 없었는데, 스튜디오가
 * 독립 화면이 되면서 정식 사이드바로 승격한다.
 *
 * 아이콘은 그 독에 있던 것을 그대로 옮겼다 — 눌러 온 자리 감각을 유지하려고
 * 모양·순서를 바꾸지 않았다.
 * ──────────────────────────────────────────────────────────────────────── */

import type { ReactElement } from 'react';
import {
  ChordIcon,
  CompingIcon,
  EditorIcon,
  LickIcon,
  NoteIcon,
  OmrIcon,
  OmrMonitorIcon,
  OnsetIcon,
  RagIcon,
  SoloIcon,
  VideoIcon,
} from './navIcons';

export interface StudioNavItem {
  path: string;
  label: string;
  desc: string;
  icon: () => ReactElement;
}

export const STUDIO_NAV: readonly StudioNavItem[] = [
  { path: '/chord',         label: 'Chord Analysis',    desc: '코드 진행 화성 분석 워크벤치',            icon: ChordIcon },
  { path: '/note',          label: 'Note Analysis',     desc: '악보(멜로디) 분석 워크벤치',              icon: NoteIcon },
  { path: '/licks',         label: 'Lick Database',     desc: '릭 수집·검수·전역 등록',                  icon: LickIcon },
  { path: '/solos',         label: 'Solo Database',     desc: '솔로 수집·검수·전역 등록',                icon: SoloIcon },
  { path: '/comping',       label: 'Comping Database',  desc: '컴핑 패턴 수집 (백엔드 미구현)',          icon: CompingIcon },
  { path: '/editor',        label: 'Editor',            desc: '릭·솔로 채보 및 편집',                    icon: EditorIcon },
  { path: '/youtube-onset', label: 'YouTube Onset',     desc: '영상에서 온셋 추출',                      icon: VideoIcon },
  { path: '/lickonset',     label: 'Onset 대조',        desc: '파커 릭 vs Omnibook 원본 대조',           icon: OnsetIcon },
  { path: '/input',         label: 'OMR',               desc: '악보 이미지 → MusicXML 업로드',           icon: OmrIcon },
  { path: '/admin/omr',     label: 'OMR 모니터',        desc: '전역 큐 진행률 · 처리 기록',              icon: OmrMonitorIcon },
  { path: '/admin/rag',     label: 'RAG',               desc: '문서 색인 관리 · 후보 확정',              icon: RagIcon },
] as const;

/** 사이드바 묶음 — 분석 / 데이터 구축 / 파이프라인 순. */
export const STUDIO_NAV_GROUPS: readonly { title: string; items: readonly string[] }[] = [
  { title: '분석',    items: ['/chord', '/note'] },
  { title: '데이터',  items: ['/licks', '/solos', '/comping', '/editor'] },
  { title: '파이프라인', items: ['/youtube-onset', '/lickonset', '/input', '/admin/omr', '/admin/rag'] },
] as const;
