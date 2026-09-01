import { ACHIEVEMENTS, config } from "../config.js";
import {
  addFsTokens,
  countTeamWorkoutsCompleted,
  getUser,
  grantAchievement,
  isPremium,
  updateStreak,
} from "../db/index.js";
import { canUseAiPhotoVerify } from "./premium.js";
export interface WorkoutReward {
  baseFs: number;
  streakBonus: number;
  achievementBonus: number;
  premiumBonus: number;
  newAchievements: Array<{ type: string; label: string; emoji: string; bonusFs: number }>;
  totalFs: number;
  streakDays: number;
}

export async function rewardWorkoutComplete(userId: number): Promise<WorkoutReward> {
  const baseFs = config.fsWorkoutComplete;
  const streakDays = await updateStreak(userId);
  const streakBonus = streakDays > 1 ? config.fsStreakBonus : 0;

  let achievementBonus = 0;
  const newAchievements: WorkoutReward["newAchievements"] = [];

  const user = await getUser(userId);
  const totalWorkouts = user?.total_workouts ?? 1;

  if (totalWorkouts === 1 && (await grantAchievement(userId, "first_workout"))) {
    const ach = ACHIEVEMENTS.find((a) => a.type === "first_workout")!;
    achievementBonus += ach.bonusFs;
    newAchievements.push({ type: ach.type, label: ach.label, emoji: ach.emoji, bonusFs: ach.bonusFs });
  }

  if (streakDays >= 7 && (await grantAchievement(userId, "streak_7"))) {
    const ach = ACHIEVEMENTS.find((a) => a.type === "streak_7")!;
    achievementBonus += ach.bonusFs;
    newAchievements.push({ type: ach.type, label: ach.label, emoji: ach.emoji, bonusFs: ach.bonusFs });
  }

  const teamWorkouts = await countTeamWorkoutsCompleted(userId);
  if (teamWorkouts >= 5 && (await grantAchievement(userId, "team_player"))) {
    const ach = ACHIEVEMENTS.find((a) => a.type === "team_player")!;
    achievementBonus += ach.bonusFs;
    newAchievements.push({ type: ach.type, label: ach.label, emoji: ach.emoji, bonusFs: ach.bonusFs });
  }

  const subtotal = baseFs + streakBonus + achievementBonus;
  const multiplier = (await isPremium(userId)) ? config.premiumFsMultiplier : 1;
  const totalFs = Math.round(subtotal * multiplier);
  const premiumBonus = totalFs - subtotal;
  await addFsTokens(userId, totalFs);

  const updatedUser = await getUser(userId);
  if ((updatedUser?.fs_tokens ?? 0) >= 100 && (await grantAchievement(userId, "fs_100"))) {
    const ach = ACHIEVEMENTS.find((a) => a.type === "fs_100")!;
    await addFsTokens(userId, ach.bonusFs);
    achievementBonus += ach.bonusFs;
    newAchievements.push({ type: ach.type, label: ach.label, emoji: ach.emoji, bonusFs: ach.bonusFs });
  }

  return {
    baseFs,
    streakBonus,
    achievementBonus,
    premiumBonus,
    newAchievements,
    totalFs: totalFs + (newAchievements.find((a) => a.type === "fs_100")?.bonusFs ?? 0),
    streakDays,
  };
}

export async function rewardPhotoVerified(userId: number): Promise<number> {
  const amount = Math.round(
    config.fsPhotoVerified * ((await isPremium(userId)) ? config.premiumFsMultiplier : 1)
  );
  await addFsTokens(userId, amount);
  return amount;
}

export async function rewardTeamBonus(memberIds: number[]): Promise<number> {
  for (const id of memberIds) {
    await addFsTokens(id, config.fsTeamBonus);
  }
  return config.fsTeamBonus;
}

export interface PhotoVerifyResult {
  verified: boolean;
  confidence: number;
  reason: string;
}

export interface PhotoVerifyContext {
  exerciseName?: string;
  exerciseSlug?: string;
}

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MIN_VERIFY_CONFIDENCE = 0.65;

