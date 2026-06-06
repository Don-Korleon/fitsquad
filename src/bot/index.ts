import { Bot } from "grammy";
import { config } from "../config.js";
import { registerHandlers, setupBotCommands } from "./handlers.js";
import { registerAppssVerifyHandlers } from "./appssVerify.js";
import { registerPremiumHandlers, setPremiumBot } from "./premium.js";

export function createBot(): Bot {
  if (!config.botToken) {
    console.warn("[bot] BOT_TOKEN not set — bot will not start");
  }
  const bot = new Bot(config.botToken || "placeholder");
  bot.catch((err) => {
    console.error("[bot] handler error:", err.error ?? err);
    err.ctx
      ?.reply("⚠️ Ошибка. Попробуйте /start или /help")
      .catch(() => {});
  });
  registerHandlers(bot);
  registerAppssVerifyHandlers(bot);
  registerPremiumHandlers(bot);
  setPremiumBot(bot);
  return bot;
}

export async function resolveBotUsername(bot: Bot): Promise<void> {
  try {
    const me = await bot.api.getMe();
    if (me.username) {
      config.botUsername = me.username;
      console.log(`[bot] @${me.username}`);
    }
  } catch (err) {
    console.warn("[bot] getMe failed:", err);
  }
}

export async function initBot(bot: Bot): Promise<void> {
  await resolveBotUsername(bot);
  await setupBotCommands(bot);
}
