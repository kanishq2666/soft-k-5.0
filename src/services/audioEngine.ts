class BroadcastAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private lfo: OscillatorNode | null = null;
  private isSynthStarted = false;
  private isMuted = false;
  private currentVolume = 0.85;
  private synthEnabled = true;

  public init() {
    if (typeof window === 'undefined') return;
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.ensureSynthNodes();
    } catch {
      // AudioContext may require user interaction first
    }
  }

  private ensureSynthNodes() {
    if (!this.ctx || this.isSynthStarted) return;
    try {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 440;

      this.osc1 = this.ctx.createOscillator();
      this.osc2 = this.ctx.createOscillator();
      this.osc1.type = 'sine';
      this.osc2.type = 'triangle';
      this.osc1.frequency.value = 220; // A3 broadcast warm bed
      this.osc2.frequency.value = 329.63; // E4 fifth interval

      // Subtle modulation so it sounds like a warm broadcast ambient bed
      this.lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      this.lfo.frequency.value = 0.4;
      lfoGain.gain.value = 60;
      this.lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      this.osc1.connect(filter);
      this.osc2.connect(filter);
      filter.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.osc1.start();
      this.osc2.start();
      this.lfo.start();
      this.isSynthStarted = true;
    } catch {
      // Ignore if blocked before gesture
    }
  }

  public resumeContext() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /**
   * Syncs the active channel's audio state & HTMLVideoElement immediately.
   * Plays native <video> audio and provides a warm WebAudio broadcast bed for silent demo clips.
   */
  public syncActiveChannelAudio(
    channelId: number,
    isPlaying: boolean,
    volume: number,
    muted: boolean,
    videoEl?: HTMLVideoElement | null,
    clipUrl?: string
  ) {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    this.isMuted = muted || !isPlaying;

    // 1. Ensure HTMLVideoElement is unmuted and at target volume
    if (videoEl) {
      videoEl.volume = this.currentVolume;
      if (videoEl.muted !== this.isMuted) {
        videoEl.muted = this.isMuted;
      }
      if (isPlaying && videoEl.paused && videoEl.src) {
        videoEl.play().catch(() => {});
      }
    }

    // 2. If playing a built-in silent test video (/videos/ch*.mp4) or standby, play subtle broadcast audio bed
    const isBuiltInSilentClip = !clipUrl || clipUrl.startsWith('/videos/');
    if (this.ctx && this.masterGain) {
      const chords = [
        [220, 329.63], // CH 1 News
        [196, 293.66], // CH 2 Cinema
        [261.63, 392.0], // CH 3 Music
        [174.61, 261.63], // CH 4 Bhakti
        [246.94, 369.99], // CH 5 Regional
        [293.66, 440.0], // CH 6 Sports
      ];
      const pair = chords[(channelId - 1) % chords.length] || chords[0];
      if (this.osc1 && this.osc2) {
        this.osc1.frequency.setTargetAtTime(pair[0], this.ctx.currentTime, 0.1);
        this.osc2.frequency.setTargetAtTime(pair[1], this.ctx.currentTime, 0.1);
      }

      const targetSynthGain =
        !this.isMuted && isPlaying && isBuiltInSilentClip && this.synthEnabled
          ? this.currentVolume * 0.14
          : 0;
      this.masterGain.gain.setTargetAtTime(targetSynthGain, this.ctx.currentTime, 0.08);
    }
  }

  public playTestChime() {
    this.resumeContext();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 - E5 - G5 - C6 broadcast chime
      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.14);
        gain.gain.setValueAtTime(0.001, now + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.15, this.currentVolume * 0.35), now + idx * 0.14 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.45);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.14);
        osc.stop(now + idx * 0.14 + 0.48);
      });
    } catch {
      // Safe fallback
    }
  }

  public setChannelVolume(channelId: number, volume: number, muted: boolean) {
    this.resumeContext();
    this.syncActiveChannelAudio(channelId, true, volume, muted);
  }

  // Calculate dynamic realistic VU level with peak hold and decay
  public getMeterValues(
    channelId: number,
    isPlaying: boolean,
    baseVolume: number,
    muted: boolean
  ): { l: number; r: number } {
    if (!isPlaying || muted || baseVolume === 0) {
      return { l: 0.02, r: 0.02 };
    }
    const t = performance.now() / 1000;
    const freq1 = 2.5 + (channelId % 3) * 0.7;
    const freq2 = 4.1 + (channelId % 4) * 0.9;
    const rawL =
      0.5 + 0.3 * Math.sin(t * freq1) + 0.15 * Math.sin(t * 11.2) + 0.05 * (Math.random() - 0.5);
    const rawR =
      0.5 +
      0.3 * Math.sin(t * freq2 + 0.4) +
      0.15 * Math.sin(t * 9.8) +
      0.05 * (Math.random() - 0.5);

    const l = Math.max(0.05, Math.min(0.98, rawL * baseVolume));
    const r = Math.max(0.05, Math.min(0.98, rawR * baseVolume));
    return { l, r };
  }
}

export const broadcastAudio = new BroadcastAudioEngine();
export const audioEngine = broadcastAudio;
