import express, { type RequestHandler } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { apiRouter } from "./routes/api.js";
import { tributeWebhookHandler } from "./routes/tribute.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(options?: {
  webhookPath?: string;
  webhookHandler?: RequestHandler;
}): express.Application {
  const app = express();

  app.post(
    "/api/tribute/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    tributeWebhookHandler
  );

  app.use(express.json({ limit: "2mb" }));

  if (options?.webhookPath && options?.webhookHandler) {
    app.use(options.webhookPath, options.webhookHandler);
  }

  app.use("/api", apiRouter);
  app.use("/uploads", express.static(config.uploadsDir));

  const publicDir = path.resolve(__dirname, "../../public");
  app.use("/exercises", express.static(path.join(publicDir, "exercises")));

  const webappDist = path.resolve(__dirname, "../../webapp/dist");
  app.use("/webapp", express.static(webappDist));
  app.get("/webapp/*", (_req, res) => {
    res.sendFile(path.join(webappDist, "index.html"));
  });

  app.get("/", (_req, res) => {
    res.json({
      name: "FitSquad",
      description: "Social fitness platform — Telegram bot + Mini App",
      webapp: config.webappUrl,
      health: "/api/health",
    });
  });

  return app;
}

export function getWebhookPath(): string {
  return `/webhook/${config.webhookSecret}`;
}
