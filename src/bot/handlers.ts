import fs from "node:fs";
import path from "node:path";
import type { Bot, Context } from "grammy";
import { ACHIEVEMENTS, config } from "../config.js";
import {
  ensureTodayWorkout,
  getAchievements,
  getTeamByInviteCode,
  getTeamMembers,
  getTodayWorkoutForTeam,
  getUser,
  getUserTeam,
  getUserWorkoutLog,
  getWorkoutLogs,
  joinTeam,
  createTeam,
  upsertUser,
  verifyWorkoutPhoto as dbVerifyPhoto,
} from "../db/index.js";
import { getExercise } from "../services/exercises.js";
import { getMotivationMessage, getWorkoutCoachTip } from "../services/aiTrainer.js";
import {
  rewardPhotoVerified,
  verifyWorkoutPhoto,
} from "../services/gamification.js";
import { withTimeout } from "../utils/helpers.js";
import {
  createTeamNameKeyboard,
  mainMenuKeyboard,
  teamKeyboard,
  workoutKeyboard,
} from "./keyboards.js";
import { helpText, statsText, teamText, WELCOME_TEXT, workoutCompleteText } from "./messages.js";

type SessionState = "awaiting_invite_code" | "awaiting_photo";

const userState = new Map<number, SessionState>();

async function downloadPhoto(bot: Bot, fileId: string): Promise<string> {
  const file = await withTimeout(bot.api.getFile(fileId), 30_000, "getFile");
  const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
  const res = await withTimeout(fetch(url), 60_000, "downloadPhoto");
  if (!res.ok) throw new Error("Failed to download photo");

  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const ext = path.extname(file.file_path ?? ".jpg") || ".jpg";
  const localPath = path.join(config.uploadsDir, `${fileId}${ext}`);
  fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
  return localPath;
}

function buildStats(userId: number) {
  const user = getUser(userId);
  const achievements = getAchievements(userId).map((a) => {
    const def = ACHIEVEMENTS.find((d) => d.type === a.type);
    return { emoji: def?.emoji ?? "🏅", label: def?.label ?? a.type };
  });
  return {
    firstName: user?.first_name ?? null,
    fsTokens: user?.fs_tokens ?? 0,
    streakDays: user?.streak_days ?? 0,
    totalWorkouts: user?.total_workouts ?? 0,
    achievements,
  };
}

function buildTeamView(userId: number) {
  const team = getUserTeam(userId);
  if (!team) return null;

  const workout = getTodayWorkoutForTeam(team.id);
  const logs = workout ? getWorkoutLogs(workout.id) : [];

  const members = getTeamMembers(team.id).map((m) => ({
    firstName: m.first_name,
    fsTokens: m.fs_tokens,
    completedToday: logs.some((l) => l.user_id === m.telegram_id && l.completed === 1),
  }));

  return { name: team.name, inviteCode: team.invite_code, members };
}

