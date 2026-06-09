import type { Bot } from "grammy";
import { config } from "../config.js";
import { grantPremium } from "../db/index.js";
import { getPremiumOffer, PREMIUM_FEATURES } from "../services/premium.js";
import { mainMenuKeyboard } from "./keyboards.js";

let premiumBot: Bot | null = null;

export function setPremiumBot(bot: Bot): void {
  premiumBot = bot;
}

export async function createPremiumInvoiceLink(): Promise<string | null> {
  if (!premiumBot) return null;
  try {
    return await premiumBot.api.createInvoiceLink(
      "FitSquad Premium ⭐",
      `Premium на ${config.premiumDays} дней: AI-тренер, AI-фото, бонус FS`,
      `premium_${config.premiumDays}`,
      "",
      "XTR",
      [{ label: `Premium ${config.premiumDays} дн.`, amount: config.premiumPriceStars }]
    );
  } catch {
    return null;
  }
}

export function premiumDescription(): string {
  const lines = PREMIUM_FEATURES.map((f) => `${f.emoji} *${f.title}* — ${f.desc}`).join("\n");
  return `⭐ *FitSquad Premium* — ${config.premiumDays} дней за ${config.premiumPriceStars} ⭐

${lines}

Оплата через Telegram Stars. Подписка продлевается при повторной покупке.`;
}

export async function sendPremiumInvoice(bot: Bot, chatId: number): Promise<void> {
  await bot.api.sendInvoice(
    chatId,
    "FitSquad Premium ⭐",
    `Premium на ${config.premiumDays} дней: AI-тренер, AI-фото, бонус FS`,
    `premium_${config.premiumDays}`,
    "XTR",
    [{ label: `Premium ${config.premiumDays} дн.`, amount: config.premiumPriceStars }],
    { provider_token: "" }
  );
}

export function registerPremiumHandlers(bot: Bot): void {
  bot.command("premium", async (ctx) => {
    await ctx.reply(premiumDescription(), { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() });
    await sendPremiumInvoice(bot, ctx.chat!.id);
  });

  bot.callbackQuery(/^premium:buy$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendPremiumInvoice(bot, ctx.chat!.id);
  });

  bot.on("pre_checkout_query", async (ctx) => {
    const payload = ctx.preCheckoutQuery.invoice_payload;
    if (!payload.startsWith("premium_")) {
      await ctx.answerPreCheckoutQuery(false, { error_message: "Неизвестный товар" });
      return;
    }
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    if (!payment.invoice_payload.startsWith("premium_")) return;

    const days = Number.parseInt(payment.invoice_payload.replace("premium_", ""), 10);
    const granted = await grantPremium(
      ctx.from!.id,
      Number.isFinite(days) ? days : config.premiumDays
    );
    const until = new Date(granted.until).toLocaleDateString("ru-RU");

    await ctx.reply(
      `✅ *Premium активирован!*\n\nДействует до: *${until}*\n\n🤖 AI-тренер Pro\n📸 AI-верификация фото\n💎 FS Boost ×${config.premiumFsMultiplier}`,
      { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() }
    );
  });
}

export { getPremiumOffer };
