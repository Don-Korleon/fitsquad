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
  getPendingAction,
  leaveTeam,
  disbandTeam,
  setPendingAction,
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
  premiumKeyboard,
  soloKeyboard,
  teamConfirmDisbandKeyboard,
  teamConfirmLeaveKeyboard,
  teamKeyboard,
  workoutKeyboard,
} from "./keyboards.js";
import { helpText, statsText, teamText, WELCOME_TEXT, workoutCompleteText } from "./messages.js";
import { premiumDescription, sendPremiumInvoice } from "./premium.js";
import { isAppssAdmin, parseAppssStartParam, replyAppssVerifyCode } from "./appssVerify.js";

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

async function buildStats(userId: number) {
  const user = await getUser(userId);
  const achievements = (await getAchievements(userId)).map((a) => {
    const def = ACHIEVEMENTS.find((d) => d.type === a.type);
    return { emoji: def?.emoji ?? "🏅", label: def?.label ?? a.type };
  });
  return {
    firstName: user?.first_name ?? null,
    fsTokens: user?.fs_tokens ?? 0,
    streakDays: user?.streak_days ?? 0,
    totalWorkouts: user?.total_workouts ?? 0,
    isPremium: await isPremium(userId),
    achievements,
  };
}

async function buildTeamView(userId: number) {
  const team = await getUserTeam(userId);
  if (!team) return null;

  const workout = await getTodayWorkoutForTeam(team.id);
  const logs = workout ? await getWorkoutLogs(workout.id) : [];

  const members = (await getTeamMembers(team.id)).map((m) => ({
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

function menuReply(extra?: Omit<Parameters<Context["reply"]>[1], "reply_markup">) {
  return { ...extra, reply_markup: mainMenuKeyboard() };
}

/** Re-attaches the reply keyboard after inline buttons or Mini App without leaving a visible message. */
async function pokeMainMenu(ctx: Context): Promise<void> {
  const msg = await ctx.reply("·", menuReply({ disable_notification: true }));
  try {
    await ctx.api.deleteMessage(ctx.chat!.id, msg.message_id);
  } catch {
    /* keyboard already restored */
  }
}

export function registerHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const payload = ctx.match?.trim();
    if (payload === "premium") {
      await ctx.reply(premiumDescription(), { parse_mode: "Markdown", reply_markup: premiumKeyboard() });
      await sendPremiumInvoice(bot, ctx.chat!.id);
      return;
    }
    const appssCode = payload ? parseAppssStartParam(payload) : null;
    if ((payload === "appss_verify" || appssCode !== null) && isAppssAdmin(ctx.from?.id)) {
      await replyAppssVerifyCode(ctx, appssCode ?? undefined);
      return;
    }
    if (payload?.startsWith("join_")) {
      const code = payload.slice(5).toUpperCase();
      const joined = await joinTeamByCode(ctx.from!.id, code);
      if (joined.ok) {
        await ctx.reply(`✅ Вы вступили в команду «${joined.team.name}»!`, {
          reply_markup: teamKeyboard(true, joined.team.captain_id === ctx.from!.id),
        });
        return;
      }
      if (joined.error) {
        await ctx.reply(`❌ ${joined.error}`, {
          reply_markup: (await isSoloModeEnabled(ctx.from!.id)) ? soloKeyboard() : teamKeyboard(false),
        });
        return;
      }
    }
    await ctx.reply(WELCOME_TEXT, menuReply({ parse_mode: "HTML" }));
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText(), menuReply({ parse_mode: "HTML" }));
  });

  bot.command("team", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await sendTeamInfo(ctx);
  });

  bot.command("solo", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const result = await enableSoloMode(ctx.from!.id);
    if (!result.ok) {
      await ctx.reply(result.error ?? "Не удалось включить Solo режим", menuReply());
      return;
    }
    await ctx.reply(
      "🏃 *Solo режим включён*\n\nТренируйся один — /workout\n\nЧтобы вступить в команду — сначала выключи Solo: /team → ❌ Выключить Solo",
      { parse_mode: "Markdown", reply_markup: soloKeyboard() }
    );
    await pokeMainMenu(ctx);
  });

  bot.command("workout", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await sendWorkoutInfo(ctx);
  });

  bot.command("motivate", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const msg = await getMotivationMessage(ctx.from!.id);
    await ctx.reply(`🤖 *AI-тренер:*\n\n${msg.text}`, menuReply({ parse_mode: "Markdown" }));
  });

  bot.command("stats", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await ctx.reply(statsText(await buildStats(ctx.from!.id)), menuReply({ parse_mode: "Markdown" }));
  });

  bot.hears("🤝 Команда", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await sendTeamInfo(ctx);
  });

  bot.hears("📊 Статистика", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    await ctx.reply(statsText(await buildStats(ctx.from!.id)), menuReply({ parse_mode: "Markdown" }));
  });

  bot.hears("💪 Мотивация", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const msg = await getMotivationMessage(ctx.from!.id);
    await ctx.reply(`🤖 *AI-тренер:*\n\n${msg.text}`, menuReply({ parse_mode: "Markdown" }));
  });

  bot.hears("🏋️ Тренировка", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    if (config.webappIsHttps) {
      await sendWorkoutInfo(ctx);
    } else {
      await ctx.reply("Откройте Mini App через HTTPS или нажмите /workout");
    }
  });

  bot.callbackQuery(/^solo:enable$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const result = await enableSoloMode(ctx.from!.id);
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
    const result = await disableSoloMode(ctx.from!.id);
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
    const check = await assertCanJoinTeam(ctx.from!.id);
    if (!check.ok) {
      await ctx.reply(check.error!, {
        reply_markup: (await isSoloModeEnabled(ctx.from!.id)) ? soloKeyboard() : teamKeyboard(false),
      });
      return;
    }
    await ctx.reply("Выберите название команды:", { reply_markup: createTeamNameKeyboard() });
  });

  bot.callbackQuery(/^team:name:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const name = ctx.match![1]!;
    const result = await createTeam(ctx.from!.id, name);
    if (!result.ok || !result.inviteCode) {
      await ctx.reply(result.error ?? "Не удалось создать команду", {
        reply_markup: (await isSoloModeEnabled(ctx.from!.id)) ? soloKeyboard() : teamKeyboard(false),
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
    const check = await assertCanJoinTeam(ctx.from!.id);
    if (!check.ok) {
      await ctx.reply(check.error!, {
        reply_markup: (await isSoloModeEnabled(ctx.from!.id)) ? soloKeyboard() : teamKeyboard(false),
      });
      return;
    }
    await setPendingAction(ctx.from!.id, "awaiting_invite_code");
    await ctx.reply("Введите 6-значный код приглашения:");
  });

  bot.callbackQuery(/^team:members$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const view = await buildTeamView(ctx.from!.id);
    if (!view) {
      await ctx.reply("Вы не в команде.");
      return;
    }
    await ctx.reply(teamText(view), { parse_mode: "Markdown" });
  });

  bot.callbackQuery(/^team:leave$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const team = await getUserTeam(ctx.from!.id);
    if (!team) {
      await ctx.reply("Вы не в команде.");
      return;
    }
    if (team.captain_id === ctx.from!.id) {
      const count = (await getTeamMembers(team.id)).length;
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
    const result = await leaveTeam(ctx.from!.id);
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
    const team = await getUserTeam(ctx.from!.id);
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
    const result = await disbandTeam(ctx.from!.id);
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
    const training = await getTrainingContext(ctx.from!.id);
    const workout = await getTodayWorkoutForTeam(training?.teamId ?? "");
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
    async (ctx) => (await getPendingAction(ctx.from!.id)) === "awaiting_invite_code",
    async (ctx) => {
      await setPendingAction(ctx.from!.id, null);
      const code = ctx.message.text.trim().toUpperCase();
      const joined = await joinTeamByCode(ctx.from!.id, code);
      if (joined.ok) {
        await ctx.reply(`✅ Вы вступили в команду «${joined.team.name}»!`, {
          reply_markup: teamKeyboard(true, false),
        });
      } else {
        await ctx.reply(`❌ ${joined.error ?? "Команда не найдена или уже заполнена."}`, {
          reply_markup: (await isSoloModeEnabled(ctx.from!.id)) ? soloKeyboard() : teamKeyboard(false),
        });
      }
    }
  );

  bot.on("message:photo", async (ctx) => {
    await upsertUser(ctx.from!.id, ctx.from?.username, ctx.from?.first_name);
    const training = await getTrainingContext(ctx.from!.id);
    if (!training) {
      await ctx.reply("Включите Solo режим — /solo — или вступите в команду — /team");
      return;
    }

    const workout = await ensureTodayWorkoutForUser(training.teamId, ctx.from!.id);
    if (!workout) return;

    const log = await getUserWorkoutLog(workout.id, ctx.from!.id);
    if (!log?.completed) {
      await ctx.reply("Сначала завершите тренировку в Mini App или через /workout.", menuReply());
      return;
    }
    if (log.photo_verified) {
      await ctx.reply("Фото уже верифицировано ✅", menuReply());
      return;
    }

    const view = await getUserWorkoutView(workout.id, ctx.from!.id);
    const exercise = view ? getExercise(view.exerciseSlug) : null;

    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1]!;
    await ctx.reply("📸 Проверяю фото...", menuReply());

    try {
      const localPath = await downloadPhoto(bot, largest.file_id);
      const result = await verifyWorkoutPhoto(localPath, ctx.from!.id, {
        exerciseName: exercise?.name,
        exerciseSlug: view?.exerciseSlug,
      });
      if (!result.verified) {
        await ctx.reply(`❌ ${result.reason}. Попробуйте другое фото.`, menuReply());
        return;
      }

      const fsBonus = await rewardPhotoVerified(ctx.from!.id);
      await dbVerifyPhoto(workout.id, ctx.from!.id, localPath, fsBonus);

      await ctx.reply(
        `✅ Фото верифицировано!\n+${fsBonus} FS 💎\n\n_${result.reason}_`,
        menuReply({ parse_mode: "Markdown" })
      );
    } catch {
      await ctx.reply("Не удалось обработать фото. Попробуйте снова.", menuReply());
    }
  });
}

