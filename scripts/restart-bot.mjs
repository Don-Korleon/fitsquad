import "dotenv/config";

const token = process.env.BOT_TOKEN?.trim();
const publicUrl = (process.env.PUBLIC_URL ?? "https://fitsquad-six.vercel.app").replace(/\/$/, "");

if (!token) {
  console.error("[restart] BOT_TOKEN is not set");
  process.exit(1);
}

const placeholderSecrets = new Set(["", "change-me-webhook-secret", "dev-secret"]);

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`${method} failed: ${data.description ?? JSON.stringify(data)}`);
  }
  return data.result;
}

console.log("[restart] Checking webhook...");
const before = await tg("getWebhookInfo", {});
const envSecret = process.env.WEBHOOK_SECRET?.trim() ?? "";
const currentUrl = before.url?.replace(/\/$/, "") ?? "";
const secretFromUrl = currentUrl.includes("/webhook/")
  ? decodeURIComponent(currentUrl.split("/webhook/")[1] ?? "")
  : "";
const secret = !placeholderSecrets.has(envSecret)
  ? envSecret
  : secretFromUrl && !placeholderSecrets.has(secretFromUrl)
    ? secretFromUrl
    : envSecret || "dev-secret";
const webhookUrl = `${publicUrl}/webhook/${secret}`;

console.log("[restart] Current webhook:", before.url || "(none)");
console.log("[restart] Pending updates:", before.pending_update_count ?? 0);

console.log("[restart] Re-registering webhook:", webhookUrl);
await tg("setWebhook", {
  url: webhookUrl,
  secret_token: secret,
  drop_pending_updates: true,
  allowed_updates: [
    "message",
    "callback_query",
    "pre_checkout_query",
    "successful_payment",
  ],
});

const after = await tg("getWebhookInfo", {});
console.log("[restart] Webhook OK:", after.url);
console.log("[restart] Pending updates:", after.pending_update_count ?? 0);

try {
  const health = await fetch(`${publicUrl}/api/health`);
  const data = await health.json();
  console.log("[restart] Health:", JSON.stringify({ ok: data.ok, mode: data.mode, bot: data.botUsername }));
} catch (err) {
  console.warn("[restart] Health check failed:", err.message);
}

console.log("[restart] Done");
