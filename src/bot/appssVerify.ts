import type { Bot } from "grammy";
import { config } from "../config.js";

export interface AppssVerifyPayload {
  status: "verified" | "invalid_code" | "missing_code";
  platform: "appss";
  app: string;
  bot: {
    id: number;
    username: string | undefined;
  };
  webappUrl: string;
  publicUrl: string;
  code: string | null;
}

export function buildAppssVerifyPayload(
  botId: number,
  botUsername: string | undefined,
  code?: string
): AppssVerifyPayload {
  const trimmed = code?.trim() ?? "";
  const expected = config.appssVerifySecret.trim();

  let status: AppssVerifyPayload["status"] = "verified";
  if (expected) {
    status = trimmed && trimmed === expected ? "verified" : "invalid_code";
  } else if (!trimmed) {
    status = "missing_code";
  }

  return {
    status,
    platform: "appss",
    app: "FitSquad",
    bot: { id: botId, username: botUsername },
    webappUrl: config.webappUrl,
    publicUrl: config.publicUrl,
    code: trimmed || null,
  };
}

function formatVerifyReply(payload: AppssVerifyPayload): string {
  if (payload.status === "invalid_code") {
    return "❌ Неверный код верификации appss.pro.\n\nСкопируйте код из личного кабинета appss.pro и отправьте:\n/appss_verify ВАШ_КОД";
  }

  if (payload.status === "missing_code") {
    return (
      "🔐 Верификация appss.pro\n\n" +
      "Отправьте команду с кодом из личного кабинета:\n" +
      "/appss_verify ВАШ_КОД\n\n" +
      `Бот: @${payload.bot.username ?? config.botUsername}\n` +
      `Mini App: ${payload.webappUrl}`
    );
  }

  return (
    "✅ FitSquad verified for appss.pro\n\n" +
    `appss:verified\n` +
    `code:${payload.code}\n` +
    `bot:@${payload.bot.username ?? config.botUsername}\n` +
    `bot_id:${payload.bot.id}\n` +
    `webapp:${payload.webappUrl}\n` +
    `api:${payload.publicUrl}`
  );
}

export function registerAppssVerifyHandlers(bot: Bot): void {
  bot.command("appss_verify", async (ctx) => {
    const me = await ctx.api.getMe();
    const payload = buildAppssVerifyPayload(me.id, me.username, ctx.match?.trim());
    await ctx.reply(formatVerifyReply(payload));
  });
}
