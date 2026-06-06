interface MeDto {
  firstName?: string;
  fsTokens: number;
  streakDays: number;
  totalWorkouts: number;
  soloMode: boolean;
  trainingMode: "solo" | "team" | null;
  team: { id: string; name: string; inviteCode: string } | null;
  achievements: Array<{ emoji: string; label: string }>;
}

interface WorkoutDto {
  id: string;
  soloMode?: boolean;
  alternativeUsed?: boolean;
  alternativeNote?: string | null;
  exercise: {
    slug: string;
    name: string;
    emoji: string;
    description: string;
    tips: string[];
    instructionImage: string;
  } | null;
  targetReps: number;
  targetSets: number;
  durationSec: number | null;
  completed: boolean;
  photoVerified: boolean;
  teamProgress: { completed: number; total: number };
}

interface TeamDto {
  team: {
    name: string;
    inviteCode: string;
    isCaptain: boolean;
    members: Array<{
      firstName: string | null;
      fsTokens: number;
      completedToday: boolean;
    }>;
    maxSize: number;
  } | null;
}

interface LeaderboardDto {
  leaderboard: Array<{
    rank: number;
    firstName: string | null;
    fsTokens: number;
    streakDays: number;
  }>;
}

import { bindMusicPlayer, musicPlayerHtml, workoutMusic } from "./music.js";

const tg = window.Telegram?.WebApp;
const API_ORIGIN = window.location.origin;
const content = document.getElementById("content")!;
const fsBadge = document.getElementById("fs-badge")!;

let currentTab = "home";
let me: MeDto | null = null;
let workout: WorkoutDto | null = null;
let team: TeamDto["team"] = null;

