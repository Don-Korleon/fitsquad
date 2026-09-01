import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const isVercel = !!process.env.VERCEL;
const vercelHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ??
  process.env.VERCEL_URL ??
  "";
const vercelHttps = vercelHost
  ? vercelHost.startsWith("http")
    ? vercelHost.replace(/\/$/, "")
    : `https://${vercelHost.replace(/\/$/, "")}`
  : "";
const resolvedPublicUrl = (
  process.env.PUBLIC_URL ??
  (vercelHttps || "http://localhost:3000")
).replace(/\/$/, "");

function isStaleWebappUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("ngrok") ||
    lower.includes("your-domain.com") ||
    lower.includes("xxxx.ngrok")
  );
}

const autoWebappUrl =
  resolvedPublicUrl !== "http://localhost:3000"
    ? `${resolvedPublicUrl}/webapp/`
    : "http://localhost:3000/webapp/";

const envWebappUrl = process.env.WEBAPP_URL?.trim();
const resolvedWebappUrl = (
  envWebappUrl && !(isVercel && isStaleWebappUrl(envWebappUrl))
    ? envWebappUrl
    : autoWebappUrl
).replace(/\/?$/, "/");
const dataRoot = isVercel ? "/tmp/fitsquad" : path.join(rootDir, "data");
const uploadsRoot = isVercel ? "/tmp/fitsquad/uploads" : path.join(rootDir, "uploads");

export const config = {
  botToken: process.env.BOT_TOKEN ?? "",
  botUsername: process.env.BOT_USERNAME ?? "fitsquad_bot",
  webhookSecret: (process.env.WEBHOOK_SECRET ?? "dev-secret").trim(),
  publicUrl: resolvedPublicUrl,
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  useWebhook: process.env.USE_WEBHOOK === "true" || isVercel,
  webappUrl: resolvedWebappUrl,
  webappIsHttps: resolvedWebappUrl.trim().toLowerCase().startsWith("https://"),
  apiMode: (process.env.API_MODE ?? "mock") as "mock" | "live",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  maxTeamSize: Number(process.env.MAX_TEAM_SIZE ?? 5),
  fsWorkoutComplete: Number(process.env.FS_WORKOUT_COMPLETE ?? 10),
  fsPhotoVerified: Number(process.env.FS_PHOTO_VERIFIED ?? 15),
  fsTeamBonus: Number(process.env.FS_TEAM_BONUS ?? 25),
  fsStreakBonus: Number(process.env.FS_STREAK_BONUS ?? 5),
  premiumPriceStars: Number(process.env.PREMIUM_PRICE_STARS ?? 99),
  premiumDays: Number(process.env.PREMIUM_DAYS ?? 30),
  premiumFsMultiplier: Number(process.env.PREMIUM_FS_MULTIPLIER ?? 1.5),
  tributeApiKey: (process.env.TRIBUTE_API_KEY ?? "").trim(),
  tributePromoLink: (process.env.TRIBUTE_PROMO_LINK ?? "").trim(),
  tributeSubscriptionLink: (process.env.TRIBUTE_SUBSCRIPTION_LINK ?? "").trim(),
  tributeProductLink: (process.env.TRIBUTE_PRODUCT_LINK ?? "").trim(),
  tributeYearDays: Number(process.env.TRIBUTE_YEAR_DAYS ?? 365),
  tributeSubscriptionId: Number(process.env.TRIBUTE_SUBSCRIPTION_ID ?? 0) || null,
  tributeProductId: Number(process.env.TRIBUTE_PRODUCT_ID ?? 0) || null,
  appssVerifySecret: process.env.APPSS_VERIFY_SECRET ?? "",
  adminTelegramIds: new Set(
    (process.env.ADMIN_TELEGRAM_IDS ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  ),
  tursoDatabaseUrl: (process.env.TURSO_DATABASE_URL ?? "").trim(),
  tursoAuthToken: (process.env.TURSO_AUTH_TOKEN ?? "").trim(),
  dbIsRemote: !!(process.env.TURSO_DATABASE_URL ?? "").trim(),
  blobToken: (process.env.BLOB_READ_WRITE_TOKEN ?? "").trim(),
  cronSecret: (process.env.CRON_SECRET ?? "").trim(),
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
