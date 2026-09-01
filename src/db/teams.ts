import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { generateInviteCode } from "../utils/helpers.js";
import { dbAll, dbGet, dbRun } from "./client.js";
import { SOLO_INVITE_PREFIX, isSoloTeam } from "./shared.js";
import { isSoloModeEnabled } from "./users.js";
import { ensureUserWorkoutLog, getTodayWorkoutForTeam } from "./workouts.js";

/** Нельзя вступить/создать команду, пока включён Solo */
export async function assertCanJoinTeam(userId: number): Promise<{ ok: boolean; error?: string }> {
  if (await isSoloModeEnabled(userId)) {
    return {
      ok: false,
      error: "Включён Solo режим. Сначала выключите его — /team → ❌ Выключить Solo",
    };
  }
  if (await getUserTeam(userId)) {
    return { ok: false, error: "Вы уже в команде" };
  }
  return { ok: true };
}

/** Нельзя включить Solo, пока пользователь в команде */
export async function assertCanEnableSolo(
  userId: number
): Promise<{ ok: boolean; error?: string }> {
  if (await getUserTeam(userId)) {
    return { ok: false, error: "Сначала выйдите из команды" };
  }
  if (await isSoloModeEnabled(userId)) {
    return { ok: false, error: "Solo режим уже включён" };
  }
  return { ok: true };
}

export async function createTeam(
  captainId: number,
  name: string
): Promise<{ ok: boolean; error?: string; id?: string; inviteCode?: string }> {
  const check = await assertCanJoinTeam(captainId);
  if (!check.ok) return check;

  const id = uuidv4();
  let inviteCode = generateInviteCode();
  while (await getTeamByInviteCode(inviteCode)) {
    inviteCode = generateInviteCode();
  }
  await dbRun(`INSERT INTO teams (id, name, invite_code, captain_id) VALUES (?, ?, ?, ?)`, [
    id,
    name,
    inviteCode,
    captainId,
  ]);
  await dbRun(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`, [id, captainId]);
  return { ok: true, id, inviteCode };
}

export async function getTeamByInviteCode(code: string) {
  return (await dbGet(
    `SELECT * FROM teams WHERE invite_code = ? AND invite_code NOT LIKE ?`,
    [code.toUpperCase(), `${SOLO_INVITE_PREFIX}%`]
  )) as
    | { id: string; name: string; invite_code: string; captain_id: number }
    | undefined;
}

export async function getUserTeam(userId: number) {
  const row = (await dbGet(
    `SELECT t.* FROM teams t
     JOIN team_members tm ON tm.team_id = t.id
     WHERE tm.user_id = ? AND t.invite_code NOT LIKE ?`,
    [userId, `${SOLO_INVITE_PREFIX}%`]
  )) as
    | { id: string; name: string; invite_code: string; captain_id: number }
    | undefined;
  return row;
}

export async function getTeamMembers(teamId: string) {
  return (await dbAll(
    `SELECT u.telegram_id, u.username, u.first_name, u.fs_tokens
     FROM team_members tm
     JOIN users u ON u.telegram_id = tm.user_id
     WHERE tm.team_id = ?
     ORDER BY tm.joined_at`,
    [teamId]
  )) as Array<{
      telegram_id: number;
      username: string | null;
      first_name: string | null;
      fs_tokens: number;
    }>;
}

export async function getTeamMemberCount(teamId: string): Promise<number> {
  const row = (await dbGet(`SELECT COUNT(*) as cnt FROM team_members WHERE team_id = ?`, [
    teamId,
  ])) as { cnt: number };
  return row.cnt;
}

export async function joinTeam(teamId: string, userId: number): Promise<{ ok: boolean; error?: string }> {
  const team = (await dbGet(`SELECT * FROM teams WHERE id = ?`, [teamId])) as
    | { id: string; invite_code: string }
    | undefined;
  if (!team || isSoloTeam(team as { id: string; invite_code: string })) {
    return { ok: false, error: "Команда не найдена" };
  }
  const soloCheck = await assertCanJoinTeam(userId);
  if (!soloCheck.ok) return soloCheck;

  const count = await getTeamMemberCount(teamId);
  if (count >= config.maxTeamSize) {
    return { ok: false, error: "Команда заполнена (макс. 5 человек)" };
  }

  await dbRun(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`, [teamId, userId]);
  const todayWorkout = await getTodayWorkoutForTeam(teamId);
  if (todayWorkout) await ensureUserWorkoutLog(todayWorkout.id, userId);
  return { ok: true };
}

