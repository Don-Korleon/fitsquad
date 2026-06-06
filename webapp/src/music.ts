export interface MusicTrack {
  id: string;
  title: string;
  url: string;
}

/** Kevin MacLeod (incompetech.com) — CC BY 4.0, стиль экшн-блокбастеров 90-х */
export const WORKOUT_TRACKS: MusicTrack[] = [
  { id: "chase", title: "🎬 Погоня", url: "/music/chase.mp3" },
  { id: "hero", title: "💥 Герой блокбастера", url: "/music/hero.mp3" },
  { id: "showdown", title: "🔫 Финальная разборка", url: "/music/showdown.mp3" },
];

const LEGACY_TRACK_IDS: Record<string, string> = {
  energy: "chase",
  drive: "hero",
  cardio: "showdown",
};

const STORAGE_TRACK = "fitsquad-music-track";
const STORAGE_VOLUME = "fitsquad-music-volume";
const STORAGE_PLAYING = "fitsquad-music-playing";

function resolveTrackId(stored: string | null): string {
  if (!stored) return WORKOUT_TRACKS[0]!.id;
  if (WORKOUT_TRACKS.some((t) => t.id === stored)) return stored;
  return LEGACY_TRACK_IDS[stored] ?? WORKOUT_TRACKS[0]!.id;
}

class WorkoutMusicPlayer {
  private audio: HTMLAudioElement | null = null;
  private trackId = resolveTrackId(localStorage.getItem(STORAGE_TRACK));
  private volume = Number(localStorage.getItem(STORAGE_VOLUME) ?? "0.65");
  private playing = false;

  getTrackId(): string {
    return this.trackId;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getVolume(): number {
    return this.volume;
  }

  setTrack(id: string): void {
    const resolved = resolveTrackId(id);
    if (this.trackId === resolved) return;
    this.trackId = resolved;
    localStorage.setItem(STORAGE_TRACK, this.trackId);
    const wasPlaying = this.playing;
    this.stop();
    if (wasPlaying) void this.play();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem(STORAGE_VOLUME, String(this.volume));
    if (this.audio) this.audio.volume = this.volume;
  }

  async toggle(): Promise<boolean> {
    if (this.playing) {
      this.pause();
      return false;
    }
    await this.play();
    return true;
  }

  async play(): Promise<void> {
    const track = WORKOUT_TRACKS.find((t) => t.id === this.trackId) ?? WORKOUT_TRACKS[0]!;
    this.stopInternal();

    this.audio = new Audio(track.url);
    this.audio.loop = true;
    this.audio.volume = this.volume;
    await this.audio.play();

    this.playing = true;
    localStorage.setItem(STORAGE_PLAYING, "true");
  }

  pause(): void {
    this.stopInternal();
    this.playing = false;
    localStorage.setItem(STORAGE_PLAYING, "false");
  }

  stop(): void {
    this.pause();
  }

  shouldAutoStart(): boolean {
    return localStorage.getItem(STORAGE_PLAYING) === "true";
  }

  private stopInternal(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
  }
}

export const workoutMusic = new WorkoutMusicPlayer();

export function musicPlayerHtml(): string {
  const trackOptions = WORKOUT_TRACKS.map(
    (t) =>
      `<option value="${t.id}"${t.id === workoutMusic.getTrackId() ? " selected" : ""}>${t.title}</option>`
  ).join("");
  const playing = workoutMusic.isPlaying();
  const vol = Math.round(workoutMusic.getVolume() * 100);

  return `
    <div class="music-player card">
      <div class="music-player-row">
        <button type="button" class="music-btn" id="music-toggle" aria-pressed="${playing}">
          ${playing ? "⏸ Пауза" : "▶️ Музыка"}
        </button>
        <select class="music-select" id="music-track" aria-label="Трек">${trackOptions}</select>
      </div>
      <label class="music-volume">
        <span>🔊</span>
        <input type="range" id="music-volume" min="0" max="100" value="${vol}" />
      </label>
      <p class="music-hint">Саундтрек в духе боевиков 90-х · Kevin MacLeod (CC BY 4.0)</p>
    </div>`;
}

export function bindMusicPlayer(): void {
  document.getElementById("music-toggle")?.addEventListener("click", () => {
    void workoutMusic.toggle().then(() => {
      const btn = document.getElementById("music-toggle");
      if (!btn) return;
      const on = workoutMusic.isPlaying();
      btn.textContent = on ? "⏸ Пауза" : "▶️ Музыка";
      btn.setAttribute("aria-pressed", String(on));
    });
  });

  document.getElementById("music-track")?.addEventListener("change", (e) => {
    workoutMusic.setTrack((e.target as HTMLSelectElement).value);
    const btn = document.getElementById("music-toggle");
    if (btn && workoutMusic.isPlaying()) btn.textContent = "⏸ Пауза";
  });

  document.getElementById("music-volume")?.addEventListener("input", (e) => {
    workoutMusic.setVolume(Number((e.target as HTMLInputElement).value) / 100);
  });
}