let timerInterval: ReturnType<typeof setInterval> | null = null;
let timerSeconds = 0;
let currentSet = 1;
let mainButtonHandler: (() => void) | null = null;

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function exerciseInstructionBlock(ex: NonNullable<WorkoutDto["exercise"]>): string {
  const tipsHtml = ex.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  return `
    <img class="exercise-instruction" src="${escapeHtml(ex.instructionImage)}" alt="Инструкция: ${escapeHtml(ex.name)}" loading="lazy" />
    <ul class="exercise-tips">${tipsHtml}</ul>`;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (!(options?.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (tg?.initData) {
    headers["X-Telegram-Init-Data"] = tg.initData;
  }
  const url = path.startsWith("http") ? path : `${API_ORIGIN}${path}`;
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

function setTab(tab: string): void {
  if (currentTab === "workout" && tab !== "workout") {
    workoutMusic.pause();
  }
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((el) => {
    el.classList.toggle("active", (el as HTMLElement).dataset.tab === tab);
  });
  hideMainButton();
  render();
}

function hideMainButton(): void {
  if (!tg) return;
  if (mainButtonHandler) {
    tg.MainButton.offClick(mainButtonHandler);
    mainButtonHandler = null;
  }
  tg.MainButton.hide();
}

function showMainButton(text: string, onClick: () => void): void {
  if (!tg) return;
  hideMainButton();
  tg.MainButton.text = text;
  mainButtonHandler = onClick;
  tg.MainButton.onClick(onClick);
  tg.MainButton.show();
}

function canTrain(m: MeDto): boolean {
  return !!m.team || m.soloMode;
}

async function loadData(): Promise<void> {
  try {
    me = await api<MeDto>("/api/me");
    fsBadge.textContent = `${me.fsTokens} FS`;
  } catch {
    me = null;
    fsBadge.textContent = "Demo";
  }

  if (me && canTrain(me)) {
    try {
      workout = await api<WorkoutDto>("/api/workout/today");
    } catch {
      workout = null;
    }
    if (me.team) {
      try {
        const teamData = await api<TeamDto>("/api/team");
        team = teamData.team;
      } catch {
        team = null;
      }
    } else {
      team = null;
    }
  } else {
    workout = null;
    team = null;
  }
}

function renderHome(): void {
  if (!me) {
    content.innerHTML = `<p class="error">Откройте через Telegram</p>`;
    return;
  }

  if (!canTrain(me)) {
    content.innerHTML = `
      <div class="card">
        <h2>👋 Привет, ${escapeHtml(me.firstName ?? "атлет")}!</h2>
        <p>Тренируйся один или собери команду</p>
        <button type="button" class="btn btn-primary" id="enable-solo-btn">🏃 Solo режим</button>
        <p class="hint" style="margin-top:12px">Или создай команду в боте — /team</p>
      </div>
      <div class="stat-grid">
        <div class="stat"><span class="stat-value">${me.fsTokens}</span><span class="stat-label">FS</span></div>
        <div class="stat"><span class="stat-value">${me.streakDays}</span><span class="stat-label">Streak</span></div>
        <div class="stat"><span class="stat-value">${me.totalWorkouts}</span><span class="stat-label">Тренировок</span></div>
      </div>
    `;
    document.getElementById("enable-solo-btn")?.addEventListener("click", () => void enableSoloMode());
    return;
  }

  const achHtml =
    me.achievements.length > 0
      ? `<div class="achievements">${me.achievements.map((a) => `<span class="ach-pill">${a.emoji} ${escapeHtml(a.label)}</span>`).join("")}</div>`
      : `<p class="empty" style="padding:12px 0">Выполни тренировку для первой ачивки!</p>`;

  const progressPct = workout
    ? Math.round((workout.teamProgress.completed / Math.max(workout.teamProgress.total, 1)) * 100)
    : 0;

  content.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><span class="stat-value">${me.fsTokens}</span><span class="stat-label">FS</span></div>
      <div class="stat"><span class="stat-value">${me.streakDays}</span><span class="stat-label">Streak</span></div>
      <div class="stat"><span class="stat-value">${me.totalWorkouts}</span><span class="stat-label">Тренировок</span></div>
    </div>
    <div class="card">
      <h2>${me.soloMode && !me.team ? "🏃 Solo режим" : `🤝 ${escapeHtml(me.team!.name)}`}</h2>
      ${me.team ? `<p>Код: <b>${me.team.inviteCode}</b></p>` : `<p>Тренируешься один</p>`}
      ${workout && !workout.soloMode ? `<div class="progress-bar"><div class="progress-fill" style="width:${progressPct}%"></div></div>
      <p>${workout.teamProgress.completed}/${workout.teamProgress.total} выполнили сегодня</p>` : ""}
    </div>
    ${
      workout?.exercise
        ? `<div class="card">
        <div class="exercise-hero">
          <span class="exercise-emoji">${workout.exercise.emoji}</span>
          <h2>${escapeHtml(workout.exercise.name)}</h2>
          <p>${workout.completed ? "✅ Выполнено" : "⏳ Ждёт тебя"}</p>
        </div>
        ${exerciseInstructionBlock(workout.exercise)}
      </div>`
        : ""
    }
    <div class="card">
      <h2>🏆 Достижения</h2>
      ${achHtml}
    </div>
  `;

  if (workout && !workout.completed) {
    showMainButton("🏋️ Начать тренировку", () => setTab("workout"));
  }
}

function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function loadCoachTip(): Promise<string> {
  if (!workout) return "";
  try {
    const tip = await api<{ text: string }>(`/api/workout/${workout.id}/coach?set=${currentSet}`);
    return tip.text;
  } catch {
    return workout.exercise?.tips[(currentSet - 1) % (workout.exercise?.tips.length ?? 1)] ?? "";
  }
}

function renderWorkout(): void {
  stopTimer();

  if (!me || !canTrain(me) || !workout?.exercise) {
    content.innerHTML = `<p class="empty">Нет активной тренировки. Включи Solo режим или создай команду в боте.</p>`;
    return;
  }

  if (workout.completed && workout.photoVerified) {
    content.innerHTML = `
      <div class="reward-popup">
        <div class="exercise-emoji">${workout.exercise.emoji}</div>
        <h2>🎉 Всё готово!</h2>
        <p>Тренировка выполнена и фото верифицировано</p>
      </div>
    `;
    return;
  }

  if (workout.completed && !workout.photoVerified) {
    renderPhotoUpload();
    return;
  }

  const ex = workout.exercise;
  const isTimed = !!workout.durationSec;
  const setsDots = Array.from({ length: workout.targetSets }, (_, i) => {
    const n = i + 1;
    let cls = "set-dot";
    if (n < currentSet) cls += " done";
    else if (n === currentSet) cls += " active";
    return `<div class="${cls}">${n}</div>`;
  }).join("");

  content.innerHTML = `
    <div class="card">
      <div class="exercise-hero">
        <span class="exercise-emoji">${ex.emoji}</span>
        <h2>${escapeHtml(ex.name)}</h2>
        <p>${escapeHtml(ex.description)}</p>
      </div>
      ${workout.alternativeNote ? `<p class="hint">${escapeHtml(workout.alternativeNote)}</p>` : ""}
      ${exerciseInstructionBlock(ex)}
      <p style="text-align:center;margin-top:12px">
        ${isTimed ? `⏱ ${workout.durationSec} сек` : `🔢 ${workout.targetReps} повт.`} × ${workout.targetSets} подходов
      </p>
      <div class="sets-bar">${setsDots}</div>
      ${isTimed ? `<div class="timer" id="timer">${formatTime(timerSeconds || workout.durationSec!)}</div>` : ""}
      <div class="coach-tip" id="coach-tip">🤖 Загрузка совета...</div>
    </div>
    ${musicPlayerHtml()}
    <button type="button" class="btn btn-primary" id="set-done-btn">
      ✅ Подход ${currentSet} выполнен
    </button>
  `;

  bindMusicPlayer();

  void loadCoachTip().then((tip) => {
    const el = document.getElementById("coach-tip");
    if (el) el.textContent = tip;
  });

  if (isTimed && !timerInterval) {
    timerSeconds = workout.durationSec!;
    timerInterval = setInterval(() => {
      timerSeconds--;
      const el = document.getElementById("timer");
      if (el) el.textContent = formatTime(Math.max(0, timerSeconds));
      if (timerSeconds <= 0) stopTimer();
    }, 1000);
  }

  document.getElementById("set-done-btn")!.onclick = () => {
    tg?.HapticFeedback.impactOccurred("medium");
    if (currentSet < workout!.targetSets) {
      currentSet++;
      renderWorkout();
    } else {
      void finishWorkout();
    }
  };
}

async function finishWorkout(): Promise<void> {
  if (!workout) return;
  stopTimer();
  workoutMusic.stop();
  content.innerHTML = `<p class="loading">Сохраняем результат...</p>`;

  try {
    const res = await fetch(`${API_ORIGIN}/api/workout/${workout.id}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tg?.initData ? { "X-Telegram-Init-Data": tg.initData } : {}),
      },
    });

    if (res.status === 409) {
      await loadData();
      currentSet = 1;
      renderWorkout();
      tg?.showAlert("Это упражнение уже было сегодня — показано другое");
      return;
    }

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const result = (await res.json()) as {
      reward: { totalFs: number; streakDays: number; newAchievements: Array<{ emoji: string; label: string }> };
      teamBonus: number;
      allTeamCompleted: boolean;
      alreadyCompleted?: boolean;
    };

    if (result.alreadyCompleted) {
      workout.completed = true;
      renderWorkout();
      return;
    }

    workout.completed = true;
    me = await api<MeDto>("/api/me");
    fsBadge.textContent = `${me.fsTokens} FS`;

    let html = `
      <div class="reward-popup">
        <div class="reward-fs">+${result.reward.totalFs} FS 💎</div>
        <p>🔥 Streak: ${result.reward.streakDays} дн.</p>
    `;
    if (result.reward.newAchievements.length) {
      html += `<div class="achievements">${result.reward.newAchievements.map((a) => `<span class="ach-pill">${a.emoji} ${escapeHtml(a.label)}</span>`).join("")}</div>`;
    }
    if (result.allTeamCompleted) {
      html += `<p>🤝 Вся команда выполнила! +${result.teamBonus} FS каждому</p>`;
    }
    html += `<p style="margin-top:16px">📸 Загрузите фото для верификации (+15 FS)</p></div>`;
    content.innerHTML = html;

    showMainButton("📸 Загрузить фото", () => renderPhotoUpload());
  } catch {
    content.innerHTML = `<p class="error">Ошибка сохранения. Попробуйте снова.</p>`;
  }
}

