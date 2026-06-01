import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import type { ChatMessage as ChatMessageType, ChordOverlay } from '../../data/types';
import { ChatMessage } from '../chat/ChatMessage';
import { IntroChatInput } from '../chat/IntroChatInput';
import { type ClaudeMessage, type ClaudeImage } from '../../api/claude';
import { streamWithRAG, type RagDebugInfo } from '../../api/harmorag';
import {
  streamChat as backendStreamChat,
  getChat as backendGetChat,
  onActiveChatChange,
  setActiveChat,
  notifyChatListChanged,
  toBackendHistory,
  toBackendImages,
} from '../../api/chat';
import { getCachedUser, onAuthChange } from '../../api/auth';
import { RagDebugPanel } from '../chat/RagDebugPanel';
import {
  findMatchingLicks,
  selectionProgressionLabel,
  findLicksByProgression,
  detectProgressionKeyword,
} from '../../lib/lickMatcher';
import { loadLicks, loadUserLicksSync } from '../../data/lickData';
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
  chordContext?: string;
  isSelectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  onClearSelectedChords?: () => void;
  songTempo?: number;
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
  chordContext,
  isSelectionMode = false,
  onToggleSelectionMode,
  onClearSelectedChords,
  songTempo,
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

  useEffect(() => {
    onMessagesChange?.(messages.length);
  }, [messages.length, onMessagesChange]);
  const [loading, setLoading] = useState(false);
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

  /* Sidebar dispatched a chat selection → load it (or clear on null).
   * Skips the load if the requested id is already open, which avoids a
   * redundant fetch when the right panel itself emitted the change after
   * creating a fresh chat. chatLoading drives the placeholder shown in the
   * MessagesArea so the UI never looks "frozen" while GET /v1/chat is in
   * flight. */
  useEffect(() => {
    const unsub = onActiveChatChange(async (id) => {
      if (id === chatPublicIdRef.current) return;
      if (id === null) {
        setChatPublicId(null);
        setMessages([]);
        historyRef.current = [];
        setChatLoading(false);
        return;
      }
      setChatLoading(true);
      try {
        const detail = await backendGetChat(id);
        const msgs: MessageWithDebug[] = (detail.messages || [])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            id: `db-${m.publicId}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: new Date(m.createdAt).getTime() || Date.now(),
          }));
        setChatPublicId(id);
        setMessages(msgs);
        historyRef.current = msgs.map((m) => ({ role: m.role, content: m.content }));
        isScrolledUpRef.current = false;
      } catch (e) {
        console.error('[chat] load failed:', e);
      } finally {
        setChatLoading(false);
      }
    });
    return unsub;
  }, [setChatPublicId]);

  /* 릭 추천 풀: 백엔드 lick DB (jazzify.p-e.kr/api/v1/licks)만 유일 소스.
   * 정적 frontend 풀(public/data/licks/licks.json)은 폴백으로도 쓰지 않음 —
   * 채팅 추천 결과의 권위성은 백엔드 curated 릭으로 단일화. 백엔드가 비어
   * 있으면 채팅 추천도 비는 게 정상 동작. */
  useEffect(() => {
    loadLicks()
      .then((licks) => { allLicksRef.current = licks; })
      .catch((err) => {
        console.warn('[RightChatPanel] 백엔드 lick DB 로드 실패 — 릭 추천 비활성:', err);
        allLicksRef.current = [];
      });
  }, []);

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
    setMessages([]);
    historyRef.current = [];
    /* Switching songs starts a fresh ad-hoc chat — drop the backend chat
     * pointer too so the next message creates a new chat (and the sidebar
     * highlight clears). The user can still re-open the previous chat from
     * the sidebar list. */
    setChatPublicId(null);
    setActiveChat(null);
  }, [songTitle, setChatPublicId]);

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

  const handleSend = useCallback(async (text: string, files?: File[]) => {
    isScrolledUpRef.current = false;

    // 첨부 이미지 → Claude 비전 블록(base64). 비이미지(PDF 등)는 건너뜀.
    const images: ClaudeImage[] = files && files.length > 0
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
    const LICK_QUERY_KEYWORDS = /릭|라인|line|lick|솔로.*예시|예시.*솔로|연주.*예|거장|추천.*솔로/i;
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
      lickMatchesForMsg = findMatchingLicks(chordsForMatch, songTitle, songKey, allLicksRef.current, 5);

      // 코드를 직접 선택하지 않고 "2-5-1 추천" / "ii-V-I lick" 같은 키워드만 던진
      // 경우엔 findMatchingLicks 가 빈 배열을 반환. 진행 키워드를 감지해서 DB
      // 전체에서 해당 진행을 포함하는 릭을 샘플링한다.
      const detectedProg = detectProgressionKeyword(text);
      if (lickMatchesForMsg.length === 0 && detectedProg) {
        lickMatchesForMsg = findLicksByProgression(detectedProg, allLicksRef.current, 5);
      }

      // LickRecommendList 패널(VexFlow + 저장/플레이/정지) 렌더 트리거.
      // ChatMessage 는 lickProgressionLabel 이 설정된 경우에만 패널을 띄우고,
      // 그렇지 않으면 LLM 본문에서 [LICK:id] 인라인 태그가 나오길 기대한다.
      // 백엔드 경로에서는 LLM 이 내부 지시를 받지 못하므로 항상 패널 모드로
      // 렌더되도록 label 을 항상 세팅한다. (로컬 경로에서 LLM 이 인라인
      // 태그를 박는다면 ChatMessage 가 그 경우 패널을 자동으로 숨긴다.)
      if (lickMatchesForMsg.length > 0) {
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
          (chordsForMatch.length > 0 ? selectionProgressionLabel(chordsForMatch) : '추천 릭');
        const savedPool = loadUserLicksSync();
        const savedRaw = chordsForMatch.length > 0
          ? findMatchingLicks(chordsForMatch, songTitle, songKey, savedPool, 5)
          : (detectedProg ? findLicksByProgression(detectedProg, savedPool, 5) : []);
        if (savedRaw.length > 0) savedLickMatchesForMsg = savedRaw;
      }

      if (lickMatchesForMsg.length > 0) {
        const lickList = lickMatchesForMsg.map((m) => {
          const l = m.lick;
          const chordsStr = l.chords.slice(0, 4).join(' → ');
          return `  [LICK:${l.id}] 연주자: ${l.performer} | 곡: ${l.title} | 키: ${l.key} | 진행: ${chordsStr}`;
        }).join('\n');

        textForLLM = `${text}

[내부 지시 — 유저에게 보이지 않음: 릭 카드 삽입]
아래는 DB에서 매칭된 실제 릭 목록입니다. 답변 안에서 각 릭을 자연스럽게 소개하면서 \`[LICK:아이디]\` 태그를 해당 위치에 삽입하세요. 이 태그는 자동으로 악보 카드로 렌더링됩니다.

사용 가능한 릭:
${lickList}

엄격한 규칙:
1. **메시지를 절대 [LICK:id] 태그로 시작하지 마세요.** 반드시 자연스러운 대화체 한국어 문장으로 먼저 운을 띄우세요. (예: "오, 그 진행이라면 좋은 예시가 하나 떠오르네요." / "이런 라인은 어떠세요?")
2. 각 릭을 소개할 때는 **먼저 글로 누구의 어떤 곡인지, 왜 참고할 만한지 짧게 설명한 뒤**, 그 다음 줄에 \`[LICK:id]\` 태그를 단독으로 놓으세요. 절대 설명 전에 태그를 먼저 두지 마세요.
3. 태그 뒤에는 그 릭에서 주목할 포인트(어떤 어프로치, 텐션, 리듬 등)를 한두 문장으로 덧붙여 자연스럽게 다음 흐름으로 이어가세요.
4. 위 목록에 없는 id는 사용하지 마세요. 모든 릭을 다 보여줄 필요는 없습니다 — 문맥상 가장 어울리는 1~3개만 골라 소개하세요.

이상적인 응답 흐름 예시:
"그 진행이라면 거장들의 라인을 한번 참고해보면 좋을 것 같아요.

먼저, [연주자]가 [곡]에서 연주한 라인인데, [어떤 점이 좋은지 한 줄] —

[LICK:아이디]

여기서 특히 [어떤 부분]이 인상적이에요. 비슷한 느낌으로는 [다른 연주자]의 솔로도 있는데요,

[LICK:아이디]

이쪽은 [어떤 차이점]이 있어서 또 다른 맛이 있죠. 한번 들어보시고 느낌이 어떤지 알려주세요!"`;
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
2~4 마디로 구성하세요.
중요: 반드시 텍스트 설명을 먼저 완전히 작성하고, glick 블록은 답변 맨 마지막에만 넣으세요. JSON이 먼저 나오면 안 됩니다.`;
    }

    const aiMsg: MessageWithDebug = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      ...(lickMatchesForMsg.length > 0 ? { lickMatches: lickMatchesForMsg } : {}),
      ...(lickProgressionLabelForMsg ? { lickProgressionLabel: lickProgressionLabelForMsg } : {}),
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

    /* When the user is logged in, route through the Jazzify backend so the
     * conversation is saved (and shows up in the sidebar list). Falls back
     * to the local RAG/Claude path on error or when not logged in.
     *
     * EXCEPTION: lick-recommendation and AI-score-generation queries MUST use
     * the local path — the backend chat only receives the raw user text, so it
     * never gets `textForLLM` (the [LICK:id] / ```glick instructions) and never
     * engages HarmoRAG. Sending those through the backend produced the
     * "no RAG + no VexFlow lick card + slow" bug. These queries are ephemeral
     * suggestions, so skipping backend persistence is an acceptable trade-off. */
    let finalText = '';
    let backendOk = false;
    if (loggedIn && !isLickQuery && !isGenQuery) {
      try {
        /* DB에 영속화되는 message 필드는 항상 raw user text만. textForLLM에
         * 부착되는 `[내부 지시 — 유저에게 보이지 않음:` 블록을 그대로 보내면
         * 백엔드가 user 메시지로 저장 → 사이드바 재로드 시 유저에게 그대로
         * 노출되는 누출이 발생함. 백엔드 LLM은 message + chordContext + history
         * 만 받게 되므로 [LICK:id] / ```glick 같은 클라 전용 지시는 백엔드
         * 경로에서 작동하지 않음(이미 회귀 중인 기능이므로 의도된 트레이드오프). */
        finalText = await backendStreamChat(
          {
            message: text,
            history: toBackendHistory(historyRef.current),
            chordContext: contextForModel || undefined,
            songTitle: songTitle || undefined,
            images: toBackendImages(images),
            chatPublicId: chatPublicIdRef.current ?? undefined,
          },
          (accumulated) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === aiMsgId ? { ...m, content: accumulated } : m)),
            );
          },
          (newId) => {
            /* First message of a brand-new chat → server assigned an id.
             * Save it for continuation + sync the sidebar selection so the
             * new chat shows up highlighted as it appears in the list. */
            if (newId !== chatPublicIdRef.current) {
              setChatPublicId(newId);
              setActiveChat(newId);
            }
          },
        );
        backendOk = true;
        notifyChatListChanged();
      } catch (e) {
        console.warn('[chat] backend stream failed, falling back to local:', e);
      }
    }
    if (!backendOk) {
      finalText = await streamWithRAG(
        textForLLM,
        historyRef.current,
        contextForModel,
        songTitle,
        (accumulated) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, content: accumulated } : m)),
          );
        },
        // RAG 디버그 정보 수신 → 해당 메시지에 attach
        (debugInfo) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, ragDebug: debugInfo } : m)),
          );
        },
        images,
      );
    }

    historyRef.current.push(
      { role: 'user', content: text },
      { role: 'assistant', content: finalText },
    );

    setMessages((prev) =>
      prev.map((m) => (m.id === aiMsgId ? { ...m, content: finalText } : m)),
    );
    setLoading(false);
  }, [chordContext, selectedChords, songTitle, notesContext]);

  return (
    <PanelContainer>
      {!hideHeader && (
        <PanelHeader>
          🎵 {songTitle || 'Jazzify AI'}
        </PanelHeader>
      )}

      {inputAtTop && (
        <IntroInputSlot style={{ marginTop: 8, marginBottom: 8 }}>
          <IntroChatInput
            onSend={handleSend}
            disabled={loading}
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
              placeholder={inputPlaceholder}
              autoFocus={autoFocusInput}
            />
          </IntroInputSlot>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.ragDebug && <RagDebugPanel info={msg.ragDebug} />}
            <ChatMessage message={msg} suppressChart={!!chordContext} songTempo={songTempo} citations={msg.ragDebug?.chunks} />
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
            placeholder={
              messages.length === 0 ? inputPlaceholder : 'Claude에게 응답하기'
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