async function joinTeamByCode(
  userId: number,
  code: string
): Promise<
  | { ok: true; team: { id: string; name: string; invite_code: string; captain_id: number } }
  | { ok: false; error: string }
> {
  const team = await getTeamByInviteCode(code);
  if (!team) {
    return { ok: false, error: "Команда не найдена или код неверный" };
  }
  const result = await joinTeam(team.id, userId);
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Не удалось вступить в команду" };
  }
  return { ok: true, team };
}

async function sendTeamInfo(ctx: Context): Promise<void> {
  const view = await buildTeamView(ctx.from!.id);
  if (!view) {
    if (await isSoloModeEnabled(ctx.from!.id)) {
      await ctx.reply(
        "🏃 *Solo режим* — тренируешься один.\n\n/workout — тренировка дня\n\n_Чтобы вступить в команду — сначала выключи Solo_",
        { parse_mode: "Markdown", reply_markup: soloKeyboard() }
      );
      await pokeMainMenu(ctx);
      return;
    }
    await ctx.reply("Вы ещё не в команде. Solo режим или команда:", {
      reply_markup: teamKeyboard(false),
    });
    await pokeMainMenu(ctx);
    return;
  }
  await ctx.reply(teamText(view), {
    parse_mode: "Markdown",
    reply_markup: teamKeyboard(true, view.isCaptain),
  });
  await pokeMainMenu(ctx);
}

