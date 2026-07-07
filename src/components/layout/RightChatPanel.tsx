import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import styled from 'styled-components';
import type { ChatMessage as ChatMessageType, ChordOverlay } from '../../data/types';
import { ChatMessage } from '../chat/ChatMessage';
import { IntroChatInput } from '../chat/IntroChatInput';
import { type ClaudeMessage, type ClaudeImage } from '../../api/claude';
import { type RagDebugInfo } from '../../api/harmorag';
import {
  getChat as backendGetChat,
  onActiveChatChange,
  setActiveChat,
  notifyChatListChanged,
  setPendingChat,
} from '../../api/chat';
import { runChatStream } from '../../lib/chat/runChatStream';
import { parseStemIntent, describeStemIntent } from '../../lib/stems/intent';
import { setChatChartMeta } from '../../lib/chatChartMeta';
import { getCachedUser, onAuthChange } from '../../api/auth';
import { RagDebugPanel } from '../chat/RagDebugPanel';
import {
  findMatchingLicks,
  selectionProgressionLabel,
  findLicksByProgression,
  detectProgressionKeyword,
  findLicksByPerformerAndProgression,
  type LickMatch,
} from '../../lib/lickMatcher';
import { loadLicks, loadUserLicksSync, loadBackupLicks } from '../../data/lickData';
import type { LickEntry } from '../../data/lickData';
import {
  PanelContainer,
  PanelHeader,
  MessagesArea,
  EmptyState,
  EmptyIcon,
  EmptyActionGroup,
  EmptyActionButton,
  IntroInputSlot,
  ScrollToBottomBtn,
  ChatLoadingState,
  ChatLoadingSpinner,
} from './RightChatPanel.styles';

/* ── Reload hydration ───────────────────────────────────────────────────
 * The backend persists chat messages as raw `{role, content}` only — the
 * ephemeral `lickMatches` (which carry each DB lick's VexFlow `sheetData`)
 * are NOT stored. So on reload, [LICK:id] tags in the content resolve to
 * nothing and the score cards vanish. Re-hydrate them: parse the [LICK:id]
 * tags out of the persisted content and rebuild `lickMatches` from the
 * loaded lick DB by id. (```glick blocks survive reload on their own since
 * their JSON lives inline in the content.) */
const LICK_TAG_RE_G = /\[LICK:([^\]]+)\]/g;
function resolveLickMatchesFromContent(
  content: string,
  allLicks: LickEntry[],
): LickMatch[] {
  if (!content || allLicks.length === 0) return [];
  const byId = new Map<string, LickEntry>();
  for (const l of allLicks) byId.set(String(l.id), l);
  const out: LickMatch[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  LICK_TAG_RE_G.lastIndex = 0;
  while ((m = LICK_TAG_RE_G.exec(content)) !== null) {
    const id = m[1].trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const lick = byId.get(id);
    if (lick) out.push({ lick, tier: 1 });
  }
  return out;
}

/* ── Export / share helpers ─────────────────────────────────────────────
 * Frontend-only export: serialise the visible chat messages to a Markdown
 * document, then either download as .md or copy to clipboard. The chat is
 * a sequence of user/assistant turns; lick-recommend cards and other
 * structured payloads are best-effort summarised (their `content` is
 * empty so they appear as "(릭 추천 카드)" stubs in the export). */
function messagesToMarkdown(
  msgs: Array<{ role: string; content: string; timestamp?: number }>,
  songTitle: string,
): string {
  const header = `# ${songTitle || 'Jazzify'} 대화 기록\n\n_내보낸 시각: ${new Date().toLocaleString('ko-KR')}_\n\n---\n\n`;
  const body = msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const label = m.role === 'user' ? '🧑 사용자' : '🎷 Jazzify AI';
      const ts = m.timestamp ? `  \n_${new Date(m.timestamp).toLocaleString('ko-KR')}_` : '';
      const body = m.content?.trim() || '_(빈 메시지)_';
      return `## ${label}${ts}\n\n${body}\n`;
    })
    .join('\n---\n\n');
  return header + body + '\n';
}

