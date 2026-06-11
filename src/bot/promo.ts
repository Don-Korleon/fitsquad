import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { upsertUser } from "../db/index.js";
import { mainMenuKeyboard } from "./keyboards.js";

function tributePromoLink(): string {
  return config.tributePromoLink || config.tributeSubscriptionLink || config.tributeProductLink;
}

export function registerPromoHandlers(bot: Bot): void {
  bot.command("promo", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);

    const link = tributePromoLink();
    if (!link) {
      await ctx.reply(
        "🎁 *Промокод Premium*\n\nПромокоды оформляются через Tribute. Ссылка пока не настроена — напишите администратору.",
        { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const kb = new InlineKeyboard().url("🎁 Активировать промокод", link);
    await ctx.reply(
      `🎁 *Premium по промокоду*\n\n` +
        `Нажмите кнопку — откроется Tribute с промокодом.\n` +
        `После оплаты Premium активируется автоматически в боте (до ${config.tributeYearDays} дн.).`,
      { parse_mode: "Markdown", reply_markup: kb }
    );
  });
}
