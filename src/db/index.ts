import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { pickDailyExercise, pickExerciseForUser } from "../services/exercises.js";
import { generateInviteCode } from "../utils/helpers.js";
import { dbAll, dbExec, dbGet, dbRun, initDb } from "./client.js";

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

export async function upsertUser(
  telegramId: number,
  username?: string,
  firstName?: string
): Promise<void> {
  await dbRun(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name`,
    [telegramId, username ?? null, firstName ?? null]
  );
}

export async function getUser(telegramId: number) {
  return (await dbGet(
    `SELECT * FROM users WHERE telegram_id = ?`,
    [telegramId]
  )) as
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

export async function isSoloModeEnabled(userId: number): Promise<boolean> {
  return !!(await getUser(userId))?.solo_mode;
}

export async function isPremium(userId: number): Promise<boolean> {
  const until = (await getUser(userId))?.premium_until;
  if (!until) return false;
  return new Date(until) > new Date();
}

export async function getPremiumStatus(userId: number) {
  const until = (await getUser(userId))?.premium_until ?? null;
  const active = until ? new Date(until) > new Date() : false;
  return { isPremium: active, premiumUntil: active ? until : null };
}

export async function grantPremium(userId: number, days: number): Promise<{ until: string }> {
  const now = new Date();
  const user = await getUser(userId);
  let start = now;
  if (user?.premium_until) {
    const current = new Date(user.premium_until);
    if (current > now) start = current;
  }
  const until = new Date(start.getTime() + days * 86_400_000);
  const untilIso = until.toISOString();
  await dbRun(`UPDATE users SET premium_until = ? WHERE telegram_id = ?`, [untilIso, userId]);
  return { until: untilIso };
}

/** Нельзя вступить/создать команду, пока включён Solo */
export async function assertCanJoinTeam(userId: number): Promise<{ ok: boolean; error?: string }> {
  if (await isSoloModeEnabled(userId)) {
    return {
      ok: false,
      error: "Включён Solo режим. Сначала выключите его — /team → ❌ Выключить Solo",
    };
  }
  if (await getUserTeam(userId)) {
    return { ok: false, error: "Вы уже в команде" };
  }
  return { ok: true };
}

/** Нельзя включить Solo, пока пользователь в команде */
export async function assertCanEnableSolo(
  userId: number
): Promise<{ ok: boolean; error?: string }> {
  if (await getUserTeam(userId)) {
    return { ok: false, error: "Сначала выйдите из команды" };
  }
  if (await isSoloModeEnabled(userId)) {
    return { ok: false, error: "Solo режим уже включён" };
  }
  return { ok: true };
}

async function clearSoloMode(userId: number): Promise<void> {
  await dbRun(`UPDATE users SET solo_mode = 0 WHERE telegram_id = ?`, [userId]);
  const teamId = soloTeamId(userId);
  const exists = await dbGet(`SELECT 1 FROM teams WHERE id = ?`, [teamId]);
  if (exists) await deleteTeamById(teamId);
}

export async function ensureSoloTeam(userId: number) {
  const teamId = soloTeamId(userId);
  let team = (await dbGet(`SELECT * FROM teams WHERE id = ?`, [teamId])) as
    | { id: string; name: string; invite_code: string; captain_id: number }
    | undefined;

  if (!team) {
    const inviteCode = `${SOLO_INVITE_PREFIX}${userId}`;
    await dbRun(`INSERT INTO teams (id, name, invite_code, captain_id) VALUES (?, ?, ?, ?)`, [
      teamId,
      "Solo",
      inviteCode,
      userId,
    ]);
    await dbRun(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`, [teamId, userId]);
    team = (await dbGet(`SELECT * FROM teams WHERE id = ?`, [teamId])) as typeof team;
  }
  return team!;
}

export async function enableSoloMode(userId: number): Promise<{ ok: boolean; error?: string }> {
  const check = await assertCanEnableSolo(userId);
  if (!check.ok) return check;
  await upsertUser(userId);
  await dbRun(`UPDATE users SET solo_mode = 1 WHERE telegram_id = ?`, [userId]);
  await ensureSoloTeam(userId);
  return { ok: true };
}

