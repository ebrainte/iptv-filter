import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(path.join(DATA_DIR, "iptv.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      short_code TEXT UNIQUE,
      url TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS selections (
      provider_id TEXT NOT NULL,
      stream_id INTEGER NOT NULL,
      PRIMARY KEY (provider_id, stream_id),
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );
  `);

  // Migration: add short_code column if missing
  const cols = db.prepare("PRAGMA table_info(providers)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "short_code")) {
    db.exec("ALTER TABLE providers ADD COLUMN short_code TEXT");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_short_code ON providers(short_code)");
  }

  return db;
}

function generateShortCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function getOrCreateShortCode(providerId: string): string {
  const db = getDb();
  const row = db.prepare("SELECT short_code FROM providers WHERE id = ?").get(providerId) as { short_code: string | null } | undefined;
  if (row?.short_code) return row.short_code;

  // Generate a unique short code
  let code: string;
  do {
    code = generateShortCode();
  } while (db.prepare("SELECT 1 FROM providers WHERE short_code = ?").get(code));

  db.prepare("UPDATE providers SET short_code = ? WHERE id = ?").run(code, providerId);
  return code;
}

export function getProviderByShortCode(shortCode: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM providers WHERE short_code = ?").get(shortCode) as
    | { id: string; short_code: string; url: string; username: string; password: string; created_at: string }
    | undefined;
}

export function upsertProvider(id: string, url: string, username: string, password: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO providers (id, url, username, password)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET url = excluded.url, username = excluded.username, password = excluded.password
  `).run(id, url, username, password);
}

export function getProvider(id: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as
    | { id: string; url: string; username: string; password: string; created_at: string }
    | undefined;
}

export function findProviderByCredentials(url: string, username: string, password: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM providers WHERE url = ? AND username = ? AND password = ?").get(url, username, password) as
    | { id: string; url: string; username: string; password: string; created_at: string }
    | undefined;
}

export function saveSelections(providerId: string, streamIds: number[]): void {
  const db = getDb();
  const deleteStmt = db.prepare("DELETE FROM selections WHERE provider_id = ?");
  const insertStmt = db.prepare("INSERT INTO selections (provider_id, stream_id) VALUES (?, ?)");

  const transaction = db.transaction(() => {
    deleteStmt.run(providerId);
    for (const streamId of streamIds) {
      insertStmt.run(providerId, streamId);
    }
  });

  transaction();
}

export function getSelections(providerId: string): number[] {
  const db = getDb();
  const rows = db.prepare("SELECT stream_id FROM selections WHERE provider_id = ?").all(providerId) as { stream_id: number }[];
  return rows.map((r) => r.stream_id);
}