export async function verifyWorkoutPhoto(
  buffer: Buffer,
  ext: string,
  userId?: number,
  context?: PhotoVerifyContext
): Promise<PhotoVerifyResult> {
  if (buffer.length === 0) {
    return { verified: false, confidence: 0, reason: "Файл не найден" };
  }

  if (!IMAGE_EXTENSIONS.has(ext.toLowerCase())) {
    return { verified: false, confidence: 0, reason: "Нужно фото (JPG/PNG)" };
  }

  if (buffer.length < 10_000) {
    return { verified: false, confidence: 0.2, reason: "Фото слишком маленькое" };
  }

  const useAi =
    (userId !== undefined && (await canUseAiPhotoVerify(userId))) ||
    (config.apiMode === "live" && !!config.openaiApiKey);

  if (useAi) {
    return verifyWithOpenAi(buffer, ext, context);
  }

  return verifyWithoutAi(buffer.length);
}

function verifyWithoutAi(sizeBytes: number): PhotoVerifyResult {
  if (sizeBytes < 30_000) {
    return {
      verified: false,
      confidence: 0.4,
      reason: "Фото размытое или слишком тёмное — попробуйте ещё раз",
    };
  }
  return {
    verified: false,
    confidence: 0,
    reason: "AI-проверка недоступна. Добавьте OPENAI_API_KEY или включите API_MODE=live.",
  };
}

function buildVerifyPrompt(context?: PhotoVerifyContext): string {
  const exerciseLine = context?.exerciseName
    ? `Сегодняшнее упражнение пользователя: «${context.exerciseName}».`
    : "Упражнение дня не указано.";

  return `Ты строгий модератор фитнес-приложения FitSquad. Определи, доказывает ли фото реальную физическую тренировку.

${exerciseLine}

ПРИНЯТЬ (verified=true) ТОЛЬКО если на фото явно видно:
- человек выполняет упражнение / силовую или кардио-нагрузку, ИЛИ
- очевидный контекст тренировки: спортзал, коврик, гантели, турник, дорожка, пот и усталость после нагрузки

ОТКЛОНИТЬ (verified=false), если это:
- еда, напитки, природа, животные, транспорт, интерьер без спорта
- селфи/портрет без признаков тренировки
- мемы, скриншоты, переписка, текст, QR-коды
- случайный предмет без человека и без спортивного контекста

Будь строгим: при сомнении ставь verified=false.
Ответь ТОЛЬКО JSON: {"verified":boolean,"confidence":0.0-1.0,"reason":"кратко на русском, что видишь"}`;
}

function normalizeVerifyResult(raw: Partial<PhotoVerifyResult>): PhotoVerifyResult {
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
  const reason = raw.reason?.trim() || "На фото не видно тренировки";
  const verified = raw.verified === true && confidence >= MIN_VERIFY_CONFIDENCE;

  if (raw.verified === true && !verified) {
    return {
      verified: false,
      confidence,
      reason: `Низкая уверенность (${Math.round(confidence * 100)}%): ${reason}`,
    };
  }

  return { verified, confidence, reason };
}

async function verifyWithOpenAi(
  buffer: Buffer,
  ext: string,
  context?: PhotoVerifyContext
): Promise<PhotoVerifyResult> {
  const base64 = buffer.toString("base64");
  const mime = ext.toLowerCase() === ".png" ? "image/png" : "image/jpeg";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildVerifyPrompt(context) },
              {
                type: "image_url",
                image_url: { url: `data:${mime};base64,${base64}` },
              },
            ],
          },
        ],
        max_tokens: 200,
      }),
    });

    if (!res.ok) {
      console.warn("[photo-verify] OpenAI error:", res.status, await res.text());
      return {
        verified: false,
        confidence: 0,
        reason: "Сервис проверки временно недоступен. Попробуйте позже.",
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as Partial<PhotoVerifyResult>;
    return normalizeVerifyResult(parsed);
  } catch (err) {
    console.warn("[photo-verify] failed:", err);
    return {
      verified: false,
      confidence: 0,
      reason: "Не удалось проверить фото. Попробуйте другое или позже.",
    };
  }
}
