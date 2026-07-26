/**
 * In-app rate limits (SPEC §5): DoS mitigation, not bank-grade lockout.
 * In-memory per instance is acceptable by spec.
 */

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns retry-after seconds when limited, or null when allowed. */
  hit(key: string, now = Date.now()): number | null {
    this.sweep(now);
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return null;
    }
    window.count += 1;
    if (window.count > this.limit) {
      return Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    }
    return null;
  }

  private lastSweep = 0;
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/** Password attempts: 5/min per (IP × site) then 429 + Retry-After (SPEC §5). */
export const passwordLimiter = new RateLimiter(5, 60_000);

/** Credential failures on API/portal: 20/min per IP (SPEC §5). */
export const credentialLimiter = new RateLimiter(20, 60_000);

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
