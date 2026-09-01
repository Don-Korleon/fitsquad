import { describe, expect, it } from "vitest";
import { EXERCISES, getExercise, pickDailyExercise, pickExerciseForUser } from "./exercises.js";

describe("getExercise", () => {
  it("finds an exercise by slug", () => {
    expect(getExercise("pushups")?.name).toBe("Отжимания");
  });

  it("returns undefined for an unknown slug", () => {
    expect(getExercise("does-not-exist")).toBeUndefined();
  });
});

describe("pickDailyExercise", () => {
  it("is deterministic for a given date", () => {
    const date = new Date("2026-03-15T00:00:00Z");
    expect(pickDailyExercise(date).slug).toBe(pickDailyExercise(date).slug);
  });

  it("cycles through all exercises across a month", () => {
    const seen = new Set<string>();
    for (let day = 1; day <= EXERCISES.length; day++) {
      seen.add(pickDailyExercise(new Date(2026, 2, day)).slug);
    }
    expect(seen.size).toBe(EXERCISES.length);
  });
});

describe("pickExerciseForUser", () => {
  it("returns an exercise not already completed today", () => {
    const date = new Date("2026-03-15T00:00:00Z");
    const daily = pickDailyExercise(date);
    const alt = pickExerciseForUser([daily.slug], date);
    expect(alt.slug).not.toBe(daily.slug);
  });

  it("falls back to the starting exercise when everything is completed", () => {
    const date = new Date("2026-03-15T00:00:00Z");
    const allSlugs = EXERCISES.map((e) => e.slug);
    const result = pickExerciseForUser(allSlugs, date);
    expect(EXERCISES.map((e) => e.slug)).toContain(result.slug);
  });
});
