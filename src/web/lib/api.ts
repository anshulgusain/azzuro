import type { HealthResponse, MetaResponse, ReviewsResponse, SummaryResponse, TrendsResponse } from '../../shared/types';

export class ApiError extends Error {}

async function get<T>(path: string, params: Record<string, string | number | undefined | null> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const res = await fetch(`/api/${path}${qs.size ? `?${qs}` : ''}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `The server returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface Scope {
  property: string;
  period: string;
  from?: string;
  to?: string;
}

const scopeParams = (s: Scope) => ({
  property: s.property,
  period: s.period,
  from: s.period === 'custom' ? s.from : undefined,
  to: s.period === 'custom' ? s.to : undefined,
});

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatView {
  hotel: string | null;
  period: string | null;
  from: string | null;
  to: string | null;
}

export const api = {
  meta: () => get<MetaResponse>('meta'),
  summary: (s: Scope) => get<SummaryResponse>('summary', scopeParams(s)),
  trends: (s: Scope) => get<TrendsResponse>('trends', scopeParams(s)),
  reviews: (s: Scope, f: Record<string, string | number | undefined>) => get<ReviewsResponse>('reviews', { ...scopeParams(s), ...f }),
  health: () => get<HealthResponse>('health'),
  assistantStatus: () => get<{ enabled: boolean; model: string | null }>('assistant'),
  chat: async (messages: ChatMessage[], view: ChatView): Promise<{ answer: string; toolsUsed: string[] }> => {
    const res = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, view }),
    });
    const body = (await res.json().catch(() => null)) as { answer?: string; toolsUsed?: string[]; error?: string } | null;
    if (!res.ok || !body?.answer) throw new ApiError(body?.error ?? `The assistant returned an error (${res.status}).`);
    return { answer: body.answer, toolsUsed: body.toolsUsed ?? [] };
  },
  collect: async (): Promise<{ started: boolean; message: string }> => {
    const res = await fetch('/api/collect', { method: 'POST' });
    return res.json();
  },
};