function renderPhotoUpload(): void {
  hideMainButton();
  content.innerHTML = `
    <div class="card">
      <h2>📸 Верификация</h2>
      <p>Загрузите фото с тренировки для +15 FS</p>
      <label class="upload-zone" id="upload-zone">
        <input type="file" id="photo-input" accept="image/*" capture="environment" />
        <p>Нажмите для выбора фото</p>
      </label>
      <p id="upload-status" class="hint" style="margin-top:12px;text-align:center"></p>
    </div>
    <p class="empty">Или отправьте фото боту в чат</p>
  `;

  const input = document.getElementById("photo-input") as HTMLInputElement;
  input.onchange = () => void uploadPhoto(input.files?.[0]);
}

async function uploadPhoto(file: File | undefined): Promise<void> {
  if (!file || !workout) return;
  const status = document.getElementById("upload-status")!;
  status.textContent = "Проверяем фото...";

  const form = new FormData();
  form.append("photo", file);

  try {
    const result = await api<{ verified: boolean; fsBonus: number; reason: string }>(
      `/api/workout/${workout.id}/verify`,
      { method: "POST", body: form }
    );
    workout.photoVerified = true;
    me = await api<MeDto>("/api/me");
    fsBadge.textContent = `${me.fsTokens} FS`;
    status.textContent = `✅ ${result.reason} (+${result.fsBonus} FS)`;
    tg?.HapticFeedback.impactOccurred("heavy");
    setTimeout(() => renderWorkout(), 1500);
  } catch (e) {
    status.textContent = `❌ ${e instanceof Error ? e.message : "Ошибка"}`;
  }
}

