/** Small helpers shared by the collector: logging, waiting, retrying. */

type Level = 'info' | 'warn' | 'error';

export function log(level: Level, msg: string, ctx: Record<string, unknown> = {}): void {
  const time = new Date().toISOString().slice(11, 19);
  const extras = Object.entries(ctx)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  const line = `${time} ${level.toUpperCase().padEnd(5)} ${msg}${extras ? `  ${extras}` : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A random wait between min and max ms, so requests are spread out like a person browsing. */
export const politePause = (minMs: number, maxMs: number) => sleep(minMs + Math.random() * (maxMs - minMs));

/** Error categories decide whether a retry is worthwhile and what the run log says. */
export type FailureKind =
  | 'network' // DNS, connection reset, timeouts loading the page
  | 'challenge' // the bot-protection challenge page never cleared
  | 'structure' // the page loaded but the data we rely on is missing
  | 'unknown';

export class CollectError extends Error {
  constructor(
    public kind: FailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'CollectError';
  }
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  /** Return false to stop retrying (e.g. the page structure changed; retrying won't help). */
  shouldRetry?: (err: unknown) => boolean;
}

/** Retries with exponential backoff plus jitter. Returns the result and how many attempts it took. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<{ value: T; attempts: number }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return { value: await fn(attempt), attempts: attempt };
    } catch (err) {
      lastErr = err;
      const retryable = opts.shouldRetry ? opts.shouldRetry(err) : true;
      if (attempt === opts.attempts || !retryable) break;
      const delay = opts.baseDelayMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
      opts.onRetry?.(attempt, err, delay);
      await sleep(delay);
    }
  }
  throw Object.assign(lastErr instanceof Error ? lastErr : new Error(String(lastErr)), { attemptsUsed: opts.attempts });
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n')[0].slice(0, 500);
  return String(err).slice(0, 500);
}
