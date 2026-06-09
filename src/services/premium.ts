import { config } from "../config.js";
import { getPremiumStatus, isPremium } from "../db/index.js";

export const PREMIUM_FEATURES = [
  { emoji: "🤖", title: "AI-тренер Pro", desc: "Уникальные советы и мотивация от OpenAI" },
  { emoji: "📸", title: "AI-верификация фото", desc: "Умная проверка фото тренировки" },
  { emoji: "💎", title: "FS Boost", desc: `+${Math.round((config.premiumFsMultiplier - 1) * 100)}% FS за тренировки и фото` },
  { emoji: "⭐", title: "Premium-статус", desc: "Значок в профиле и Mini App" },
] as const;

export async function canUseLiveAi(userId: number): Promise<boolean> {
  return (await isPremium(userId)) || (config.apiMode === "live" && !!config.openaiApiKey);
}

export async function canUseAiPhotoVerify(userId: number): Promise<boolean> {
  return (await isPremium(userId)) || (config.apiMode === "live" && !!config.openaiApiKey);
}

export function getPremiumOffer() {
  return {
    priceStars: config.premiumPriceStars,
    days: config.premiumDays,
    fsMultiplier: config.premiumFsMultiplier,
    features: PREMIUM_FEATURES.map((f) => ({ ...f })),
  };
}

export async function getUserPremiumInfo(userId: number) {
  const status = await getPremiumStatus(userId);
  return {
    ...status,
    ...getPremiumOffer(),
    botUsername: config.botUsername,
  };
}

export { isPremium };
