import type { Exercise } from "../types.js";

export const EXERCISES: Exercise[] = [
  {
    slug: "pushups",
    name: "Отжимания",
    emoji: "💪",
    category: "strength",
    description: "Классические отжимания от пола. Держите корпус прямым.",
    defaultReps: 15,
    defaultSets: 3,
    tips: ["Локти под углом 45°", "Корпус — прямая линия", "Опускайтесь до 90° в локтях"],
    instructionImage: "/exercises/pushups.png",
  },
  {
    slug: "squats",
    name: "Приседания",
    emoji: "🦵",
    category: "strength",
    description: "Приседания с собственным весом. Колени не выходят за носки.",
    defaultReps: 20,
    defaultSets: 3,
    tips: ["Спина прямая", "Бёдра параллельны полу", "Пятки на полу"],
    instructionImage: "/exercises/squats.png",
  },
  {
    slug: "plank",
    name: "Планка",
    emoji: "🧘",
    category: "core",
    description: "Статическая планка на предплечьях.",
    defaultReps: 1,
    defaultSets: 3,
    durationSec: 45,
    tips: ["Не прогибайте поясницу", "Напрягите пресс", "Дышите ровно"],
    instructionImage: "/exercises/plank.png",
  },
  {
    slug: "jumping_jacks",
    name: "Прыжки",
    emoji: "⭐",
    category: "cardio",
    description: "Jumping jacks — прыжки с разведением рук и ног.",
    defaultReps: 30,
    defaultSets: 3,
    tips: ["Мягкая посадка", "Руки над головой", "Держите темп"],
    instructionImage: "/exercises/jumping_jacks.png",
  },
  {
    slug: "burpees",
    name: "Бёрпи",
    emoji: "🔥",
    category: "cardio",
    description: "Полный бёрпи: присед, планка, отжимание, прыжок.",
    defaultReps: 10,
    defaultSets: 3,
    tips: ["Плавный переход между фазами", "Не пропускайте прыжок", "Следите за дыханием"],
    instructionImage: "/exercises/burpees.png",
  },
];

export function getExercise(slug: string): Exercise | undefined {
  return EXERCISES.find((e) => e.slug === slug);
}

export function exerciseInstructionUrl(exercise: Exercise, publicUrl?: string): string {
  const path = exercise.instructionImage;
  if (publicUrl) return `${publicUrl.replace(/\/$/, "")}${path}`;
  return path;
}

export function pickDailyExercise(date = new Date()): Exercise {
  const dayIndex = date.getDate() % EXERCISES.length;
  return EXERCISES[dayIndex]!;
}

/** Первое упражнение дня, которое пользователь ещё не выполнял сегодня */
export function pickExerciseForUser(completedSlugs: string[], date = new Date()): Exercise {
  const start = date.getDate() % EXERCISES.length;
  for (let i = 0; i < EXERCISES.length; i++) {
    const ex = EXERCISES[(start + i) % EXERCISES.length]!;
    if (!completedSlugs.includes(ex.slug)) return ex;
  }
  return EXERCISES[start]!;
}
