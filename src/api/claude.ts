const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string;
const MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';

/** An image attachment to send to Claude's vision input. */
export interface ClaudeImage {
  /** MIME type, e.g. "image/png", "image/jpeg", "image/webp", "image/gif". */
  mediaType: string;
  /** Base64-encoded image bytes (WITHOUT the "data:...;base64," prefix). */
  data: string;
}

interface TextBlock { type: 'text'; text: string; }
interface ImageBlock { type: 'image'; source: { type: 'base64'; media_type: string; data: string }; }
type ContentBlock = TextBlock | ImageBlock;

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  /** Plain text, or — for a user turn with image attachments — an array of
   *  content blocks (text + image) per the Anthropic messages API. */
  content: string | ContentBlock[];
}

const BASE_SYSTEM = `You are Jazzify AI, a jazz harmony expert and educator.
Respond in the same language the user writes in (Korean or English).
Keep explanations concise but insightful. Use music theory terminology with brief explanations.
Format with markdown: use **bold** for chord symbols and key terms, bullet points for lists.

When you present a chord progression for a song or section, ALWAYS use a fenced
\`\`\`chart block containing JSON instead of an ASCII pipe diagram. The frontend
renders this block as an iRealPro-style chord chart automatically.

Schema:

\`\`\`chart
{
  "title": "Song Title",
  "composer": "Composer (optional)",
  "key": "F",
  "timeSig": "4/4",
  "sections": [
    {
      "label": "A",
      "bars": ["FΔ7", "D7", "G-7", "C7", "A-7", "D7", "G-7 C7", "FΔ7"]
    }
  ]
}
\`\`\`

Rules:
- Use jazz chord notation: Δ for major 7 (FΔ7), - for minor (G-7), ø for half-diminished, ° for diminished, alt/b9/#9/#11/b13 for altered dominants.
- Each "bar" string is one measure. For bars with two chords, separate them with a single space ("G-7 C7").
- Repeat sections explicitly (e.g. AABA = four section objects), not via repeat marks.
- Section labels are short ("A", "A'", "B", "Bridge", "Intro", "Coda").
- Output the JSON exactly — no comments, no trailing commas.
- You may put text explanation BEFORE and AFTER the chart block, but the chart itself MUST be a clean fenced block.

When you reference a section by its letter in prose (e.g. "the A section", "in the bridge"),
wrap the letter/label with [SEC:X] so the frontend renders it as a small black filled
section badge, just like the section labels printed on the chord chart itself.

Examples:
  - "[SEC:A] 섹션은 ii-V-I 진행이 두 번 나옵니다."
  - "Notice how [SEC:B] modulates to the relative minor before returning to [SEC:A']."
  - "Bridge ([SEC:B]) borrows from the parallel minor."

Only wrap the section letter/label itself, not surrounding words. Use the same labels
that appear in the chart (e.g. A, A', B, Bridge, Intro, Coda).`;

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
 * Stream Claude response, calling onChunk with accumulated text as each SSE arrives.
 * Returns the final full text.
 */
export async function streamClaudeMessage(
  userMessage: string,
  history: ClaudeMessage[],
  chordContext: string | undefined,
  onChunk: (accumulated: string) => void,
  category?: AnalysisCategory,
  images?: ClaudeImage[],
): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    const msg = '[Error] VITE_ANTHROPIC_API_KEY not set in .env';
    onChunk(msg);
    return msg;
  }

  let fullUserMessage = userMessage;
  if (chordContext) {
    fullUserMessage = `[Chord Analysis Context]\n${chordContext}\n\n[User Question]\n${userMessage}`;
  }

  // With image attachments the final user turn becomes a content-block array
  // (text + one image block per attachment) so Claude can actually see them.
  const userContent: string | ContentBlock[] = images && images.length > 0
    ? [
        { type: 'text', text: fullUserMessage },
        ...images.map((im): ImageBlock => ({
          type: 'image',
          source: { type: 'base64', media_type: im.mediaType, data: im.data },
        })),
      ]
    : fullUserMessage;

  const messages: ClaudeMessage[] = [
    ...history,
    { role: 'user', content: userContent },
  ];

  // When the user has a chord chart already on screen (chordContext given),
  // we don't want the AI to regenerate the same chart inline. Suppress chart
  // blocks for THAT song; the AI may still emit chart blocks for OTHER songs
  // it references in the answer.
  const contextSuffix = chordContext
    ? '\n\n[CONTEXT NOTE] The user is currently viewing the chord chart referenced in the [Chord Analysis Context] above. Do NOT emit a ```chart fenced block for THIS song — they can already see it on screen. You may still use ```chart blocks for OTHER songs you reference.'
    : '';

  const body = {
    model: MODEL,
    max_tokens: 16384,
    system: getSystemInstruction(category) + contextSuffix,
    messages,
    stream: true,
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Claude API error:', res.status, err);
    const msg = `[API Error ${res.status}] ${err}`;
    onChunk(msg);
    return msg;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const msg = '[Error] No response stream';
    onChunk(msg);
    return msg;
  }

  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json || json === '[DONE]') continue;

      try {
        const parsed = JSON.parse(json);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          accumulated += parsed.delta.text;
          onChunk(accumulated);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  return accumulated || '[No response from Claude]';
}