export function registerHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const payload = ctx.match?.trim();
    if (payload?.startsWith("join_")) {
      const code = payload.slice(5).toUpperCase();
      const team = joinTeamByCode(ctx.from!.id, code);
      if (team) {
        await ctx.reply(`✅ Вы вступили в команду «${team.name}»!`, {
          reply_markup: teamKeyboard(true),
        });
        return;
      }
    }
    await ctx.reply(WELCOME_TEXT, {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText(), { parse_mode: "HTML" });
  });

  bot.command("team", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await sendTeamInfo(ctx);
  });

  bot.command("workout", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await sendWorkoutInfo(ctx);
  });

  bot.command("motivate", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const msg = await getMotivationMessage(ctx.from!.id);
    await ctx.reply(`🤖 *AI-тренер:*\n\n${msg.text}`, { parse_mode: "Markdown" });
  });

  bot.command("stats", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await ctx.reply(statsText(buildStats(ctx.from!.id)), { parse_mode: "Markdown" });
  });

  bot.hears("🤝 Команда", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await sendTeamInfo(ctx);
  });

  bot.hears("📊 Статистика", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await ctx.reply(statsText(buildStats(ctx.from!.id)), { parse_mode: "Markdown" });
  });

  bot.hears("💪 Мотивация", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const msg = await getMotivationMessage(ctx.from!.id);
    await ctx.reply(`🤖 *AI-тренер:*\n\n${msg.text}`, { parse_mode: "Markdown" });
  });

  bot.hears("🏋️ Тренировка", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    if (config.webappIsHttps) {
      await sendWorkoutInfo(ctx);
    } else {
      await ctx.reply("Откройте Mini App через HTTPS или нажмите /workout");
    }
  });

  bot.callbackQuery(/^team:create$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Выберите название команды:", { reply_markup: createTeamNameKeyboard() });
  });

  bot.callbackQuery(/^team:name:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const name = ctx.match![1]!;
    const existing = getUserTeam(ctx.from!.id);
    if (existing) {
      await ctx.reply("Вы уже в команде.");
      return;
    }
    const { inviteCode } = createTeam(ctx.from!.id, name);
    await ctx.reply(
      `✅ Команда «${name}» создана!\n\nКод приглашения: \`${inviteCode}\`\n\nПоделитесь: t.me/${config.botUsername}?start=join_${inviteCode}`,
      { parse_mode: "Markdown", reply_markup: teamKeyboard(true) }
    );
  });

  bot.callbackQuery(/^team:join$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    userState.set(ctx.from!.id, "awaiting_invite_code");
    await ctx.reply("Введите 6-значный код приглашения:");
  });

  bot.callbackQuery(/^team:members$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const view = buildTeamView(ctx.from!.id);
    if (!view) {
      await ctx.reply("Вы не в команде.");
      return;
    }
    await ctx.reply(teamText(view), { parse_mode: "Markdown" });
  });

  bot.callbackQuery(/^coach:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const workoutId = ctx.match![1]!;
    const workout = getTodayWorkoutForTeam(getUserTeam(ctx.from!.id)?.id ?? "");
    if (!workout || workout.id !== workoutId) {
      await ctx.reply("Тренировка не найдена.");
      return;
    }
    const tip = await getWorkoutCoachTip(workout.exercise_slug, 1, ctx.from!.id);
    await ctx.reply(`🤖 ${tip.text}`);
  });

  bot.callbackQuery(/^webapp:(.*)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Mini App требует HTTPS. Настройте WEBAPP_URL (ngrok или домен) в .env"
    );
  });

  bot.on("message:text").filter(
    (ctx) => userState.get(ctx.from!.id) === "awaiting_invite_code",
    async (ctx) => {
      userState.delete(ctx.from!.id);
      const code = ctx.message.text.trim().toUpperCase();
      const team = joinTeamByCode(ctx.from!.id, code);
      if (team) {
        await ctx.reply(`✅ Вы вступили в команду «${team.name}»!`, {
          reply_markup: teamKeyboard(true),
        });
      } else {
        await ctx.reply("❌ Команда не найдена или уже заполнена.", {
          reply_markup: teamKeyboard(false),
        });
      }
    }
  );

  bot.on("message:photo", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const team = getUserTeam(ctx.from!.id);
    if (!team) {
      await ctx.reply("Сначала вступите в команду — /team");
      return;
    }

    const workout = ensureTodayWorkout(team.id);
    if (!workout) return;

    const log = getUserWorkoutLog(workout.id, ctx.from!.id);
    if (!log?.completed) {
      await ctx.reply("Сначала завершите тренировку в Mini App или через /workout.");
      return;
    }
    if (log.photo_verified) {
      await ctx.reply("Фото уже верифицировано ✅");
      return;
    }

    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1]!;
    await ctx.reply("📸 Проверяю фото...");

    try {
      const localPath = await downloadPhoto(bot, largest.file_id);
      const result = await verifyWorkoutPhoto(localPath);
      if (!result.verified) {
        await ctx.reply(`❌ ${result.reason}. Попробуйте другое фото.`);
        return;
      }

      const fsBonus = rewardPhotoVerified(ctx.from!.id);
      dbVerifyPhoto(workout.id, ctx.from!.id, localPath, fsBonus);

      await ctx.reply(
        `✅ Фото верифицировано!\n+${fsBonus} FS 💎\n\n_${result.reason}_`,
        { parse_mode: "Markdown" }
      );
    } catch {
      await ctx.reply("Не удалось обработать фото. Попробуйте снова.");
    }
  });
}

function joinTeamByCode(userId: number, code: string) {
  const team = getTeamByInviteCode(code);
  if (!team) return null;
  const result = joinTeam(team.id, userId);
  if (!result.ok) return null;
  return team;
}

async function sendTeamInfo(ctx: Context): Promise<void> {
  const view = buildTeamView(ctx.from!.id);
  if (!view) {
    await ctx.reply("Вы ещё не в команде. Создайте или вступите:", {
      reply_markup: teamKeyboard(false),
    });
    return;
  }
  await ctx.reply(teamText(view), {
    parse_mode: "Markdown",
    reply_markup: teamKeyboard(true),
  });
}

async function sendWorkoutInfo(ctx: Context): Promise<void> {
  const team = getUserTeam(ctx.from!.id);
  if (!team) {
    await ctx.reply("Сначала создайте или вступите в команду — /team");
    return;
  }

  const workout = ensureTodayWorkout(team.id);
  if (!workout) return;

  const exercise = getExercise(workout.exercise_slug);
  if (!exercise) return;

  const logs = getWorkoutLogs(workout.id);
  const completed = logs.filter((l) => l.completed === 1).length;
  const userLog = getUserWorkoutLog(workout.id, ctx.from!.id);

  const durationLine = workout.duration_sec
    ? `\n⏱ ${workout.duration_sec} сек × ${workout.target_sets} подходов`
    : `\n🔢 ${workout.target_reps} повт. × ${workout.target_sets} подходов`;

  let text = `${exercise.emoji} *${exercise.name}*\n\n${exercise.description}${durationLine}\n\n👥 Команда: ${completed}/${logs.length} выполнили`;

  if (userLog?.completed) {
    text += "\n\n✅ Вы уже выполнили сегодня!";
  }

  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: workoutKeyboard(workout.id),
  });
}

export async function setupBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Начать" },
    { command: "team", description: "Команда" },
    { command: "workout", description: "Тренировка дня" },
    { command: "motivate", description: "Мотивация AI" },
    { command: "stats", description: "Статистика и FS" },
    { command: "help", description: "Справка" },
  ]);
}
