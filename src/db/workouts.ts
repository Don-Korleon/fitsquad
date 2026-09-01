import { v4 as uuidv4 } from "uuid";
import { pickDailyExercise, pickExerciseForUser } from "../services/exercises.js";
import { dbAll, dbGet, dbRun } from "./client.js";
import { getTeamMembers } from "./teams.js";
import { todayKey } from "./shared.js";

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

export async function countTeamWorkoutsCompleted(userId: number): Promise<number> {
  const row = (await dbGet(
    `SELECT COUNT(*) as cnt FROM workout_logs wl
     JOIN team_workouts tw ON tw.id = wl.team_workout_id
     WHERE wl.user_id = ? AND wl.completed = 1`,
    [userId]
  )) as { cnt: number };
  return row.cnt;
}
