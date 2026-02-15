import type { Category, Stream } from "./xtream";

interface SessionData {
  url: string;
  username: string;
  password: string;
  categories: Category[];
  streams: Stream[];
  createdAt: number;
}

const sessions = new Map<string, SessionData>();

// Clean up sessions older than 1 hour
function cleanup() {
  const now = Date.now();
  for (const [key, data] of sessions) {
    if (now - data.createdAt > 3600_000) {
      sessions.delete(key);
    }
  }
}

export function setSession(token: string, data: Omit<SessionData, "createdAt">) {
  cleanup();
  sessions.set(token, { ...data, createdAt: Date.now() });
}

export function getSession(token: string): SessionData | undefined {
  const data = sessions.get(token);
  if (data && Date.now() - data.createdAt > 3600_000) {
    sessions.delete(token);
    return undefined;
  }
  return data;
}
