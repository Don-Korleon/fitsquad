import { dbGet, dbRun } from "./client.js";

/**
 * DB-backed fixed-window rate limiter. An in-memory counter wouldn't survive across Vercel's
 * stateless serverless instances (same reasoning as setPendingAction in users.ts) — this
 * protects costly AI calls (OpenAI photo verification, coach tips, motivation) from being
 * spammed.
 */
export async function hitRateLimit(
  userId: number,
  action: string,
  windowSeconds: number,
  maxHits: number
): Promise<{ allowed: boolean; remaining: number }> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  await dbRun(
    `INSERT INTO rate_limit_hits (user_id, action, window_start, count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(user_id, action, window_start) DO UPDATE SET count = count + 1`,
    [userId, action, windowStart]
  );
  const row = (await dbGet(`SELECT count FROM rate_limit_hits WHERE user_id = ? AND action = ? AND window_start = ?`, [
    userId,
    action,
    windowStart,
  ])) as { count: number } | undefined;
  const count = row?.count ?? 1;

  if (Math.random() < 0.01) {
    const cutoff = Math.floor(Date.now() / 1000) - 172_800;
    await dbRun(`DELETE FROM rate_limit_hits WHERE window_start < ?`, [cutoff]);
  }

  return { allowed: count <= maxHits, remaining: Math.max(0, maxHits - count) };
}