export async function disableSoloMode(userId: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await isSoloModeEnabled(userId))) {
    return { ok: false, error: "Solo режим не включён" };
  }
  await clearSoloMode(userId);
  return { ok: true };
}

export async function getTrainingContext(userId: number): Promise<{
  teamId: string;
  mode: "team" | "solo";
} | null> {
  const socialTeam = await getUserTeam(userId);
  if (socialTeam) return { teamId: socialTeam.id, mode: "team" };
  if (!(await isSoloModeEnabled(userId))) return null;
  return { teamId: (await ensureSoloTeam(userId)).id, mode: "solo" };
}

export async function addFsTokens(telegramId: number, amount: number): Promise<number> {
  await dbRun(`UPDATE users SET fs_tokens = fs_tokens + ? WHERE telegram_id = ?`, [
    amount,
    telegramId,
  ]);
  return (await getUser(telegramId))?.fs_tokens ?? amount;
}

export async function updateStreak(telegramId: number): Promise<number> {
  const user = await getUser(telegramId);
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

  await dbRun(
    `UPDATE users SET streak_days = ?, last_workout_date = ?, total_workouts = total_workouts + 1 WHERE telegram_id = ?`,
    [streak, today, telegramId]
  );

  return streak;
}

export async function createTeam(
  captainId: number,
  name: string
): Promise<{ ok: boolean; error?: string; id?: string; inviteCode?: string }> {
  const check = await assertCanJoinTeam(captainId);
  if (!check.ok) return check;

  const id = uuidv4();
  let inviteCode = generateInviteCode();
  while (await getTeamByInviteCode(inviteCode)) {
    inviteCode = generateInviteCode();
  }
  await dbRun(`INSERT INTO teams (id, name, invite_code, captain_id) VALUES (?, ?, ?, ?)`, [
    id,
    name,
    inviteCode,
    captainId,
  ]);
  await dbRun(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`, [id, captainId]);
  return { ok: true, id, inviteCode };
}

export async function getTeamByInviteCode(code: string) {
  return (await dbGet(
    `SELECT * FROM teams WHERE invite_code = ? AND invite_code NOT LIKE ?`,
    [code.toUpperCase(), `${SOLO_INVITE_PREFIX}%`]
  )) as
    | { id: string; name: string; invite_code: string; captain_id: number }
    | undefined;
}

export async function getUserTeam(userId: number) {
  const row = (await dbGet(
    `SELECT t.* FROM teams t
     JOIN team_members tm ON tm.team_id = t.id
     WHERE tm.user_id = ? AND t.invite_code NOT LIKE ?`,
    [userId, `${SOLO_INVITE_PREFIX}%`]
  )) as
    | { id: string; name: string; invite_code: string; captain_id: number }
    | undefined;
  return row;
}

export async function getTeamMembers(teamId: string) {
  return (await dbAll(
    `SELECT u.telegram_id, u.username, u.first_name, u.fs_tokens
     FROM team_members tm
     JOIN users u ON u.telegram_id = tm.user_id
     WHERE tm.team_id = ?
     ORDER BY tm.joined_at`,
    [teamId]
  )) as Array<{
      telegram_id: number;
      username: string | null;
      first_name: string | null;
      fs_tokens: number;
    }>;
}

export async function getTeamMemberCount(teamId: string): Promise<number> {
  const row = (await dbGet(`SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?`, [
    teamId,
  ])) as { cnt: number };
  return row.cnt;
}

export async function joinTeam(teamId: string, userId: number): Promise<{ ok: boolean; error?: string }> {
  const team = (await dbGet(`SELECT * FROM teams WHERE id = ?`, [teamId])) as
    | { id: string; invite_code: string }
    | undefined;
  if (!team || isSoloTeam(team as { id: string; invite_code: string })) {
    return { ok: false, error: "Команда не найдена" };
  }
  const soloCheck = await assertCanJoinTeam(userId);
  if (!soloCheck.ok) return soloCheck;

  const count = await getTeamMemberCount(teamId);
  if (count >= config.maxTeamSize) {
    return { ok: false, error: "Команда заполнена (макс. 5 человек)" };
  }

  await dbRun(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`, [teamId, userId]);
  const todayWorkout = await getTodayWorkoutForTeam(teamId);
  if (todayWorkout) await ensureUserWorkoutLog(todayWorkout.id, userId);
  return { ok: true };
}

