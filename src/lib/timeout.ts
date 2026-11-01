// ─── Give a promise a deadline ──────────────────────────────────────────────
export class TimeoutError extends Error {
  constructor(ms: number) { super(`Timed out after ${ms} ms`); this.name = 'TimeoutError'; }
}

/** Rejects with TimeoutError if `p` has not settled within `ms`. The original keeps running; its result is ignored. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new TimeoutError(ms)), ms);
    p.then(
      v => { clearTimeout(id); resolve(v); },
      (e: unknown) => { clearTimeout(id); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}
