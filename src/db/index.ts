import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { pickDailyExercise } from "../services/exercises.js";
import { generateInviteCode } from "../utils/helpers.js";

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new DatabaseSync(config.dbPath);

db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
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
`);

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function upsertUser(telegramId: number, username?: string, firstName?: string): void {
  db.prepare(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name`
  ).run(telegramId, username ?? null, firstName ?? null);
}

export function getUser(telegramId: number) {
  return db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId) as
    | {
        telegram_id: number;
        username: string | null;
        first_name: string | null;
        fs_tokens: number;
        streak_days: number;
        last_workout_date: string | null;
        total_workouts: number;
      }
    | undefined;
}

export function addFsTokens(telegramId: number, amount: number): number {
  db.prepare(`UPDATE users SET fs_tokens = fs_tokens + ? WHERE telegram_id = ?`).run(
    amount,
    telegramId
  );
  return getUser(telegramId)?.fs_tokens ?? amount;
}

export function updateStreak(telegramId: number): number {
  const user = getUser(telegramId);
  if (!user) return 0;
  const today = todayKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  let streak = user.streak_days ?? 0;
  if (user.last_workout_date === today) {
    return streak;
  }
  if (user.last_workout_date === yesterdayKey) {
    streak += 1;
  } else {
    streak = 1;
  }

  db.prepare(
    `UPDATE users SET streak_days = ?, last_workout_date = ?, total_workouts = total_workouts + 1 WHERE telegram_id = ?`
  ).run(streak, today, telegramId);

  return streak;
}

export function createTeam(captainId: number, name: string): { id: string; inviteCode: string } {
  const id = uuidv4();
  let inviteCode = generateInviteCode();
  while (getTeamByInviteCode(inviteCode)) {
    inviteCode = generateInviteCode();
  }
  db.prepare(`INSERT INTO teams (id, name, invite_code, captain_id) VALUES (?, ?, ?, ?)`).run(
    id,
    name,
    inviteCode,
    captainId
  );
  db.prepare(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`).run(id, captainId);
  return { id, inviteCode };
}

export function getTeamByInviteCode(code: string) {
  return db.prepare(`SELECT * FROM teams WHERE invite_code = ?`).get(code.toUpperCase()) as
    | { id: string; name: string; invite_code: string; captain_id: number }
    | undefined;
}

export function getUserTeam(userId: number) {
  const row = db
    .prepare(
      `SELECT t.* FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = ?`
    )
    .get(userId) as
    | { id: string; name: string; invite_code: string; captain_id: number }
    | undefined;
  return row;
}

export function getTeamMembers(teamId: string) {
  return db
    .prepare(
      `SELECT u.telegram_id, u.username, u.first_name, u.fs_tokens
       FROM team_members tm
       JOIN users u ON u.telegram_id = tm.user_id
       WHERE tm.team_id = ?
       ORDER BY tm.joined_at`
    )
    .all(teamId) as Array<{
      telegram_id: number;
      username: string | null;
      first_name: string | null;
      fs_tokens: number;
    }>;
}

export function getTeamMemberCount(teamId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?`)
    .get(teamId) as { cnt: number };
  return row.cnt;
}

