// In-memory token bucket per grant (one hosted process on one host, so no
// shared store is needed). Default 120 tool calls per minute per grant.
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private capacity = 120,
    private perMs = 60_000,
    private now: () => number = Date.now
  ) {}

  // True when the call may proceed; consumes one token.
  take(key: string): boolean {
    const t = this.now();
    const refillPerMs = this.capacity / this.perMs;
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: t };
    b.tokens = Math.min(this.capacity, b.tokens + (t - b.at) * refillPerMs);
    b.at = t;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 50_000) this.buckets.clear();
    return true;
  }
}
