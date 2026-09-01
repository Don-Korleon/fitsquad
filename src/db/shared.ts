export const SOLO_INVITE_PREFIX = "SOLO";

export function soloTeamId(userId: number): string {
  return `solo-${userId}`;
}

export function isSoloTeam(team: { id: string; invite_code: string }): boolean {
  return team.id.startsWith("solo-") || team.invite_code.startsWith(SOLO_INVITE_PREFIX);
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
