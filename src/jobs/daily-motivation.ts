import { Bot } from "grammy";
import { config } from "../config.js";
import {
  ensureTodayWorkout,
  getTeamMembers,
  getWorkoutLogs,
  getAllActiveTeams,
} from "../db/index.js";
import { getExercise } from "../services/exercises.js";
import { getTeamDailyMessage } from "../services/aiTrainer.js";
import { mainMenuKeyboard } from "../bot/keyboards.js";

async function main(): Promise<void> {
  if (!config.botToken) {
    console.error("BOT_TOKEN required");
    process.exit(1);
  }

  const bot = new Bot(config.botToken);
  const teams = await getAllActiveTeams();

  for (const team of teams) {
    const workout = await ensureTodayWorkout(team.id);
    if (!workout) continue;

    const exercise = getExercise(workout.exercise_slug);
    const logs = await getWorkoutLogs(workout.id);
    const completed = logs.filter((l) => l.completed === 1).length;
    const members = await getTeamMembers(team.id);

    const message = await getTeamDailyMessage(
      team.name,
      exercise?.name ?? "тренировка",
      completed,
      members.length
    );

    const text = `🌅 *Утренняя мотивация — ${team.name}*\n\n${exercise?.emoji ?? "🏋️"} Сегодня: *${exercise?.name ?? "тренировка"}*\n👥 ${completed}/${members.length} выполнили\n\n${message}`;

    for (const member of members) {
      try {
        await bot.api.sendMessage(member.telegram_id, text, {
          parse_mode: "Markdown",
          reply_markup: mainMenuKeyboard(),
        });
      } catch {
        /* user blocked bot */
      }
    }
  }

  console.log(`[motivation] sent to ${teams.length} teams`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
