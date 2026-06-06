import { config } from "../config.js";
import { getUser, getUserTeam, getTodayWorkoutForTeam, todayKey } from "../db/index.js";
import { getExercise } from "./exercises.js";
import { canUseLiveAi } from "./premium.js";
import type { AiCoachMessage } from "../types.js";
const MOCK_MOTIVATION = [
  "💎 {name}, каждый подход — +FS. Сегодня цель: {exercise}!",
  "🚀 {name}, команда «{team}» уже на старте. Покажи класс!",
  "🔥 Streak {streak} дн. — не сбавляй темп, {name}!",
  "⚡ {exercise} ждёт. {reps} повт. × {sets} — ты справишься!",
  "🧠 Дисциплина бьёт мотивацию. Начни с первого подхода, {name}.",
  "🏆 У тебя {fs} FS — ещё немного и новая ачивка!",
  "💪 {name}, боль — это слабость, покидающая тело. Вперёд!",
  "🎯 Фокус на технике в {exercise} — результат придёт сам.",
  "🌟 Команда верит в тебя, {name}. Не подведи «{team}»!",
  "⏱️ 15 минут сегодня — месяц прогресса завтра.",
  "🤝 Синхронизируйся с командой: все делают {exercise} сегодня.",
  "📈 {name}, ты уже на {streak} дне streak — это сила!",
  "✨ FS-tokens не врут: тренируйся — расти.",
  "🦾 Последний подход — самый важный. Дожми, {name}!",
  "🔔 Напоминание от AI-тренера: {exercise} — твоя миссия на сегодня.",
];

const EXERCISE_COACH: Record<string, string[]> = {
  pushups: [
    "Локти под 45° — меньше нагрузки на плечи.",
    "Корпус прямая линия, не прогибай поясницу.",
    "Опускайся до 90° в локтях — полная амплитуда.",
    "Дыши: вниз — вдох, вверх — выдох.",
    "Ладони на ширине плеч, пальцы вперёд.",
    "Смотри в пол перед собой — шея нейтральна.",
    "Сжимай пресс и ягодицы — стабильность +30%.",
    "Последние повторения — те, что строят мышцы.",
    "Если тяжело — колени на пол, но техника та же.",
  ],
  squats: [
    "Колени следуют за носками, не заваливайся внутрь.",
    "Бёдра параллельны полу — или ниже, если гибкость есть.",
    "Пятки прижаты к полу, вес на середину стопы.",
    "Спина прямая, грудь расправлена.",
    "Руки перед собой — баланс лучше.",
    "Вниз — 2 сек, вверх — мощно, но контролируемо.",
    "Не округляй поясницу в нижней точке.",
    "Вверху не блокируй колени полностью — держи напряжение.",
    "Представь, что садишься на стул позади себя.",
  ],
  plank: [
    "Не прогибай поясницу — таз чуть подкручен.",
    "Локти строго под плечами.",
    "Напряги пресс и ягодицы одновременно.",
    "Дыши ровно, не задерживай дыхание.",
    "Взгляд в пол — шея продолжение спины.",
    "Если дрожишь — ты делаешь правильно.",
    "Распредели вес между предплечьями и носками.",
    "Каждая секунда планки — +1 к выносливости.",
    "Последние 10 сек — максимальное напряжение кора.",
  ],
  jumping_jacks: [
    "Мягкая посадка — защита коленей.",
    "Руки полностью над головой в верхней точке.",
    "Держи ритм: раз- два, раз- два.",
    "Корпус прямой, не отклоняйся назад.",
    "Носки слегка наружу при приземлении.",
    "Дыши через нос, не задыхайся.",
    "Ускоряйся на 3-м подходе — кардио-эффект.",
    "Представь, что прыгаешь через верёвку.",
    "Последние 10 прыжков — на полной амплитуде.",
  ],
  burpees: [
    "Плавный переход: присед → планка → прыжок.",
    "Не пропускай прыжок вверх — это 30% упражнения.",
    "В планке — одно отжимание, если есть силы.",
    "Дыши ритмично, не задерживай на планке.",
    "Руки на пол стави сразу под плечи.",
    "Прыжок вверх — руки над головой.",
    "Если устал — шаг назад вместо прыжка в планку.",
    "Темп важнее скорости — не ломай технику.",
    "Финишный подход — представь финиш спринта.",
  ],
};

