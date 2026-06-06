import { config } from "../config.js";
import { getUser, getUserTeam, getTodayWorkoutForTeam } from "../db/index.js";
import { getExercise } from "./exercises.js";
import type { AiCoachMessage } from "../types.js";

const MOCK_MESSAGES = {
  morning: [
    "☀️ Доброе утро, {name}! Сегодня отличный день для {exercise}. Команда ждёт тебя!",
    "🔥 Проснись и качай! {exercise} — твоя цель на сегодня. Не подведи команду!",
  ],
  workout: [
    "💪 Отличная работа, {name}! {reps} повторений — это серьёзно. Продолжай в том же духе!",
    "🎯 Ты на правильном пути! Ещё {sets} подхода и тренировка в кармане.",
    "⚡ Энергия команды растёт с каждым твоим повторением!",
  ],
  team: [
    "🤝 Вся команда «{team}» сегодня на связи! {done}/{total} уже выполнили тренировку.",
    "🏆 Командный дух — ваше секретное оружие. Вместе вы сильнее!",
  ],
  streak: [
    "🔥 {streak} дней подряд — ты на огне! Не останавливайся, {name}!",
    "⭐ Серия {streak} дней — это дисциплина. Горжусь тобой!",
  ],
  motivate: [
    "💎 Каждая тренировка — инвестиция в себя. FS-токены не дадут солгать!",
    "🚀 Не жди идеального момента — создай его. Начни прямо сейчас!",
    "🧠 Твоё тело может всё. Это голова нуждается в убеждении.",
    "⚔️ Боль — временная. Гордость за результат — навсегда.",
  ],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));
}

export async function getMotivationMessage(userId: number): Promise<AiCoachMessage> {
  const user = getUser(userId);
  const name = user?.first_name ?? "атлет";
  const team = getUserTeam(userId);
  const workout = team ? getTodayWorkoutForTeam(team.id) : null;
  const exercise = workout ? getExercise(workout.exercise_slug) : null;

  const context = {
    name,
    team: team?.name ?? "FitSquad",
    exercise: exercise?.name ?? "тренировку",
    reps: workout?.target_reps ?? 15,
    sets: workout?.target_sets ?? 3,
    streak: user?.streak_days ?? 0,
    fs: user?.fs_tokens ?? 0,
    done: 0,
    total: 5,
  };

  if (config.apiMode === "live" && config.openaiApiKey) {
    const ai = await askOpenAi(context);
    if (ai) return ai;
  }

  let pool = MOCK_MESSAGES.motivate;
  if (context.streak >= 3) pool = MOCK_MESSAGES.streak;
  else if (exercise) pool = MOCK_MESSAGES.morning;

  return {
    text: fillTemplate(pick(pool), context),
    source: "mock",
  };
}

export async function getWorkoutCoachTip(
  exerciseSlug: string,
  setNumber: number
): Promise<AiCoachMessage> {
  const exercise = getExercise(exerciseSlug);
  const tip = exercise?.tips[(setNumber - 1) % (exercise?.tips.length ?? 1)] ?? "Держите темп!";

  if (config.apiMode === "live" && config.openaiApiKey && exercise) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Ты AI-тренер FitSquad. Короткие мотивирующие советы на русском, 1-2 предложения, с эмодзи.",
            },
            {
              role: "user",
              content: `Упражнение: ${exercise.name}, подход ${setNumber}/${exercise.defaultSets}. Дай совет.`,
            },
          ],
          max_tokens: 100,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return { text, source: "openai" };
      }
    } catch {
      /* fallback */
    }
  }

  return {
    text: `💡 Подход ${setNumber}: ${tip}`,
    source: "mock",
  };
}

async function askOpenAi(context: Record<string, string | number>): Promise<AiCoachMessage | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Ты AI-тренер FitSquad — социальной фитнес-платформы. Мотивируй коротко (2-3 предложения), на русском, с эмодзи. Упоминай FS-тokens и команду.",
          },
          {
            role: "user",
            content: `Пользователь: ${context.name}, команда: ${context.team}, streak: ${context.streak} дней, FS: ${context.fs}. Упражнение дня: ${context.exercise}. Дай мотивацию.`,
          },
        ],
        max_tokens: 150,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text) return { text, source: "openai" };
  } catch {
    return null;
  }
  return null;
}

export async function getTeamDailyMessage(
  teamName: string,
  exerciseName: string,
  completedCount: number,
  totalCount: number
): Promise<string> {
  if (config.apiMode === "live" && config.openaiApiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: `Команда «${teamName}»: ${completedCount}/${totalCount} выполнили тренировку (${exerciseName}). Напиши короткое командное сообщение-мотивацию на русском.`,
            },
          ],
          max_tokens: 120,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch {
      /* fallback */
    }
  }

  return fillTemplate(pick(MOCK_MESSAGES.team), {
    team: teamName,
    exercise: exerciseName,
    done: completedCount,
    total: totalCount,
  });
}
