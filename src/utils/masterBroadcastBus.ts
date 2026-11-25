import { TVChannel } from '../types/playout';
import { videoGenerator } from '../services/videoGenerator';

export interface PlayoutDeckSnapshot {
  channel: TVChannel;
  activeVideoElement: HTMLVideoElement | null;
  mainVideoElement: HTMLVideoElement | null;
  programVideoElement: HTMLVideoElement | null;
  adVideoElement: HTMLVideoElement | null;
  liveVideoElement: HTMLVideoElement | null;
  overlayVideoElement: HTMLVideoElement | null;
  topOverlayVideoElement: HTMLVideoElement | null;
  lShapeVideoElement: HTMLVideoElement | null;
  cameraStream: MediaStream | null;
}

export interface BroadcastAudioMeterLevels {
  peakDb: number;
  rmsDb: number;
  levelPct: number;
  hasSignal: boolean;
  videoTrackLive: boolean;
  audioTrackLive: boolean;
}

const DISPLAY_RTC_CHANNEL = 'ashoka_playout_display_rtc';

class MasterBroadcastBus {
  private masterCanvas: HTMLCanvasElement | null = null;
  private snapshot: PlayoutDeckSnapshot | null = null;
  private isHostRunning = false;
  private rafId = 0;
  private bgIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastRenderMs = 0;

  // Master Audio Mixer (WebAudio)
  private audioCtx: AudioContext | null = null;
  private audioDest: MediaStreamAudioDestinationNode | null = null;
  private programMixGain: GainNode | null = null;
  private deckMixGain: GainNode | null = null;
  private cameraGain: GainNode | null = null;
  private studioMonitorGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuf: Float32Array<ArrayBuffer> | null = null;

  private connectedTrackIds = new Set<string>();
  private elementSources = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>();

  // Combined Canvas + Audio stream cache
  private canvasStream: MediaStream | null = null;
  private combinedStream: MediaStream | null = null;

  // WebRTC Host peers keyed by viewerId
  private rtcChannel: BroadcastChannel | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private pendingHostCandidates = new Map<string, RTCIceCandidateInit[]>();

  public updateSnapshot(next: PlayoutDeckSnapshot) {
    this.snapshot = next;
    if (this.isHostRunning) {
      this.ensureAudioInputsTapped(next);
      this.syncMasterAudioGain(next.channel);
    }
  }

