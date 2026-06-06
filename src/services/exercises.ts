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
  },
];

export function getExercise(slug: string): Exercise | undefined {
  return EXERCISES.find((e) => e.slug === slug);
}

export function pickDailyExercise(date = new Date()): Exercise {
  const dayIndex = date.getDate() % EXERCISES.length;
  return EXERCISES[dayIndex]!;
}
