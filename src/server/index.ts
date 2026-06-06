import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { apiRouter } from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(): express.Application {
  const app = express();
  app.use(express.json());

  app.use("/api", apiRouter);
  app.use("/uploads", express.static(config.uploadsDir));

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