async function sendWorkoutInfo(ctx: Context): Promise<void> {
  const training = await getTrainingContext(ctx.from!.id);
  if (!training) {
    await ctx.reply(
      "Включите 🏃 Solo режим — /solo — или создайте команду — /team",
      { reply_markup: teamKeyboard(false) }
    );
    await pokeMainMenu(ctx);
    return;
  }

  const workout = await ensureTodayWorkoutForUser(training.teamId, ctx.from!.id);
  if (!workout) return;

  const view = await getUserWorkoutView(workout.id, ctx.from!.id);
  if (!view) return;

  const exercise = getExercise(view.exerciseSlug);
  if (!exercise) return;

  const logs = await getWorkoutLogs(workout.id);
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
  await pokeMainMenu(ctx);
}

export async function setupBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Начать" },
    { command: "team", description: "Команда" },
    { command: "solo", description: "Тренироваться одному" },
    { command: "workout", description: "Тренировка дня" },
    { command: "motivate", description: "Мотивация AI" },
    { command: "stats", description: "Статистика и FS" },
    { command: "premium", description: "Premium подписка ⭐" },
    { command: "promo", description: "Промокод Premium (Tribute)" },
    { command: "appss_verify", description: "Верификация appss.pro" },
    { command: "help", description: "Справка" },
  ]);
}
