import { Router } from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { ACHIEVEMENTS, config } from "../../config.js";
import {
  completeWorkout,
  disbandTeam,
  disableSoloMode,
  enableSoloMode,
  ensureTodayWorkoutForUser,
  getAchievements,
  getTeamLeaderboard,
  getTeamMembers,
  getTeamWorkout,
  getTodayWorkoutForTeam,
  getUser,
  getUserTeam,
  getUserWorkoutLog,
  getUserWorkoutView,
  getWorkoutLogs,
  getTrainingContext,
  hasUserCompletedExerciseToday,
  hasUserPhotoVerifiedExerciseToday,
  isSoloModeEnabled,
  isPremium,
  isWorkoutFullyCompleted,
  leaveTeam,
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
import { getUserPremiumInfo } from "../../services/premium.js";
import { resolveAppssVerifyCode, fetchBotCommandNames, APPSS_COMMAND } from "../../bot/appssVerify.js";
import { createPremiumInvoiceLink } from "../../bot/premium.js";
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

function resolveWorkoutForUser(userId: number, workoutId: string) {
  const direct = getTeamWorkout(workoutId);
  if (direct) return direct;

  const training = getTrainingContext(userId);
  if (!training) return undefined;

  return getTodayWorkoutForTeam(training.teamId) ?? undefined;
}

apiRouter.get("/health", async (_req, res) => {
  const botCommands = await fetchBotCommandNames();
  res.json({
    ok: true,
    name: "FitSquad",
    mode: config.apiMode,
    photoVerify: config.apiMode === "live" && config.openaiApiKey ? "openai" : "auto",
    premiumPriceStars: config.premiumPriceStars,
    premiumDays: config.premiumDays,
    webappUrl: config.webappUrl,
    webappIsHttps: config.webappIsHttps,
    botTokenSet: !!config.botToken,
    botUsername: config.botUsername,
    appssVerifyCommand: botCommands.includes(APPSS_COMMAND),
    botCommands,
    webhookPath: `/webhook/${config.webhookSecret.slice(0, 4)}…`,
    publicUrl: config.publicUrl,
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
    soloMode: isSoloModeEnabled(user.id),
    isPremium: isPremium(user.id),
    premiumUntil: getUserPremiumInfo(user.id).premiumUntil,
    trainingMode: team ? "team" : isSoloModeEnabled(user.id) ? "solo" : null,
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
      isCaptain: team.captain_id === user.id,
      members,
      maxSize: config.maxTeamSize,
    },
  });
});

apiRouter.post("/team/leave", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const result = leaveTeam(user.id);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

apiRouter.post("/team/disband", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const result = disbandTeam(user.id);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

apiRouter.post("/solo/enable", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const result = enableSoloMode(user.id);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, soloMode: true });
});

apiRouter.post("/solo/disable", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const result = disableSoloMode(user.id);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, soloMode: false });
});

