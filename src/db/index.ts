import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { pickDailyExercise, pickExerciseForUser } from "../services/exercises.js";
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

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

try {
  db.exec(`ALTER TABLE workout_logs ADD COLUMN exercise_slug TEXT`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE workout_logs ADD COLUMN target_reps INTEGER`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE workout_logs ADD COLUMN target_sets INTEGER`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE workout_logs ADD COLUMN duration_sec INTEGER`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN solo_mode INTEGER DEFAULT 0`);
} catch {
  /* exists */
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN premium_until TEXT`);
} catch {
  /* exists */
}

const SOLO_INVITE_PREFIX = "SOLO";

export function soloTeamId(userId: number): string {
  return `solo-${userId}`;
}

export function isSoloTeam(team: { id: string; invite_code: string }): boolean {
  return team.id.startsWith("solo-") || team.invite_code.startsWith(SOLO_INVITE_PREFIX);
}

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
        solo_mode: number;
        premium_until: string | null;
      }
    | undefined;
}

export function isSoloModeEnabled(userId: number): boolean {
  return !!getUser(userId)?.solo_mode;
}

export function isPremium(userId: number): boolean {
  const until = getUser(userId)?.premium_until;
  if (!until) return false;
  return new Date(until) > new Date();
}

export function getPremiumStatus(userId: number) {
  const until = getUser(userId)?.premium_until ?? null;
  const active = until ? new Date(until) > new Date() : false;
  return { isPremium: active, premiumUntil: active ? until : null };
}

export function grantPremium(userId: number, days: number): { until: string } {
  const now = new Date();
  const user = getUser(userId);
  let start = now;
  if (user?.premium_until) {
    const current = new Date(user.premium_until);
    if (current > now) start = current;
  }
  const until = new Date(start.getTime() + days * 86_400_000);
  const untilIso = until.toISOString();
  db.prepare(`UPDATE users SET premium_until = ? WHERE telegram_id = ?`).run(untilIso, userId);
  return { until: untilIso };
}

/** Нельзя вступить/создать команду, пока включён Solo */
export function assertCanJoinTeam(userId: number): { ok: boolean; error?: string } {
  if (isSoloModeEnabled(userId)) {
    return {
      ok: false,
      error: "Включён Solo режим. Сначала выключите его — /team → ❌ Выключить Solo",
    };
  }
  if (getUserTeam(userId)) {
    return { ok: false, error: "Вы уже в команде" };
  }
  return { ok: true };
}

/** Нельзя включить Solo, пока пользователь в команде */
export function assertCanEnableSolo(userId: number): { ok: boolean; error?: string } {
  if (getUserTeam(userId)) {
    return { ok: false, error: "Сначала выйдите из команды" };
  }
  if (isSoloModeEnabled(userId)) {
    return { ok: false, error: "Solo режим уже включён" };
  }
  return { ok: true };
}

function clearSoloMode(userId: number): void {
  db.prepare(`UPDATE users SET solo_mode = 0 WHERE telegram_id = ?`).run(userId);
  const teamId = soloTeamId(userId);
  const exists = db.prepare(`SELECT 1 FROM teams WHERE id = ?`).get(teamId);
  if (exists) deleteTeamById(teamId);
}

export function ensureSoloTeam(userId: number) {
  const teamId = soloTeamId(userId);
  let team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId) as
    | { id: string; name: string; invite_code: string; captain_id: number }
    | undefined;

  if (!team) {
    const inviteCode = `${SOLO_INVITE_PREFIX}${userId}`;
    db.prepare(`INSERT INTO teams (id, name, invite_code, captain_id) VALUES (?, ?, ?, ?)`).run(
      teamId,
      "Solo",
      inviteCode,
      userId
    );
    db.prepare(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`).run(teamId, userId);
    team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId) as typeof team;
  }
  return team!;
}

export function enableSoloMode(userId: number): { ok: boolean; error?: string } {
  const check = assertCanEnableSolo(userId);
  if (!check.ok) return check;
  upsertUser(userId);
  db.prepare(`UPDATE users SET solo_mode = 1 WHERE telegram_id = ?`).run(userId);
  ensureSoloTeam(userId);
  return { ok: true };
}

export function disableSoloMode(userId: number): { ok: boolean; error?: string } {
  if (!isSoloModeEnabled(userId)) {
    return { ok: false, error: "Solo режим не включён" };
  }
  clearSoloMode(userId);
  return { ok: true };
}