async function enableSoloMode(): Promise<void> {
  try {
    await api("/api/solo/enable", { method: "POST" });
    await loadData();
    render();
    tg?.showAlert("🏃 Solo режим включён!");
  } catch (e) {
    tg?.showAlert(e instanceof Error ? e.message : "Не удалось включить Solo режим");
  }
}

async function disableSoloMode(): Promise<void> {
  try {
    await api("/api/solo/disable", { method: "POST" });
    workout = null;
    await loadData();
    render();
    tg?.showAlert("Solo режим выключен");
  } catch (e) {
    tg?.showAlert(e instanceof Error ? e.message : "Ошибка");
  }
}

async function renderTeam(): Promise<void> {
  if (!team) {
    if (me?.soloMode) {
      content.innerHTML = `
        <div class="card">
          <h2>🏃 Solo режим</h2>
          <p>Тренируешься один — без команды и кодов приглашения.</p>
          <p>FS, streak и ачивки работают как обычно.</p>
          <button type="button" class="btn btn-secondary" id="disable-solo-btn">❌ Выключить Solo</button>
          <p class="hint">Чтобы играть в команде — выключи Solo и используй /team в боте</p>
        </div>
      `;
      document.getElementById("disable-solo-btn")?.addEventListener("click", () => void disableSoloMode());
      return;
    }
    content.innerHTML = `
      <div class="card">
        <p class="empty">Нет команды</p>
        <button type="button" class="btn btn-primary" id="enable-solo-team-btn">🏃 Solo режим</button>
        <p class="hint" style="margin-top:12px">Или /team в боте — создать или вступить в команду</p>
      </div>
    `;
    document.getElementById("enable-solo-team-btn")?.addEventListener("click", () => void enableSoloMode());
    return;
  }

  let leaderboard: LeaderboardDto["leaderboard"] = [];
  try {
    const lb = await api<LeaderboardDto>("/api/leaderboard");
    leaderboard = lb.leaderboard;
  } catch {
    /* optional */
  }

  const membersHtml = team.members
    .map(
      (m) => `
    <div class="member-row">
      <span class="member-name">${escapeHtml(m.firstName ?? "Участник")}<span class="status-icon">${m.completedToday ? "✅" : "⏳"}</span></span>
      <span class="member-fs">${m.fsTokens} FS</span>
    </div>`
    )
    .join("");

  const lbHtml =
    leaderboard.length > 0
      ? `<div class="card"><h2>🏆 Лидерборд</h2>${leaderboard
          .map(
            (m) =>
              `<div class="member-row"><span>#${m.rank} ${escapeHtml(m.firstName ?? "—")}</span><span class="member-fs">${m.fsTokens} FS · 🔥${m.streakDays}</span></div>`
          )
          .join("")}</div>`
      : "";

  const leaveHint = team.isCaptain
    ? team.members.length > 1
      ? "При выходе капитанство передаётся другому участнику."
      : "Вы единственный участник — команда будет удалена."
    : "";

  const captainActions = team.isCaptain
    ? `<button type="button" class="btn btn-danger" id="btn-disband">💥 Расформировать команду</button>`
    : "";

  content.innerHTML = `
    <div class="card">
      <h2>🤝 ${escapeHtml(team.name)}</h2>
      <p>Код: <b>${team.inviteCode}</b> · ${team.members.length}/${team.maxSize}</p>
    </div>
    <div class="card">
      <h2>Участники</h2>
      ${membersHtml}
    </div>
    ${lbHtml}
    <div class="card" id="team-actions">
      <button type="button" class="btn btn-secondary" id="btn-leave">🚪 Выйти из команды</button>
      ${captainActions}
      ${leaveHint ? `<p class="hint">${leaveHint}</p>` : ""}
    </div>
    <div class="card hidden" id="team-confirm"></div>
  `;

  document.getElementById("btn-leave")?.addEventListener("click", () => showLeaveConfirm());
  document.getElementById("btn-disband")?.addEventListener("click", () => showDisbandConfirm());
}

function showLeaveConfirm(): void {
  const box = document.getElementById("team-confirm");
  if (!box || !team) return;
  box.classList.remove("hidden");
  box.innerHTML = `
    <h2>🚪 Выйти из команды?</h2>
    <p>${team.isCaptain && team.members.length > 1 ? "Капитанство будет передано другому участнику." : team.isCaptain ? "Команда будет удалена." : `Покинуть «${escapeHtml(team.name)}»?`}</p>
    <button type="button" class="btn btn-secondary" id="confirm-leave">Подтвердить выход</button>
    <button type="button" class="btn btn-primary" id="cancel-team-action">Отмена</button>
  `;
  document.getElementById("confirm-leave")?.addEventListener("click", () => void confirmLeave());
  document.getElementById("cancel-team-action")?.addEventListener("click", () => {
    box.classList.add("hidden");
    box.innerHTML = "";
  });
}

function showDisbandConfirm(): void {
  const box = document.getElementById("team-confirm");
  if (!box || !team) return;
  box.classList.remove("hidden");
  box.innerHTML = `
    <h2>💥 Расформировать команду?</h2>
    <p>Все участники будут удалены. Это нельзя отменить.</p>
    <button type="button" class="btn btn-danger" id="confirm-disband">Расформировать</button>
    <button type="button" class="btn btn-primary" id="cancel-team-action">Отмена</button>
  `;
  document.getElementById("confirm-disband")?.addEventListener("click", () => void confirmDisband());
  document.getElementById("cancel-team-action")?.addEventListener("click", () => {
    box.classList.add("hidden");
    box.innerHTML = "";
  });
}

async function confirmLeave(): Promise<void> {
  const box = document.getElementById("team-confirm");
  try {
    const result = await api<{ ok: boolean; error?: string; disbanded?: boolean; teamName?: string }>(
      "/api/team/leave",
      { method: "POST" }
    );
    if (!result.ok) {
      if (box) box.innerHTML = `<p class="error">${escapeHtml(result.error ?? "Ошибка")}</p>`;
      return;
    }
    await loadData();
    if (me?.team) {
      void renderTeam();
    } else {
      currentTab = "home";
      document.querySelectorAll(".tab").forEach((el) => el.classList.remove("active"));
      document.querySelector('[data-tab="home"]')?.classList.add("active");
      render();
    }
    tg?.showAlert(result.disbanded ? `Команда «${result.teamName}» расформирована` : "Вы вышли из команды");
  } catch (e) {
    if (box) box.innerHTML = `<p class="error">${escapeHtml(e instanceof Error ? e.message : "Ошибка")}</p>`;
  }
}

async function confirmDisband(): Promise<void> {
  const box = document.getElementById("team-confirm");
  try {
    const result = await api<{ ok: boolean; error?: string; teamName?: string }>(
      "/api/team/disband",
      { method: "POST" }
    );
    if (!result.ok) {
      if (box) box.innerHTML = `<p class="error">${escapeHtml(result.error ?? "Ошибка")}</p>`;
      return;
    }
    await loadData();
    currentTab = "home";
    document.querySelectorAll(".tab").forEach((el) => el.classList.remove("active"));
    document.querySelector('[data-tab="home"]')?.classList.add("active");
    render();
    tg?.showAlert(`Команда «${result.teamName}» расформирована`);
  } catch (e) {
    if (box) box.innerHTML = `<p class="error">${escapeHtml(e instanceof Error ? e.message : "Ошибка")}</p>`;
  }
}

function render(): void {
  switch (currentTab) {
    case "workout":
      renderWorkout();
      break;
    case "team":
      void renderTeam();
      break;
    default:
      renderHome();
  }
}

async function init(): Promise<void> {
  tg?.ready();
  tg?.expand();

  document.querySelectorAll(".tab").forEach((el) => {
    el.addEventListener("click", () => {
      const tab = (el as HTMLElement).dataset.tab;
      if (tab) setTab(tab);
    });
  });

  const startParam = tg?.initDataUnsafe?.start_param;
  if (startParam?.startsWith("workout")) {
    currentTab = "workout";
    document.querySelector('[data-tab="workout"]')?.classList.add("active");
    document.querySelector('[data-tab="home"]')?.classList.remove("active");
  }

  await loadData();
  render();
}

init();