export function joinTeam(teamId: string, userId: number): { ok: boolean; error?: string } {
  const count = getTeamMemberCount(teamId);
  if (count >= config.maxTeamSize) {
    return { ok: false, error: "Команда заполнена (макс. 5 человек)" };
  }
  const existing = getUserTeam(userId);
  if (existing) {
    return { ok: false, error: "Вы уже в команде" };
  }
  db.prepare(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`).run(teamId, userId);
  return { ok: true };
}

export function ensureTodayWorkout(teamId: string) {
  const today = todayKey();
  const existing = db
    .prepare(`SELECT * FROM team_workouts WHERE team_id = ? AND workout_date = ?`)
    .get(teamId, today) as
    | {
        id: string;
        team_id: string;
        exercise_slug: string;
        target_reps: number;
        target_sets: number;
        duration_sec: number | null;
        workout_date: string;
        status: string;
      }
    | undefined;

  if (existing) return existing;

  const exercise = pickDailyExercise();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO team_workouts (id, team_id, exercise_slug, target_reps, target_sets, duration_sec, workout_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    teamId,
    exercise.slug,
    exercise.defaultReps,
    exercise.defaultSets,
    exercise.durationSec ?? null,
    today
  );

  const members = getTeamMembers(teamId);
  for (const m of members) {
    db.prepare(
      `INSERT INTO workout_logs (id, team_workout_id, user_id) VALUES (?, ?, ?)`
    ).run(uuidv4(), id, m.telegram_id);
  }

  return db.prepare(`SELECT * FROM team_workouts WHERE id = ?`).get(id) as typeof existing;
}

export function getTeamWorkout(id: string) {
  return db.prepare(`SELECT * FROM team_workouts WHERE id = ?`).get(id) as
    | {
        id: string;
        team_id: string;
        exercise_slug: string;
        target_reps: number;
        target_sets: number;
        duration_sec: number | null;
        workout_date: string;
        status: string;
      }
    | undefined;
}

export function getTodayWorkoutForTeam(teamId: string) {
  return db
    .prepare(`SELECT * FROM team_workouts WHERE team_id = ? AND workout_date = ?`)
    .get(teamId, todayKey()) as ReturnType<typeof getTeamWorkout>;
}

export function getWorkoutLogs(workoutId: string) {
  return db
    .prepare(`SELECT * FROM workout_logs WHERE team_workout_id = ?`)
    .all(workoutId) as Array<{
      id: string;
      team_workout_id: string;
      user_id: number;
      completed: number;
      photo_path: string | null;
      photo_verified: number;
      fs_earned: number;
      completed_at: string | null;
    }>;
}

export function getUserWorkoutLog(workoutId: string, userId: number) {
  return db
    .prepare(`SELECT * FROM workout_logs WHERE team_workout_id = ? AND user_id = ?`)
    .get(workoutId, userId) as ReturnType<typeof getWorkoutLogs>[number] | undefined;
}

export function completeWorkout(
  workoutId: string,
  userId: number,
  fsEarned: number
): void {
  db.prepare(
    `UPDATE workout_logs SET completed = 1, fs_earned = ?, completed_at = datetime('now')
     WHERE team_workout_id = ? AND user_id = ?`
  ).run(fsEarned, workoutId, userId);
}

export function verifyWorkoutPhoto(
  workoutId: string,
  userId: number,
  photoPath: string,
  extraFs: number
): void {
  db.prepare(
    `UPDATE workout_logs SET photo_path = ?, photo_verified = 1, fs_earned = fs_earned + ?
     WHERE team_workout_id = ? AND user_id = ?`
  ).run(photoPath, extraFs, workoutId, userId);
}

export function isWorkoutFullyCompleted(workoutId: string): boolean {
  const logs = getWorkoutLogs(workoutId);
  if (logs.length === 0) return false;
  return logs.every((l) => l.completed === 1);
}

export function markWorkoutCompleted(workoutId: string): void {
  db.prepare(`UPDATE team_workouts SET status = 'completed' WHERE id = ?`).run(workoutId);
}

export function grantAchievement(userId: number, type: string): boolean {
  const existing = db
    .prepare(`SELECT 1 FROM achievements WHERE user_id = ? AND type = ?`)
    .get(userId, type);
  if (existing) return false;
  db.prepare(`INSERT INTO achievements (id, user_id, type) VALUES (?, ?, ?)`).run(
    uuidv4(),
    userId,
    type
  );
  return true;
}

export function getAchievements(userId: number) {
  return db
    .prepare(`SELECT type, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at`)
    .all(userId) as Array<{ type: string; earned_at: string }>;
}

export function countTeamWorkoutsCompleted(userId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM workout_logs wl
       JOIN team_workouts tw ON tw.id = wl.team_workout_id
       WHERE wl.user_id = ? AND wl.completed = 1`
    )
    .get(userId) as { cnt: number };
  return row.cnt;
}

export function getAllActiveTeams() {
  return db.prepare(`SELECT id, name, captain_id FROM teams`).all() as Array<{
    id: string;
    name: string;
    captain_id: number;
  }>;
}

export function getTeamLeaderboard(teamId: string, limit = 5) {
  return db
    .prepare(
      `SELECT u.telegram_id, u.first_name, u.username, u.fs_tokens, u.streak_days
       FROM team_members tm
       JOIN users u ON u.telegram_id = tm.user_id
       WHERE tm.team_id = ?
       ORDER BY u.fs_tokens DESC
       LIMIT ?`
    )
    .all(teamId, limit) as Array<{
      telegram_id: number;
      first_name: string | null;
      username: string | null;
      fs_tokens: number;
      streak_days: number;
    }>;
}

export { db };
