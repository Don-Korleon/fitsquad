/**
 * Express app for Vercel serverless (webhook + API; без listen).
 */
import fs from "node:fs";
import { webhookCallback } from "grammy";
import { createBot, initBot } from "./bot/index.js";
import { config } from "./config.js";
import { createServer } from "./server/index.js";

const app = createServer();

let botReady: Promise<void> | null = null;

async function ensureBot(): Promise<void> {
  if (!config.botToken) return;
  if (!botReady) {
    botReady = (async () => {
      fs.mkdirSync(config.uploadsDir, { recursive: true });
      fs.mkdirSync(config.dataDir, { recursive: true });

      const bot = createBot();
      await initBot(bot);

      const webhookPath = `/webhook/${config.webhookSecret}`;
      app.use(webhookPath, webhookCallback(bot, "express"));

      if (
        process.env.VERCEL &&
        process.env.SKIP_SET_WEBHOOK !== "true" &&
        config.publicUrl.startsWith("https://")
      ) {
        const base = config.publicUrl.replace(/\/$/, "");
        try {
          await bot.api.setWebhook(`${base}${webhookPath}`, {
            secret_token: config.webhookSecret,
          });
          console.log(`[vercel] webhook set: ${base}${webhookPath}`);
        } catch (err) {
          console.warn("[vercel] setWebhook failed (set manually):", err);
        }
      }
    })();
  }
  await botReady;
}

app.use(async (_req, _res, next) => {
  await ensureBot();
  next();
});

export default app;
