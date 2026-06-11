import type { Request, Response } from "express";
import { config } from "../../config.js";
import { handleTributeWebhook, verifyTributeSignature } from "../../services/tribute.js";

export async function tributeWebhookHandler(req: Request, res: Response): Promise<void> {
  const rawBody =
    typeof req.body === "string"
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : "";

  if (!rawBody) {
    res.status(400).json({ error: "Empty body" });
    return;
  }

  const signature = req.header("trbt-signature") ?? req.header("x-trbt-signature") ?? undefined;
  if (!verifyTributeSignature(rawBody, signature)) {
    console.warn("[tribute] invalid webhook signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const result = await handleTributeWebhook(rawBody);
  res.status(result.status).json(result.body);
}

export function tributeWebhookPath(): string {
  return "/api/tribute/webhook";
}

export function tributeWebhookUrl(): string {
  return `${config.publicUrl}${tributeWebhookPath()}`;
}
