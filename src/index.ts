import fs from "node:fs";
import { webhookCallback } from "grammy";
import { config } from "./config.js";
import { createBot, initBot } from "./bot/index.js";
import { createServer, getWebhookPath } from "./server/index.js";

async function main(): Promise<void> {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  fs.mkdirSync(config.dataDir, { recursive: true });

  const bot = createBot();

  if (config.botToken) {
    await initBot(bot);
    if (!config.webappIsHttps) {
      console.warn(
        "[webapp] WEBAPP_URL не HTTPS — Mini App недоступен. Для локалки: ngrok + WEBAPP_URL=https://.../webapp/"
      );
    }

    if (config.useWebhook && config.publicUrl) {
      const webhookPath = getWebhookPath();
      const app = createServer({
        webhookPath,
        webhookHandler: webhookCallback(bot, "express", {
          secretToken: config.webhookSecret,
        }),
      });
      await bot.api.setWebhook(`${config.publicUrl}${webhookPath}`, {
        secret_token: config.webhookSecret,
      });
      console.log(`[bot] Webhook: ${config.publicUrl}${webhookPath}`);
      app.listen(config.port, () => {
        console.log(`[server] http://localhost:${config.port}`);
        console.log(`[webapp] ${config.webappUrl}`);
        console.log(`[api] mode=${config.apiMode}`);
      });
    } else {
      const app = createServer();
      bot.start({
        onStart: (info) => console.log(`[bot] Polling as @${info.username}`),
      });
      console.log("[bot] Long polling (USE_WEBHOOK=true для production)");
      app.listen(config.port, () => {
        console.log(`[server] http://localhost:${config.port}`);
        console.log(`[webapp] ${config.webappUrl}`);
        console.log(`[api] mode=${config.apiMode}`);
      });
    }
  } else {
    const app = createServer();
    app.listen(config.port, () => {
      console.log(`[server] http://localhost:${config.port}`);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
