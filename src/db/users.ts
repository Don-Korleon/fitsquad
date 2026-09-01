import { dbGet, dbRun } from "./client.js";
import { SOLO_INVITE_PREFIX, soloTeamId, todayKey } from "./shared.js";
import { assertCanEnableSolo, deleteTeamById, getUserTeam } from "./teams.js";

export async function upsertUser(
  telegramId: number,
  username?: string,
  firstName?: string
): Promise<void> {
  await dbRun(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name`,
    [telegramId, username ?? null, firstName ?? null]
  );
}

export async function getUser(telegramId: number) {
  return (await dbGet(
    `SELECT * FROM users WHERE telegram_id = ?`,
    [telegramId]
  )) as
    | {
        telegram_id: number;
        username: string | null;
        first_name: string | null;
        fs_tokens: number;
        streak_days: number;
        last_workout_date: string | null;
        total_workouts: number;
        solo_mode: number;
        premium_until: string | null;
        pending_action: string | null;
      }
    | undefined;
}

/**
 * Persists lightweight per-user "what am I waiting for next" state (e.g. invite code entry).
 * Backed by the DB rather than in-memory Map — the bot runs as stateless serverless functions
 * on Vercel, so different webhook calls for the same user can land on different instances.
 */
export async function setPendingAction(userId: number, action: string | null): Promise<void> {
  await dbRun(`UPDATE users SET pending_action = ? WHERE telegram_id = ?`, [action, userId]);
}

export async function getPendingAction(userId: number): Promise<string | null> {
  return (await getUser(userId))?.pending_action ?? null;
}

export async function isSoloModeEnabled(userId: number): Promise<boolean> {
  return !!(await getUser(userId))?.solo_mode;
}

export async function isPremium(userId: number): Promise<boolean> {
  const until = (await getUser(userId))?.premium_until;
  if (!until) return false;
  return new Date(until) > new Date();
}

export async function getPremiumStatus(userId: number) {
  const until = (await getUser(userId))?.premium_until ?? null;
  const active = until ? new Date(until) > new Date() : false;
  return { isPremium: active, premiumUntil: active ? until : null };
}

export async function grantPremium(userId: number, days: number): Promise<{ until: string }> {
  const now = new Date();
  const user = await getUser(userId);
  let start = now;
  if (user?.premium_until) {
    const current = new Date(user.premium_until);
    if (current > now) start = current;
  }
  const until = new Date(start.getTime() + days * 86_400_000);
  const untilIso = until.toISOString();
  await dbRun(`UPDATE users SET premium_until = ? WHERE telegram_id = ?`, [untilIso, userId]);
  return { until: untilIso };
}

async function clearSoloMode(userId: number): Promise<void> {
  await dbRun(`UPDATE users SET solo_mode = 0 WHERE telegram_id = ?`, [userId]);
  const teamId = soloTeamId(userId);
  const exists = await dbGet(`SELECT 1 FROM teams WHERE id = ?`, [teamId]);
  if (exists) await deleteTeamById(teamId);
}

export async function ensureSoloTeam(userId: number) {
  const teamId = soloTeamId(userId);
  let team = (await dbGet(`SELECT * FROM teams WHERE id = ?`, [teamId])) as
    | { id: string; name: string; invite_code: string; captain_id: number }
    | undefined;

  if (!team) {
    const inviteCode = `${SOLO_INVITE_PREFIX}${userId}`;
    await dbRun(`INSERT INTO teams (id, name, invite_code, captain_id) VALUES (?, ?, ?, ?)`, [
      teamId,
      "Solo",
      inviteCode,
      userId,
    ]);
    await dbRun(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`, [teamId, userId]);
    team = (await dbGet(`SELECT * FROM teams WHERE id = ?`, [teamId])) as typeof team;
  }
  return team!;
}

export async function enableSoloMode(userId: number): Promise<{ ok: boolean; error?: string }> {
  const check = await assertCanEnableSolo(userId);
  if (!check.ok) return check;
  await upsertUser(userId);
  await dbRun(`UPDATE users SET solo_mode = 1 WHERE telegram_id = ?`, [userId]);
  await ensureSoloTeam(userId);
  return { ok: true };
}

export async function disableSoloMode(userId: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await isSoloModeEnabled(userId))) {
    return { ok: false, error: "Solo режим не включён" };
  }
  await clearSoloMode(userId);
  return { ok: true };
}

export async function getTrainingContext(userId: number): Promise<{
  teamId: string;
  mode: "team" | "solo";
} | null> {
  const socialTeam = await getUserTeam(userId);
  if (socialTeam) return { teamId: socialTeam.id, mode: "team" };
  if (!(await isSoloModeEnabled(userId))) return null;
  return { teamId: (await ensureSoloTeam(userId)).id, mode: "solo" };
}

export async function addFsTokens(telegramId: number, amount: number): Promise<number> {
  await dbRun(`UPDATE users SET fs_tokens = fs_tokens + ? WHERE telegram_id = ?`, [
    amount,
    telegramId,
  ]);
  return (await getUser(telegramId))?.fs_tokens ?? amount;
}

export async function updateStreak(telegramId: number): Promise<number> {
  const user = await getUser(telegramId);
  if (!user) return 0;
  const today = todayKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  let streak = user.streak_days ?? 0;
  if (user.last_workout_date === today) {
    return streak;
  }
  if (user.last_workout_date === yesterdayKey) {
    streak += 1;
  } else {
    streak = 1;
  }

  await dbRun(
    `UPDATE users SET streak_days = ?, last_workout_date = ?, total_workouts = total_workouts + 1 WHERE telegram_id = ?`,
    [streak, today, telegramId]
  );

  return streak;
}
