import fs from "node:fs";
import path from "node:path";
import { ACHIEVEMENTS, config } from "../config.js";
import {
  addFsTokens,
  countTeamWorkoutsCompleted,
  getUser,
  grantAchievement,
  updateStreak,
} from "../db/index.js";

export interface WorkoutReward {
  baseFs: number;
  streakBonus: number;
  achievementBonus: number;
  newAchievements: Array<{ type: string; label: string; emoji: string; bonusFs: number }>;
  totalFs: number;
  streakDays: number;
}

export function rewardWorkoutComplete(userId: number): WorkoutReward {
  const baseFs = config.fsWorkoutComplete;
  const streakDays = updateStreak(userId);
  const streakBonus = streakDays > 1 ? config.fsStreakBonus : 0;

  let achievementBonus = 0;
  const newAchievements: WorkoutReward["newAchievements"] = [];

  const user = getUser(userId);
  const totalWorkouts = user?.total_workouts ?? 1;

  if (totalWorkouts === 1 && grantAchievement(userId, "first_workout")) {
    const ach = ACHIEVEMENTS.find((a) => a.type === "first_workout")!;
    achievementBonus += ach.bonusFs;
    newAchievements.push({ type: ach.type, label: ach.label, emoji: ach.emoji, bonusFs: ach.bonusFs });
  }

  if (streakDays >= 7 && grantAchievement(userId, "streak_7")) {
    const ach = ACHIEVEMENTS.find((a) => a.type === "streak_7")!;
    achievementBonus += ach.bonusFs;
    newAchievements.push({ type: ach.type, label: ach.label, emoji: ach.emoji, bonusFs: ach.bonusFs });
  }

  const teamWorkouts = countTeamWorkoutsCompleted(userId);
  if (teamWorkouts >= 5 && grantAchievement(userId, "team_player")) {
    const ach = ACHIEVEMENTS.find((a) => a.type === "team_player")!;
    achievementBonus += ach.bonusFs;
    newAchievements.push({ type: ach.type, label: ach.label, emoji: ach.emoji, bonusFs: ach.bonusFs });
  }

  const totalFs = baseFs + streakBonus + achievementBonus;
  addFsTokens(userId, totalFs);

  const updatedUser = getUser(userId);
  if ((updatedUser?.fs_tokens ?? 0) >= 100 && grantAchievement(userId, "fs_100")) {
    const ach = ACHIEVEMENTS.find((a) => a.type === "fs_100")!;
    addFsTokens(userId, ach.bonusFs);
    achievementBonus += ach.bonusFs;
    newAchievements.push({ type: ach.type, label: ach.label, emoji: ach.emoji, bonusFs: ach.bonusFs });
  }

  return {
    baseFs,
    streakBonus,
    achievementBonus,
    newAchievements,
    totalFs: totalFs + (newAchievements.find((a) => a.type === "fs_100")?.bonusFs ?? 0),
    streakDays,
  };
}

export function rewardPhotoVerified(userId: number): number {
  addFsTokens(userId, config.fsPhotoVerified);
  return config.fsPhotoVerified;
}

export function rewardTeamBonus(memberIds: number[]): number {
  for (const id of memberIds) {
    addFsTokens(id, config.fsTeamBonus);
  }
  return config.fsTeamBonus;
}

export interface PhotoVerifyResult {
  verified: boolean;
  confidence: number;
  reason: string;
}

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export async function verifyWorkoutPhoto(photoPath: string): Promise<PhotoVerifyResult> {
  if (!fs.existsSync(photoPath)) {
    return { verified: false, confidence: 0, reason: "Файл не найден" };
  }

  const ext = path.extname(photoPath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return { verified: false, confidence: 0, reason: "Нужно фото (JPG/PNG)" };
  }

  const stat = fs.statSync(photoPath);
  if (stat.size < 10_000) {
    return { verified: false, confidence: 0.2, reason: "Фото слишком маленькое" };
  }

  if (config.apiMode === "live" && config.openaiApiKey) {
    return verifyWithOpenAi(photoPath);
  }

  // Mock: принимаем фото > 50KB как «верифицированное»
  if (stat.size >= 50_000) {
    return { verified: true, confidence: 0.85, reason: "Фото принято (demo-режим)" };
  }
  return { verified: true, confidence: 0.7, reason: "Фото принято" };
}

async function verifyWithOpenAi(photoPath: string): Promise<PhotoVerifyResult> {
  const buffer = fs.readFileSync(photoPath);
  const base64 = buffer.toString("base64");
  const mime = photoPath.endsWith(".png") ? "image/png" : "image/jpeg";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: 'Это фото с тренировки/спортивной активности? Ответь JSON: {"verified":true/false,"confidence":0-1,"reason":"кратко на русском"}',
              },
              {
                type: "image_url",
                image_url: { url: `data:${mime};base64,${base64}` },
              },
            ],
          },
        ],
        max_tokens: 150,
      }),
    });

    if (!res.ok) {
      return { verified: true, confidence: 0.6, reason: "AI недоступен, фото принято" };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as PhotoVerifyResult;
      return parsed;
    }
  } catch {
    /* fallback */
  }

  return { verified: true, confidence: 0.6, reason: "Фото принято" };
}
