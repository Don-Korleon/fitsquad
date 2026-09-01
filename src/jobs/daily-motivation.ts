import { Bot } from "grammy";
import { pathToFileURL } from "node:url";
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
import { escapeMd } from "../bot/messages.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends the daily team motivation message. Exported so it can run either from this file's own
 * CLI entrypoint (VPS/Docker crontab, per README) or from the /api/cron/daily-motivation route
 * (Vercel Cron — a serverless deployment has no OS-level crontab to run this script directly).
 */
export async function runDailyMotivation(): Promise<{ teamsNotified: number }> {
  if (!config.botToken) {
    throw new Error("BOT_TOKEN required");
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

    const text = `🌅 *Утренняя мотивация — ${escapeMd(team.name)}*\n\n${exercise?.emoji ?? "🏋️"} Сегодня: *${exercise?.name ?? "тренировка"}*\n👥 ${completed}/${members.length} выполнили\n\n${message}`;

    for (const member of members) {
      try {
        await bot.api.sendMessage(member.telegram_id, text, {
          parse_mode: "Markdown",
          reply_markup: mainMenuKeyboard(),
        });
      } catch {
        /* user blocked bot */
      }
      // Stays under Telegram's ~30 msg/sec global rate limit as the user base grows.
      await sleep(40);
    }
  }

  return { teamsNotified: teams.length };
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runDailyMotivation()
    .then(({ teamsNotified }) => {
      console.log(`[motivation] sent to ${teamsNotified} teams`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
