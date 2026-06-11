import crypto from "node:crypto";
import { config } from "../config.js";
import {
  grantPremium,
  isTributeEventProcessed,
  markTributeEventProcessed,
  upsertUser,
} from "../db/index.js";

export interface TributeWebhookBody {
  name?: string;
  created_at?: string;
  sent_at?: string;
  payload?: Record<string, unknown>;
}

const PREMIUM_EVENTS = new Set([
  "new_subscription",
  "renewed_subscription",
  "new_digital_product",
]);

export function verifyTributeSignature(rawBody: string, signature: string | undefined): boolean {
  if (!config.tributeApiKey) return false;
  if (!signature?.trim()) return false;

  const expected = crypto
    .createHmac("sha256", config.tributeApiKey)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.trim()));
  } catch {
    return false;
  }
}

function extractTelegramUserId(payload: Record<string, unknown>): number | null {
  const raw =
    payload.telegram_user_id ??
    payload.telegramUserId ??
    payload.user_id ??
    payload.userId;
  const id = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function extractEventId(name: string, payload: Record<string, unknown>, body: TributeWebhookBody): string {
  const id =
    payload.subscription_id ??
    payload.purchase_id ??
    payload.id ??
    payload.payment_id ??
    `${name}:${extractTelegramUserId(payload) ?? "unknown"}:${body.created_at ?? body.sent_at ?? Date.now()}`;
  return String(id);
}

function matchesConfiguredProduct(payload: Record<string, unknown>): boolean {
  const productId = Number(payload.product_id ?? payload.productId ?? 0);
  if (config.tributeProductId && productId && productId !== config.tributeProductId) {
    return false;
  }
  const subscriptionId = Number(payload.subscription_id ?? payload.subscriptionId ?? 0);
  if (config.tributeSubscriptionId && subscriptionId && subscriptionId !== config.tributeSubscriptionId) {
    return false;
  }
  return true;
}

function premiumDaysForEvent(name: string, payload: Record<string, unknown>): number {
  const period = String(
    payload.period ?? payload.subscription_period ?? payload.billing_period ?? ""
  ).toLowerCase();

  if (period.includes("year") || period === "yearly" || period === "annual") {
    return config.tributeYearDays;
  }
  if (period.includes("month") || period === "monthly") return 30;
  if (period.includes("week") || period === "weekly") return 7;

  if (name === "new_digital_product") return config.tributeYearDays;
  if (name === "renewed_subscription") return config.premiumDays;
  return config.tributeYearDays;
}

async function notifyPremiumActivated(userId: number, until: string, days: number): Promise<void> {
  if (!config.botToken) return;

  const untilText = new Date(until).toLocaleDateString("ru-RU");
  const text =
    `✅ *Premium активирован через Tribute!*\n\n` +
    `📅 Срок: *${days}* дн. (до ${untilText})\n\n` +
    `🤖 AI-тренер Pro\n📸 AI-верификация фото\n💎 FS Boost ×${config.premiumFsMultiplier}`;

  try {
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    console.warn("[tribute] failed to notify user:", err);
  }
}

export async function handleTributeWebhook(rawBody: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (!config.tributeApiKey) {
    return { ok: false, status: 503, body: { error: "Tribute not configured" } };
  }

  let body: TributeWebhookBody;
  try {
    body = JSON.parse(rawBody) as TributeWebhookBody;
  } catch {
    return { ok: false, status: 400, body: { error: "Invalid JSON" } };
  }

  const name = String(body.name ?? "").toLowerCase();
  const payload = (body.payload ?? body) as Record<string, unknown>;

  if (!PREMIUM_EVENTS.has(name)) {
    return { ok: true, status: 200, body: { ignored: true, event: name } };
  }

  if (!matchesConfiguredProduct(payload)) {
    return { ok: true, status: 200, body: { ignored: true, reason: "product_mismatch" } };
  }

  const telegramUserId = extractTelegramUserId(payload);
  if (!telegramUserId) {
    return { ok: false, status: 400, body: { error: "telegram_user_id missing" } };
  }

  const eventId = extractEventId(name, payload, body);
  if (await isTributeEventProcessed(eventId)) {
    return { ok: true, status: 200, body: { duplicate: true, eventId } };
  }

  const days = premiumDaysForEvent(name, payload);
  await upsertUser(telegramUserId);
  const granted = await grantPremium(telegramUserId, days);
  await markTributeEventProcessed(eventId, name, telegramUserId, rawBody);
  await notifyPremiumActivated(telegramUserId, granted.until, days);

  console.log(`[tribute] premium granted: user=${telegramUserId} days=${days} event=${name}`);

  return {
    ok: true,
    status: 200,
    body: { ok: true, event: name, telegramUserId, days, until: granted.until },
  };
}
