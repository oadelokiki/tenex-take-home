import { randomBytes } from "node:crypto";

export type PendingOAuth = {
  state: string;
  codeVerifier: string;
  expiresAt: number;
};

const TTL_MS = 10 * 60 * 1000;

/** In-memory PKCE + state store (PoC). Replace with Redis for multi-instance. */
export class OAuthPendingStore {
  private readonly byState = new Map<string, PendingOAuth>();

  create(): { state: string; codeVerifier: string } {
    const state = randomBytes(32).toString("hex");
    const codeVerifier = randomBytes(32).toString("base64url");
    this.byState.set(state, {
      state,
      codeVerifier,
      expiresAt: Date.now() + TTL_MS,
    });
    this.prune();
    return { state, codeVerifier };
  }

  consume(state: string): PendingOAuth | undefined {
    this.prune();
    const row = this.byState.get(state);
    if (!row) return undefined;
    this.byState.delete(state);
    if (Date.now() > row.expiresAt) return undefined;
    return row;
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.byState) {
      if (v.expiresAt < now) this.byState.delete(k);
    }
  }

  /** E2E / test harness: drop all pending OAuth rows. */
  clear(): void {
    this.byState.clear();
  }
}