apiRouter.get("/workout/today", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const training = getTrainingContext(user.id);
  if (!training) {
    res.status(404).json({ error: "No training mode" });
    return;
  }

  const workout = ensureTodayWorkoutForUser(training.teamId, user.id);
  if (!workout) {
    res.status(500).json({ error: "Workout error" });
    return;
  }

  const view = getUserWorkoutView(workout.id, user.id);
  if (!view) {
    res.status(500).json({ error: "Workout error" });
    return;
  }

  const exercise = getExercise(view.exerciseSlug);
  const teamExercise = getExercise(view.teamExerciseSlug);
  const logs = getWorkoutLogs(workout.id);

  res.json({
    id: workout.id,
    exercise: exercise ?? null,
    targetReps: view.targetReps,
    targetSets: view.targetSets,
    durationSec: view.durationSec,
    workoutDate: workout.workout_date,
    status: workout.status,
    completed: view.completed,
    photoVerified: view.photoVerified,
    soloMode: training.mode === "solo",
    alternativeUsed: view.alternativeUsed,
    alternativeNote: view.alternativeUsed
      ? `Вы уже выполнили «${teamExercise?.name ?? view.teamExerciseSlug}» сегодня — другое упражнение`
      : null,
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
  const view = getUserWorkoutView(workout.id, user.id);
  if (!view) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const exercise = getExercise(view.exerciseSlug);
  res.json({
    id: workout.id,
    exercise,
    targetReps: view.targetReps,
    targetSets: view.targetSets,
    durationSec: view.durationSec,
    completed: view.completed,
    photoVerified: view.photoVerified,
    alternativeUsed: view.alternativeUsed,
  });
});

apiRouter.post("/workout/:id/complete", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }

  const workout = resolveWorkoutForUser(user.id, workoutIdParam(req.params.id));
  if (!workout) {
    res.status(404).json({ error: "Тренировка не найдена. Обновите Mini App." });
    return;
  }

  const view = getUserWorkoutView(workout.id, user.id);
  if (!view) {
    res.status(404).json({ error: "Тренировка недоступна. Обновите Mini App." });
    return;
  }

  const existing = getUserWorkoutLog(workout.id, user.id);
  if (existing?.completed) {
    res.json({ alreadyCompleted: true, fsEarned: existing.fs_earned });
    return;
  }

  if (hasUserCompletedExerciseToday(user.id, view.exerciseSlug)) {
    res.status(409).json({
      error: "Это упражнение уже выполнено сегодня. Обновите тренировку — будет предложено другое.",
      exerciseAlreadyDone: true,
    });
    return;
  }

  const reward = rewardWorkoutComplete(user.id);
  completeWorkout(workout.id, user.id, reward.totalFs);

  let teamBonus = 0;
  const soloWorkout = workout.team_id.startsWith("solo-");

  if (isWorkoutFullyCompleted(workout.id)) {
    markWorkoutCompleted(workout.id);
    if (!soloWorkout) {
      const logs = getWorkoutLogs(workout.id);
      teamBonus = rewardTeamBonus(logs.map((l) => l.user_id));
    }
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
    res.status(401).json({ error: "Откройте Mini App через Telegram" });
    return;
  }

  const workout = resolveWorkoutForUser(user.id, workoutIdParam(req.params.id));
  if (!workout) {
    res.status(404).json({
      error: "Тренировка не найдена. Обновите Mini App и завершите тренировку снова.",
    });
    return;
  }

  const log = getUserWorkoutLog(workout.id, user.id);
  if (!log?.completed) {
    res.status(400).json({ error: "Сначала завершите тренировку в Mini App" });
    return;
  }
  if (log.photo_verified) {
    res.json({ alreadyVerified: true, reason: "Фото уже верифицировано ✅" });
    return;
  }

  const view = getUserWorkoutView(workout.id, user.id);
  if (view && hasUserPhotoVerifiedExerciseToday(user.id, view.exerciseSlug)) {
    res.status(409).json({
      error: "Фото для этого упражнения уже верифицировано сегодня",
      photoAlreadyVerified: true,
    });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "Выберите фото для загрузки" });
    return;
  }

  const ext = path.extname(req.file.originalname) || ".jpg";
  const finalPath = path.join(config.uploadsDir, `${req.file.filename}${ext}`);
  fs.renameSync(req.file.path, finalPath);

  const result = await verifyWorkoutPhoto(finalPath, user.id, {
    exerciseName: view ? getExercise(view.exerciseSlug)?.name : undefined,
    exerciseSlug: view?.exerciseSlug,
  });
  if (!result.verified) {
    fs.unlinkSync(finalPath);
    res.status(400).json({
      error: result.reason,
      reason: result.reason,
      confidence: result.confidence,
    });
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
  const view = getUserWorkoutView(workout.id, user.id);
  const setNum = Number(req.query.set ?? 1);
  const slug = view?.exerciseSlug ?? workout.exercise_slug;
  const tip = await getWorkoutCoachTip(slug, setNum, user.id);
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

apiRouter.get("/premium", (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  res.json(getUserPremiumInfo(user.id));
});

apiRouter.post("/premium/invoice", async (req, res) => {
  const user = requireUser(req.headers["x-telegram-init-data"] as string);
  if (!user) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }
  const invoiceLink = await createPremiumInvoiceLink();
  if (!invoiceLink) {
    res.status(503).json({ error: "Оплата временно недоступна. Используйте /premium в боте." });
    return;
  }
  res.json({ invoiceLink });
});

apiRouter.get("/appss-verify", (req, res) => {
  const code = resolveAppssVerifyCode(
    typeof req.query.code === "string" ? req.query.code : undefined
  );
  if (!code) {
    res.status(400).json({ error: "Missing verification code" });
    return;
  }
  res.type("text/plain").send(code);
});
