import type { Bot, Context } from "grammy";
import { config } from "../config.js";
import { getStoredAppssVerifyCode, setStoredAppssVerifyCode } from "../db/index.js";

const APPSS_COMMAND = "appss_verify";

/** Только владелец бота может задавать/просматривать код верификации appss.pro. */
export function isAppssAdmin(userId: number | undefined): boolean {
  return userId !== undefined && config.adminTelegramIds.has(userId);
}

/** Код для ответа: аргумент → БД → APPSS_VERIFY_SECRET. */
export async function resolveAppssVerifyCode(argument?: string): Promise<string | null> {
  const arg = argument?.trim() ?? "";
  if (arg) return arg;

  const stored = await getStoredAppssVerifyCode();
  if (stored) return stored;

  const secret = config.appssVerifySecret.trim();
  return secret || null;
}

export function parseAppssStartParam(payload: string): string | null {
  const p = payload.trim();
  if (p === APPSS_COMMAND) return null;
  if (p.startsWith(`${APPSS_COMMAND}_`)) return p.slice(`${APPSS_COMMAND}_`.length);
  if (p.startsWith(APPSS_COMMAND)) {
    const rest = p.slice(APPSS_COMMAND.length).replace(/^[_-]/, "");
    return rest || null;
  }
  return null;
}

export async function replyAppssVerifyCode(ctx: Context, argument?: string): Promise<void> {
  const arg = argument?.trim();
  if (arg) {
    await setStoredAppssVerifyCode(arg);
    await ctx.reply(arg);
    return;
  }

  const code = await resolveAppssVerifyCode();
  if (!code) {
    await ctx.reply(
      "Скопируйте код из appss.pro (поле «Ответ») и отправьте:\n/appss_verify ВАШ_КОД"
    );
    return;
  }

  await ctx.reply(code);
}

export async function setupAppssVerifyCommand(bot: Bot): Promise<boolean> {
  if (!config.botToken) return false;

  try {
    const current = await bot.api.getMyCommands();
    const hasCommand = current.some((c) => c.command === APPSS_COMMAND);

    if (!hasCommand) {
      await bot.api.setMyCommands([
        ...current,
        { command: APPSS_COMMAND, description: "Appss verification" },
      ]);
    }

    const updated = await bot.api.getMyCommands();
    const ok = updated.some((c) => c.command === APPSS_COMMAND);
    if (!ok) {
      console.warn("[appss] appss_verify missing after setMyCommands");
    } else {
      console.log("[appss] appss_verify registered in bot menu");
    }
    return ok;
  } catch (err) {
    console.error("[appss] failed to register appss_verify command:", err);
    return false;
  }
}

export async function fetchBotCommandNames(): Promise<string[]> {
  if (!config.botToken) return [];
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/getMyCommands`);
    if (!res.ok) return [];
    const data = (await res.json()) as { ok?: boolean; result?: Array<{ command: string }> };
    return data.ok ? (data.result?.map((c) => c.command) ?? []) : [];
  } catch {
    return [];
  }
}

export function registerAppssVerifyHandlers(bot: Bot): void {
  const handle = async (ctx: Context, argument?: string) => {
    if (!isAppssAdmin(ctx.from?.id)) {
      await ctx.reply("🔒 Команда доступна только администратору бота.");
      return;
    }
    await replyAppssVerifyCode(ctx, argument);
  };

  bot.command(APPSS_COMMAND, async (ctx) => {
    await handle(ctx, ctx.match?.trim());
  });

  bot.hears(/^\/appss_verify(?:@\w+)?(?:\s+(.+))?\s*$/i, async (ctx) => {
    const text = ctx.message?.text ?? "";
    const match = text.match(/^\/appss_verify(?:@\w+)?(?:\s+(.+))?\s*$/i);
    await handle(ctx, match?.[1]?.trim());
  });
}

export { APPSS_COMMAND };