async function deleteTeamById(teamId: string): Promise<void> {
  const workouts = (await dbAll(`SELECT id FROM team_workouts WHERE team_id = ?`, [teamId])) as Array<{
    id: string;
  }>;
  for (const w of workouts) {
    await dbRun(`DELETE FROM workout_logs WHERE team_workout_id = ?`, [w.id]);
  }
  await dbRun(`DELETE FROM team_workouts WHERE team_id = ?`, [teamId]);
  await dbRun(`DELETE FROM team_members WHERE team_id = ?`, [teamId]);
  await dbRun(`DELETE FROM teams WHERE id = ?`, [teamId]);
}

export async function leaveTeam(userId: number): Promise<{
  ok: boolean;
  error?: string;
  disbanded?: boolean;
  teamName?: string;
  newCaptainId?: number;
}> {
  const team = await getUserTeam(userId);
  if (!team) return { ok: false, error: "Вы не в команде" };

  const count = await getTeamMemberCount(team.id);

  if (team.captain_id === userId) {
    if (count <= 1) {
      await deleteTeamById(team.id);
      return { ok: true, disbanded: true, teamName: team.name };
    }
    const nextCaptain = (await dbGet(
      `SELECT user_id FROM team_members
       WHERE team_id = ? AND user_id != ?
       ORDER BY joined_at ASC LIMIT 1`,
      [team.id, userId]
    )) as { user_id: number } | undefined;
    if (!nextCaptain) {
      await deleteTeamById(team.id);
      return { ok: true, disbanded: true, teamName: team.name };
    }
    await dbRun(`UPDATE teams SET captain_id = ? WHERE id = ?`, [nextCaptain.user_id, team.id]);
    await dbRun(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`, [team.id, userId]);
    return { ok: true, teamName: team.name, newCaptainId: nextCaptain.user_id };
  }

  await dbRun(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`, [team.id, userId]);
  return { ok: true, teamName: team.name };
}

export async function disbandTeam(
  userId: number
): Promise<{ ok: boolean; error?: string; teamName?: string }> {
  const team = await getUserTeam(userId);
  if (!team) return { ok: false, error: "Вы не в команде" };
  if (team.captain_id !== userId) {
    return { ok: false, error: "Только капитан может расформировать команду" };
  }
  await deleteTeamById(team.id);
  return { ok: true, teamName: team.name };
}

export async function ensureTodayWorkout(teamId: string) {
  const today = todayKey();
  const existing = (await dbGet(
    `SELECT * FROM team_workouts WHERE team_id = ? AND workout_date = ?`,
    [teamId, today]
  )) as
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
  await dbRun(
    `INSERT INTO team_workouts (id, team_id, exercise_slug, target_reps, target_sets, duration_sec, workout_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      teamId,
      exercise.slug,
      exercise.defaultReps,
      exercise.defaultSets,
      exercise.durationSec ?? null,
      today,
    ]
  );

  const members = await getTeamMembers(teamId);
  for (const m of members) {
    await ensureUserWorkoutLog(id, m.telegram_id);
  }

  return (await dbGet(`SELECT * FROM team_workouts WHERE id = ?`, [id])) as typeof existing;
}

async function resolveExerciseAssignment(
  userId: number,
  teamSlug: string,
  teamReps: number,
  teamSets: number,
  teamDuration: number | null
): Promise<{
  slug: string;
  reps: number;
  sets: number;
  durationSec: number | null;
  alternativeUsed: boolean;
}> {
  const completed = await getUserCompletedExerciseSlugsToday(userId);
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

export async function getUserCompletedExerciseSlugsToday(userId: number): Promise<string[]> {
  const rows = (await dbAll(
    `SELECT DISTINCT COALESCE(wl.exercise_slug, tw.exercise_slug) AS slug
     FROM workout_logs wl
     JOIN team_workouts tw ON tw.id = wl.team_workout_id
     WHERE wl.user_id = ? AND tw.workout_date = ? AND wl.completed = 1`,
    [userId, todayKey()]
  )) as Array<{ slug: string }>;
  return rows.map((r) => r.slug);
}

export async function hasUserCompletedExerciseToday(
  userId: number,
  exerciseSlug: string
): Promise<boolean> {
  return (await getUserCompletedExerciseSlugsToday(userId)).includes(exerciseSlug);
}

export async function hasUserPhotoVerifiedExerciseToday(
  userId: number,
  exerciseSlug: string
): Promise<boolean> {
  const row = await dbGet(
    `SELECT 1 FROM workout_logs wl
     JOIN team_workouts tw ON tw.id = wl.team_workout_id
     WHERE wl.user_id = ? AND tw.workout_date = ? AND wl.photo_verified = 1
       AND COALESCE(wl.exercise_slug, tw.exercise_slug) = ?`,
    [userId, todayKey(), exerciseSlug]
  );
  return !!row;
}

export async function syncUserWorkoutLogAssignment(
  teamWorkoutId: string,
  userId: number
): Promise<void> {
  const tw = await getTeamWorkout(teamWorkoutId);
  const log = await getUserWorkoutLog(teamWorkoutId, userId);
  if (!tw || !log || log.completed === 1) return;

  const assignment = await resolveExerciseAssignment(
    userId,
    tw.exercise_slug,
    tw.target_reps,
    tw.target_sets,
    tw.duration_sec
  );

  await dbRun(
    `UPDATE workout_logs SET exercise_slug = ?, target_reps = ?, target_sets = ?, duration_sec = ?
     WHERE team_workout_id = ? AND user_id = ?`,
    [
      assignment.slug,
      assignment.reps,
      assignment.sets,
      assignment.durationSec,
      teamWorkoutId,
      userId,
    ]
  );
}

export async function ensureUserWorkoutLog(teamWorkoutId: string, userId: number) {
  const tw = await getTeamWorkout(teamWorkoutId);
  if (!tw) return undefined;

  let log = await getUserWorkoutLog(teamWorkoutId, userId);
  if (!log) {
    const assignment = await resolveExerciseAssignment(
      userId,
      tw.exercise_slug,
      tw.target_reps,
      tw.target_sets,
      tw.duration_sec
    );
    await dbRun(
      `INSERT INTO workout_logs (id, team_workout_id, user_id, exercise_slug, target_reps, target_sets, duration_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        teamWorkoutId,
        userId,
        assignment.slug,
        assignment.reps,
        assignment.sets,
        assignment.durationSec,
      ]
    );
    log = await getUserWorkoutLog(teamWorkoutId, userId);
  } else if (log.completed !== 1) {
    await syncUserWorkoutLogAssignment(teamWorkoutId, userId);
    log = await getUserWorkoutLog(teamWorkoutId, userId);
  }
  return log;
}

