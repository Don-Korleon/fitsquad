import fs from "node:fs";
import { createClient, type Client, type InValue } from "@libsql/client";
import { config } from "../config.js";

let client: Client | null = null;
let initialized = false;

export function getDbClient(): Client {
  if (!client) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const url = config.tursoDatabaseUrl || `file:${config.dbPath}`;
    client = createClient({
      url,
      authToken: config.tursoAuthToken || undefined,
    });
  }
  return client;
}

export async function dbExec(sql: string): Promise<void> {
  await getDbClient().execute(sql);
}

export async function dbRun(sql: string, args: InValue[] = []): Promise<void> {
  await getDbClient().execute({ sql, args });
}

export async function dbGet<T>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  const result = await getDbClient().execute({ sql, args });
  return (result.rows[0] as T | undefined) ?? undefined;
}

export async function dbAll<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  const result = await getDbClient().execute({ sql, args });
  return result.rows as T[];
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    fs_tokens INTEGER DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    last_workout_date TEXT,
    total_workouts INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    captain_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (captain_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS team_workouts (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    exercise_slug TEXT NOT NULL,
    target_reps INTEGER NOT NULL,
    target_sets INTEGER NOT NULL,
    duration_sec INTEGER,
    workout_date TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    UNIQUE(team_id, workout_date)
  );

  CREATE TABLE IF NOT EXISTS workout_logs (
    id TEXT PRIMARY KEY,
    team_workout_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    completed INTEGER DEFAULT 0,
    photo_path TEXT,
    photo_verified INTEGER DEFAULT 0,
    fs_earned INTEGER DEFAULT 0,
    completed_at TEXT,
    FOREIGN KEY (team_workout_id) REFERENCES team_workouts(id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id),
    UNIQUE(team_workout_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    earned_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, type),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    days INTEGER NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS promo_redemptions (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    redeemed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(code, user_id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );
`;

async function tryAlter(sql: string): Promise<void> {
  try {
    await dbExec(sql);
  } catch {
    /* column exists */
  }
}

export async function initDb(): Promise<void> {
  if (initialized) return;
  await getDbClient().executeMultiple(SCHEMA);
  if (!config.dbIsRemote) {
    await dbExec("PRAGMA foreign_keys = ON");
  }
  await tryAlter(`ALTER TABLE workout_logs ADD COLUMN exercise_slug TEXT`);
  await tryAlter(`ALTER TABLE workout_logs ADD COLUMN target_reps INTEGER`);
  await tryAlter(`ALTER TABLE workout_logs ADD COLUMN target_sets INTEGER`);
  await tryAlter(`ALTER TABLE workout_logs ADD COLUMN duration_sec INTEGER`);
  await tryAlter(`ALTER TABLE users ADD COLUMN solo_mode INTEGER DEFAULT 0`);
  await tryAlter(`ALTER TABLE users ADD COLUMN premium_until TEXT`);
  await seedDefaultPromoCodes();
  initialized = true;
}

async function seedDefaultPromoCodes(): Promise<void> {
  const code = config.promoYearCode.trim().toUpperCase();
  if (!code) return;
  await dbRun(
    `INSERT OR IGNORE INTO promo_codes (code, days, max_uses, uses_count, note)
     VALUES (?, ?, 1, 0, ?)`,
    [code, config.promoYearDays, "Premium 1 year"]
  );
}