  public getMasterCanvas(): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    if (!this.masterCanvas) {
      const c = document.createElement('canvas');
      c.width = 1920;
      c.height = 1080;
      this.masterCanvas = c;
    }
    return this.masterCanvas;
  }

  public ensureAudioBus(): MediaStreamAudioDestinationNode | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        const ctx = new AudioCtx({ sampleRate: 48000 });
        const dest = ctx.createMediaStreamDestination();
        const programMix = ctx.createGain();
        const deckMix = ctx.createGain();
        const camGain = ctx.createGain();
        const monitorGain = ctx.createGain();
        const analyser = ctx.createAnalyser();

        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.65;

        programMix.gain.value = 1;
        deckMix.gain.value = 1;
        camGain.gain.value = 1;
        monitorGain.gain.value = 1;

        // Route file/URL video decks -> program output AND control room speakers
        deckMix.connect(programMix);
        deckMix.connect(monitorGain);
        monitorGain.connect(ctx.destination);

        // Route live USB camera / HDMI capture audio -> program output ONLY (no local speaker echo)
        camGain.connect(programMix);

        // Program master -> live VU analyser -> MediaStreamDestination (2nd Display)
        programMix.connect(analyser);
        analyser.connect(dest);

        // Inaudible -82dB carrier keeps MediaRecorder & WebRTC Opus clock locked across silent breaks
        const osc = ctx.createOscillator();
        const carrierGain = ctx.createGain();
        carrierGain.gain.value = 0.00008;
        osc.connect(carrierGain);
        carrierGain.connect(dest);
        osc.start();

        this.audioCtx = ctx;
        this.audioDest = dest;
        this.programMixGain = programMix;
        this.deckMixGain = deckMix;
        this.cameraGain = camGain;
        this.studioMonitorGain = monitorGain;
        this.analyser = analyser;
        this.analyserBuf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      } catch {
        return null;
      }
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioDest;
  }

  public unlockAudio() {
    this.ensureAudioBus();
    const applyUnlock = () => {
      if (!this.snapshot) return;
      const ch = this.snapshot.channel;
      const isChannelMuted = Boolean(ch.transmission?.audio?.muted);
      const softEnabled =
        typeof ch.transmission?.audio?.softwareAudioEnabled === 'boolean'
          ? ch.transmission.audio.softwareAudioEnabled
          : ch.transmission?.audio?.audioOutputTarget !== 'display2';
      const isLiveMuted = Boolean(ch.liveInput?.muted);
      const masterVol = Math.max(0.1, Math.min(1, ch.transmission?.audio?.masterVolume ?? 0.9));

      const nonLiveDecks = [
        this.snapshot.mainVideoElement,
        this.snapshot.programVideoElement,
        this.snapshot.adVideoElement,
      ];
      for (const el of nonLiveDecks) {
        if (el && !(el.srcObject instanceof MediaStream)) {
          const isCaptured = this.elementSources.has(el);
          el.muted = isCaptured ? isChannelMuted : isChannelMuted || !softEnabled;
          el.volume = masterVol;
        }
      }
      const liveEl = this.snapshot.liveVideoElement;
      if (liveEl && !(liveEl.srcObject instanceof MediaStream)) {
        const isCaptured = this.elementSources.has(liveEl);
        liveEl.muted = isCaptured
          ? isChannelMuted || isLiveMuted
          : isChannelMuted || isLiveMuted || !softEnabled;
        liveEl.volume = masterVol;
      }

      if (Boolean(this.combinedStream) || this.peers.size > 0) {
        this.ensureAudioInputsTapped(this.snapshot, true);
      }
      this.syncMasterAudioGain(ch);
    };

    applyUnlock();

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx
        .resume()
        .then(() => {
          applyUnlock();
        })
        .catch(() => {});
    }
  }

  private syncMasterAudioGain(ch: TVChannel) {
    if (!this.audioCtx || !this.programMixGain || !this.deckMixGain || !this.cameraGain || !this.studioMonitorGain) {
      return;
    }
    const isStopped = ch.status === 'STOPPED';
    const isChannelMuted = Boolean(ch.transmission?.audio?.muted);
    const softEnabled =
      typeof ch.transmission?.audio?.softwareAudioEnabled === 'boolean'
        ? ch.transmission.audio.softwareAudioEnabled
        : ch.transmission?.audio?.audioOutputTarget !== 'display2';
    const d2Enabled =
      typeof ch.transmission?.audio?.display2AudioEnabled === 'boolean'
        ? ch.transmission.audio.display2AudioEnabled
        : ch.transmission?.audio?.audioOutputTarget !== 'software';
    const isLiveActive = Boolean(ch.liveInput?.active) && !ch.activeEveryNMinAd && !ch.activeProgramId;
    const isLiveMuted = isLiveActive && Boolean(ch.liveInput?.muted);
    const masterVol = Math.max(0, Math.min(1, ch.transmission?.audio?.masterVolume ?? 0.9));
    const liveVol = isLiveActive
      ? Math.max(0, Math.min(1, (ch.liveInput?.volume ?? 100) / 100))
      : 1;

    const now = this.audioCtx.currentTime;

    if (isStopped || isChannelMuted) {
      this.programMixGain.gain.setTargetAtTime(0, now, 0.015);
      this.studioMonitorGain.gain.setTargetAtTime(0, now, 0.015);
      this.cameraGain.gain.setTargetAtTime(0, now, 0.015);
      return;
    }

    this.programMixGain.gain.setTargetAtTime(!isLiveMuted && d2Enabled ? 1 : 0, now, 0.015);
    this.deckMixGain.gain.setTargetAtTime(1, now, 0.015);
    this.studioMonitorGain.gain.setTargetAtTime(!isLiveMuted && softEnabled ? 1 : 0, now, 0.015);

    const targetCamGain = isLiveActive && !isLiveMuted ? masterVol * liveVol : 0;
    this.cameraGain.gain.setTargetAtTime(targetCamGain, now, 0.015);
  }

  private tapMediaStreamAudio(stream: MediaStream | null | undefined) {
    if (!stream || !this.audioCtx || !this.cameraGain) return;
    const audioTracks = stream.getAudioTracks();
    for (const track of audioTracks) {
      if (track.readyState === 'ended') continue;
      if (this.connectedTrackIds.has(track.id)) continue;
      try {
        const singleAudioStream = new MediaStream([track]);
        const src = this.audioCtx.createMediaStreamSource(singleAudioStream);
        src.connect(this.cameraGain);
        this.connectedTrackIds.add(track.id);
        track.addEventListener(
          'ended',
          () => {
            this.connectedTrackIds.delete(track.id);
            try {
              src.disconnect();
            } catch {}
          },
          { once: true }
        );
      } catch {}
    }
  }

  private tapVideoElementAudio(el: HTMLVideoElement | null) {
    if (!el || !this.audioCtx || !this.deckMixGain) return;

    // Live camera / HDMI streams attached via srcObject are tapped directly via tapMediaStreamAudio
    if (el.srcObject instanceof MediaStream) {
      this.tapMediaStreamAudio(el.srcObject);
      return;
    }

    if (this.elementSources.has(el)) return;

    try {
      const src = this.audioCtx.createMediaElementSource(el);
      src.connect(this.deckMixGain);
      this.elementSources.set(el, src);
    } catch {
      // Element may not yet support attachment or already bound elsewhere
    }
  }

  private ensureAudioInputsTapped(snap: PlayoutDeckSnapshot, forceTap = false) {
    const hasStreamConsumer = forceTap || Boolean(this.combinedStream) || this.peers.size > 0;
    if (!hasStreamConsumer) {
      return;
    }
    this.ensureAudioBus();
    if (!this.audioCtx) return;
    if (this.audioCtx.state !== 'running') {
      return;
    }

    this.tapVideoElementAudio(snap.mainVideoElement);
    this.tapVideoElementAudio(snap.programVideoElement);
    this.tapVideoElementAudio(snap.adVideoElement);
    this.tapVideoElementAudio(snap.liveVideoElement);
    if (snap.cameraStream) {
      this.tapMediaStreamAudio(snap.cameraStream);
    }
  }

  public getAudioMeterLevels(): BroadcastAudioMeterLevels {
    const videoTrackLive = Boolean(
      this.combinedStream?.getVideoTracks().some((t) => t.readyState === 'live')
    );
    const audioTrackLive = Boolean(
      this.combinedStream?.getAudioTracks().some((t) => t.readyState === 'live')
    );

    if (!this.analyser || !this.analyserBuf || !this.audioCtx || this.audioCtx.state !== 'running') {
      return {
        peakDb: -60,
        rmsDb: -60,
        levelPct: 0,
        hasSignal: false,
        videoTrackLive,
        audioTrackLive,
      };
    }

    this.analyser.getFloatTimeDomainData(this.analyserBuf);
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < this.analyserBuf.length; i++) {
      const v = Math.abs(this.analyserBuf[i]);
      if (v > peak) peak = v;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.analyserBuf.length);
    const peakDb = peak > 0.0001 ? Math.max(-60, Math.min(0, 20 * Math.log10(peak))) : -60;
    const rmsDb = rms > 0.0001 ? Math.max(-60, Math.min(0, 20 * Math.log10(rms))) : -60;
    const levelPct = Math.max(0, Math.min(100, Math.round(((rmsDb + 60) / 60) * 100)));

    return {
      peakDb: Math.round(peakDb),
      rmsDb: Math.round(rmsDb),
      levelPct,
      hasSignal: peak > 0.001,
      videoTrackLive,
      audioTrackLive,
    };
  }

  public getMasterBroadcastStream(fps = 60): MediaStream | null {
    const canvas = this.getMasterCanvas();
    if (!canvas || typeof canvas.captureStream !== 'function') return null;

    this.ensureAudioBus();
    if (this.snapshot) {
      this.ensureAudioInputsTapped(this.snapshot, true);
      this.syncMasterAudioGain(this.snapshot.channel);
      // Paint a fresh composite frame immediately so MediaRecorder/WebRTC receives a keyframe right at t = 0
      this.renderCompositeTick(performance.now());
    }

    const hasLiveCanvasVideo =
      this.canvasStream &&
      this.canvasStream.getVideoTracks().some((t) => t.readyState === 'live');
    if (!hasLiveCanvasVideo) {
      this.canvasStream = canvas.captureStream(fps);
    }

    const videoTracks = this.canvasStream!.getVideoTracks();
    const audioTracks = this.audioDest?.stream.getAudioTracks() || [];
    const tracks = [...videoTracks, ...audioTracks];

    if (!this.combinedStream) {
      this.combinedStream = new MediaStream(tracks);
    } else {
      for (const existing of this.combinedStream.getTracks()) {
        if (existing.readyState === 'ended') {
          this.combinedStream.removeTrack(existing);
        }
      }
      const existingIds = new Set(this.combinedStream.getTracks().map((t) => t.id));
      for (const t of tracks) {
        if (!existingIds.has(t.id) && t.readyState === 'live') {
          this.combinedStream.addTrack(t);
        }
      }
    }

    this.ensureCompositorLoopRunning();
    return this.combinedStream;
  }

  private renderCompositeTick(timestamp: number) {
    const canvas = this.getMasterCanvas();
    const snap = this.snapshot;
    if (!canvas || !snap) return;

    const hasActiveVideoTrack = Boolean(
      this.canvasStream && this.canvasStream.getVideoTracks().some((t) => t.readyState === 'live')
    );
    if (!hasActiveVideoTrack && this.peers.size === 0) {
      return;
    }

    this.lastRenderMs = Date.now();
    videoGenerator.renderChannelFrame(
      canvas,
      snap.channel,
      timestamp,
      snap.activeVideoElement,
      snap.overlayVideoElement,
      snap.topOverlayVideoElement,
      snap.lShapeVideoElement
    );
  }

  private hasActiveCompositeConsumer(): boolean {
    const streamLive = Boolean(
      this.combinedStream?.getVideoTracks().some((t) => t.readyState === 'live')
    );
    return this.peers.size > 0 || streamLive;
  }

  private ensureCompositorLoopRunning() {
    if (!this.isHostRunning || !this.hasActiveCompositeConsumer()) return;
    if (!this.rafId) {
      const rafLoop = (ts: number) => {
        if (!this.isHostRunning || !this.hasActiveCompositeConsumer()) {
          this.rafId = 0;
          return;
        }
        this.renderCompositeTick(ts);
        this.rafId = requestAnimationFrame(rafLoop);
      };
      this.rafId = requestAnimationFrame(rafLoop);
    }
    if (!this.bgIntervalId) {
      this.bgIntervalId = setInterval(() => {
        if (!this.isHostRunning || !this.hasActiveCompositeConsumer()) {
          if (this.bgIntervalId) {
            clearInterval(this.bgIntervalId);
            this.bgIntervalId = null;
          }
          return;
        }
        if (Date.now() - this.lastRenderMs > 40) {
          this.renderCompositeTick(performance.now());
        }
      }, 33);
    }
  }

  public startHost() {
    if (this.isHostRunning) return;
    this.isHostRunning = true;
    this.getMasterCanvas();
    this.ensureAudioBus();
    this.setupRtcHostSignaling();
  }

  public stopHost() {
    this.isHostRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.bgIntervalId) {
      clearInterval(this.bgIntervalId);
      this.bgIntervalId = null;
    }
    this.closeAllPeers();
    if (this.rtcChannel) {
      try {
        this.rtcChannel.close();
      } catch {}
      this.rtcChannel = null;
    }
  }

  private closePeer(viewerId: string) {
    const pc = this.peers.get(viewerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.peers.delete(viewerId);
    }
    this.pendingHostCandidates.delete(viewerId);
  }

  private closeAllPeers() {
    for (const viewerId of Array.from(this.peers.keys())) {
      this.closePeer(viewerId);
    }
  }

  private setupRtcHostSignaling() {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    if (this.rtcChannel) {
      try {
        this.rtcChannel.close();
      } catch {}
    }

    const bc = new BroadcastChannel(DISPLAY_RTC_CHANNEL);
    this.rtcChannel = bc;

    bc.onmessage = async (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      const viewerId = String(msg.viewerId || '');
      if (!viewerId) return;

      if (msg.type === 'RTC_REQUEST_OFFER') {
        await this.createOfferForViewer(viewerId);
      } else if (msg.type === 'RTC_ANSWER' && msg.sdp) {
        const pc = this.peers.get(viewerId);
        if (pc && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const queued = this.pendingHostCandidates.get(viewerId) || [];
            this.pendingHostCandidates.delete(viewerId);
            for (const c of queued) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
          } catch {}
        }
      } else if (msg.type === 'RTC_VIEWER_ICE' && msg.candidate) {
        const pc = this.peers.get(viewerId);
        if (pc) {
          if (pc.remoteDescription) {
            pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
          } else {
            const arr = this.pendingHostCandidates.get(viewerId) || [];
            arr.push(msg.candidate);
            this.pendingHostCandidates.set(viewerId, arr);
          }
        }
      } else if (msg.type === 'RTC_VIEWER_CLOSE') {
        this.closePeer(viewerId);
      }
    };

    try {
      bc.postMessage({ type: 'RTC_HOST_READY' });
    } catch {}
  }

  private async createOfferForViewer(viewerId: string) {
    if (!this.rtcChannel || typeof RTCPeerConnection === 'undefined') return;
    this.closePeer(viewerId);

    const stream = this.getMasterBroadcastStream(60);
    if (!stream) return;

    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      this.peers.set(viewerId, pc);
      this.ensureCompositorLoopRunning();

      for (const track of stream.getTracks()) {
        const sender = pc.addTrack(track, stream);
        if (track.kind === 'video' && sender && typeof sender.getParameters === 'function') {
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            params.encodings[0].maxBitrate = 20_000_000;
            params.encodings[0].maxFramerate = 60;
            (params as any).degradationPreference = 'maintain-resolution';
            sender.setParameters(params).catch(() => {});
          } catch {}
        }
      }

      pc.onicecandidate = (e) => {
        if (e.candidate && this.rtcChannel) {
          try {
            this.rtcChannel.postMessage({
              type: 'RTC_HOST_ICE',
              viewerId,
              candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
            });
          } catch {}
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          this.closePeer(viewerId);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.rtcChannel.postMessage({
        type: 'RTC_OFFER',
        viewerId,
        sdp: pc.localDescription?.toJSON ? pc.localDescription.toJSON() : pc.localDescription,
      });
    } catch {
      this.closePeer(viewerId);
    }
  }
}

