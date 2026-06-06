import { Router } from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { ACHIEVEMENTS, config } from "../../config.js";
import {
  completeWorkout,
  ensureTodayWorkout,
  getAchievements,
  getTeamLeaderboard,
  getTeamMembers,
  getTeamWorkout,
  getTodayWorkoutForTeam,
  getUser,
  getUserTeam,
  getUserWorkoutLog,
  getWorkoutLogs,
  isWorkoutFullyCompleted,
  markWorkoutCompleted,
  upsertUser,
  verifyWorkoutPhoto as dbVerifyPhoto,
} from "../../db/index.js";
import { getExercise, EXERCISES } from "../../services/exercises.js";
import { getWorkoutCoachTip } from "../../services/aiTrainer.js";
import {
  rewardPhotoVerified,
  rewardTeamBonus,
  rewardWorkoutComplete,
  verifyWorkoutPhoto,
} from "../../services/gamification.js";
import { validateInitData } from "../../utils/telegramAuth.js";

export const apiRouter = Router();

const upload = multer({
  dest: config.uploadsDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images allowed"));
  },
});

function requireUser(initData: string | undefined) {
  if (!initData) return null;
  const user = validateInitData(initData);
  if (!user) return null;
  upsertUser(user.id, user.username, user.first_name);
  return user;
}

function workoutIdParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0]! : raw;
}

apiRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    name: "FitSquad",
    mode: config.apiMode,
    webappUrl: config.webappUrl,
    webappIsHttps: config.webappIsHttps,
  });
});

apiRouter.get("/exercises", (_req, res) => {
  res.json({ exercises: EXERCISES });
});

apiRouter.get("/me", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const dbUser = getUser(user.id);
  const team = getUserTeam(user.id);
  const achievements = getAchievements(user.id).map((a) => {
    const def = ACHIEVEMENTS.find((d) => d.type === a.type);
    return {
      type: a.type,
      label: def?.label ?? a.type,
      emoji: def?.emoji ?? "🏅",
      earnedAt: a.earned_at,
    };
  });

  res.json({
    id: user.id,
    username: user.username,
    firstName: user.first_name,
    fsTokens: dbUser?.fs_tokens ?? 0,
    streakDays: dbUser?.streak_days ?? 0,
    totalWorkouts: dbUser?.total_workouts ?? 0,
    team: team ? { id: team.id, name: team.name, inviteCode: team.invite_code } : null,
    achievements,
  });
});

apiRouter.get("/team", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const team = getUserTeam(user.id);
  if (!team) {
    res.json({ team: null });
    return;
  }

  const workout = getTodayWorkoutForTeam(team.id);
  const logs = workout ? getWorkoutLogs(workout.id) : [];
  const members = getTeamMembers(team.id).map((m) => ({
    userId: m.telegram_id,
    firstName: m.first_name,
    username: m.username,
    fsTokens: m.fs_tokens,
    completedToday: logs.some((l) => l.user_id === m.telegram_id && l.completed === 1),
  }));

  res.json({
    team: {
      id: team.id,
      name: team.name,
      inviteCode: team.invite_code,
      captainId: team.captain_id,
      members,
      maxSize: config.maxTeamSize,
    },
  });
});

apiRouter.get("/workout/today", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const team = getUserTeam(user.id);
  if (!team) {
    res.status(404).json({ error: "No team" });
    return;
  }

  const workout = ensureTodayWorkout(team.id);
  if (!workout) {
    res.status(500).json({ error: "Workout error" });
    return;
  }

  const exercise = getExercise(workout.exercise_slug);
  const logs = getWorkoutLogs(workout.id);
  const userLog = getUserWorkoutLog(workout.id, user.id);

  res.json({
    id: workout.id,
    exercise: exercise ?? null,
    targetReps: workout.target_reps,
    targetSets: workout.target_sets,
    durationSec: workout.duration_sec,
    workoutDate: workout.workout_date,
    status: workout.status,
    completed: !!userLog?.completed,
    photoVerified: !!userLog?.photo_verified,
    teamProgress: {
      completed: logs.filter((l) => l.completed === 1).length,
      total: logs.length,
    },
  });
});

apiRouter.get("/workout/:id", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const workout = getTeamWorkout(workoutIdParam(req.params.id));
  if (!workout) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const exercise = getExercise(workout.exercise_slug);
  const userLog = getUserWorkoutLog(workout.id, user.id);
  res.json({
    id: workout.id,
    exercise,
    targetReps: workout.target_reps,
    targetSets: workout.target_sets,
    durationSec: workout.duration_sec,
    completed: !!userLog?.completed,
    photoVerified: !!userLog?.photo_verified,
  });
});

apiRouter.post("/workout/:id/complete", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }

  const workout = getTeamWorkout(workoutIdParam(req.params.id));
  if (!workout) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const existing = getUserWorkoutLog(workout.id, user.id);
  if (existing?.completed) {
    res.json({ alreadyCompleted: true, fsEarned: existing.fs_earned });
    return;
  }

  const reward = rewardWorkoutComplete(user.id);
  completeWorkout(workout.id, user.id, reward.totalFs);

  let teamBonus = 0;
  if (isWorkoutFullyCompleted(workout.id)) {
    markWorkoutCompleted(workout.id);
    const logs = getWorkoutLogs(workout.id);
    const memberIds = logs.map((l) => l.user_id);
    teamBonus = rewardTeamBonus(memberIds);
  }

  res.json({
    reward,
    teamBonus,
    allTeamCompleted: isWorkoutFullyCompleted(workout.id),
  });
});

apiRouter.post("/workout/:id/verify", upload.single("photo"), async (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }

  const workout = getTeamWorkout(workoutIdParam(req.params.id));
  if (!workout) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const log = getUserWorkoutLog(workout.id, user.id);
  if (!log?.completed) {
    res.status(400).json({ error: "Complete workout first" });
    return;
  }
  if (log.photo_verified) {
    res.json({ alreadyVerified: true });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "Photo required" });
    return;
  }

  const ext = path.extname(req.file.originalname) || ".jpg";
  const finalPath = path.join(config.uploadsDir, `${req.file.filename}${ext}`);
  fs.renameSync(req.file.path, finalPath);

  const result = await verifyWorkoutPhoto(finalPath);
  if (!result.verified) {
    fs.unlinkSync(finalPath);
    res.status(400).json({ error: result.reason, confidence: result.confidence });
    return;
  }

  const fsBonus = rewardPhotoVerified(user.id);
  dbVerifyPhoto(workout.id, user.id, finalPath, fsBonus);

  res.json({ verified: true, fsBonus, reason: result.reason, confidence: result.confidence });
});

apiRouter.get("/workout/:id/coach", async (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const workout = getTeamWorkout(workoutIdParam(req.params.id));
  if (!workout) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const setNum = Number(req.query.set ?? 1);
  const tip = await getWorkoutCoachTip(workout.exercise_slug, setNum);
  res.json(tip);
});

apiRouter.get("/leaderboard", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const team = getUserTeam(user.id);
  if (!team) {
    res.json({ leaderboard: [] });
    return;
  }
  const leaderboard = getTeamLeaderboard(team.id).map((m, i) => ({
    rank: i + 1,
    userId: m.telegram_id,
    firstName: m.first_name,
    username: m.username,
    fsTokens: m.fs_tokens,
    streakDays: m.streak_days,
  }));
  res.json({ leaderboard });
});
