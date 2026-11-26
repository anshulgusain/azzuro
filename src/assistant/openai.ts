import OpenAI from 'openai';
import type { CreateResponse } from './agent.js';

/**
 * OpenAI connection settings, read from the environment (put them in .env,
 * which is never committed). The assistant is simply switched off when no
 * key is set, and the rest of the dashboard works as normal.
 */
export const DEFAULT_MODEL = 'gpt-5.6-terra';

export interface AssistantConfig {
  enabled: boolean;
  model: string;
}

export function assistantConfig(): AssistantConfig {
  return {
    enabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
  };
}

let client: OpenAI | null = null;
let clientKey: string | undefined;

export function openAiCreate(): CreateResponse {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!client || clientKey !== apiKey) {
    client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
      timeout: 60_000,
      maxRetries: 2,
    });
    clientKey = apiKey;
  }
  const c = client;
  return (params) => c.responses.create(params);
}

/** Turns OpenAI errors into messages staff can act on (or pass to IT). */
export function friendlyOpenAiError(err: unknown): { status: number; message: string } {
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return { status: 504, message: 'The assistant took too long to answer. Please try again.' };
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return { status: 502, message: "The assistant can't reach OpenAI right now. Check the internet connection and try again." };
  }
  if (err instanceof OpenAI.APIError) {
    switch (err.status) {
      case 401:
        return { status: 502, message: 'The OpenAI key was not accepted. Ask IT to check OPENAI_API_KEY.' };
      case 403:
        return { status: 502, message: 'This OpenAI account is not allowed to use the chosen model. Ask IT to check OPENAI_MODEL.' };
      case 404:
        return { status: 502, message: 'The chosen OpenAI model was not found. Ask IT to check OPENAI_MODEL.' };
      case 429:
        return {
          status: 503,
          message: 'OpenAI is busy or the account has run out of credit. Please try again in a minute, or ask IT to check the OpenAI billing.',
        };
      default:
        return { status: 502, message: 'OpenAI had a problem answering. Please try again.' };
    }
  }
  return { status: 500, message: 'Something went wrong while answering. Please try again.' };
}