const SET_PHASE: Record<number, string> = {
  1: "Разогрев подход — техника важнее скорости.",
  2: "Рабочий подход — добавь интенсивности.",
  3: "Финишный подход — дожми до конца!",
};

function hashSeed(...parts: (string | number)[]): number {
  const s = parts.join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickSeeded<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]!;
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
  };

  if (canUseLiveAi(userId)) {
    const ai = await askOpenAi(context, userId);
    if (ai) return ai;
  }

  const seed = hashSeed(userId, todayKey(), user?.total_workouts ?? 0, Date.now() >> 20);
  const text = fillTemplate(pickSeeded(MOCK_MOTIVATION, seed), context);

  return { text, source: "mock" };
}

export async function getWorkoutCoachTip(
  exerciseSlug: string,
  setNumber: number,
  userId?: number
): Promise<AiCoachMessage> {
  const exercise = getExercise(exerciseSlug);

  if (userId !== undefined && canUseLiveAi(userId) && exercise) {
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
                "Ты AI-тренер FitSquad. Короткие уникальные советы на русском, 1-2 предложения, с эмодзи. Не повторяйся.",
            },
            {
              role: "user",
              content: `Упражнение: ${exercise.name}, подход ${setNumber}/${exercise.defaultSets}, userId ${userId ?? 0}. Дай свежий совет по технике или мотивации.`,
            },
          ],
          max_tokens: 100,
          temperature: 0.9,
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

  const tips = EXERCISE_COACH[exerciseSlug] ?? exercise?.tips ?? ["Держите темп!"];
  const seed = hashSeed(exerciseSlug, setNumber, userId ?? 0, todayKey());
  const tip = pickSeeded(tips, seed);
  const phase = SET_PHASE[setNumber] ?? `Подход ${setNumber} — не сбавляй темп.`;

  return {
    text: `💡 ${exercise?.emoji ?? "🏋️"} Подход ${setNumber}: ${tip} ${phase}`,
    source: "mock",
  };
}

async function askOpenAi(
  context: Record<string, string | number>,
  userId: number
): Promise<AiCoachMessage | null> {
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
              "Ты AI-тренер FitSquad. Мотивируй коротко (2-3 предложения), на русском, с эмодзи. Каждый ответ уникален.",
          },
          {
            role: "user",
            content: `userId=${userId}. Пользователь: ${context.name}, команда: ${context.team}, streak: ${context.streak} дн., FS: ${context.fs}. Упражнение: ${context.exercise}. Дай свежую мотивацию.`,
          },
        ],
        max_tokens: 150,
        temperature: 0.85,
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
              content: `Команда «${teamName}»: ${completedCount}/${totalCount} выполнили (${exerciseName}). Короткая уникальная мотивация на русском.`,
            },
          ],
          max_tokens: 120,
          temperature: 0.85,
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

  const templates = [
    "🤝 «{team}»: {done}/{total} уже сделали {exercise}. Остальные — за вами!",
    "🔥 Команда «{team}» на {done}/{total}. Кто следующий?",
    "⚡ {exercise} дня в «{team}» — {done} из {total} на финише!",
    "🏆 «{team}», вместе вы сильнее! {done}/{total} выполнили.",
  ];
  const seed = hashSeed(teamName, exerciseName, todayKey(), completedCount);
  return fillTemplate(pickSeeded(templates, seed), {
    team: teamName,
    exercise: exerciseName,
    done: completedCount,
    total: totalCount,
  });
}