export function getTrainingContext(userId: number): {
  teamId: string;
  mode: "team" | "solo";
} | null {
  const socialTeam = getUserTeam(userId);
  if (socialTeam) return { teamId: socialTeam.id, mode: "team" };
  if (!isSoloModeEnabled(userId)) return null;
  return { teamId: ensureSoloTeam(userId).id, mode: "solo" };
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

export function createTeam(
  captainId: number,
  name: string
): { ok: boolean; error?: string; id?: string; inviteCode?: string } {
  const check = assertCanJoinTeam(captainId);
  if (!check.ok) return check;

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
  return { ok: true, id, inviteCode };
}

export function getTeamByInviteCode(code: string) {
  return db
    .prepare(`SELECT * FROM teams WHERE invite_code = ? AND invite_code NOT LIKE ?`)
    .get(code.toUpperCase(), `${SOLO_INVITE_PREFIX}%`) as
    | { id: string; name: string; invite_code: string; captain_id: number }
    | undefined;
}

export function getUserTeam(userId: number) {
  const row = db
    .prepare(
      `SELECT t.* FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = ? AND t.invite_code NOT LIKE ?`
    )
    .get(userId, `${SOLO_INVITE_PREFIX}%`) as
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
  const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId) as
    | { id: string; invite_code: string }
    | undefined;
  if (!team || isSoloTeam(team as { id: string; invite_code: string })) {
    return { ok: false, error: "Команда не найдена" };
  }
  const soloCheck = assertCanJoinTeam(userId);
  if (!soloCheck.ok) return soloCheck;

  const count = getTeamMemberCount(teamId);
  if (count >= config.maxTeamSize) {
    return { ok: false, error: "Команда заполнена (макс. 5 человек)" };
  }

  db.prepare(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`).run(teamId, userId);
  const todayWorkout = getTodayWorkoutForTeam(teamId);
  if (todayWorkout) ensureUserWorkoutLog(todayWorkout.id, userId);
  return { ok: true };
}

function deleteTeamById(teamId: string): void {
  const workouts = db
    .prepare(`SELECT id FROM team_workouts WHERE team_id = ?`)
    .all(teamId) as Array<{ id: string }>;
  for (const w of workouts) {
    db.prepare(`DELETE FROM workout_logs WHERE team_workout_id = ?`).run(w.id);
  }
  db.prepare(`DELETE FROM team_workouts WHERE team_id = ?`).run(teamId);
  db.prepare(`DELETE FROM team_members WHERE team_id = ?`).run(teamId);
  db.prepare(`DELETE FROM teams WHERE id = ?`).run(teamId);
}

export function leaveTeam(userId: number): {
  ok: boolean;
  error?: string;
  disbanded?: boolean;
  teamName?: string;
  newCaptainId?: number;
} {
  const team = getUserTeam(userId);
  if (!team) return { ok: false, error: "Вы не в команде" };

  const count = getTeamMemberCount(team.id);

  if (team.captain_id === userId) {
    if (count <= 1) {
      deleteTeamById(team.id);
      return { ok: true, disbanded: true, teamName: team.name };
    }
    const nextCaptain = db
      .prepare(
        `SELECT user_id FROM team_members
         WHERE team_id = ? AND user_id != ?
         ORDER BY joined_at ASC LIMIT 1`
      )
      .get(team.id, userId) as { user_id: number } | undefined;
    if (!nextCaptain) {
      deleteTeamById(team.id);
      return { ok: true, disbanded: true, teamName: team.name };
    }
    db.prepare(`UPDATE teams SET captain_id = ? WHERE id = ?`).run(nextCaptain.user_id, team.id);
    db.prepare(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`).run(team.id, userId);
    return { ok: true, teamName: team.name, newCaptainId: nextCaptain.user_id };
  }

  db.prepare(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`).run(team.id, userId);
  return { ok: true, teamName: team.name };
}

export function disbandTeam(userId: number): { ok: boolean; error?: string; teamName?: string } {
  const team = getUserTeam(userId);
  if (!team) return { ok: false, error: "Вы не в команде" };
  if (team.captain_id !== userId) {
    return { ok: false, error: "Только капитан может расформировать команду" };
  }
  deleteTeamById(team.id);
  return { ok: true, teamName: team.name };
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
    ensureUserWorkoutLog(id, m.telegram_id);
  }

  return db.prepare(`SELECT * FROM team_workouts WHERE id = ?`).get(id) as typeof existing;
}

function resolveExerciseAssignment(
  userId: number,
  teamSlug: string,
  teamReps: number,
  teamSets: number,
  teamDuration: number | null
): {
  slug: string;
  reps: number;
  sets: number;
  durationSec: number | null;
  alternativeUsed: boolean;
} {
  const completed = getUserCompletedExerciseSlugsToday(userId);
  if (!completed.includes(teamSlug)) {
    return {
      slug: teamSlug,
      reps: teamReps,
      sets: teamSets,
      durationSec: teamDuration,
      alternativeUsed: false,
    };
  }
  const alt = pickExerciseForUser(completed);
  return {
    slug: alt.slug,
    reps: alt.defaultReps,
    sets: alt.defaultSets,
    durationSec: alt.durationSec ?? null,
    alternativeUsed: true,
  };
}

export function getUserCompletedExerciseSlugsToday(userId: number): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT COALESCE(wl.exercise_slug, tw.exercise_slug) AS slug
       FROM workout_logs wl
       JOIN team_workouts tw ON tw.id = wl.team_workout_id
       WHERE wl.user_id = ? AND tw.workout_date = ? AND wl.completed = 1`
    )
    .all(userId, todayKey()) as Array<{ slug: string }>;
  return rows.map((r) => r.slug);
}

