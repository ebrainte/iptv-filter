import { createClient, type Client } from "@libsql/client";

let db: Client | null = null;
let initialized = false;

function getDb(): Client {
  if (db) return db;

  db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return db;
}

async function ensureSchema() {
  if (initialized) return;
  const db = getDb();

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      short_code TEXT UNIQUE,
      url TEXT NOT NULL,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS selections (
      provider_id TEXT NOT NULL,
      stream_id INTEGER NOT NULL,
      PRIMARY KEY (provider_id, stream_id),
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );
  `);

  initialized = true;
}

function generateShortCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function getOrCreateShortCode(providerId: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const row = await db.execute({ sql: "SELECT short_code FROM providers WHERE id = ?", args: [providerId] });
  if (row.rows[0]?.short_code) return row.rows[0].short_code as string;

  let code: string;
  do {
    code = generateShortCode();
    const existing = await db.execute({ sql: "SELECT 1 FROM providers WHERE short_code = ?", args: [code] });
    if (existing.rows.length === 0) break;
  } while (true);

  await db.execute({ sql: "UPDATE providers SET short_code = ? WHERE id = ?", args: [code, providerId] });
  return code;
}

export async function getProviderByShortCode(shortCode: string) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: "SELECT * FROM providers WHERE short_code = ?", args: [shortCode] });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return { id: row.id as string, short_code: row.short_code as string, url: row.url as string, username: row.username as string, created_at: row.created_at as string };
}

export async function upsertProvider(id: string, url: string, username: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO providers (id, url, username) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET url = excluded.url, username = excluded.username`,
    args: [id, url, username],
  });
}

export async function getProvider(id: string) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: "SELECT * FROM providers WHERE id = ?", args: [id] });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return { id: row.id as string, url: row.url as string, username: row.username as string, created_at: row.created_at as string };
}

export async function findProviderByCredentials(url: string, username: string) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: "SELECT * FROM providers WHERE url = ? AND username = ?", args: [url, username] });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return { id: row.id as string, url: row.url as string, username: row.username as string, created_at: row.created_at as string };
}

export async function saveSelections(providerId: string, streamIds: number[]): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({ sql: "DELETE FROM selections WHERE provider_id = ?", args: [providerId] });
  for (const streamId of streamIds) {
    await db.execute({ sql: "INSERT INTO selections (provider_id, stream_id) VALUES (?, ?)", args: [providerId, streamId] });
  }
}

export async function getSelections(providerId: string): Promise<number[]> {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: "SELECT stream_id FROM selections WHERE provider_id = ?", args: [providerId] });
  return result.rows.map((r) => r.stream_id as number);
}
