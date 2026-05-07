import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage as ChatMessageType, ChordOverlay } from '../../data/types';
import { ChatMessage } from '../chat/ChatMessage';
import { ChatInput } from '../chat/ChatInput';
import { type ClaudeMessage } from '../../api/claude';
import { streamWithRAG, type RagDebugInfo } from '../../api/harmorag';
import { findMatchingLicks, selectionProgressionLabel } from '../../lib/lickMatcher';
import { loadUserLicks, loadUserLicksSync } from '../../data/lickData';
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
}

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
}: RightChatPanelProps) {
  const [messages, setMessages] = useState<MessageWithDebug[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const isScrolledUpRef = useRef(false);
  const historyRef = useRef<ClaudeMessage[]>([]);
  const allLicksRef = useRef<LickEntry[]>([]);

  // seed + local 릭 마운트 시 로드
  useEffect(() => {
    loadUserLicks().then((licks) => { allLicksRef.current = licks; });
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

    // AI 악보 생성 요청 감지 — "예시 보여줘", "만들어줘" 류 모두 포함
    const GEN_KEYWORDS = /만들어|생성|작성|직접|그려줘?|generate|compose|짜봐|짜줘|써줘|(솔로|릭|라인|line).*(예시|보여|보여줘)|예시.*악보|악보.*예시/i;
    const isGenQuery = GEN_KEYWORDS.test(text);

    // LLM에게 보낼 실제 메시지 (유저에게는 원본 text만 보임)
    let textForLLM = text;

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
      // 릭 카드는 💡 버튼(handleRequestLicks)에서만 설정. 일반 채팅은 텍스트만.
    };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setLoading(true);

    const selectedChordContext = buildSelectedChordContext(selectedChords);
    const contextForModel = appendSelectedChordContext(chordContext, selectedChordContext);

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
  }, [chordContext, selectedChords, songTitle]);

  return (
    <PanelContainer>
      <PanelHeader>
        🎵 {songTitle || 'Jazzify AI'}
      </PanelHeader>

      <MessagesArea ref={messagesAreaRef} onScroll={handleScroll}>
        {messages.length === 0 && (
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
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            <ChatMessage message={msg} suppressChart={!!chordContext} />
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
