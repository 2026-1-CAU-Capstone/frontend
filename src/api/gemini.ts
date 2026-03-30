const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GEMINI_MODEL = 'gemini-2.5-pro';
const GEMINI_STREAM_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

const BASE_SYSTEM = `You are Jazzify AI, a jazz harmony expert and educator.
Respond in the same language the user writes in (Korean or English).
Keep explanations concise but insightful. Use music theory terminology with brief explanations.
Format with markdown: use **bold** for chord symbols and key terms, bullet points for lists.`;

export type AnalysisCategory =
  | 'overview'
  | 'functional'
  | 'iiVI'
  | 'secondary'
  | 'modal'
  | 'improv';

export const ANALYSIS_CATEGORIES: { id: AnalysisCategory; label: string; emoji: string; prompt: string }[] = [
  {
    id: 'overview',
    label: 'Overview',
    emoji: '🎼',
    prompt: `Provide a concise overview of this chord progression:
- Overall harmonic structure and form (A/B sections, turnarounds)
- Key center(s) and any modulations
- Most notable harmonic features (in 2-3 bullet points)
- General character and style of the harmony
Keep it short — this is a summary, not deep analysis.`,
  },
  {
    id: 'functional',
    label: 'Functional Harmony',
    emoji: '🔗',
    prompt: `Analyze the functional harmony of this progression:
- Label each chord's function: Tonic (T), Subdominant (SD), Dominant (D)
- Show the functional flow bar-by-bar (e.g. T → D → D → SD → ...)
- Highlight any unusual functional assignments
- Explain the overall tonal trajectory and cadence points
Present as a clear bar-by-bar table or flow, then explain key moments.`,
  },
  {
    id: 'iiVI',
    label: 'ii-V-I Patterns',
    emoji: '🔄',
    prompt: `Identify and explain all ii-V-I patterns and their variants:
- List every ii-V-I (complete and incomplete) with bar numbers
- Note variants: minor ii-V-i, tritone subs, backdoor ii-Vs
- Explain how each ii-V resolves (or doesn't)
- Show the chain/connection between consecutive ii-V-I patterns
Format each pattern clearly with bar numbers and chord symbols.`,
  },
  {
    id: 'secondary',
    label: 'Secondary Dominants',
    emoji: '⚡',
    prompt: `Analyze all secondary dominants and dominant chains:
- List every secondary dominant with its target (V/vi, V/ii, V/V, etc.)
- Track dominant chains (sequences of V→V→V resolving down)
- Note which secondary dominants resolve and which are deceptive
- Explain the voice leading that makes each secondary dominant work
Show the chain of dominants as a clear progression diagram.`,
  },
  {
    id: 'modal',
    label: 'Modal Interchange',
    emoji: '🎨',
    prompt: `Analyze modal interchange and borrowed chords:
- Identify every non-diatonic chord that comes from a parallel mode
- Specify the source mode (minor, dorian, phrygian, lydian, etc.)
- Explain the emotional/color effect of each borrowed chord
- Note any chromatic voice leading created by modal interchange
If there are no clear modal interchange chords, explain why the non-diatonic chords are better analyzed differently.`,
  },
  {
    id: 'improv',
    label: 'Improvisation',
    emoji: '🎹',
    prompt: `Give practical improvisation advice for this progression:
- Suggest scales/modes for each chord or chord group
- Highlight guide tones and voice leading paths across changes
- Point out chromatic approach opportunities
- Suggest target notes for key resolution points
- Note any "tricky" changes that need special attention
Be specific with note names and scale choices, not just generic advice.`,
  },
];

function getSystemInstruction(category?: AnalysisCategory): string {
  if (!category) return BASE_SYSTEM;
  const cat = ANALYSIS_CATEGORIES.find((c) => c.id === category);
  if (!cat) return BASE_SYSTEM;
  return `${BASE_SYSTEM}\n\n[Analysis Focus: ${cat.label}]\n${cat.prompt}`;
}

/**
 * Stream Gemini response, calling onChunk with accumulated text as each SSE arrives.
 * Returns the final full text.
 */
export async function streamGeminiMessage(
  userMessage: string,
  history: GeminiMessage[],
  chordContext: string | undefined,
  onChunk: (accumulated: string) => void,
  category?: AnalysisCategory,
): Promise<string> {
  if (!GEMINI_API_KEY) {
    return '[Error] VITE_GEMINI_API_KEY not set in .env';
  }

  let fullUserMessage = userMessage;
  if (chordContext) {
    fullUserMessage = `[Chord Analysis Context]\n${chordContext}\n\n[User Question]\n${userMessage}`;
  }

  const contents: GeminiMessage[] = [
    ...history,
    { role: 'user', parts: [{ text: fullUserMessage }] },
  ];

  const body = {
    system_instruction: {
      parts: [{ text: getSystemInstruction(category) }],
    },
    contents,
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 16384,
    },
  };

  const res = await fetch(GEMINI_STREAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Gemini API error:', res.status, err);
    return `[API Error ${res.status}] ${err}`;
  }

  const reader = res.body?.getReader();
  if (!reader) return '[Error] No response stream';

  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // Keep incomplete last line in buffer
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json || json === '[DONE]') continue;

      try {
        const parsed = JSON.parse(json);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          accumulated += text;
          onChunk(accumulated);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  return accumulated || '[No response from Gemini]';
}
