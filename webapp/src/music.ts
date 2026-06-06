export interface MusicTrack {
  id: string;
  title: string;
  /** MP3 path or empty for Web Audio synth */
  url?: string;
  synth?: "drive" | "cardio";
}

export const WORKOUT_TRACKS: MusicTrack[] = [
  { id: "energy", title: "🔥 Rock Energy", url: "/music/energy.mp3" },
  { id: "drive", title: "💪 Beat Mode", synth: "drive" },
  { id: "cardio", title: "⚡ Cardio Rush", synth: "cardio" },
];

const STORAGE_TRACK = "fitsquad-music-track";
const STORAGE_VOLUME = "fitsquad-music-volume";
const STORAGE_PLAYING = "fitsquad-music-playing";

class SynthLoop {
  private ctx: AudioContext;
  private master: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;

  constructor(ctx: AudioContext, master: GainNode, private style: "drive" | "cardio") {
    this.ctx = ctx;
    this.master = master;
  }

  start(): void {
    const bpm = this.style === "drive" ? 128 : 145;
    const intervalMs = (60_000 / bpm / 4);
    this.timer = setInterval(() => this.tick(bpm), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.step = 0;
  }

  private tick(_bpm: number): void {
    const t = this.ctx.currentTime;
    const beat = this.step % 16;
    this.step++;

    if (beat % 4 === 0) this.kick(t);
    if (beat % 8 === 4) this.kick(t, 0.55);
    if (beat % 2 === 1) this.hihat(t, 0.08);

    if (this.style === "drive" && beat % 4 === 0) {
      this.bass(t, [55, 65.41, 73.42, 82.41][Math.floor(beat / 4) % 4]!);
    }
    if (this.style === "cardio") {
      if (beat % 4 === 0) this.bass(t, 110);
      if (beat % 8 === 0) this.stab(t, 440);
      if (beat % 8 === 4) this.stab(t, 554.37);
    }
  }

  private kick(t: number, gain = 0.9): void {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  private hihat(t: number, gain: number): void {
    const len = Math.floor(this.ctx.sampleRate * 0.04);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0)!;
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    src.connect(hp).connect(g).connect(this.master);
    src.start(t);
  }

  private bass(t: number, freq: number): void {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private stab(t: number, freq: number): void {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.09);
  }
}

class WorkoutMusicPlayer {
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private synth: SynthLoop | null = null;
  private trackId = localStorage.getItem(STORAGE_TRACK) ?? WORKOUT_TRACKS[0]!.id;
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
    if (this.trackId === id) return;
    this.trackId = id;
    localStorage.setItem(STORAGE_TRACK, id);
    const wasPlaying = this.playing;
    this.stop();
    if (wasPlaying) void this.play();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem(STORAGE_VOLUME, String(this.volume));
    if (this.audio) this.audio.volume = this.volume;
    if (this.masterGain) this.masterGain.gain.value = this.volume * 0.85;
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

    if (track.url) {
      this.audio = new Audio(track.url);
      this.audio.loop = true;
      this.audio.volume = this.volume;
      await this.audio.play();
    } else if (track.synth) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume * 0.85;
      this.masterGain.connect(this.ctx.destination);
      this.synth = new SynthLoop(this.ctx, this.masterGain, track.synth);
      this.synth.start();
    }

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
    if (this.synth) {
      this.synth.stop();
      this.synth = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
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
      <p class="music-hint">Включи перед первым подходом. Rock Energy — SoundHelix (CC BY-SA)</p>
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