function exportChatAsMarkdown(
  msgs: Array<{ role: string; content: string; timestamp?: number }>,
  songTitle: string,
): void {
  const md = messagesToMarkdown(msgs, songTitle);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  /* Filename: jazzify-<song>-<YYYYMMDD-hhmm>.md (slugified song title). */
  const slug = (songTitle || 'chat').replace(/[^\w가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  a.download = `jazzify-${slug || 'chat'}-${stamp}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function copyChatToClipboard(
  msgs: Array<{ role: string; content: string; timestamp?: number }>,
  songTitle: string,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(messagesToMarkdown(msgs, songTitle));
  } catch (e) {
    console.warn('[chat export] clipboard copy failed:', e);
  }
}

const ExportRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
`;

/* "이전 메시지 N개 더 보기" affordance shown at the top of MessagesArea
 * when the virtual-window has trimmed older turns out of the DOM.
 * Click expands the window by VISIBLE_STEP. */
const RevealOlderBtn = styled.button`
  align-self: center;
  margin: 8px 0 4px;
  padding: 6px 14px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 999px;
  background: #fff;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.6);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  &:hover {
    background: rgba(0, 0, 0, 0.04);
    color: #1a1a1a;
    border-color: rgba(0, 0, 0, 0.2);
  }
`;
const ExportBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
  border-radius: 999px;
  padding: 5px 10px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.7);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.04); color: #1a1a1a; border-color: rgba(0, 0, 0, 0.18); }
  svg { width: 14px; height: 14px; }
`;
const ExportIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12" />
    <path d="M7 8l5-5 5 5" />
    <path d="M5 21h14" />
  </svg>
);
const CopyShareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

/** Read an attached image File into a Claude vision block (base64, no prefix).
 *  Non-image files (e.g. PDFs) return null and are skipped. */
async function fileToClaudeImage(file: File): Promise<ClaudeImage | null> {
  if (!file.type.startsWith('image/')) return null;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { mediaType: file.type, data };
}

interface RightChatPanelProps {
  selectedChords: ChordOverlay[];
  groupExplanation: string | null;
  songTitle: string;
  /** Set when this panel lives on a chord/sheet chart page. Tags any chat
   *  started here so the Recent Chats sidebar shows the chart icon + song name,
   *  and forces a fresh session on entry (see the mount effect below). */
  chartKind?: 'chord' | 'sheet';
  /** publicId of the originating chord/sheet PROJECT (chartKind set). Routes the
   *  chat to the categorized backend endpoint so it persists with this id and the
   *  Recent Chats row can reopen the chart directly. */
  projectPublicId?: string;
  /** Set when the page was opened by clicking a chord/sheet chart chat in the
   *  Recent Chats sidebar. Keeps that conversation loaded instead of letting
   *  the song-settle (placeholder → real title) wipe it as a "song switch". */
  restoreChatId?: string;
  chordContext?: string;
  isSelectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  onClearSelectedChords?: () => void;
  songTempo?: number;
  /** Pin a recommended lick onto the left-hand chord chart (anchored at the
   *  selected span). Set only on the chord page; absent → lick cards hide the
   *  ▼ "show on chart" button. */
  onLickShowInline?: (lick: LickEntry) => void;
  /** id of the lick currently pinned on the chart, so its card shows ▼ active. */
  activeInlineLickId?: string | number;
  /** Pre-formatted note-level dump of the user-selected NoteSheet range.
   *  Attached to LLM context only when the user asks a solo / line / note-
   *  level question (heuristic below). Casual "analyze this chord progression"
   *  queries don't include it, so they stay token-cheap. */
  notesContext?: string;
  /** Optional override for the empty-state visual (shown when there are no
   *  messages yet). HomePage uses this to keep its hero intro (big logo +
   *  greeting + subtitle) while still funneling all chat logic through this
   *  same component, so the chord/note pages and the intro stay identical. */
  emptyState?: ReactNode;
  /** Hide the panel header (e.g. on HomePage intro where the brand strip is
   *  already on the page outside the panel). */
  hideHeader?: boolean;
  /** Hide the "select chord section" quick action for chat-only intro views. */
  hideSelectionQuickAction?: boolean;
  /** Override the chat input placeholder. Defaults to a chord-page-flavored
   *  prompt; HomePage intro overrides to something more general since the
   *  intro isn't tied to a specific chord chart. */
  inputPlaceholder?: string;
  /** Focus the chat input on mount — HomePage native uses this to pop the
   *  iOS keyboard automatically on app launch. */
  autoFocusInput?: boolean;
  /** When true, render the chat input at the top of the panel (above messages) */
  inputAtTop?: boolean;
  /** When true, in empty-state mode (no messages yet), render the chat input
   *  RIGHT BELOW the empty-state content (centered as a group) instead of
   *  pinned to the bottom of the panel. As soon as the first message is
   *  sent, the input slides back to the bottom for the normal chat layout.
   *  Mirrors the ChatGPT / Claude "centered input + hero" launch pattern. */
  inputInIntro?: boolean;
  /** Native intro variant: hero centered upper, input pinned at the bottom
   *  (just above the iOS keyboard via the keyboardOffsetPx). */
  nativeIntroLayout?: boolean;
  /** Pixels of extra bottom padding to leave below the input — used on
   *  native to lift the input above the iOS keyboard when it's shown. */
  keyboardOffsetPx?: number;
  /** Fires whenever the message count changes. HomePage uses this to decide
   *  whether the "새 채팅" button should prompt a confirm modal (when there's
   *  an in-progress conversation to discard). */
  onMessagesChange?: (count: number) => void;
}

/** Keywords that signal the user wants to talk about the actual played notes
 *  (line shape, solo choices, voice leading, approach tones, why-this-note),
 *  rather than just the chord skeleton. When matched AND `notesContext` is
 *  available, we attach the per-note dump to the model context. */
const NOTE_LEVEL_KEYWORDS =
  /솔로|솔로잉|라인|멜로디|음표|노트|음정|음역|어프로치|어떤\s*음|이\s*음|이\s*노트|왜.*했|왜.*골|왜.*이렇|왜.*쳤|왜.*연주|즉흥|임프로|보이싱|텐션|보이스\s*리딩|approach|why.*play|why.*chose|why.*note|melody|line|solo/i;

interface MessageWithDebug extends ChatMessageType {
  ragDebug?: RagDebugInfo;
  /** User aborted the stream — keep whatever text we got, show a "중단됨" badge. */
  aborted?: boolean;
  /** Set when the stream errored out completely — drives the inline retry UI. */
  error?: string;
  /** Original user prompt for the failed turn (used by the Retry button). */
  retryPrompt?: string;
  retryImages?: ClaudeImage[];
}

function buildSelectedChordContext(selectedChords: ChordOverlay[]): string {
  if (selectedChords.length === 0) return '';

  const lines = selectedChords.map((chord, index) => {
    const parts = [`${index + 1}. Bar ${chord.bar}: ${chord.symbol}`];
    if (chord.analysis.degree) parts.push(`degree=${chord.analysis.degree}`);
    if (chord.analysis.func) parts.push(`function=${chord.analysis.func}`);
    if (chord.analysis.secDom) parts.push(`secondaryDominant=${chord.analysis.secDom}`);
    if (chord.analysis.modal) parts.push(`modal=${chord.analysis.modal}`);
    parts.push(chord.analysis.diatonic ? 'diatonic' : 'non-diatonic');
    return parts.join(' | ');
  });

  return [
    '=== User Selected Chord Section ===',
    'Use this selected chord section as the primary target of the user question.',
    ...lines,
  ].join('\n');
}

function appendSelectedChordContext(chordContext: string | undefined, selectedChordContext: string): string | undefined {
  if (!selectedChordContext) return chordContext;
  return [chordContext, selectedChordContext].filter(Boolean).join('\n\n');
}

function snapshotSelectedChords(selectedChords: ChordOverlay[]): ChordOverlay[] | undefined {
  if (selectedChords.length === 0) return undefined;
  return selectedChords.map((chord) => ({
    ...chord,
    position: { ...chord.position },
    analysis: { ...chord.analysis },
  }));
}

export function RightChatPanel({
  selectedChords,
  songTitle,
  chartKind,
  projectPublicId,
  restoreChatId,
  chordContext,
  isSelectionMode = false,
  onToggleSelectionMode,
  onClearSelectedChords,
  songTempo,
  onLickShowInline,
  activeInlineLickId,
  notesContext,
  emptyState,
  hideHeader = false,
  hideSelectionQuickAction = false,
  inputPlaceholder,
  autoFocusInput = false,
  inputAtTop = false,
  inputInIntro = false,
  nativeIntroLayout = false,
  keyboardOffsetPx = 0,
  onMessagesChange,
}: RightChatPanelProps) {
  const [messages, setMessages] = useState<MessageWithDebug[]>([]);
  /* Mirror of the latest messages so regenerate/edit handlers (which are
   * memoised with a [] deps array because they call into handleSend)
   * can read the current array without grabbing a stale closure copy. */
  const messagesRef = useRef<MessageWithDebug[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    onMessagesChange?.(messages.length);
  }, [messages.length, onMessagesChange]);
  const [loading, setLoading] = useState(false);
  /* Mirror of `loading` for sync access inside handlers that were
   * memoised with stale-state captures. Used by the message queue to
   * decide whether the new send should go straight through or wait. */
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  /* Abort controller for the in-flight stream. Set when a message is sent;
   * cleared when the stream ends (success / error / user-abort). The Send
   * button on the input row toggles to a Stop button while this is set —
   * clicking Stop calls .abort() and the stream cleanup leaves whatever
   * text was already received in the message bubble. */
  const abortRef = useRef<AbortController | null>(null);
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);
  /* Unmount cleanup — tab switches (믹서↔채팅), HomePage's new-chat remount
   * and route changes unmount this panel while a stream may be in flight.
   * Without the abort the fetch keeps streaming in the background (tokens +
   * network for nothing) and its completion side-effects fire post-unmount. */
  useEffect(() => () => { abortRef.current?.abort(); }, []);
  /* Guards for the "switch chat while streaming" races:
   *  - loadSeqRef: sequence token for sidebar chat loads; a stale
   *    backendGetChat response (A clicked, then B) must not win over the
   *    newer one.
   *  - historyEpochRef: bumped whenever historyRef is REPLACED (chat switch /
   *    clear). A stream that started under an older epoch must not push its
   *    turn into the NEW chat's history (LLM context contamination). */
  const loadSeqRef = useRef(0);
  const historyEpochRef = useRef(0);
  /* True while a sidebar-triggered GET /v1/chat/{id} is in flight, so the
   * empty MessagesArea can show a "채팅 불러오는 중…" placeholder instead of
   * looking frozen. */
  const [chatLoading, setChatLoading] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const isScrolledUpRef = useRef(false);
  const historyRef = useRef<ClaudeMessage[]>([]);
  const allLicksRef = useRef<LickEntry[]>([]);
  // Flips true once the lick DB has loaded — drives reload re-hydration of
  // [LICK:id] score cards (see the effect below).
  const [licksReady, setLicksReady] = useState(false);
  /* Tracks the songTitle that was active the LAST time we cleared the chat,
   * so we can skip the clear on the very first effect run (which would
   * otherwise stomp an activeChat that the sidebar just dispatched). */
  const lastSongTitleRef = useRef<string | null>(null);
  const songTitleInitedRef = useRef(false);

  /* Backend chat persistence (Jazzify /v1/chat/*). When the user is logged
   * in we route streaming through the backend so each message is saved
   * server-side and shows up in the sidebar list. chatPublicIdRef mirrors
   * the state for use inside async callbacks (where stale closures bite). */
  const [loggedIn, setLoggedIn] = useState(() => !!getCachedUser());
  const [_chatPublicId, setChatPublicIdState] = useState<string | null>(null);
  const chatPublicIdRef = useRef<string | null>(null);
  const setChatPublicId = useCallback((id: string | null) => {
    chatPublicIdRef.current = id;
    setChatPublicIdState(id);
  }, []);

  useEffect(() => {
    return onAuthChange((isIn) => {
      setLoggedIn(isIn);
      if (!isIn) {
        setChatPublicId(null);
        setActiveChat(null);
      }
    });
  }, [setChatPublicId]);

  /* Load a chat's messages into the panel (or clear on null). Shared by the
   * sidebar's active-chat dispatch AND the explicit restore effect below, so
   * a Recent-Chats click always repopulates the log regardless of event
   * timing. `force` bypasses the "already open" short-circuit — needed by the
   * restore path, where the global active id may already equal the target but
   * the panel hasn't actually fetched it yet (e.g. arrived via ?chat). */
  const loadChatById = useCallback(async (id: string | null, force = false) => {
    if (!force && id === chatPublicIdRef.current) return;
    // Switching away from a chat that may still be streaming: kill the stream
    // FIRST so its finishing turn can't leak into the new chat's history.
    abortRef.current?.abort();
    historyEpochRef.current++;
    if (id === null) {
      setChatPublicId(null);
      setMessages([]);
      historyRef.current = [];
      setChatLoading(false);
      return;
    }
    const seq = ++loadSeqRef.current;
    setChatLoading(true);
    try {
      const detail = await backendGetChat(id);
      // A newer load (rapid A→B clicks) superseded this one — drop it.
      if (seq !== loadSeqRef.current) return;
      const msgs: MessageWithDebug[] = (detail.messages || [])
        // Role is normalised case-insensitively: the backend may serialise the
        // enum as 'USER'/'ASSISTANT' (or 'system'), so a strict lowercase match
        // silently dropped EVERY message → blank panel even when the chat had a
        // full log. Keep only user/assistant turns.
        .map((m) => ({ ...m, _r: (m.role || '').toLowerCase() }))
        .filter((m) => m._r === 'user' || m._r === 'assistant')
        .map((m) => {
          const role: 'user' | 'assistant' = m._r === 'assistant' ? 'assistant' : 'user';
          const base: MessageWithDebug = {
            id: `db-${m.publicId}`,
            role,
            content: m.content,
            timestamp: new Date(m.createdAt).getTime() || Date.now(),
          };
          if (role === 'assistant') {
            const lm = resolveLickMatchesFromContent(m.content, allLicksRef.current);
            if (lm.length > 0) { base.lickMatches = lm; base.lickInline = true; }
          }
          return base;
        });
      setChatPublicId(id);
      setMessages(msgs);
      historyRef.current = msgs.map((m) => ({ role: m.role, content: m.content }));
      isScrolledUpRef.current = false;
    } catch (e) {
      console.error('[chat] load failed:', e);
    } finally {
      if (seq === loadSeqRef.current) setChatLoading(false);
    }
  }, [setChatPublicId]);

  /* Sidebar dispatched a chat selection → load it (or clear on null). */
  useEffect(() => onActiveChatChange((id) => { void loadChatById(id); }), [loadChatById]);

  /* Explicit restore (Recent-Chats click → ?chat=<id> → restoreChatId).
   * Force-load it directly so the conversation reopens even when the global
   * active-chat event was missed or already equalled the id at mount — the
   * bug where clicking a chord/sheet chart's recent chat showed the empty
   * start screen instead of the saved log. */
  useEffect(() => {
    if (!restoreChatId) return;
    setActiveChat(restoreChatId);
    void loadChatById(restoreChatId, true);
  }, [restoreChatId, loadChatById]);

  /* 릭 추천 풀: 1순위 백엔드 lick DB (jazzify.p-e.kr/api/v1/licks). 백엔드가
   * 인증 만료/다운 등으로 실패하면 번들된 백업 스냅샷(public/data/licks/
   * backend_backup_licks.json, 백엔드 wipe 직전 145개)으로 폴백해 추천이
   * 빈손이 되지 않게 한다. (이전엔 폴백을 막아둬서 백엔드 401 시 풀이
   * 영영 비었음.) */
  useEffect(() => {
    loadLicks()
      .then((licks) => {
        if (licks.length > 0) { allLicksRef.current = licks; return; }
        return loadBackupLicks().then((b) => { allLicksRef.current = b; });
      })
      .catch((err) => {
        console.warn('[RightChatPanel] 백엔드 lick DB 로드 실패 → 백업 스냅샷 폴백:', err);
        return loadBackupLicks()
          .then((b) => { allLicksRef.current = b; })
          .catch(() => { allLicksRef.current = []; });
      })
      .finally(() => setLicksReady(true));
  }, []);

  /* If a chat was loaded before the lick DB finished loading, its [LICK:id]
   * tags couldn't resolve yet. Once the DB is ready, re-hydrate any already-
   * displayed assistant messages that have lick tags but no cards. */
  useEffect(() => {
    if (!licksReady) return;
    setMessages((prev) => {
      let changed = false;
      const next = prev.map((msg) => {
        if (msg.role !== 'assistant' || msg.lickMatches) return msg;
        const lm = resolveLickMatchesFromContent(msg.content, allLicksRef.current);
        if (lm.length === 0) return msg;
        changed = true;
        return { ...msg, lickMatches: lm, lickInline: true };
      });
      return changed ? next : prev;
    });
  }, [licksReady]);

  const handleScroll = useCallback(() => {
    if (!messagesAreaRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesAreaRef.current;
    // 50px 이상 위로 올렸으면 자동스크롤 중지 + scroll-to-bottom 버튼 표시
    const isUp = scrollHeight - scrollTop - clientHeight > 50;
    isScrolledUpRef.current = isUp;
    setShowScrollBtn(isUp);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    isScrolledUpRef.current = false;
    setShowScrollBtn(false);
  }, []);

  useEffect(() => {
    if (!isScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages]);

  useEffect(() => {
    /* First effect run = component mount, NOT a real song switch. Skipping
     * here is critical: without it we'd stomp an activeChat that the sidebar
     * just dispatched (the user clicked "최근 채팅" then navigated here →
     * mount fires → setActiveChat(null) wipes the selection before the
     * listener above has a chance to fetch it). */
    if (!songTitleInitedRef.current) {
      songTitleInitedRef.current = true;
      lastSongTitleRef.current = songTitle;
      return;
    }
    if (lastSongTitleRef.current === songTitle) return;
    lastSongTitleRef.current = songTitle;
    /* Restored-chat entry (opened from Recent Chats): the song title settling
     * from a placeholder to the real song is NOT a user-initiated switch, so we
     * must NOT wipe the conversation we just restored. While restoreChatId is
     * set we never auto-reset on a song change. */
    if (restoreChatId) return;
    setMessages([]);
    historyRef.current = [];
    /* Switching songs starts a fresh ad-hoc chat — drop the backend chat
     * pointer too so the next message creates a new chat (and the sidebar
     * highlight clears). The user can still re-open the previous chat from
     * the sidebar list. */
    setChatPublicId(null);
    setActiveChat(null);
  }, [songTitle, setChatPublicId, restoreChatId]);

  const handleRequestLicks = useCallback(() => {
    if (selectedChords.length === 0) return;

    const allLicks = allLicksRef.current;
    // Extract song key root from chordContext (e.g. "Key: Eb" → "Eb")
    const keyMatch = chordContext?.match(/Key:\s*([A-G][b#]?)/);
    const songKey = keyMatch ? keyMatch[1] : 'C';

    const matches = findMatchingLicks(selectedChords, songTitle, songKey, allLicks, 3);
    const savedMatches = findMatchingLicks(selectedChords, songTitle, songKey, loadUserLicksSync(), 5);
    const progLabel = selectionProgressionLabel(selectedChords);

    const userMsgId = `user-${Date.now()}`;
    const aiMsgId = `ai-${Date.now()}`;

    const userMsg: MessageWithDebug = {
      id: userMsgId,
      role: 'user',
      content: `💡 "${progLabel}" 릭 추천해줘`,
      timestamp: Date.now(),
      selectedChords: snapshotSelectedChords(selectedChords),
    };
    const aiMsg: MessageWithDebug = {
      id: aiMsgId,
      role: 'assistant',
      content: matches.length === 0 ? '해당 구간과 매칭되는 릭을 찾지 못했습니다.' : '',
      timestamp: Date.now(),
      lickMatches: matches,
      savedLickMatches: savedMatches.length > 0 ? savedMatches : undefined,
      lickProgressionLabel: progLabel,
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    isScrolledUpRef.current = false;
  }, [selectedChords, songTitle, chordContext]);

  // 악보 말풍선 "💡 릭 추천받기" 클릭 이벤트 수신
  useEffect(() => {
    const handler = () => handleRequestLicks();
    window.addEventListener('jazzify:requestLicks', handler);
    return () => window.removeEventListener('jazzify:requestLicks', handler);
  }, [handleRequestLicks]);

  const handleSend = useCallback(async (text: string, files?: File[], preImages?: ClaudeImage[]) => {
    /* While a reply is streaming the composer is locked (textarea disabled +
     * the send button shows Stop), so a new send shouldn't even be reachable.
     * Guard anyway — silently ignore any send attempt mid-stream rather than
     * queueing it. (User decision: no "type while it answers" / queueing.) */
    if (loadingRef.current) return;
    isScrolledUpRef.current = false;

    // ── 오디오 첨부 → 스템 분리 파이프라인 (LLM 우회) ──────────────────
    // 현행 채팅 LLM은 오디오 입력을 처리하지 못한다. 오디오가 붙으면
    // rule-based 인텐트("스템 분리/피아노만/MR")를 파싱해 StemSplitMessage
    // 카드로 응답한다. 신호가 없으면 4스템 분리로 폴백. File 기반이라
    // 이 턴은 백엔드 히스토리에 저장하지 않는다(비영속 카드).
    const audioFile = files?.find(
      (f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac)$/i.test(f.name),
    );
    if (audioFile) {
      const intent = parseStemIntent(text) ?? { kind: 'split' as const, preset: '4' as const };
      const now = Date.now();
      const stemUserMsg: MessageWithDebug = {
        id: `user-${now}`,
        role: 'user',
        // 첨부 파일명을 항상 표기 — 텍스트만 보이면 뭘 올렸는지 알 수 없다.
        content: text.trim() ? `${text.trim()}\n\n🎵 ${audioFile.name}` : `🎵 ${audioFile.name}`,
        timestamp: now,
      };
      const stemAiMsg: MessageWithDebug = {
        id: `ai-${now}`,
        role: 'assistant',
        content: `“${audioFile.name}” — ${describeStemIntent(intent)}를 시작할게요. 아래 카드에서 결과를 듣고 저장할 수 있어요.`,
        timestamp: now,
        stemRequest: { file: audioFile, intent },
      };
      setMessages((prev) => [...prev, stemUserMsg, stemAiMsg]);
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: stemUserMsg.content },
        { role: 'assistant', content: stemAiMsg.content },
      ];
      return;
    }

    // 첨부 이미지 → Claude 비전 블록(base64). 비이미지(PDF 등)는 건너뜀.
    // preImages: 이미 변환된 ClaudeImage[] (재시도 경로). 예전엔 retryImages를
    // File[]로 강제 캐스트해 fileToClaudeImage의 file.type 접근에서 TypeError →
    // 재시도가 메시지만 지우고 아무것도 못 보냈다.
    const images: ClaudeImage[] = preImages && preImages.length > 0
      ? preImages
      : files && files.length > 0
        ? (await Promise.all(files.map(fileToClaudeImage))).filter((x): x is ClaudeImage => x !== null)
        : [];

    const userMsg: MessageWithDebug = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      selectedChords: snapshotSelectedChords(selectedChords),
      images: images.length > 0 ? images : undefined,
    };
    const aiMsgId = `ai-${Date.now()}`;

    // "만들어줘", "생성해줘" 등 명시적 창작 요청만 AI 생성 모드
    const CREATE_KEYWORDS = /만들어|생성|작성|직접|그려줘?|generate|compose|짜봐|짜줘|써줘/i;
    /* "처럼" — almost always "X처럼 연주" (imitate musician X) which wants
     *  lick examples. "어떻게.*(연주|솔로|라인)" — "how to play" requests.
     *  "스타일로" — "in the style of" similarly implies example licks.
     *  "방식" — playing approach. Combined with the original keywords
     *  (릭/라인/lick/거장/etc.) this should cover the common ways users
     *  ask "show me how this person would play". */
    const LICK_QUERY_KEYWORDS = /릭|라인|line|lick|솔로.*예시|예시.*솔로|연주.*예|거장|추천.*솔로|솔로.*(추천|알려|보여|들려|골라|줘)|처럼|스타일로|어떻게.*(연주|솔로|라인)|방식.*연주/i;
    const isGenQuery = CREATE_KEYWORDS.test(text);
    const isLickQuery = !isGenQuery && LICK_QUERY_KEYWORDS.test(text);

    // LLM에게 보낼 실제 메시지 (유저에게는 원본 text만 보임)
    let textForLLM = text;

    // 릭 DB 매칭: lick 쿼리일 때 관련 릭을 컨텍스트로 주입
    let lickMatchesForMsg: ReturnType<typeof findMatchingLicks> = [];
    let lickProgressionLabelForMsg: string | undefined;
    let savedLickMatchesForMsg: ReturnType<typeof findMatchingLicks> | undefined;
    if (isLickQuery) {
      const keyMatch = chordContext?.match(/Key:\s*([A-G][b#♭]?)/);
      const songKey = (keyMatch ? keyMatch[1] : 'C').replace('♭', 'b');
      const chordsForMatch = selectedChords.length > 0 ? selectedChords : [];
      const detectedProg = detectProgressionKeyword(text);

      // 우선순위: 1) 선택한 코드 진행에 맞는 릭  2) 연주자(+진행)  3) 진행만.
      lickMatchesForMsg = findMatchingLicks(chordsForMatch, songTitle, songKey, allLicksRef.current, 5);
      if (lickMatchesForMsg.length === 0) {
        // "찰리파커 2-5-1" 류 — 그 연주자의 해당 진행 릭 우선, 부족하면 같은 진행의
        // 다른 거장으로 보완. (연주자만 언급했고 진행이 없으면 연주자 릭 그대로.)
        lickMatchesForMsg = findLicksByPerformerAndProgression(text, detectedProg, allLicksRef.current, 5);
      }
      if (lickMatchesForMsg.length === 0 && detectedProg) {
        lickMatchesForMsg = findLicksByProgression(detectedProg, allLicksRef.current, 5);
      }

      if (lickMatchesForMsg.length > 0) {
        // 인라인 소개줄에 쓸 진행 라벨.
        const PROG_LABELS: Record<string, string> = {
          'ii-V-I': 'ii-V-I',
          'ii-V': 'ii-V',
          'minor-ii-V': '마이너 ii-V',
          'V-I': 'V-I',
          'turnaround': '턴어라운드',
          'iii-VI-ii-V': 'iii-VI-ii-V',
        };
        lickProgressionLabelForMsg =
          (detectedProg && PROG_LABELS[detectedProg]) ||
          (chordsForMatch.length > 0 ? selectionProgressionLabel(chordsForMatch) : undefined);

        const savedPool = loadUserLicksSync();
        const savedRaw = chordsForMatch.length > 0
          ? findMatchingLicks(chordsForMatch, songTitle, songKey, savedPool, 5)
          : (detectedProg ? findLicksByProgression(detectedProg, savedPool, 5) : []);
        if (savedRaw.length > 0) savedLickMatchesForMsg = savedRaw;

        // 각 릭 사이사이에 LLM 의 짧은 설명을 넣는다: 인트로 → (설명 + [LICK:id]) 반복.
        // [LICK:id] 는 프론트에서 해당 DB 릭의 VexFlow 악보 카드로 자동 치환된다.
        // 태그를 못 받은 릭은 ChatMessage 가 스트림 종료 후 결정적으로 보충하므로
        // (lickInline 안전망) 설명이 없더라도 카드는 무조건 표시된다.
        const lickList = lickMatchesForMsg.map((m, i) => {
          const l = m.lick;
          const chordsStr = (l.chords ?? []).slice(0, 4).join(' → ');
          return `  ${i + 1}. [LICK:${l.id}] — ${l.performer} / ${l.title} / 키 ${m.originalKey ?? l.key}${chordsStr ? ` / ${chordsStr}` : ''}`;
        }).join('\n');
        const progPhrase = lickProgressionLabelForMsg ? ` ${lickProgressionLabelForMsg}` : '';
        const leadPerformer = lickMatchesForMsg[0].lick.performer;
        textForLLM = `${text}

[내부 지시 — 유저에게 보이지 않음: 릭 카드 + 설명]
아래는 DB에서 매칭된 실제 릭 목록이다. 각 릭을 사이사이 짧은 설명과 함께 소개하라. \`[LICK:아이디]\` 태그는 그 자리에서 자동으로 악보 카드로 렌더링된다.

작성 규칙:
1. 먼저 자연스러운 대화체 한국어 인트로 1~2문장으로 운을 띄워라. (예: "${leadPerformer}의${progPhrase} 라인 몇 개 골라봤어요 🎷")
2. 그 다음 목록의 릭을 위에서부터 순서대로, 각각 **누구의 어떤 곡인지 + 주목할 점(어프로치/텐션/리듬 등)을 1~2문장으로 간략히 설명한 뒤**, 다음 줄에 그 릭의 \`[LICK:아이디]\` 태그를 단독으로 놓아라. 가능한 한 목록의 릭을 모두 다뤄라.
3. 메시지를 절대 [LICK:id] 태그로 시작하지 마라(반드시 설명 문장이 먼저).
4. 위 목록에 없는 id를 쓰지 마라. **음표·악보·ASCII 탭(예: "F E D C B♭ A")·\`\`\`glick·\`\`\`chart 를 만들지 마라. 존재하지 않는 가짜 릭/라인을 지어내지 마라** — 악보는 오직 [LICK:id] 태그로만 표시된다.

사용 가능한 릭:
${lickList}`;
      }
    }

    // AI 릭 생성 요청: glick JSON 코드 블록 출력 지시.
    // ALSO fallback for lick queries (e.g. "2-5-1 릭 추천") whose DB lookup
    // returned nothing — without this prompt, the LLM would just emit a plain
    // markdown ASCII tab and never produce a renderable VexFlow score.
    const useGlickGen = isGenQuery || (isLickQuery && lickMatchesForMsg.length === 0);
    if (useGlickGen) {
      const keyMatch = chordContext?.match(/Key:\s*([A-G][b#♭]?)/);
      const songKey = keyMatch ? keyMatch[1].replace('♭', 'b') : 'C';
      const isFlat = ['F','Bb','Eb','Ab','Db','Gb'].includes(songKey);

      textForLLM = `${textForLLM}

[내부 지시 — 유저에게 보이지 않음: 릭 악보 생성]
악보 예시를 만들 때, 반드시 아래 형식의 \`\`\`glick 코드 블록을 사용하세요.
이 블록은 자동으로 VexFlow 악보로 렌더링됩니다.

형식:
\`\`\`glick
{
  "key": "${songKey}-maj",
  "timeSignature": "4/4",
  "tempo": 180,
  "label": "릭 설명",
  "measures": [
    {
      "chord": "코드명",
      "notes": [
        {"keys": ["f/4"], "duration": "8"},
        {"keys": ["a/4"], "duration": "8"},
        {"keys": ["c/5"], "duration": "q"}
      ]
    }
  ]
}
\`\`\`

노트 형식 규칙:
- keys: ["음이름/옥타브"] — 소문자, 예: "c/4", "g/4", "d/5"
- duration: "8"=8분, "q"=4분, "h"=2분, "16"=16분, 쉼표는 뒤에 "r" (예: "8r")
- accidentals: {"0":"b"} (플랫), {"0":"#"} (샵) — 키 시그니처 외 임시표만

키 시그니처 ${songKey} (${isFlat ? '플랫계' : '샵계'}) 자동 적용:
${songKey === 'Eb' ? `- Bb→"b/옥타브" (임시표 불필요), Eb→"e/옥타브", Ab→"a/옥타브"` :
  songKey === 'Bb' ? `- Bb→"b/옥타브" (임시표 불필요), Eb→"e/옥타브"` :
  songKey === 'F' ? `- Bb→"b/옥타브" (임시표 불필요)` :
  songKey === 'Ab' ? `- Bb→"b/옥타브", Eb→"e/옥타브", Ab→"a/옥타브", Db→"d/옥타브"+{"0":"b"}` :
  `- 모든 음은 그대로 (C major 기준)`}

권장 음역: b/3 ~ g/5
반드시 4/4 박자 기준 각 마디 합계가 4박이 되도록 하세요.
각 \`\`\`glick 은 2~4 마디로 구성하세요.

★ 가장 중요한 규칙 (어기면 사용자는 악보를 전혀 볼 수 없다):
1. **악보로 보여주는 모든 라인은 반드시 네가 직접 만든 \`\`\`glick 블록이어야 한다.** 이 답변에는 \`\`\`glick 블록이 최소 1개, 여러 라인을 추천하면 라인마다 1개씩(최대 3개) 들어가야 한다. glick 없이 글로만 라인을 묘사하면 사용자 화면엔 악보가 안 나온다.
2. **특정 연주자의 실제 솔로/녹음을 인용하거나 "들어보세요/느껴보세요" 식으로 있는 것처럼 설명하지 마라.** (예: "Bud Powell의 Celia에 나오는 라인" ❌) 너는 그 음원을 가져올 수 없다. "○○ 스타일로 만든 예시"처럼 네가 생성한 라인만 제시하고, 그 라인을 \`\`\`glick 으로 그려라.
3. 각 라인은: 짧은 설명(스타일/어프로치/텐션 1~2문장) → 바로 다음 줄에 그 라인의 \`\`\`glick 블록, 순서로 작성하라.
4. 텍스트 설명을 먼저, JSON(\`\`\`glick)이 답변 맨 앞에 오면 안 된다.`;
    }

    const aiMsg: MessageWithDebug = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      // 채팅 타이핑 경로: 릭 카드를 결정적으로 인라인 렌더(lickInline). 💡 버튼
      // 경로(handleRequestLicks)만 lickProgressionLabel + 하단 탭 패널을 쓴다.
      ...(lickMatchesForMsg.length > 0
        ? { lickMatches: lickMatchesForMsg, lickInline: true, lickInlineLabel: lickProgressionLabelForMsg }
        : {}),
      ...(savedLickMatchesForMsg ? { savedLickMatches: savedLickMatchesForMsg } : {}),
    };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setLoading(true);

    const selectedChordContext = buildSelectedChordContext(selectedChords);
    let contextForModel = appendSelectedChordContext(chordContext, selectedChordContext);

    // Solo / line / note-level question → attach the per-note dump of the
    // selected NoteSheet range so the model can reason about specific pitches,
    // rhythms, approach tones, voice leading, etc. We only attach when both
    // (a) a selection exists with note data and (b) the question keyword
    // signals note-level intent — otherwise token-cheap chord-only context.
    if (notesContext && NOTE_LEVEL_KEYWORDS.test(text)) {
      contextForModel = [contextForModel, notesContext].filter(Boolean).join('\n\n');
    }

    /* Fresh abort controller for this turn. Stop button calls .abort(). */
    const ac = new AbortController();
    abortRef.current = ac;
    // historyRef가 이 스트림 도중 교체(채팅 전환/클리어)되면 epoch가 달라진다 —
    // 완료 시 동일할 때만 이 턴을 히스토리에 커밋한다.
    const historyEpoch = historyEpochRef.current;

    /* Lick-recommendation and glick-generation turns MUST use the local
     * HarmoRAG path: only that path sends `textForLLM` (the grounding
     * that suppresses hallucinated licks + tells the model the DB cards
     * render automatically). The backend chat only persists the raw
     * `text`, so routing these through it reproduces the "할루시네이션
     * 릭" bug. Ephemeral suggestion turns → skipping persistence is OK. */
    const forceLocalForLicks = lickMatchesForMsg.length > 0 || useGlickGen;

    /* Brand-new BACKEND chat (logged in, persisted, no id yet)? Drop an
     * optimistic spinner row into the sidebar now; the Recent Chats list polls
     * listChats() and swaps it for the real row once the backend has committed
     * the chat (it's created lazily on the first message, so it isn't listable
     * until the request lands). */
    const creatingNewChat = loggedIn && !forceLocalForLicks && !chatPublicIdRef.current;
    if (creatingNewChat) {
      setPendingChat({ songTitle, kind: chartKind ?? null });
    }

    /* Delegate the actual transport (backend with auto-fallback to local)
     * to runChatStream. Callbacks below patch the in-flight assistant
     * bubble + RAG debug panel as bytes arrive; the result object tells
     * us how to finalise the message (commit / abort badge / error). */
    const { finalText, aborted, error: streamError } = await runChatStream({
      text,
      textForLLM,
      images,
      contextForModel,
      songTitle,
      history: historyRef.current,
      chatPublicId: chatPublicIdRef.current,
      chartKind: chartKind ?? null,
      projectPublicId: projectPublicId ?? null,
      loggedIn,
      signal: ac.signal,
      forceLocal: forceLocalForLicks,
      onChunk: (accumulated) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, content: accumulated } : m)),
        );
      },
      onDebug: (debugInfo) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, ragDebug: debugInfo as RagDebugInfo } : m,
          ),
        );
      },
      onNewChatPublicId: (newId) => {
        if (newId !== chatPublicIdRef.current) {
          setChatPublicId(newId);
          setActiveChat(newId);
        }
        // Tag this brand-new chat as a chord/sheet-chart session so the Recent
        // Chats sidebar renders its icon + song name (client-side mirror of the
        // backend `category` we also send). The list REFRESH is deferred to
        // after the stream completes (below) — refreshing now (the header
        // arrives at stream start) races the backend's lazy chat commit.
        if (chartKind) {
          // Capture the chart's in-app route (HashRouter → location.hash) so the
          // sidebar can reopen this exact chart when the chat row is clicked.
          const route = typeof window !== 'undefined' && window.location.hash
            ? window.location.hash.replace(/^#/, '')
            : undefined;
          setChatChartMeta(newId, { kind: chartKind, songTitle, updatedAt: Date.now(), route });
        }
      },
    });

    /* Only commit to history when we actually produced an answer (no abort,
     * no error). On abort the partial reply stays visible but isn't fed
     * back into the LLM context. On error we surface a retry affordance. */
    if (!aborted && !streamError && historyEpoch === historyEpochRef.current) {
      historyRef.current.push(
        { role: 'user', content: text },
        { role: 'assistant', content: finalText },
      );
    }

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== aiMsgId) return m;
        if (aborted) {
          /* Keep whatever streamed in; mark so ChatMessage can show a
           * "사용자가 중단함" badge / regenerate affordance. */
          return { ...m, content: finalText || m.content, aborted: true };
        }
        if (streamError) {
          /* No usable reply — attach error + the failed prompt so the
           * inline Retry button can re-send the exact same turn. */
          return {
            ...m,
            content: '',
            error: streamError.message || '응답을 받지 못했습니다.',
            retryPrompt: text,
            retryImages: images,
          };
        }
        return { ...m, content: finalText };
      }),
    );
    setLoading(false);
    loadingRef.current = false;
    abortRef.current = null;

    /* Now that the stream has fully committed on the backend, refresh the
     * sidebar: a brand-new chat becomes listable (its pending placeholder is
     * swapped for the real row by the Recent Chats list's poll), and a
     * continued chat re-sorts by updatedAt. */
    if (loggedIn && !forceLocalForLicks) {
      notifyChatListChanged();
    }
  }, [chordContext, selectedChords, songTitle, notesContext, chartKind, projectPublicId, loggedIn, setChatPublicId]);

  /* Rebuild historyRef from the currently-visible messages, preserving
   * only clean user / assistant turns (skips error / aborted bubbles and
   * messages without textual content like the lick-recommend card).
   * Called from regenerate + edit-and-resend after slicing the array
   * so the LLM context stays in sync with what the user actually sees. */
  const rebuildHistoryFromMessages = useCallback((msgs: MessageWithDebug[]) => {
    const next: ClaudeMessage[] = [];
    for (const m of msgs) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      if (m.error) continue;
      if (m.aborted) continue;
      if (!m.content) continue;
      next.push({ role: m.role, content: m.content });
    }
    historyRef.current = next;
  }, []);

  /* Regenerate the last assistant turn. ChatMessage's onRegenerate handler
   * passes the assistant message id; we look up the preceding user
   * message, drop both bubbles, rebuild history, then re-run handleSend
   * with the same prompt. Bound to the LAST clean assistant message only
   * (see `lastRegenerableAssistantId` below) — regenerating mid-
   * conversation would orphan downstream turns. */
  const handleRegenerate = useCallback((assistantMsgId: string): void => {
    if (loading) return;
    const msgs = messagesRef.current;
    const idx = msgs.findIndex((m) => m.id === assistantMsgId);
    if (idx < 0) return;
    const prevUser = idx > 0 && msgs[idx - 1].role === 'user' ? msgs[idx - 1] : null;
    if (!prevUser) return;
    const prompt = prevUser.content;
    const sliced = msgs.slice(0, idx - 1);
    setMessages(sliced);
    rebuildHistoryFromMessages(sliced);
    void handleSend(prompt);
  }, [handleSend, loading, rebuildHistoryFromMessages]);

  /* Edit-a-past-user-message → branch. Drops the edited message + every
   * message after it (the conversation forks there), then re-sends the
   * new content as if the user just typed it. Mirrors Claude/ChatGPT
   * "edit message" semantics — older turns above stay visible. */
  const handleEditAndResend = useCallback((userMsgId: string, newContent: string): void => {
    if (loading) return;
    const trimmed = newContent.trim();
    if (!trimmed) return;
    const msgs = messagesRef.current;
    const idx = msgs.findIndex((m) => m.id === userMsgId);
    if (idx < 0) return;
    const sliced = msgs.slice(0, idx);
    setMessages(sliced);
    rebuildHistoryFromMessages(sliced);
    void handleSend(trimmed);
  }, [handleSend, loading, rebuildHistoryFromMessages]);

  /* Id of the most recent CLEAN assistant message — drives where the
   * Regenerate icon renders. Only the last clean turn gets the button
   * so mid-conversation regenerate (which would orphan downstream
   * messages) stays out of reach. */
  const lastRegenerableAssistantId = useMemo(() => {
    if (loading) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && !m.error && !m.aborted && m.content) return m.id;
    }
    return null;
  }, [messages, loading]);

  /* ── Virtual scroll (lightweight) ─────────────────────────────────────
   * Keeps only the most-recent VISIBLE_TAIL messages mounted in the DOM;
   * older turns collapse into a single "이전 메시지 N개 더 보기" affordance
   * that re-mounts the next batch on click. Avoids a full react-window
   * dependency while still preventing 200-turn chats from re-rendering
   * the world on every stream tick.
   *
   * - `revealOlder` adds VISIBLE_STEP more turns to the visible window.
   * - Resets to the tail whenever a new chat is opened (messages
   *   reference identity changes via sidebar load).
   * - For chats under VISIBLE_TAIL turns nothing changes — visibleMessages
   *   === messages. */
  const VISIBLE_TAIL = 60;
  const VISIBLE_STEP = 60;
  const [windowEnd, setWindowEnd] = useState(VISIBLE_TAIL);
  /* Pin the window to the tail whenever messages array shrinks (new
   * chat loaded, edit-and-resend, etc.) so we don't sit on a stale
   * offset that's larger than the new total. */
  useEffect(() => {
    if (messages.length < windowEnd) setWindowEnd(Math.max(VISIBLE_TAIL, messages.length));
  }, [messages.length, windowEnd]);
  const hiddenCount = Math.max(0, messages.length - windowEnd);
  const visibleMessages = hiddenCount > 0 ? messages.slice(-windowEnd) : messages;
  const revealOlder = () => setWindowEnd((n) => n + VISIBLE_STEP);

  return (
    <PanelContainer>
      {!hideHeader && (
        <PanelHeader>
          <span>🎵 {songTitle || 'Jazzify AI'}</span>
          {/* Export row is ALWAYS mounted so the header height doesn't jump
           *  when the first message arrives. When the chat is empty the
           *  buttons are visually hidden + non-interactive but still
           *  occupy their natural space. */}
          <ExportRow
            style={messages.length === 0
              ? { visibility: 'hidden', pointerEvents: 'none' }
              : undefined}
            aria-hidden={messages.length === 0}
          >
            <ExportBtn
              type="button"
              title="대화를 Markdown 파일로 내보내기"
              tabIndex={messages.length === 0 ? -1 : 0}
              onClick={() => exportChatAsMarkdown(messages, songTitle)}
            >
              <ExportIcon /> 내보내기
            </ExportBtn>
            <ExportBtn
              type="button"
              title="대화를 클립보드에 복사"
              tabIndex={messages.length === 0 ? -1 : 0}
              onClick={() => void copyChatToClipboard(messages, songTitle)}
            >
              <CopyShareIcon /> 복사
            </ExportBtn>
          </ExportRow>
        </PanelHeader>
      )}

      {inputAtTop && (
        <IntroInputSlot style={{ marginTop: 8, marginBottom: 8 }}>
          <IntroChatInput
            onSend={handleSend}
            disabled={loading}
            isStreaming={loading}
            onStop={stopGeneration}
            compact
            isSelectionMode={isSelectionMode}
            onToggleSelectionMode={onToggleSelectionMode}
            selectedChords={selectedChords}
            onClearSelectedChords={onClearSelectedChords}
            onRequestLicks={handleRequestLicks}
            hideSelectionQuickAction={hideSelectionQuickAction}
            placeholder={inputPlaceholder}
            autoFocus={autoFocusInput}
          />
        </IntroInputSlot>
      )}

      <MessagesArea
        ref={messagesAreaRef}
        onScroll={handleScroll}
        style={
          messages.length === 0 && inputInIntro
            ? nativeIntroLayout
              /* Native: IntroBlock claims flex:1 + self-centers (see its
               *  mobile @media in HomePage). Input is at the end of the
               *  flex flow. PanelContainer translateY handles keyboard. */
              ? { justifyContent: 'flex-start', padding: 0 }
              /* Web: hero + input centered as a group. */
              : { justifyContent: 'center' }
            /* chord/note pages: default top alignment — EmptyState sits up
             *  top while the bottom-pinned input keeps the disclaimer at the
             *  very bottom of the panel. */
            : undefined
        }
      >
        {chatLoading && messages.length === 0 && (
          <ChatLoadingState>
            <ChatLoadingSpinner aria-hidden />
            <span>채팅 불러오는 중…</span>
          </ChatLoadingState>
        )}

        {!chatLoading && messages.length === 0 && (
          emptyState ?? (
            <EmptyState>
              <EmptyIcon src="/jazzifylogo.png" alt="Jazzify" />
              악보에서 코드를 클릭하거나,
              <br />
              아래에서 질문을 입력해보세요.
              <EmptyActionGroup>
                <EmptyActionButton
                  type="button"
                  onClick={() => handleSend('전체 코드 진행 분석해줘')}
                  disabled={loading}
                >
                  🎼 전체 코드 진행 분석해줘
                </EmptyActionButton>
                <EmptyActionButton
                  type="button"
                  onClick={() => handleSend('여기에서 쓸 수 있는 솔로 아이디어 줘')}
                  disabled={loading}
                >
                  🎷 여기에서 쓸 수 있는 솔로 아이디어 줘
                </EmptyActionButton>
              </EmptyActionGroup>
            </EmptyState>
          )
        )}

        {/* Web-only intro inline input (Claude desktop pattern). On native
         *  the IntroChatInput is rendered as a sibling at the bottom of
         *  PanelContainer (see below) so it sticks above the keyboard and
         *  persists even after the first message. */}
        {messages.length === 0 && inputInIntro && !inputAtTop && !nativeIntroLayout && (
          /* Empty-state input is wider than the post-chat one to match the
           * roomier hero column. Inline maxWidth overrides the styled
           * IntroInputSlot's default 760 cap. $hideFade because there are no
           * messages above to fade out from — the gradient would look like a
           * stray band floating on empty background. */
          <IntroInputSlot style={{ maxWidth: '950px' }} $hideFade>
            <IntroChatInput
              onSend={handleSend}
              disabled={loading}
              isStreaming={loading}
              onStop={stopGeneration}
              placeholder={inputPlaceholder}
              autoFocus={autoFocusInput}
            />
          </IntroInputSlot>
        )}

        {hiddenCount > 0 && (
          <RevealOlderBtn type="button" onClick={revealOlder}>
            이전 메시지 {hiddenCount}개 더 보기
          </RevealOlderBtn>
        )}
        {visibleMessages.map((msg, msgIdx) => (
          <div key={msg.id}>
            {msg.ragDebug && <RagDebugPanel info={msg.ragDebug} />}
            <ChatMessage
              message={msg}
              suppressChart={!!chordContext}
              songTempo={songTempo}
              onLickShowInline={onLickShowInline}
              activeInlineLickId={activeInlineLickId}
              /* The streaming reply is always the last assistant bubble while
               * `loading`. ChatMessage uses this to hold the deterministic
               * lick-card fallback until the stream finishes (so cards don't
               * flicker bottom→inline as [LICK:id] tags arrive). */
              isStreaming={loading && msgIdx === visibleMessages.length - 1 && msg.role === 'assistant'}
              citations={msg.ragDebug?.chunks}
              /* Inline retry — wired only on the errored assistant
               * message (ChatMessage hides the button otherwise). Re-runs
               * the original turn with the cached prompt + images. */
              onRetry={
                msg.role === 'assistant' && msg.error && msg.retryPrompt
                  ? () => {
                      const prompt = msg.retryPrompt!;
                      const imgs = msg.retryImages;
                      /* Drop the failed bubbles (the user msg + the
                       * errored assistant placeholder) so the retry adds
                       * fresh ones, not a "second attempt below the
                       * first" double-up. */
                      setMessages((prev) => {
                        const idx = prev.findIndex((m) => m.id === msg.id);
                        if (idx < 0) return prev;
                        /* The matching user message sits immediately
                         * before the errored assistant one (they were
                         * pushed in pairs by handleSend). */
                        const start = idx > 0 && prev[idx - 1].role === 'user' ? idx - 1 : idx;
                        return prev.slice(0, start).concat(prev.slice(idx + 1));
                      });
                      void handleSend(prompt, undefined, imgs); // 이미 ClaudeImage[] — 변환 경로 우회
                    }
                  : undefined
              }
              /* Regenerate icon shows only on the most-recent clean
               * assistant turn (avoid orphaning downstream messages). */
              onRegenerate={
                msg.role === 'assistant' && msg.id === lastRegenerableAssistantId
                  ? () => handleRegenerate(msg.id)
                  : undefined
              }
              /* Hover-edit on user messages — saving forks the chat
               * there and re-sends the new content. */
              onEditUserMessage={
                msg.role === 'user' && !loading
                  ? (next: string) => handleEditAndResend(msg.id, next)
                  : undefined
              }
            />
          </div>
        ))}

        <div ref={messagesEndRef} />
      </MessagesArea>

      {/* Native: IntroChatInput is permanent at the bottom of the panel
       *  (flex flow). The whole PanelContainer translates up by the
       *  keyboard height so the input rides above the keyboard and the
       *  hero lifts in lockstep — single GPU transform, smooth. */}
      {nativeIntroLayout && !inputAtTop && (
        <IntroInputSlot
          /* No messages yet → nothing scrollable above to fade out from, so
           * suppress the top gradient strip (it would otherwise look like a
           * stray band floating over the empty hero area). */
          $hideFade={messages.length === 0}
          style={{
            margin: 0,
            paddingBottom: keyboardOffsetPx > 0 ? '8px' : 'max(12px, env(safe-area-inset-bottom, 0px))',
            transform: keyboardOffsetPx
              ? `translateY(${-keyboardOffsetPx}px)`
              : 'translateY(0)',
            transition: 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
            willChange: 'transform',
          }}
        >
          <IntroChatInput
            onSend={handleSend}
            disabled={loading}
            isStreaming={loading}
            onStop={stopGeneration}
            placeholder={
              messages.length === 0 ? inputPlaceholder : 'Jazzify AI에게 응답하기'
            }
            autoFocus={messages.length === 0 ? autoFocusInput : false}
          />
        </IntroInputSlot>
      )}

      {/* Web intro, mid-conversation: keep the IntroChatInput pinned at the
       *  bottom so the design stays continuous with the empty-state hero.
       *  (Native handles this via the nativeIntroLayout branch above.) */}
      {inputInIntro && !nativeIntroLayout && !inputAtTop && messages.length > 0 && (
        <IntroInputSlot style={{ marginTop: 0, marginBottom: 16 }}>
          <IntroChatInput
            onSend={handleSend}
            disabled={loading}
            isStreaming={loading}
            onStop={stopGeneration}
            placeholder={inputPlaceholder}
            compact
          />
        </IntroInputSlot>
      )}

      {/* Web non-intro case: bottom-pinned input (chord / note pages).
       *  Uses the same IntroChatInput as the main page (compact) so the
       *  design is identical everywhere. Chord-selection chips render above
       *  the box. This stays pinned to the panel bottom in BOTH the empty
       *  state and mid-conversation, so the disclaimer always sits at the
       *  very bottom of the panel. */}
      {!nativeIntroLayout && !inputAtTop && !inputInIntro && (
        <IntroInputSlot style={{ marginTop: 0, marginBottom: 16, paddingLeft: 16, paddingRight: 16 }}>
          <IntroChatInput
            onSend={handleSend}
            disabled={loading}
            isStreaming={loading}
            onStop={stopGeneration}
            compact
            isSelectionMode={isSelectionMode}
            onToggleSelectionMode={onToggleSelectionMode}
            selectedChords={selectedChords}
            onClearSelectedChords={onClearSelectedChords}
            onRequestLicks={handleRequestLicks}
            hideSelectionQuickAction={hideSelectionQuickAction}
            dropUpMenu
            placeholder={inputPlaceholder}
            autoFocus={autoFocusInput}
          />
        </IntroInputSlot>
      )}

      {showScrollBtn && (
        <ScrollToBottomBtn
          onClick={scrollToBottom}
          aria-label="맨 아래로"
          title="맨 아래로"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14" />
            <path d="M5 12l7 7 7-7" />
          </svg>
        </ScrollToBottomBtn>
      )}
    </PanelContainer>
  );
}
