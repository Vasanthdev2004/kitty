// ─── RPC resilience: retryable errors, validation retry, session cache ───────
import { describe, it, expect, vi } from 'vitest';
import { isRetryableRpcError, jitteredDelay, VALIDATION_DELAYS_MS } from '../rpc';
import {
  validateKittyDeployment, validateWithRetry, ensureDeploymentValid, hasCachedValidation, resetDeploymentValidation,
  type MinimalPublicClient, type StorageLike,
} from '../kitty-tx';
import { getDeployment } from '../kitty-config';

const dep = getDeployment();

// ── error shapes as viem produces them ──
const http429 = Object.assign(new Error('HTTP request failed.\n\nStatus: 429\nURL: https://rpc.example'), { name: 'HttpRequestError', status: 429 });
const http503 = Object.assign(new Error('HTTP request failed.\n\nStatus: 503'), { name: 'HttpRequestError', status: 503 });
const wrapped429 = Object.assign(new Error('The contract function "token" returned no data'), { name: 'ContractFunctionExecutionError', cause: http429 });
const revert = Object.assign(new Error('The contract function "token" reverted with the following reason: execution reverted'), { name: 'ContractFunctionRevertedError' });

describe('isRetryableRpcError', () => {
  it('retries 429, 5xx, timeouts and network failures, including wrapped causes', () => {
    expect(isRetryableRpcError(http429)).toBe(true);
    expect(isRetryableRpcError(http503)).toBe(true);
    expect(isRetryableRpcError(wrapped429)).toBe(true);
    expect(isRetryableRpcError(Object.assign(new Error('The request took too long'), { name: 'TimeoutError' }))).toBe(true);
    expect(isRetryableRpcError(new Error('TypeError: Failed to fetch'))).toBe(true);
    expect(isRetryableRpcError(new Error('getaddrinfo ENOTFOUND rpc.example'))).toBe(true);
    expect(isRetryableRpcError(Object.assign(new Error('rate limited'), { code: -32005 }))).toBe(true);
  });
  it('never retries a definitive answer from the chain', () => {
    expect(isRetryableRpcError(revert)).toBe(false);
    expect(isRetryableRpcError(new Error('execution reverted'))).toBe(false);
    expect(isRetryableRpcError(new Error('something unrelated'))).toBe(false);
    expect(isRetryableRpcError(undefined)).toBe(false);
  });
});

describe('jitteredDelay', () => {
  it('stays within +/-25% of the base', () => {
    expect(jitteredDelay(1000, () => 0)).toBe(750);
    expect(jitteredDelay(1000, () => 1)).toBe(1250);
    expect(jitteredDelay(3000, () => 0.5)).toBe(3000);
  });
  it('defaults to roughly 1s, 3s, 7s', () => {
    expect([...VALIDATION_DELAYS_MS]).toEqual([1000, 3000, 7000]);
  });
});

// ── a scriptable client: each call to a method consumes the next scripted outcome ──
type Outcome = 'ok' | Error | 'nocode' | 'wrongtoken';
function client(script: { code?: Outcome[]; token?: Outcome[]; decimals?: Outcome[] }) {
  const calls = { code: 0, token: 0, decimals: 0 };
  const next = (list: Outcome[] | undefined, key: keyof typeof calls): Outcome => {
    const i = Math.min(calls[key]++, (list?.length ?? 1) - 1);
    return list?.[i] ?? 'ok';
  };
  const c: MinimalPublicClient = {
    getBytecode: () => {
      const o = next(script.code, 'code');
      if (o instanceof Error) return Promise.reject(o);
      return Promise.resolve(o === 'nocode' ? '0x' : '0x6080');
    },
    readContract: (a: { functionName: string }) => {
      if (a.functionName === 'token') {
        const o = next(script.token, 'token');
        if (o instanceof Error) return Promise.reject(o);
        return Promise.resolve(o === 'wrongtoken' ? '0x2222222222222222222222222222222222222222' : dep.usdc);
      }
      const o = next(script.decimals, 'decimals');
      if (o instanceof Error) return Promise.reject(o);
      return Promise.resolve(6);
    },
    waitForTransactionReceipt: () => Promise.reject(new Error('unused')),
  } as never;
  return { c, calls };
}
const fastSleep = () => Promise.resolve();

