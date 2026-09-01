import { v4 as uuidv4 } from "uuid";
import { dbAll, dbGet, dbRun } from "./client.js";

export async function grantAchievement(userId: number, type: string): Promise<boolean> {
  const existing = await dbGet(`SELECT 1 FROM achievements WHERE user_id = ? AND type = ?`, [
    userId,
    type,
  ]);
  if (existing) return false;
  await dbRun(`INSERT INTO achievements (id, user_id, type) VALUES (?, ?, ?)`, [
    uuidv4(),
    userId,
    type,
  ]);
  return true;
}

export async function getAchievements(userId: number) {
  return (await dbAll(
    `SELECT type, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at`,
    [userId]
  )) as Array<{ type: string; earned_at: string }>;
}
