import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import type { ChatMessage as ChatMessageType, ChordOverlay } from '../../data/types';
import { ChatMessage } from '../chat/ChatMessage';
import { ChatInput } from '../chat/ChatInput';
import { type ClaudeMessage } from '../../api/claude';
import { streamWithRAG, type RagDebugInfo } from '../../api/harmorag';
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
} from './RightChatPanel.styles';

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
}: RightChatPanelProps) {
  const [messages, setMessages] = useState<MessageWithDebug[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const isScrolledUpRef = useRef(false);
  const historyRef = useRef<ClaudeMessage[]>([]);
  const allLicksRef = useRef<LickEntry[]>([]);

  // 릭 추천 풀: 백엔드 릭 DB (jazzify.p-e.kr/api/v1/licks). 예전엔 프론트
  // 정적 JSON(user_licks.json)을 봤지만, 릭이 백엔드로 이관되어 그쪽을 단일
  // 소스로 사용. 실패 시 빈 배열 — 채팅은 LLM 답변으로 폴백된다.
  useEffect(() => {
    loadLicks()
      .then((licks) => { allLicksRef.current = licks; })
      .catch((err) => {
        console.warn('[RightChatPanel] 릭 DB 로드 실패 — 릭 추천 비활성:', err);
        allLicksRef.current = [];
      });
  }, []);

  const handleScroll = useCallback(() => {
    if (!messagesAreaRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesAreaRef.current;
    // 50px 이상 위로 올렸으면 자동스크롤 중지
    isScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 50;
  }, []);

  useEffect(() => {
    if (!isScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages]);

  useEffect(() => {
    setMessages([]);
    historyRef.current = [];
  }, [songTitle]);

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

  const handleSend = useCallback(async (text: string) => {
    isScrolledUpRef.current = false;

    const userMsg: MessageWithDebug = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      selectedChords: snapshotSelectedChords(selectedChords),
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
    if (isLickQuery) {
      const keyMatch = chordContext?.match(/Key:\s*([A-G][b#♭]?)/);
      const songKey = (keyMatch ? keyMatch[1] : 'C').replace('♭', 'b');
      const chordsForMatch = selectedChords.length > 0 ? selectedChords : [];
      lickMatchesForMsg = findMatchingLicks(chordsForMatch, songTitle, songKey, allLicksRef.current, 5);

      // 코드를 직접 선택하지 않고 "2-5-1 추천" / "ii-V-I lick" 같은 키워드만 던진
      // 경우엔 findMatchingLicks 가 빈 배열을 반환. 진행 키워드를 감지해서 DB
      // 전체에서 해당 진행을 포함하는 릭을 샘플링한다.
      if (lickMatchesForMsg.length === 0) {
        const prog = detectProgressionKeyword(text);
        if (prog) {
          lickMatchesForMsg = findLicksByProgression(prog, allLicksRef.current, 5);
        }
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

    // AI 릭 생성 요청: glick JSON 코드 블록 출력 지시
    if (isGenQuery) {
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

    const finalText = await streamWithRAG(
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
    );

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

      <MessagesArea ref={messagesAreaRef} onScroll={handleScroll}>
        {messages.length === 0 && (
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

        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.ragDebug && <RagDebugPanel info={msg.ragDebug} />}
            <ChatMessage message={msg} suppressChart={!!chordContext} songTempo={songTempo} />
          </div>
        ))}

        <div ref={messagesEndRef} />
      </MessagesArea>

      <ChatInput
        onSend={handleSend}
        disabled={loading}
        isSelectionMode={isSelectionMode}
        onToggleSelectionMode={onToggleSelectionMode}
        selectedChords={selectedChords}
        onClearSelectedChords={onClearSelectedChords}
        onRequestLicks={handleRequestLicks}
      />
    </PanelContainer>
  );
}
