import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const isVercel = !!process.env.VERCEL;
const vercelHttps = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
const dataRoot = isVercel ? "/tmp/fitsquad" : path.join(rootDir, "data");
const uploadsRoot = isVercel ? "/tmp/fitsquad/uploads" : path.join(rootDir, "uploads");

export const config = {
  botToken: process.env.BOT_TOKEN ?? "",
  botUsername: process.env.BOT_USERNAME ?? "fitsquad_bot",
  webhookSecret: process.env.WEBHOOK_SECRET ?? "dev-secret",
  publicUrl: (process.env.PUBLIC_URL ?? (vercelHttps || "http://localhost:3000")).replace(/\/$/, ""),
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  useWebhook: process.env.USE_WEBHOOK === "true" || isVercel,
  webappUrl: (
    process.env.WEBAPP_URL ??
    (vercelHttps ? `${vercelHttps}/webapp/` : "http://localhost:3000/webapp/")
  ).replace(/\/?$/, "/"),
  webappIsHttps: (
    process.env.WEBAPP_URL ??
    (vercelHttps ? `${vercelHttps}/webapp/` : "http://localhost:3000/webapp/")
  )
    .trim()
    .toLowerCase()
    .startsWith("https://"),
  apiMode: (process.env.API_MODE ?? "mock") as "mock" | "live",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  maxTeamSize: Number(process.env.MAX_TEAM_SIZE ?? 5),
  fsWorkoutComplete: Number(process.env.FS_WORKOUT_COMPLETE ?? 10),
  fsPhotoVerified: Number(process.env.FS_PHOTO_VERIFIED ?? 15),
  fsTeamBonus: Number(process.env.FS_TEAM_BONUS ?? 25),
  fsStreakBonus: Number(process.env.FS_STREAK_BONUS ?? 5),
  dataDir: dataRoot,
  uploadsDir: uploadsRoot,
  dbPath: path.join(dataRoot, "fitsquad.db"),
};

export const ACHIEVEMENTS = [
  { type: "first_workout", label: "Первый шаг", emoji: "🎯", bonusFs: 20 },
  { type: "streak_7", label: "7 дней подряд", emoji: "🔥", bonusFs: 50 },
  { type: "team_player", label: "Командный игрок", emoji: "🤝", bonusFs: 30 },
  { type: "fs_100", label: "100 FS", emoji: "💎", bonusFs: 10 },
] as const;

export type AchievementType = (typeof ACHIEVEMENTS)[number]["type"];