export const masterBroadcastBus = new MasterBroadcastBus();

/**
 * Connects a 2nd Display window to Window 1's Master Broadcast Bus over zero-buffer local WebRTC.
 * Returns a cleanup function that tears down the peer connection cleanly.
 */
export function connectDisplayStreamReceiver(
  onStream: (stream: MediaStream) => void,
  onDisconnected?: () => void
): () => void {
  if (
    typeof window === 'undefined' ||
    !('BroadcastChannel' in window) ||
    typeof RTCPeerConnection === 'undefined'
  ) {
    return () => {};
  }

  const viewerId = `disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const bc = new BroadcastChannel(DISPLAY_RTC_CHANNEL);
  let pc: RTCPeerConnection | null = null;
  let pendingCandidates: RTCIceCandidateInit[] = [];
  let closed = false;
  let handshakeTimer: ReturnType<typeof setInterval> | null = null;
  let connected = false;

  const cleanupPc = () => {
    if (pc) {
      try {
        pc.close();
      } catch {}
      pc = null;
    }
    pendingCandidates = [];
  };

  const requestOffer = () => {
    if (closed) return;
    try {
      bc.postMessage({ type: 'RTC_REQUEST_OFFER', viewerId });
    } catch {}
  };

  bc.onmessage = async (event) => {
    if (closed) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'RTC_HOST_READY') {
      if (!connected) requestOffer();
      return;
    }

    if (msg.viewerId !== viewerId) return;

    if (msg.type === 'RTC_OFFER' && msg.sdp) {
      cleanupPc();
      try {
        const nextPc = new RTCPeerConnection({ iceServers: [] });
        pc = nextPc;
        const assembledStream = new MediaStream();

        nextPc.ontrack = (e) => {
          const incomingStream = e.streams && e.streams[0];
          if (incomingStream) {
            for (const t of incomingStream.getTracks()) {
              if (!assembledStream.getTracks().some((x) => x.id === t.id)) {
                assembledStream.addTrack(t);
              }
            }
          } else if (e.track) {
            if (!assembledStream.getTracks().some((x) => x.id === e.track.id)) {
              assembledStream.addTrack(e.track);
            }
          }
          connected = true;
          onStream(assembledStream);
        };

        nextPc.onicecandidate = (e) => {
          if (e.candidate && !closed) {
            try {
              bc.postMessage({
                type: 'RTC_VIEWER_ICE',
                viewerId,
                candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
              });
            } catch {}
          }
        };

        nextPc.onconnectionstatechange = () => {
          if (
            nextPc.connectionState === 'disconnected' ||
            nextPc.connectionState === 'failed' ||
            nextPc.connectionState === 'closed'
          ) {
            connected = false;
            if (onDisconnected) onDisconnected();
          }
        };

        await nextPc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        for (const c of pendingCandidates) {
          await nextPc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        pendingCandidates = [];

        const answer = await nextPc.createAnswer();
        await nextPc.setLocalDescription(answer);
        bc.postMessage({
          type: 'RTC_ANSWER',
          viewerId,
          sdp: nextPc.localDescription?.toJSON
            ? nextPc.localDescription.toJSON()
            : nextPc.localDescription,
        });
      } catch {
        cleanupPc();
      }
    } else if (msg.type === 'RTC_HOST_ICE' && msg.candidate) {
      if (pc && pc.remoteDescription) {
        pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
      } else {
        pendingCandidates.push(msg.candidate);
      }
    }
  };

  requestOffer();
  handshakeTimer = setInterval(() => {
    if (!connected && !closed) {
      requestOffer();
    }
  }, 1500);

  return () => {
    closed = true;
    if (handshakeTimer) clearInterval(handshakeTimer);
    try {
      bc.postMessage({ type: 'RTC_VIEWER_CLOSE', viewerId });
    } catch {}
    cleanupPc();
    try {
      bc.close();
    } catch {}
  };
}
