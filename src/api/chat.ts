import { getMockResponse } from '../data/mockResponses';

export async function sendChatMessage(message: string): Promise<string> {
  // 목업: keyword-based mock response
  // 실제: return fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message }) }).then(r => r.json()).then(d => d.reply);
  await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
  return getMockResponse(message);
}
