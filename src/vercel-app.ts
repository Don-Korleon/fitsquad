/**
 * Express app for Vercel serverless (webhook + API).
 */
import fs from "node:fs";
import { webhookCallback } from "grammy";
import { createBot, initBot } from "./bot/index.js";
import { config } from "./config.js";
import { createServer, getWebhookPath } from "./server/index.js";

fs.mkdirSync(config.uploadsDir, { recursive: true });
fs.mkdirSync(config.dataDir, { recursive: true });

const bot = createBot();
const webhookPath = getWebhookPath();

const app = createServer({
  webhookPath,
  webhookHandler: webhookCallback(bot, "express", {
    secretToken: config.webhookSecret,
  }),
});

const botReady = initBot(bot).then(async () => {
  if (
    process.env.VERCEL &&
    process.env.SKIP_SET_WEBHOOK !== "true" &&
    config.publicUrl.startsWith("https://") &&
    config.botToken
  ) {
    const base = config.publicUrl.replace(/\/$/, "");
    try {
      await bot.api.setWebhook(`${base}${webhookPath}`, {
        secret_token: config.webhookSecret,
        drop_pending_updates: true,
      });
      console.log(`[vercel] webhook set: ${base}${webhookPath}`);
    } catch (err) {
      console.warn("[vercel] setWebhook failed (set manually):", err);
    }
  }
});

app.use(async (_req, _res, next) => {
  try {
    await botReady;
  } catch (err) {
    console.error("[vercel] bot init failed:", err);
  }
  next();
});

export default app;
