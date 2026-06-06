import { config } from "../config.js";

export const WELCOME_TEXT = `🏋️ *FitSquad* — социальная фитнес-платформа

Тренируйся с командой до 5 человек, получай FS-тokens за достижения и мотивацию от AI-тренера.

*Как начать:*
1. Создай или вступи в команду — /team
2. Открой Mini App — тренировка дня
3. Загрузи фото для верификации
4. Зарабатывай FS и ачивки 💎

Команды:
/team — команда
/workout — тренировка дня
/motivate — мотивация от AI
/stats — статистика и FS
/help — справка`;

export function helpText(): string {
  return `<b>📖 FitSquad — справка</b>

<b>Команды</b>
• /team — создать или вступить в команду (до 5 человек)
• /workout — сегодняшняя командная тренировка
• /motivate — сообщение от AI-тренера
• /stats — FS-тokens, streak, достижения

<b>FS-тokens</b>
• +${config.fsWorkoutComplete} FS — завершить тренировку
• +${config.fsPhotoVerified} FS — верификация фото
• +${config.fsTeamBonus} FS — вся команда выполнила тренировку
• +${config.fsStreakBonus} FS — бонус за streak (со 2-го дня)

<b>Упражнения V1</b>
Отжимания, приседания, планка, прыжки, бёрпи

<b>Mini App</b>
Открой через кнопку «🏋️ Тренировка» — таймер, подходы, загрузка фото.`;
}

export function statsText(profile: {
  firstName: string | null;
  fsTokens: number;
  streakDays: number;
  totalWorkouts: number;
  achievements: Array<{ emoji: string; label: string }>;
}): string {
  const name = profile.firstName ?? "Атлет";
  const achLines =
    profile.achievements.length > 0
      ? profile.achievements.map((a) => `${a.emoji} ${a.label}`).join("\n")
      : "Пока нет — выполни первую тренировку!";

  return `📊 *Статистика ${escapeMd(name)}*

💎 FS-tokens: *${profile.fsTokens}*
🔥 Streak: *${profile.streakDays}* дн.
✅ Тренировок: *${profile.totalWorkouts}*

<b>Достижения:</b>
${achLines}`;
}

export function teamText(team: {
  name: string;
  inviteCode: string;
  members: Array<{ firstName: string | null; fsTokens: number; completedToday: boolean }>;
}): string {
  const memberLines = team.members
    .map((m, i) => {
      const status = m.completedToday ? "✅" : "⏳";
      return `${i + 1}. ${m.firstName ?? "Участник"} — ${m.fsTokens} FS ${status}`;
    })
    .join("\n");

  return `🤝 *Команда «${escapeMd(team.name)}»*

Код приглашения: \`${team.inviteCode}\`

<b>Участники (${team.members.length}/5):</b>
${memberLines}`;
}

export function workoutCompleteText(reward: {
  totalFs: number;
  streakDays: number;
  newAchievements: Array<{ emoji: string; label: string; bonusFs: number }>;
}): string {
  let text = `✅ *Тренировка завершена!*\n\n+${reward.totalFs} FS 💎\n🔥 Streak: ${reward.streakDays} дн.`;
  if (reward.newAchievements.length > 0) {
    text += "\n\n🏆 *Новые достижения:*\n";
    text += reward.newAchievements
      .map((a) => `${a.emoji} ${a.label} (+${a.bonusFs} FS)`)
      .join("\n");
  }
  text += "\n\n📸 Отправь фото тренировки для +15 FS!";
  return text;
}

function escapeMd(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