describe('validateKittyDeployment: transient vs final', () => {
  it('marks a 429 as transient and a mismatch as final', async () => {
    const t = await validateKittyDeployment(client({ code: [http429] }).c, dep);
    expect(t).toMatchObject({ ok: false, transient: true });
    const m = await validateKittyDeployment(client({ token: ['wrongtoken'] }).c, dep);
    expect(m).toMatchObject({ ok: false });
    expect((m as { transient?: boolean }).transient).toBeFalsy();
  });
  it('treats a revert from token() as final, not transient', async () => {
    const r = await validateKittyDeployment(client({ token: [revert] }).c, dep);
    expect(r).toMatchObject({ ok: false });
    expect((r as { transient?: boolean }).transient).toBeFalsy();
  });
  it('never puts raw error text in the reason', async () => {
    const r = await validateKittyDeployment(client({ code: [http429] }).c, dep);
    if (!r.ok) expect(r.reason).not.toMatch(/429|HTTP|rpc\.example/);
  });
});

describe('validateWithRetry', () => {
  it('succeeds on the second attempt after one 429', async () => {
    const { c, calls } = client({ code: [http429, 'ok'] });
    const onRetry = vi.fn();
    const r = await validateWithRetry(c, dep, { sleep: fastSleep, onRetry });
    expect(r.ok).toBe(true);
    expect(calls.code).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toBe(1);
  });

  it('gives up after 3 retries (4 attempts) and reports it as transient', async () => {
    const { c, calls } = client({ code: [http429] });
    const waits: number[] = [];
    const r = await validateWithRetry(c, dep, { sleep: ms => { waits.push(ms); return Promise.resolve(); }, random: () => 0.5 });
    expect(r).toMatchObject({ ok: false, transient: true });
    expect(calls.code).toBe(4);
    expect(waits).toEqual([1000, 3000, 7000]);
  });

  it('does not retry a definitive mismatch', async () => {
    for (const script of [{ code: ['nocode' as const] }, { token: ['wrongtoken' as const] }, { token: [revert] }]) {
      const { c, calls } = client(script);
      const sleep = vi.fn(fastSleep);
      const r = await validateWithRetry(c, dep, { sleep });
      expect(r.ok).toBe(false);
      expect(sleep).not.toHaveBeenCalled();
      expect(calls.code).toBe(1);
    }
  });

  it('retries a flaky token() read too', async () => {
    const { c, calls } = client({ token: [http503, http503, 'ok'] });
    const r = await validateWithRetry(c, dep, { sleep: fastSleep });
    expect(r.ok).toBe(true);
    expect(calls.token).toBe(3);
  });
});

function memoryStore(failing = false): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: k => { if (failing) throw new Error('blocked'); return data.get(k) ?? null; },
    setItem: (k, v) => { if (failing) throw new Error('blocked'); data.set(k, v); },
    removeItem: k => { data.delete(k); },
  };
}

describe('validation cache', () => {
  it('a successful check is remembered per chain + contract, so a reload makes no calls', async () => {
    const store = memoryStore();
    const first = client({});
    expect((await ensureDeploymentValid(first.c, dep, { store, sleep: fastSleep })).ok).toBe(true);
    expect(first.calls.code).toBe(1);
    expect(hasCachedValidation(dep, store)).toBe(true);
    expect([...store.data.keys()][0]).toContain(`${dep.chainId}:${dep.kitty.toLowerCase()}`);

    const second = client({});
    expect((await ensureDeploymentValid(second.c, dep, { store })).ok).toBe(true);
    expect(second.calls).toEqual({ code: 0, token: 0, decimals: 0 });
  });

  it('does not cache a failure, and Retry (reset) forces a fresh check', async () => {
    const store = memoryStore();
    const bad = client({ code: ['nocode'] });
    expect((await ensureDeploymentValid(bad.c, dep, { store, sleep: fastSleep })).ok).toBe(false);
    expect(hasCachedValidation(dep, store)).toBe(false);

    store.data.set([...[`kitty:validated:${dep.chainId}:${dep.kitty.toLowerCase()}`]][0], '1');
    resetDeploymentValidation(dep, store);
    expect(hasCachedValidation(dep, store)).toBe(false);
  });

  it('shares one in-flight check between concurrent callers', async () => {
    const store = memoryStore();
    const c = client({});
    const [a, b] = await Promise.all([
      ensureDeploymentValid(c.c, dep, { store, sleep: fastSleep }),
      ensureDeploymentValid(c.c, dep, { store, sleep: fastSleep }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(c.calls.code).toBe(1);
  });

  it('survives blocked storage (private mode)', async () => {
    const store = memoryStore(true);
    const c = client({});
    expect((await ensureDeploymentValid(c.c, dep, { store, sleep: fastSleep })).ok).toBe(true);
    expect(hasCachedValidation(dep, store)).toBe(false);
  });
});
