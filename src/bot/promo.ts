import type { Bot } from "grammy";
import { config } from "../config.js";
import { redeemPromoCode, upsertUser } from "../db/index.js";
import { mainMenuKeyboard } from "./keyboards.js";

export function registerPromoHandlers(bot: Bot): void {
  bot.command("promo", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const code = ctx.match?.trim();
    if (!code) {
      await ctx.reply(
        "🎁 *Промокод Premium*\n\nОтправьте:\n`/promo ВАШ_КОД`\n\nПример:\n`/promo FITSQUAD1YEAR`",
        { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const result = await redeemPromoCode(ctx.from!.id, code);
    if (!result.ok) {
      await ctx.reply(`❌ ${result.error}`, { reply_markup: mainMenuKeyboard() });
      return;
    }

    const until = new Date(result.until).toLocaleDateString("ru-RU");
    await ctx.reply(
      `✅ *Premium активирован!*\n\n🎁 Промокод: \`${code.toUpperCase()}\`\n📅 Срок: *${result.days}* дн. (до ${until})\n\n🤖 AI-тренер Pro\n📸 AI-верификация фото\n💎 FS Boost ×${config.premiumFsMultiplier}`,
      { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() }
    );
  });
}