export function hasUserCompletedExerciseToday(userId: number, exerciseSlug: string): boolean {
  return getUserCompletedExerciseSlugsToday(userId).includes(exerciseSlug);
}

export function hasUserPhotoVerifiedExerciseToday(userId: number, exerciseSlug: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM workout_logs wl
       JOIN team_workouts tw ON tw.id = wl.team_workout_id
       WHERE wl.user_id = ? AND tw.workout_date = ? AND wl.photo_verified = 1
         AND COALESCE(wl.exercise_slug, tw.exercise_slug) = ?`
    )
    .get(userId, todayKey(), exerciseSlug);
  return !!row;
}

export function syncUserWorkoutLogAssignment(teamWorkoutId: string, userId: number): void {
  const tw = getTeamWorkout(teamWorkoutId);
  const log = getUserWorkoutLog(teamWorkoutId, userId);
  if (!tw || !log || log.completed === 1) return;

  const assignment = resolveExerciseAssignment(
    userId,
    tw.exercise_slug,
    tw.target_reps,
    tw.target_sets,
    tw.duration_sec
  );

  db.prepare(
    `UPDATE workout_logs SET exercise_slug = ?, target_reps = ?, target_sets = ?, duration_sec = ?
     WHERE team_workout_id = ? AND user_id = ?`
  ).run(
    assignment.slug,
    assignment.reps,
    assignment.sets,
    assignment.durationSec,
    teamWorkoutId,
    userId
  );
}

export function ensureUserWorkoutLog(teamWorkoutId: string, userId: number) {
  const tw = getTeamWorkout(teamWorkoutId);
  if (!tw) return undefined;

  let log = getUserWorkoutLog(teamWorkoutId, userId);
  if (!log) {
    const assignment = resolveExerciseAssignment(
      userId,
      tw.exercise_slug,
      tw.target_reps,
      tw.target_sets,
      tw.duration_sec
    );
    db.prepare(
      `INSERT INTO workout_logs (id, team_workout_id, user_id, exercise_slug, target_reps, target_sets, duration_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      teamWorkoutId,
      userId,
      assignment.slug,
      assignment.reps,
      assignment.sets,
      assignment.durationSec
    );
    log = getUserWorkoutLog(teamWorkoutId, userId);
  } else if (log.completed !== 1) {
    syncUserWorkoutLogAssignment(teamWorkoutId, userId);
    log = getUserWorkoutLog(teamWorkoutId, userId);
  }
  return log;
}

export function getUserWorkoutView(teamWorkoutId: string, userId: number) {
  const tw = getTeamWorkout(teamWorkoutId);
  if (!tw) return null;

  ensureUserWorkoutLog(teamWorkoutId, userId);
  const log = getUserWorkoutLog(teamWorkoutId, userId);
  if (!log) return null;

  const slug = log.exercise_slug ?? tw.exercise_slug;
  return {
    exerciseSlug: slug,
    targetReps: log.target_reps ?? tw.target_reps,
    targetSets: log.target_sets ?? tw.target_sets,
    durationSec: log.duration_sec ?? tw.duration_sec,
    alternativeUsed: slug !== tw.exercise_slug,
    teamExerciseSlug: tw.exercise_slug,
    completed: log.completed === 1,
    photoVerified: log.photo_verified === 1,
  };
}

export function ensureTodayWorkoutForUser(teamId: string, userId: number) {
  const workout = ensureTodayWorkout(teamId);
  if (!workout) return null;
  ensureUserWorkoutLog(workout.id, userId);
  return workout;
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
      exercise_slug: string | null;
      target_reps: number | null;
      target_sets: number | null;
      duration_sec: number | null;
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
  return db
    .prepare(`SELECT id, name, captain_id FROM teams WHERE invite_code NOT LIKE ?`)
    .all(`${SOLO_INVITE_PREFIX}%`) as Array<{
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

const APPSS_VERIFY_SETTING_KEY = "appss_verify_code";

export function getStoredAppssVerifyCode(): string | null {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(APPSS_VERIFY_SETTING_KEY) as { value: string } | undefined;
  const value = row?.value?.trim();
  return value || null;
}

export function setStoredAppssVerifyCode(code: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run(APPSS_VERIFY_SETTING_KEY, code.trim());
}

export { db };
