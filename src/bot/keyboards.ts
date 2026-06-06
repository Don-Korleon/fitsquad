import { InlineKeyboard, Keyboard } from "grammy";
import { config } from "../config.js";

export function webAppUrl(startParam?: string): string {
  const base = config.webappUrl;
  if (!startParam) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}tgWebAppStartParam=${encodeURIComponent(startParam)}`;
}

function inlineWebApp(kb: InlineKeyboard, label: string, startParam?: string): InlineKeyboard {
  if (config.webappIsHttps) {
    return kb.webApp(label, webAppUrl(startParam));
  }
  return kb.text(label, `webapp:${startParam ?? ""}`);
}

export function mainMenuKeyboard(): Keyboard {
  if (config.webappIsHttps) {
    return new Keyboard()
      .webApp("🏋️ Тренировка", webAppUrl())
      .text("💪 Мотивация")
      .row()
      .text("🤝 Команда")
      .text("📊 Статистика")
      .resized();
  }
  return new Keyboard()
    .text("🤝 Команда")
    .text("📊 Статистика")
    .text("💪 Мотивация")
    .resized();
}

export function teamKeyboard(hasTeam: boolean, isCaptain = false): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (!hasTeam) {
    kb.text("➕ Создать команду", "team:create").row();
    kb.text("🔗 Вступить по коду", "team:join").row();
  } else {
    inlineWebApp(kb, "🏋️ Открыть тренировку", "workout");
    kb.row().text("📋 Участники", "team:members").row();
    if (isCaptain) {
      kb.text("🚪 Выйти", "team:leave");
      kb.text("💥 Расформировать", "team:disband");
    } else {
      kb.text("🚪 Выйти", "team:leave");
    }
  }
  return kb;
}

export function teamConfirmLeaveKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Да, выйти", "team:leave:confirm")
    .text("❌ Отмена", "team:cancel");
}

export function teamConfirmDisbandKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Да, расформировать", "team:disband:confirm")
    .text("❌ Отмена", "team:cancel");
}

export function workoutKeyboard(workoutId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  inlineWebApp(kb, "🏋️ Начать тренировку", `workout_${workoutId}`);
  kb.row().text("💪 Совет AI-тренера", `coach:${workoutId}`);
  return kb;
}

export function musicKeyboard(workoutId?: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  inlineWebApp(kb, "🎵 Открыть тренировку", workoutId ? `workout_${workoutId}` : "workout");
  return kb;
}

export function createTeamNameKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💪 FitSquad", "team:name:FitSquad")
    .text("🔥 Burn Crew", "team:name:Burn Crew")
    .row()
    .text("⚡ Iron Team", "team:name:Iron Team")
    .text("🌟 Dream Team", "team:name:Dream Team");
}
