import fs from "node:fs";
import path from "node:path";
import type { Bot, Context } from "grammy";
import { ACHIEVEMENTS, config } from "../config.js";
import {
  ensureTodayWorkoutForUser,
  getAchievements,
  getTeamByInviteCode,
  getTeamMembers,
  getTodayWorkoutForTeam,
  getUser,
  getUserTeam,
  getUserWorkoutLog,
  getUserWorkoutView,
  getWorkoutLogs,
  getTrainingContext,
  isPremium,
  isSoloModeEnabled,
  joinTeam,
  assertCanJoinTeam,
  createTeam,
  disableSoloMode,
  enableSoloMode,
  leaveTeam,
  disbandTeam,
  upsertUser,
  verifyWorkoutPhoto as dbVerifyPhoto,
} from "../db/index.js";
import { getExercise, exerciseInstructionUrl } from "../services/exercises.js";
import { getMotivationMessage, getWorkoutCoachTip } from "../services/aiTrainer.js";
import {
  rewardPhotoVerified,
  verifyWorkoutPhoto,
} from "../services/gamification.js";
import { withTimeout } from "../utils/helpers.js";
import {
  createTeamNameKeyboard,
  mainMenuKeyboard,
  musicKeyboard,
  premiumKeyboard,
  soloKeyboard,
  teamConfirmDisbandKeyboard,
  teamConfirmLeaveKeyboard,
  teamKeyboard,
  workoutKeyboard,
} from "./keyboards.js";
import { helpText, statsText, teamText, WELCOME_TEXT, workoutCompleteText } from "./messages.js";
import { premiumDescription, sendPremiumInvoice } from "./premium.js";

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
    isPremium: isPremium(userId),
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

  return {
    name: team.name,
    inviteCode: team.invite_code,
    members,
    isCaptain: team.captain_id === userId,
  };
}