export async function getUserWorkoutView(teamWorkoutId: string, userId: number) {
  const tw = await getTeamWorkout(teamWorkoutId);
  if (!tw) return null;

  await ensureUserWorkoutLog(teamWorkoutId, userId);
  const log = await getUserWorkoutLog(teamWorkoutId, userId);
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

export async function ensureTodayWorkoutForUser(teamId: string, userId: number) {
  const workout = await ensureTodayWorkout(teamId);
  if (!workout) return null;
  await ensureUserWorkoutLog(workout.id, userId);
  return workout;
}

export async function getTeamWorkout(id: string) {
  return (await dbGet(`SELECT * FROM team_workouts WHERE id = ?`, [id])) as
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

export async function getTodayWorkoutForTeam(teamId: string) {
  return (await dbGet(`SELECT * FROM team_workouts WHERE team_id = ? AND workout_date = ?`, [
    teamId,
    todayKey(),
  ])) as Awaited<ReturnType<typeof getTeamWorkout>>;
}

export async function getWorkoutLogs(workoutId: string) {
  return (await dbAll(`SELECT * FROM workout_logs WHERE team_workout_id = ?`, [workoutId])) as Array<{
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

export async function getUserWorkoutLog(workoutId: string, userId: number) {
  return (await dbGet(
    `SELECT * FROM workout_logs WHERE team_workout_id = ? AND user_id = ?`,
    [workoutId, userId]
  )) as Awaited<ReturnType<typeof getWorkoutLogs>>[number] | undefined;
}

export async function completeWorkout(
  workoutId: string,
  userId: number,
  fsEarned: number
): Promise<void> {
  await dbRun(
    `UPDATE workout_logs SET completed = 1, fs_earned = ?, completed_at = datetime('now')
     WHERE team_workout_id = ? AND user_id = ?`,
    [fsEarned, workoutId, userId]
  );
}

export async function verifyWorkoutPhoto(
  workoutId: string,
  userId: number,
  photoPath: string,
  extraFs: number
): Promise<void> {
  await dbRun(
    `UPDATE workout_logs SET photo_path = ?, photo_verified = 1, fs_earned = fs_earned + ?
     WHERE team_workout_id = ? AND user_id = ?`,
    [photoPath, extraFs, workoutId, userId]
  );
}

export async function isWorkoutFullyCompleted(workoutId: string): Promise<boolean> {
  const logs = await getWorkoutLogs(workoutId);
  if (logs.length === 0) return false;
  return logs.every((l) => l.completed === 1);
}

export async function markWorkoutCompleted(workoutId: string): Promise<void> {
  await dbRun(`UPDATE team_workouts SET status = 'completed' WHERE id = ?`, [workoutId]);
}

export async function grantAchievement(userId: number, type: string): Promise<boolean> {
  const existing = await dbGet(`SELECT 1 FROM achievements WHERE user_id = ? AND type = ?`, [
    userId,
    type,
  ]);
  if (existing) return false;
  await dbRun(`INSERT INTO achievements (id, user_id, type) VALUES (?, ?, ?)`, [
    uuidv4(),
    userId,
    type,
  ]);
  return true;
}

export async function getAchievements(userId: number) {
  return (await dbAll(
    `SELECT type, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at`,
    [userId]
  )) as Array<{ type: string; earned_at: string }>;
}

export async function countTeamWorkoutsCompleted(userId: number): Promise<number> {
  const row = (await dbGet(
    `SELECT COUNT(*) as cnt FROM workout_logs wl
     JOIN team_workouts tw ON tw.id = wl.team_workout_id
     WHERE wl.user_id = ? AND wl.completed = 1`,
    [userId]
  )) as { cnt: number };
  return row.cnt;
}

export async function getAllActiveTeams() {
  return (await dbAll(
    `SELECT id, name, captain_id FROM teams WHERE invite_code NOT LIKE ?`,
    [`${SOLO_INVITE_PREFIX}%`]
  )) as Array<{
    id: string;
    name: string;
    captain_id: number;
  }>;
}

export async function getTeamLeaderboard(teamId: string, limit = 5) {
  return (await dbAll(
    `SELECT u.telegram_id, u.first_name, u.username, u.fs_tokens, u.streak_days
     FROM team_members tm
     JOIN users u ON u.telegram_id = tm.user_id
     WHERE tm.team_id = ?
     ORDER BY u.fs_tokens DESC
     LIMIT ?`,
    [teamId, limit]
  )) as Array<{
      telegram_id: number;
      first_name: string | null;
      username: string | null;
      fs_tokens: number;
      streak_days: number;
    }>;
}

const APPSS_VERIFY_SETTING_KEY = "appss_verify_code";

export async function getStoredAppssVerifyCode(): Promise<string | null> {
  const row = (await dbGet(`SELECT value FROM app_settings WHERE key = ?`, [
    APPSS_VERIFY_SETTING_KEY,
  ])) as { value: string } | undefined;
  const value = row?.value?.trim();
  return value || null;
}

export async function setStoredAppssVerifyCode(code: string): Promise<void> {
  await dbRun(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [APPSS_VERIFY_SETTING_KEY, code.trim()]
  );
}

export async function isTributeEventProcessed(eventId: string): Promise<boolean> {
  const row = await dbGet(`SELECT 1 FROM tribute_events WHERE id = ?`, [eventId]);
  return !!row;
}

export async function markTributeEventProcessed(
  eventId: string,
  eventName: string,
  telegramUserId: number,
  payloadJson: string
): Promise<void> {
  await dbRun(
    `INSERT OR IGNORE INTO tribute_events (id, event_name, telegram_user_id, payload_json)
     VALUES (?, ?, ?, ?)`,
    [eventId, eventName, telegramUserId, payloadJson]
  );
}

export { dbAll, dbExec, dbGet, dbRun, initDb };
