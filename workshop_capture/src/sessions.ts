import { randomBytes } from "node:crypto";

interface Session {
  homeboxToken: string;
  expires: number;
}

/**
 * Maps an opaque cookie id to the user's Homebox token. The Homebox token never
 * reaches the browser. Kept in memory: a restart just means signing in again.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly ttlMs: number;

  constructor(ttlHours: number) {
    this.ttlMs = ttlHours * 3600_000;
  }

  create(homeboxToken: string, homeboxExpires?: Date): { id: string; maxAgeSec: number } {
    const id = randomBytes(32).toString("base64url");
    const expires = Math.min(Date.now() + this.ttlMs, homeboxExpires?.getTime() ?? Infinity);
    this.sessions.set(id, { homeboxToken, expires });
    return { id, maxAgeSec: Math.max(0, Math.floor((expires - Date.now()) / 1000)) };
  }

  get(id: string | undefined): string | null {
    if (!id) return null;
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.expires < Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return s.homeboxToken;
  }

  delete(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }
}