export async function deleteTeamById(teamId: string): Promise<void> {
  const workouts = (await dbAll(`SELECT id FROM team_workouts WHERE team_id = ?`, [teamId])) as Array<{
    id: string;
  }>;
  for (const w of workouts) {
    await dbRun(`DELETE FROM workout_logs WHERE team_workout_id = ?`, [w.id]);
  }
  await dbRun(`DELETE FROM team_workouts WHERE team_id = ?`, [teamId]);
  await dbRun(`DELETE FROM team_members WHERE team_id = ?`, [teamId]);
  await dbRun(`DELETE FROM teams WHERE id = ?`, [teamId]);
}

export async function leaveTeam(userId: number): Promise<{
  ok: boolean;
  error?: string;
  disbanded?: boolean;
  teamName?: string;
  newCaptainId?: number;
}> {
  const team = await getUserTeam(userId);
  if (!team) return { ok: false, error: "Вы не в команде" };

  const count = await getTeamMemberCount(team.id);

  if (team.captain_id === userId) {
    if (count <= 1) {
      await deleteTeamById(team.id);
      return { ok: true, disbanded: true, teamName: team.name };
    }
    const nextCaptain = (await dbGet(
      `SELECT user_id FROM team_members
       WHERE team_id = ? AND user_id != ?
       ORDER BY joined_at ASC LIMIT 1`,
      [team.id, userId]
    )) as { user_id: number } | undefined;
    if (!nextCaptain) {
      await deleteTeamById(team.id);
      return { ok: true, disbanded: true, teamName: team.name };
    }
    await dbRun(`UPDATE teams SET captain_id = ? WHERE id = ?`, [nextCaptain.user_id, team.id]);
    await dbRun(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`, [team.id, userId]);
    return { ok: true, teamName: team.name, newCaptainId: nextCaptain.user_id };
  }

  await dbRun(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`, [team.id, userId]);
  return { ok: true, teamName: team.name };
}

export async function disbandTeam(
  userId: number
): Promise<{ ok: boolean; error?: string; teamName?: string }> {
  const team = await getUserTeam(userId);
  if (!team) return { ok: false, error: "Вы не в команде" };
  if (team.captain_id !== userId) {
    return { ok: false, error: "Только капитан может расформировать команду" };
  }
  await deleteTeamById(team.id);
  return { ok: true, teamName: team.name };
}

export async function getAllActiveTeams() {
  return (await dbAll(
    `SELECT id, name, captain_id FROM teams WHERE invite_code NOT LIKE ?`,
    [`${SOLO_INVITE_PREFIX}%`]
  )) as Array<{
    id: string;
    name: string;
    captain_id: number;
  }>;
}

export async function getTeamLeaderboard(teamId: string, limit = 5) {
  return (await dbAll(
    `SELECT u.telegram_id, u.first_name, u.username, u.fs_tokens, u.streak_days
     FROM team_members tm
     JOIN users u ON u.telegram_id = tm.user_id
     WHERE tm.team_id = ?
     ORDER BY u.fs_tokens DESC
     LIMIT ?`,
    [teamId, limit]
  )) as Array<{
      telegram_id: number;
      first_name: string | null;
      username: string | null;
      fs_tokens: number;
      streak_days: number;
    }>;
}
