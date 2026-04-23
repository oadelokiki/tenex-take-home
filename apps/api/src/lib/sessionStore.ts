import { randomUUID } from "node:crypto";

export type SessionData = {
  googleRefreshToken: string;
  email: string;
  createdAt: number;
};

/** In-memory sessions (PoC). Refresh tokens never leave this store to the client. */
export class SessionStore {
  private readonly sessions = new Map<string, SessionData>();

  create(data: Omit<SessionData, "createdAt">): string {
    const id = randomUUID();
    this.sessions.set(id, { ...data, createdAt: Date.now() });
    return id;
  }

  get(sessionId: string): SessionData | undefined {
    return this.sessions.get(sessionId);
  }

  destroy(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** E2E / test harness: drop all sessions. */
  clear(): void {
    this.sessions.clear();
  }
}
