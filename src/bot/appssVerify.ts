import type { Bot } from "grammy";
import { config } from "../config.js";

/** Код для ответа: аргумент команды или APPSS_VERIFY_SECRET из env. */
export function resolveAppssVerifyCode(argument?: string): string | null {
  const arg = argument?.trim() ?? "";
  if (arg) return arg;
  const secret = config.appssVerifySecret.trim();
  return secret || null;
}

export function registerAppssVerifyHandlers(bot: Bot): void {
  bot.command("appss_verify", async (ctx) => {
    const code = resolveAppssVerifyCode(ctx.match?.trim());
    if (!code) {
      await ctx.reply(
        "Скопируйте код из appss.pro и отправьте:\n/appss_verify ВАШ_КОД\n\nИли задайте APPSS_VERIFY_SECRET на сервере."
      );
      return;
    }

    // appss.pro сверяет ответ бота с кодом на dashboard — только plain text
    await ctx.reply(code);
  });
}
