export interface Exercise {
  slug: string;
  name: string;
  emoji: string;
  category: "strength" | "cardio" | "core";
  description: string;
  defaultReps: number;
  defaultSets: number;
  durationSec?: number;
  tips: string[];
}

export interface UserProfile {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  fsTokens: number;
  streakDays: number;
  totalWorkouts: number;
  lastWorkoutDate: string | null;
}

export interface Team {
  id: string;
  name: string;
  inviteCode: string;
  captainId: number;
  memberCount: number;
  members: TeamMember[];
}

export interface TeamMember {
  userId: number;
  username: string | null;
  firstName: string | null;
  fsTokens: number;
  completedToday: boolean;
}

export interface TeamWorkout {
  id: string;
  teamId: string;
  exerciseSlug: string;
  exercise: Exercise;
  targetReps: number;
  targetSets: number;
  durationSec: number | null;
  workoutDate: string;
  status: "active" | "completed";
  completions: WorkoutCompletion[];
}

export interface WorkoutCompletion {
  userId: number;
  completed: boolean;
  photoVerified: boolean;
  fsEarned: number;
  completedAt: string | null;
}

export interface Achievement {
  type: string;
  label: string;
  emoji: string;
  earnedAt: string;
}

export interface AiCoachMessage {
  text: string;
  source: "mock" | "openai";
}