export function registerHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const payload = ctx.match?.trim();
    if (payload === "premium") {
      await ctx.reply(premiumDescription(), { parse_mode: "Markdown", reply_markup: premiumKeyboard() });
      await sendPremiumInvoice(bot, ctx.chat!.id);
      return;
    }
    if (payload?.startsWith("join_")) {
      const code = payload.slice(5).toUpperCase();
      const joined = joinTeamByCode(ctx.from!.id, code);
      if (joined.ok) {
        await ctx.reply(`✅ Вы вступили в команду «${joined.team.name}»!`, {
          reply_markup: teamKeyboard(true, joined.team.captain_id === ctx.from!.id),
        });
        return;
      }
      if (joined.error) {
        await ctx.reply(`❌ ${joined.error}`, {
          reply_markup: isSoloModeEnabled(ctx.from!.id) ? soloKeyboard() : teamKeyboard(false),
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

  bot.command("solo", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const result = enableSoloMode(ctx.from!.id);
    if (!result.ok) {
      await ctx.reply(result.error ?? "Не удалось включить Solo режим");
      return;
    }
    await ctx.reply(
      "🏃 *Solo режим включён*\n\nТренируйся один — /workout\n\nЧтобы вступить в команду — сначала выключи Solo: /team → ❌ Выключить Solo",
      { parse_mode: "Markdown", reply_markup: soloKeyboard() }
    );
  });

  bot.command("workout", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await sendWorkoutInfo(ctx);
  });

  bot.command("music", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const training = getTrainingContext(ctx.from!.id);
    if (!training) {
      await ctx.reply("Включите Solo режим — /solo — или создайте команду — /team");
      return;
    }
    const workout = ensureTodayWorkoutForUser(training.teamId, ctx.from!.id);
    await ctx.reply(
      "🎵 *Саундтрек боевиков 90-х* — во вкладке «Тренировка» в Mini App.\n\n" +
        "Треки:\n" +
        "• 🎬 Погоня\n" +
        "• 💥 Герой блокбастера\n" +
        "• 🔫 Финальная разборка\n\n" +
        "Нажми ▶️ Музыка перед первым подходом.",
      { reply_markup: musicKeyboard(workout?.id) }
    );
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

  bot.callbackQuery(/^solo:enable$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const result = enableSoloMode(ctx.from!.id);
    if (!result.ok) {
      await ctx.reply(result.error ?? "Не удалось включить Solo режим");
      return;
    }
    await ctx.reply("🏃 Solo режим включён! /workout — тренировка дня", {
      reply_markup: soloKeyboard(),
    });
  });

  bot.callbackQuery(/^solo:disable$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const result = disableSoloMode(ctx.from!.id);
    if (!result.ok) {
      await ctx.reply(result.error ?? "Не удалось выключить Solo режим");
      return;
    }
    await ctx.reply("Solo режим выключен. Создайте или вступите в команду:", {
      reply_markup: teamKeyboard(false),
    });
  });

  bot.callbackQuery(/^team:create$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const check = assertCanJoinTeam(ctx.from!.id);
    if (!check.ok) {
      await ctx.reply(check.error!, {
        reply_markup: isSoloModeEnabled(ctx.from!.id) ? soloKeyboard() : teamKeyboard(false),
      });
      return;
    }
    await ctx.reply("Выберите название команды:", { reply_markup: createTeamNameKeyboard() });
  });

  bot.callbackQuery(/^team:name:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const name = ctx.match![1]!;
    const result = createTeam(ctx.from!.id, name);
    if (!result.ok || !result.inviteCode) {
      await ctx.reply(result.error ?? "Не удалось создать команду", {
        reply_markup: isSoloModeEnabled(ctx.from!.id) ? soloKeyboard() : teamKeyboard(false),
      });
      return;
    }
    await ctx.reply(
      `✅ Команда «${name}» создана!\n\nКод приглашения: \`${result.inviteCode}\`\n\nПоделитесь: t.me/${config.botUsername}?start=join_${result.inviteCode}`,
      { parse_mode: "Markdown", reply_markup: teamKeyboard(true, true) }
    );
  });

  bot.callbackQuery(/^team:join$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const check = assertCanJoinTeam(ctx.from!.id);
    if (!check.ok) {
      await ctx.reply(check.error!, {
        reply_markup: isSoloModeEnabled(ctx.from!.id) ? soloKeyboard() : teamKeyboard(false),
      });
      return;
    }
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

  bot.callbackQuery(/^team:leave$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const team = getUserTeam(ctx.from!.id);
    if (!team) {
      await ctx.reply("Вы не в команде.");
      return;
    }
    if (team.captain_id === ctx.from!.id) {
      const count = getTeamMembers(team.id).length;
      if (count > 1) {
        await ctx.reply(
          "Вы капитан. При выходе капитанство передаётся следующему участнику.\n\nПодтвердите выход:",
          { reply_markup: teamConfirmLeaveKeyboard() }
        );
      } else {
        await ctx.reply(
          "Вы единственный участник — при выходе команда будет удалена.\n\nПодтвердите:",
          { reply_markup: teamConfirmLeaveKeyboard() }
        );
      }
    } else {
      await ctx.reply(`Выйти из команды «${team.name}»?`, {
        reply_markup: teamConfirmLeaveKeyboard(),
      });
    }
  });

  bot.callbackQuery(/^team:leave:confirm$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const result = leaveTeam(ctx.from!.id);
    if (!result.ok) {
      await ctx.reply(result.error ?? "Не удалось выйти");
      return;
    }
    if (result.disbanded) {
      await ctx.reply(`✅ Команда «${result.teamName}» расформирована.`, {
        reply_markup: teamKeyboard(false),
      });
      return;
    }
    let msg = `✅ Вы вышли из команды «${result.teamName}».`;
    if (result.newCaptainId) {
      msg += "\n👑 Капитанство передано другому участнику.";
    }
    await ctx.reply(msg, { reply_markup: teamKeyboard(false) });
  });

  bot.callbackQuery(/^team:disband$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const team = getUserTeam(ctx.from!.id);
    if (!team) {
      await ctx.reply("Вы не в команде.");
      return;
    }
    if (team.captain_id !== ctx.from!.id) {
      await ctx.reply("Только капитан может расформировать команду.");
      return;
    }
    await ctx.reply(
      `⚠️ Расформировать команду «${team.name}»?\n\nВсе участники будут удалены. Это нельзя отменить.`,
      { reply_markup: teamConfirmDisbandKeyboard() }
    );
  });

  bot.callbackQuery(/^team:disband:confirm$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const result = disbandTeam(ctx.from!.id);
    if (!result.ok) {
      await ctx.reply(result.error ?? "Не удалось расформировать");
      return;
    }
    await ctx.reply(`✅ Команда «${result.teamName}» расформирована.`, {
      reply_markup: teamKeyboard(false),
    });
  });

  bot.callbackQuery(/^team:cancel$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendTeamInfo(ctx);
  });

  bot.callbackQuery(/^coach:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const workoutId = ctx.match![1]!;
    const workout = getTodayWorkoutForTeam(getTrainingContext(ctx.from!.id)?.teamId ?? "");
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
      const joined = joinTeamByCode(ctx.from!.id, code);
      if (joined.ok) {
        await ctx.reply(`✅ Вы вступили в команду «${joined.team.name}»!`, {
          reply_markup: teamKeyboard(true, false),
        });
      } else {
        await ctx.reply(`❌ ${joined.error ?? "Команда не найдена или уже заполнена."}`, {
          reply_markup: isSoloModeEnabled(ctx.from!.id) ? soloKeyboard() : teamKeyboard(false),
        });
      }
    }
  );

  bot.on("message:photo", async (ctx) => {
    upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const training = getTrainingContext(ctx.from!.id);
    if (!training) {
      await ctx.reply("Включите Solo режим — /solo — или вступите в команду — /team");
      return;
    }

    const workout = ensureTodayWorkoutForUser(training.teamId, ctx.from!.id);
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
      const result = await verifyWorkoutPhoto(localPath, ctx.from!.id);
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

function joinTeamByCode(
  userId: number,
  code: string
):
  | { ok: true; team: { id: string; name: string; invite_code: string; captain_id: number } }
  | { ok: false; error: string } {
  const team = getTeamByInviteCode(code);
  if (!team) {
    return { ok: false, error: "Команда не найдена или код неверный" };
  }
  const result = joinTeam(team.id, userId);
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Не удалось вступить в команду" };
  }
  return { ok: true, team };
}

async function sendTeamInfo(ctx: Context): Promise<void> {
  const view = buildTeamView(ctx.from!.id);
  if (!view) {
    if (isSoloModeEnabled(ctx.from!.id)) {
      await ctx.reply(
        "🏃 *Solo режим* — тренируешься один.\n\n/workout — тренировка дня\n\n_Чтобы вступить в команду — сначала выключи Solo_",
        { parse_mode: "Markdown", reply_markup: soloKeyboard() }
      );
      return;
    }
    await ctx.reply("Вы ещё не в команде. Solo режим или команда:", {
      reply_markup: teamKeyboard(false),
    });
    return;
  }
  await ctx.reply(teamText(view), {
    parse_mode: "Markdown",
    reply_markup: teamKeyboard(true, view.isCaptain),
  });
}

async function sendWorkoutInfo(ctx: Context): Promise<void> {
  const training = getTrainingContext(ctx.from!.id);
  if (!training) {
    await ctx.reply(
      "Включите 🏃 Solo режим — /solo — или создайте команду — /team",
      { reply_markup: teamKeyboard(false) }
    );
    return;
  }

  const workout = ensureTodayWorkoutForUser(training.teamId, ctx.from!.id);
  if (!workout) return;

  const view = getUserWorkoutView(workout.id, ctx.from!.id);
  if (!view) return;

  const exercise = getExercise(view.exerciseSlug);
  if (!exercise) return;

  const logs = getWorkoutLogs(workout.id);
  const completed = logs.filter((l) => l.completed === 1).length;

  const durationLine = view.durationSec
    ? `\n⏱ ${view.durationSec} сек × ${view.targetSets} подходов`
    : `\n🔢 ${view.targetReps} повт. × ${view.targetSets} подходов`;

  let text = `${exercise.emoji} *${exercise.name}*\n\n${exercise.description}${durationLine}\n\n*Техника:*\n${exercise.tips.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;

  if (view.alternativeUsed) {
    const teamEx = getExercise(view.teamExerciseSlug);
    text += `\n\n🔄 Вы уже сделали «${teamEx?.name ?? view.teamExerciseSlug}» сегодня — альтернатива`;
  }

  if (training.mode === "solo") {
    text += "\n\n🏃 Solo тренировка";
  } else {
    text += `\n\n👥 Команда: ${completed}/${logs.length} выполнили`;
  }

  if (view.completed) {
    text += "\n\n✅ Вы уже выполнили сегодня!";
  }

  const photoUrl = exerciseInstructionUrl(exercise, config.publicUrl);
  const markup = { parse_mode: "Markdown" as const, reply_markup: workoutKeyboard(workout.id) };

  try {
    await ctx.replyWithPhoto(photoUrl, { caption: text, ...markup });
  } catch {
    await ctx.reply(text, markup);
  }
}

export async function setupBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Начать" },
    { command: "team", description: "Команда" },
    { command: "solo", description: "Тренироваться одному" },
    { command: "workout", description: "Тренировка дня" },
    { command: "music", description: "Музыка боевиков 90-х" },
    { command: "motivate", description: "Мотивация AI" },
    { command: "stats", description: "Статистика и FS" },
    { command: "premium", description: "Premium подписка ⭐" },
    { command: "help", description: "Справка" },
  ]);
}
