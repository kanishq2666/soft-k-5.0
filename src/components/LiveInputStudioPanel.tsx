import React, { useState, useEffect, useRef } from 'react';
import {
  Radio,
  Video,
  Youtube,
  Play,
  Square,
  Save,
  CheckCircle2,
  Clock,
  Volume2,
  VolumeX,
  RefreshCw,
  Plus,
  Trash2,
  SkipBack,
  SkipForward,
  Repeat,
  ArrowUp,
  ArrowDown,
  ListVideo,
  Check,
  Loader2,
} from 'lucide-react';
import {
  TVChannel,
  LiveInputConfig,
  LiveInputSourceType,
  YouTubeQueueItem,
} from '../types/playout';
import {
  advanceYouTubeQueueIndex,
  buildImmediateYouTubeQueueFromText,
  getActiveYouTubeQueueItem,
  isSupportedM3u8LiveUrl,
  parseYouTubeBatchInput,
  toggleYouTubeQueueItemEnabled,
} from '../utils/youtubeLive';

interface LiveInputStudioPanelProps {
  channel: TVChannel;
  onUpdateLiveInput: (partial: Partial<LiveInputConfig>) => void;
  onStartCameraCapture: (deviceId?: string) => void;
  onStopLiveInput: () => void;
  everyNMinEnabled: boolean;
  everyNMinInterval: number;
  onChangeEveryNMin?: (enabled: boolean, intervalMin: number) => void;
  onUpdateLShape?: (partial: Record<string, any>) => void;
  onUpdateGraphics?: (partial: Record<string, any>) => void;
  onSaveChannel?: () => void;
  activeStream?: MediaStream | null;
}

type SourceTabType = 'm3u8' | 'camera' | 'youtube';

function resolveTabFromSourceType(sourceType?: LiveInputSourceType): SourceTabType {
  if (sourceType === 'camera') return 'camera';
  if (sourceType === 'youtube') return 'youtube';
  return 'm3u8';
}

export const LiveInputStudioPanel: React.FC<LiveInputStudioPanelProps> = ({
  channel,
  onUpdateLiveInput,
  onStartCameraCapture,
  onStopLiveInput,
  everyNMinEnabled,
  everyNMinInterval,
  onChangeEveryNMin,
  onUpdateLShape,
  onUpdateGraphics,
  onSaveChannel,
  activeStream,
}) => {
  const live: LiveInputConfig = channel.liveInput || {
    active: false,
    sourceType: 'm3u8',
    streamUrl: '',
    playEveryMinAdsOnLive: true,
    volume: 100,
    muted: false,
    youtubeQueue: [],
    youtubeQueueIndex: 0,
    youtubeLoop: true,
  };

  const [selectedTab, setSelectedTab] = useState<SourceTabType>(
    resolveTabFromSourceType(live.sourceType)
  );
  const [m3u8Input, setM3u8Input] = useState(live.streamUrl || '');
  const [ytInput, setYtInput] = useState(live.youtubeInputText || '');
  const [ytResolving, setYtResolving] = useState(false);
  const [ytStatusMsg, setYtStatusMsg] = useState<string>('');
  const [ytErrorMsg, setYtErrorMsg] = useState<string>('');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(live.cameraDeviceId || '');
  const [savedToast, setSavedToast] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const ytQueue: YouTubeQueueItem[] = Array.isArray(live.youtubeQueue) ? live.youtubeQueue : [];
  const ytLoop = live.youtubeLoop !== false;
  const { item: activeYtItem, index: activeYtIndex } = getActiveYouTubeQueueItem(
    ytQueue,
    live.youtubeQueueIndex || 0
  );

  useEffect(() => {
    setSelectedTab(resolveTabFromSourceType(live.sourceType));
  }, [live.sourceType]);

  useEffect(() => {
    const el = previewVideoRef.current;
    if (!el) return;
    if (live.active && live.sourceType === 'camera' && activeStream) {
      if (el.srcObject !== activeStream) {
        el.srcObject = activeStream;
      }
      el.muted = true;
      el.play().catch(() => {});
    } else if (el.srcObject) {
      el.srcObject = null;
    }
  }, [live.active, live.sourceType, activeStream, selectedTab]);

  useEffect(() => {
    if (live.streamUrl && !m3u8Input) setM3u8Input(live.streamUrl);
  }, [live.streamUrl]);

  useEffect(() => {
    if (live.youtubeInputText && !ytInput) setYtInput(live.youtubeInputText);
  }, [live.youtubeInputText]);

  const refreshCameraDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const vids = list.filter((d) => d.kind === 'videoinput');
      setVideoDevices(vids);
      if (vids.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(vids[0].deviceId);
      }
    } catch {}
  };

  useEffect(() => {
    refreshCameraDevices();
  }, []);

  const [streamErrorMsg, setStreamErrorMsg] = useState<string>('');

  // Start M3U8 / HLS Live Stream on Live Output (RTMP removed)
  const handleStartStreamLive = () => {
    setStreamErrorMsg('');
    const check = isSupportedM3u8LiveUrl(m3u8Input);
    if (check.isRejectedRtmp) {
      setStreamErrorMsg('RTMP/RTSP links are disabled. Please enter a valid .m3u8 HLS broadcast URL.');
      return;
    }
    if (!check.valid || !check.normalizedUrl) {
      setStreamErrorMsg('Enter a valid http(s)://...m3u8 live stream URL.');
      return;
    }
    if (check.normalizedUrl !== m3u8Input) {
      setM3u8Input(check.normalizedUrl);
    }
    onUpdateLiveInput({
      active: true,
      sourceType: 'm3u8',
      streamUrl: check.normalizedUrl,
    });
  };

  // Start / Load YouTube Video, Live, or Batch Playlist immediately
  const handleResolveAndPlayYouTube = async (mode: 'replace_and_play' | 'append_to_queue') => {
    const rawText = ytInput.trim();
    setYtErrorMsg('');
    setYtStatusMsg('');

    // If user clicks Start YouTube Stream when queue already has enabled items and input box is empty
    if (!rawText) {
      if (ytQueue.length > 0) {
        const activeResolved = getActiveYouTubeQueueItem(ytQueue, live.youtubeQueueIndex || 0);
        if (!activeResolved.item) {
          setYtErrorMsg('Enable at least one YouTube item in the playlist to play.');
          return;
        }
        onUpdateLiveInput({
          active: true,
          sourceType: 'youtube',
          youtubeQueue: ytQueue,
          youtubeQueueIndex: activeResolved.index,
          youtubeLoop: ytLoop,
          youtubeCycle: Date.now(),
        });
        return;
      }
      setYtErrorMsg('Paste a YouTube Video, Live Stream, Playlist link, or multiple links.');
      return;
    }

    const parsed = parseYouTubeBatchInput(rawText);
    const immediateDirectItems = buildImmediateYouTubeQueueFromText(rawText);
    const needsBackendExpand = parsed.tokens.some(
      (t) => t.kind === 'playlist' || t.kind === 'channel_live' || t.kind === 'video'
    );

    if (parsed.tokens.length === 0) {
      setYtErrorMsg('No valid YouTube URL or Video ID found. Paste youtube.com or youtu.be links.');
      return;
    }

    // Put direct videos ON AIR immediately while backend resolves playlist items & titles
    let initialQueue: YouTubeQueueItem[] = ytQueue;
    if (immediateDirectItems.length > 0 && mode === 'replace_and_play') {
      initialQueue = immediateDirectItems;
      onUpdateLiveInput({
        active: true,
        sourceType: 'youtube',
        youtubeInputText: rawText,
        youtubeQueue: immediateDirectItems,
        youtubeQueueIndex: 0,
        youtubeLoop: ytLoop,
        youtubeCycle: Date.now(),
      });
    } else if (immediateDirectItems.length > 0 && mode === 'append_to_queue') {
      const existingIds = new Set(ytQueue.map((q) => q.videoId));
      const newOnes = immediateDirectItems.filter((q) => q.videoId && !existingIds.has(q.videoId));
      initialQueue = [...ytQueue, ...newOnes];
      onUpdateLiveInput({
        youtubeInputText: rawText,
        youtubeQueue: initialQueue,
      });
    }

    if (!needsBackendExpand) return;

    setYtResolving(true);
    try {
      const resp = await fetch('/api/live/youtube/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputText: rawText }),
      });
      const data = await resp.json().catch(() => null);
      const serverItems: YouTubeQueueItem[] = Array.isArray(data?.items) ? data.items : [];

      if (serverItems.length > 0) {
        let finalQueue: YouTubeQueueItem[];
        if (mode === 'append_to_queue') {
          const mergedMap = new Map<string, YouTubeQueueItem>();
          ytQueue.forEach((it) => {
            if (it.videoId) mergedMap.set(it.videoId, it);
          });
          serverItems.forEach((it) => {
            if (it.videoId) {
              const prev = mergedMap.get(it.videoId);
              mergedMap.set(it.videoId, prev ? { ...prev, title: it.title || prev.title } : it);
            }
          });
          finalQueue = Array.from(mergedMap.values());
        } else {
          finalQueue = serverItems;
        }

        const shouldGoLive = mode === 'replace_and_play' || live.active;
        const startIdx =
          mode === 'replace_and_play'
            ? 0
            : Math.max(0, Math.min(finalQueue.length - 1, live.youtubeQueueIndex || 0));

        onUpdateLiveInput({
          ...(shouldGoLive ? { active: true, sourceType: 'youtube' as const } : {}),
          youtubeInputText: rawText,
          youtubeQueue: finalQueue,
          youtubeQueueIndex: startIdx,
          youtubeLoop: ytLoop,
          ...(mode === 'replace_and_play' ? { youtubeCycle: Date.now() } : {}),
        });
        setYtStatusMsg(
          `Loaded ${finalQueue.length} YouTube item${finalQueue.length === 1 ? '' : 's'} into Live Playlist.`
        );
      } else if (immediateDirectItems.length === 0) {
        setYtErrorMsg(
          'Could not extract videos from that playlist/channel link. Paste individual watch/live URLs directly.'
        );
      }
    } catch {
      if (immediateDirectItems.length === 0) {
        setYtErrorMsg('Unable to resolve playlist link. Paste direct YouTube video or live URLs.');
      }
    } finally {
      setYtResolving(false);
    }
  };

  const handlePlayQueueItemAt = (index: number) => {
    const target = ytQueue[index];
    if (!target) return;
    const nextQueue =
      target.enabled === false
        ? ytQueue.map((it, idx) => (idx === index ? { ...it, enabled: true } : it))
        : ytQueue;
    onUpdateLiveInput({
      active: true,
      sourceType: 'youtube',
      youtubeQueue: nextQueue,
      youtubeQueueIndex: index,
      youtubeLoop: ytLoop,
      youtubeCycle: Date.now(),
    });
  };

  const handleToggleItemEnabled = (itemId: string) => {
    const result = toggleYouTubeQueueItemEnabled(ytQueue, live.youtubeQueueIndex || 0, itemId);
    onUpdateLiveInput({
      youtubeQueue: result.queue,
      youtubeQueueIndex: result.nextIndex,
      ...(live.active && live.sourceType === 'youtube' && !result.hasEnabledItems
        ? { active: false }
        : {}),
      youtubeCycle: Date.now(),
    });
  };

  const handleRemoveQueueItem = (itemId: string) => {
    const remaining = ytQueue.filter((it) => it.id !== itemId);
    const activeAfter = getActiveYouTubeQueueItem(remaining, live.youtubeQueueIndex || 0);
    onUpdateLiveInput({
      youtubeQueue: remaining,
      youtubeQueueIndex: activeAfter.index >= 0 ? activeAfter.index : 0,
      ...(live.active && live.sourceType === 'youtube' && !activeAfter.item
        ? { active: false }
        : {}),
      youtubeCycle: Date.now(),
    });
  };

  const handleMoveQueueItem = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= ytQueue.length) return;
    const copy = [...ytQueue];
    const [moved] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, moved);
    let nextActiveIdx = live.youtubeQueueIndex || 0;
    if (nextActiveIdx === idx) nextActiveIdx = targetIdx;
    else if (nextActiveIdx === targetIdx) nextActiveIdx = idx;
    onUpdateLiveInput({
      youtubeQueue: copy,
      youtubeQueueIndex: nextActiveIdx,
    });
  };

  const handleNextYouTubeItem = () => {
    const step = advanceYouTubeQueueIndex(ytQueue, live.youtubeQueueIndex || 0, true);
    if (step.shouldStop) return;
    onUpdateLiveInput({
      active: true,
      sourceType: 'youtube',
      youtubeQueueIndex: step.nextIndex,
      youtubeCycle: Date.now(),
    });
  };

  const handlePrevYouTubeItem = () => {
    const enabledIndices = ytQueue
      .map((it, idx) => (it && it.enabled !== false && Boolean(it.videoId) ? idx : -1))
      .filter((i) => i >= 0);
    if (enabledIndices.length === 0) return;
    const cur = live.youtubeQueueIndex || 0;
    const prevIndices = enabledIndices.filter((i) => i < cur);
    const targetIdx =
      prevIndices.length > 0
        ? prevIndices[prevIndices.length - 1]
        : enabledIndices[enabledIndices.length - 1];
    onUpdateLiveInput({
      active: true,
      sourceType: 'youtube',
      youtubeQueueIndex: targetIdx,
      youtubeCycle: Date.now(),
    });
  };

  const handleTriggerSave = () => {
    if (onSaveChannel) onSaveChannel();
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  const playAdsOnLive = live.playEveryMinAdsOnLive !== false;
  const enabledYtCount = ytQueue.filter((q) => q.enabled !== false).length;

  return (
    <div className="bg-[#090d14] border border-[#1a2232] rounded-lg p-3.5 space-y-3.5 text-xs font-sans text-white">
      {/* Top Status & Save Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#1b2436]">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              live.active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
            }`}
          />
          <div>
            <div className="text-xs font-bold text-white uppercase tracking-wide flex items-center gap-2">
              <span>LIVE INPUT STUDIO (M3U8 HLS • USB CAPTURE • YOUTUBE VIDEO / PLAYLIST)</span>
              {live.active && (
                <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-mono font-black">
                  LIVE ON AIR ({live.sourceType.toUpperCase()})
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400">
              All CG Overlays, Top/Bottom Banners, Logos, L-Shape &amp; Tickers render live on top
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {live.active && (
            <button
              type="button"
              onClick={onStopLiveInput}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] flex items-center gap-1.5 shadow cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop Live Input</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleTriggerSave}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1.5 shadow cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{savedToast ? '✓ Saved to Backend' : 'Save Live Input'}</span>
          </button>
        </div>
      </div>

      {/* 3 Live Source Type Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <button
          type="button"
          onClick={() => setSelectedTab('m3u8')}
          className={`p-3 rounded-lg border font-bold text-left transition cursor-pointer ${
            selectedTab === 'm3u8'
              ? 'bg-sky-950/80 border-sky-400 text-white shadow'
              : 'bg-[#101622] border-[#222d42] text-slate-300 hover:text-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <Radio className="w-4 h-4 text-sky-400" />
            {live.active && (live.sourceType === 'm3u8' || live.sourceType === 'stream') && (
              <span className="text-[9px] bg-emerald-600 text-white px-1.5 rounded font-mono">
                ON AIR
              </span>
            )}
          </div>
          <div className="mt-1.5 text-xs">1. M3U8 / HLS Live Link</div>
          <div className="text-[10px] text-slate-400 font-normal">
            Live .m3u8 HLS &amp; HTTP Broadcast Streams
          </div>
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('camera')}
          className={`p-3 rounded-lg border font-bold text-left transition cursor-pointer ${
            selectedTab === 'camera'
              ? 'bg-amber-950/80 border-amber-400 text-white shadow'
              : 'bg-[#101622] border-[#222d42] text-slate-300 hover:text-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <Video className="w-4 h-4 text-amber-400" />
            {live.active && live.sourceType === 'camera' && (
              <span className="text-[9px] bg-emerald-600 text-white px-1.5 rounded font-mono">
                ON AIR
              </span>
            )}
          </div>
          <div className="mt-1.5 text-xs">2. Camera / USB HDMI Capture Card</div>
          <div className="text-[10px] text-slate-400 font-normal">
            USB HDMI Capture Card, SDI Card &amp; Live Camera
          </div>
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('youtube')}
          className={`p-3 rounded-lg border font-bold text-left transition cursor-pointer ${
            selectedTab === 'youtube'
              ? 'bg-rose-950/80 border-rose-400 text-white shadow'
              : 'bg-[#101622] border-[#222d42] text-slate-300 hover:text-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <Youtube className="w-4 h-4 text-rose-400" />
            {live.active && live.sourceType === 'youtube' && (
              <span className="text-[9px] bg-emerald-600 text-white px-1.5 rounded font-mono">
                ON AIR
              </span>
            )}
          </div>
          <div className="mt-1.5 text-xs">3. YouTube (Video / Live / Playlist)</div>
          <div className="text-[10px] text-slate-400 font-normal">
            Paste 1 link, Playlist URL, or multiple YouTube links
          </div>
        </button>
      </div>

      {/* Selected Source Configuration Card */}
      {selectedTab === 'm3u8' && (
        <div className="bg-[#101624] border border-[#222e46] rounded-lg p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-sky-300 text-xs uppercase">
                M3U8 / HLS LIVE STREAM
              </div>
              <div className="text-[11px] text-slate-400">
                Paste any .m3u8 HLS live link (e.g. https://cdn.example.com/live/stream.m3u8)
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={m3u8Input}
              onChange={(e) => {
                setM3u8Input(e.target.value);
                if (streamErrorMsg) setStreamErrorMsg('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleStartStreamLive()}
              placeholder="https://example.com/live/stream.m3u8"
              className="flex-1 bg-[#070a10] border border-[#2a3854] rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-400"
            />
            <button
              type="button"
              onClick={handleStartStreamLive}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 shadow cursor-pointer shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Play M3U8 Stream</span>
            </button>
            {live.active && (live.sourceType === 'm3u8' || live.sourceType === 'stream') && (
              <button
                type="button"
                onClick={onStopLiveInput}
                className="px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow cursor-pointer shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            )}
          </div>

          {streamErrorMsg && (
            <div className="bg-rose-950/70 border border-rose-500/50 rounded-lg px-3 py-2 text-[11px] text-rose-200 font-semibold">
              {streamErrorMsg}
            </div>
          )}

          {live.active && (live.sourceType === 'm3u8' || live.sourceType === 'stream') && live.streamUrl && (
            <div className="bg-[#090d15] border border-sky-500/40 rounded-lg p-2.5 flex items-center justify-between gap-2 text-[11px]">
              <span className="text-emerald-400 font-bold font-mono truncate">
                ● ACTIVE M3U8 STREAM: {live.streamUrl}
              </span>
            </div>
          )}
        </div>
      )}

      {selectedTab === 'camera' && (
        <div className="bg-[#101624] border border-[#222e46] rounded-lg p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-amber-300 text-xs uppercase flex items-center gap-2">
                <span>Live Camera / USB HDMI Capture Card Input</span>
                {live.active && live.sourceType === 'camera' && (
                  <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-mono">
                    ● CAMERA ON AIR
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400">
                Select your USB HDMI Capture Card or Webcam and broadcast live in 1080p HD across Monitor 1 &amp; 2nd Display
              </div>
            </div>
            <button
              type="button"
              onClick={refreshCameraDevices}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              title="Refresh Video Capture Devices"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={selectedDeviceId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedDeviceId(nextId);
                if (live.active && live.sourceType === 'camera') {
                  onStartCameraCapture(nextId || undefined);
                }
              }}
              className="flex-1 bg-[#070a10] border border-[#2a3854] rounded-lg px-3 py-2 text-xs text-white"
            >
              <option value="">Default System Camera / USB HDMI Capture Card</option>
              {videoDevices.map((d, idx) => (
                <option key={d.deviceId || idx} value={d.deviceId}>
                  {d.label || `USB HDMI / Camera Device ${idx + 1}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                onStartCameraCapture(selectedDeviceId || undefined);
                setTimeout(refreshCameraDevices, 600);
              }}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 shadow cursor-pointer shrink-0"
            >
              <Video className="w-3.5 h-3.5" />
              <span>
                {live.active && live.sourceType === 'camera'
                  ? 'Reconnect Camera / HDMI'
                  : 'Start Live Camera / Capture'}
              </span>
            </button>
            {live.active && live.sourceType === 'camera' && (
              <button
                type="button"
                onClick={onStopLiveInput}
                className="px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow cursor-pointer shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            )}
          </div>

          {live.active && live.sourceType === 'camera' && (
            <div className="bg-black border border-amber-500/40 rounded-lg p-2 flex items-center gap-3">
              <video
                ref={previewVideoRef}
                autoPlay
                playsInline
                muted
                className="w-40 aspect-video bg-black rounded border border-amber-500/50 object-contain shrink-0"
              />
              <div className="space-y-1 text-[11px]">
                <div className="text-emerald-400 font-bold font-mono">
                  ● LIVE CAMERA / USB HDMI PLAYING IN BROADCAST OUTPUT
                </div>
                <div className="text-slate-400">
                  Live camera feed is active on Monitor 1 and 2nd Display with all enabled CG overlays.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedTab === 'youtube' && (
        <div className="bg-[#101624] border border-rose-500/40 rounded-lg p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-bold text-rose-300 text-xs uppercase flex items-center gap-2">
                <Youtube className="w-4 h-4 text-rose-400" />
                <span>YouTube Live Stream • Video • Batch Playlist Playout</span>
                {live.active && live.sourceType === 'youtube' && (
                  <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-mono">
                    ● ON AIR
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400">
                Paste single video, YouTube Live link, Playlist URL, or multiple YouTube URLs together (one per line) to play immediately across Studio Player &amp; 2nd Display
              </div>
            </div>
          </div>

          <textarea
            rows={4}
            value={ytInput}
            onChange={(e) => {
              const val = e.target.value;
              setYtInput(val);
              onUpdateLiveInput({ youtubeInputText: val });
            }}
            placeholder={
              'Paste YouTube Video, Live, or Playlist URLs here (one per line or paste all together):\nhttps://www.youtube.com/watch?v=...\nhttps://www.youtube.com/live/...\nhttps://www.youtube.com/playlist?list=...'
            }
            className="w-full bg-[#070a10] border border-[#2a3854] rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-rose-400 resize-y"
          />

          {/* Primary Transport Controls — same clarity as USB Capture & HLS Stream */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleResolveAndPlayYouTube('replace_and_play')}
              disabled={ytResolving}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow cursor-pointer"
            >
              {ytResolving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>
                {live.active && live.sourceType === 'youtube'
                  ? 'Load Batch & Play YouTube Stream'
                  : 'Start YouTube Stream'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleResolveAndPlayYouTube('append_to_queue')}
              disabled={ytResolving || !ytInput.trim()}
              className="px-3 py-2 bg-[#172136] hover:bg-[#202d48] disabled:opacity-50 border border-[#314266] text-sky-200 rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Links to Queue</span>
            </button>

            {live.active && live.sourceType === 'youtube' && (
              <button
                type="button"
                onClick={onStopLiveInput}
                className="px-3.5 py-2 bg-rose-700 hover:bg-rose-600 border border-rose-400 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Stream</span>
              </button>
            )}

            <div className="flex items-center gap-1.5 ml-auto">
              <button
                type="button"
                onClick={handlePrevYouTubeItem}
                disabled={enabledYtCount <= 1}
                className="px-2.5 py-1.5 rounded bg-[#0c111d] hover:bg-[#172136] disabled:opacity-40 border border-[#26334d] text-slate-200 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                title="Previous YouTube Video"
              >
                <SkipBack className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>
              <button
                type="button"
                onClick={handleNextYouTubeItem}
                disabled={enabledYtCount <= 1}
                className="px-2.5 py-1.5 rounded bg-[#0c111d] hover:bg-[#172136] disabled:opacity-40 border border-[#26334d] text-slate-200 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                title="Next YouTube Video"
              >
                <span>Next</span>
                <SkipForward className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onUpdateLiveInput({ youtubeLoop: !ytLoop })}
                className={`px-2.5 py-1.5 rounded border font-bold text-[11px] flex items-center gap-1 cursor-pointer ${
                  ytLoop
                    ? 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300'
                    : 'bg-[#0c111d] border-[#26334d] text-slate-400'
                }`}
                title="Loop YouTube Playlist continuously"
              >
                <Repeat className="w-3.5 h-3.5" />
                <span>{ytLoop ? 'Loop: ON' : 'Loop: OFF'}</span>
              </button>
            </div>
          </div>

          {ytErrorMsg && (
            <div className="bg-rose-950/60 border border-rose-500/50 rounded-lg px-3 py-2 text-[11px] text-rose-200">
              {ytErrorMsg}
            </div>
          )}

          {ytStatusMsg && !ytErrorMsg && (
            <div className="bg-emerald-950/50 border border-emerald-500/40 rounded-lg px-3 py-1.5 text-[11px] text-emerald-300">
              {ytStatusMsg}
            </div>
          )}

          {live.active && live.sourceType === 'youtube' && activeYtItem && (
            <div className="bg-[#090d15] border border-emerald-500/40 rounded-lg p-2.5 flex items-center justify-between gap-2 text-[11px]">
              <span className="text-emerald-400 font-bold font-mono truncate">
                ● ACTIVE YOUTUBE LIVE ({activeYtIndex + 1}/{ytQueue.length}): {activeYtItem.title}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-rose-600/80 text-white text-[9px] font-mono font-bold shrink-0">
                {activeYtItem.isLive ? 'LIVE STREAM' : 'VIDEO'}
              </span>
            </div>
          )}

          {/* YouTube Video / Live Playlist Queue with Enable/Disable checkboxes */}
          <div className="bg-[#070a11] border border-[#1d283d] rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-[#0c1220] border-b border-[#1d283d] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-[11px] text-slate-200 uppercase">
                <ListVideo className="w-3.5 h-3.5 text-rose-400" />
                <span>
                  YouTube Live Playlist Queue ({enabledYtCount}/{ytQueue.length} Enabled)
                </span>
              </div>
              {ytQueue.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateLiveInput({
                      youtubeQueue: [],
                      youtubeQueueIndex: 0,
                      ...(live.active && live.sourceType === 'youtube' ? { active: false } : {}),
                    })
                  }
                  className="text-[10px] text-rose-400 hover:text-rose-300 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear Playlist</span>
                </button>
              )}
            </div>

            {ytQueue.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-slate-500">
                No YouTube videos queued yet. Paste links above and click Start YouTube Stream.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto divide-y divide-[#151e30]">
                {ytQueue.map((item, idx) => {
                  const isItemEnabled = item.enabled !== false;
                  const isCurrentlyPlaying =
                    live.active && live.sourceType === 'youtube' && idx === activeYtIndex;
                  return (
                    <div
                      key={item.id}
                      className={`px-2.5 py-1.5 flex items-center gap-2 text-[11px] transition ${
                        isCurrentlyPlaying
                          ? 'bg-emerald-950/45 border-l-2 border-l-emerald-400'
                          : !isItemEnabled
                          ? 'opacity-45 bg-[#060910]'
                          : 'hover:bg-[#0d1424]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleItemEnabled(item.id)}
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 cursor-pointer ${
                          isItemEnabled
                            ? 'bg-emerald-600 border-emerald-400 text-white'
                            : 'bg-[#0b101b] border-slate-600 text-transparent'
                        }`}
                        title={
                          isItemEnabled
                            ? 'Enabled in YouTube Playlist (click to disable)'
                            : 'Disabled (click to enable)'
                        }
                      >
                        <Check className="w-3 h-3" />
                      </button>

                      <span className="w-5 text-center font-mono text-[10px] text-slate-500 shrink-0">
                        {idx + 1}
                      </span>

                      <button
                        type="button"
                        onClick={() => handlePlayQueueItemAt(idx)}
                        className="w-6 h-6 rounded bg-[#141d30] hover:bg-rose-600 text-white flex items-center justify-center shrink-0 cursor-pointer transition"
                        title="Play this YouTube item On Air immediately"
                      >
                        <Play className="w-3 h-3 fill-current" />
                      </button>

                      <div
                        onClick={() => handlePlayQueueItemAt(idx)}
                        className="flex-1 min-w-0 cursor-pointer"
                      >
                        <div className="font-semibold text-white truncate flex items-center gap-1.5">
                          <span className="truncate">{item.title || item.videoId}</span>
                          {item.isLive && (
                            <span className="px-1 py-0.2 rounded bg-rose-600 text-[9px] font-mono font-bold text-white shrink-0">
                              LIVE
                            </span>
                          )}
                          {isCurrentlyPlaying && (
                            <span className="px-1 py-0.2 rounded bg-emerald-600 text-[9px] font-mono font-bold text-white shrink-0">
                              ON AIR
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 truncate">
                          {item.url}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMoveQueueItem(idx, -1)}
                          disabled={idx === 0}
                          className="p-1 rounded hover:bg-[#192338] disabled:opacity-30 text-slate-300 cursor-pointer"
                          title="Move Up"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveQueueItem(idx, 1)}
                          disabled={idx === ytQueue.length - 1}
                          className="p-1 rounded hover:bg-[#192338] disabled:opacity-30 text-slate-300 cursor-pointer"
                          title="Move Down"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveQueueItem(item.id)}
                          className="p-1 rounded hover:bg-rose-900/60 text-rose-400 cursor-pointer"
                          title="Remove from YouTube Playlist"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audio Volume & Mute for Live Input */}
      <div className="bg-[#101624] border border-[#222e46] rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onUpdateLiveInput({ muted: !live.muted })}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer ${
              live.muted
                ? 'bg-rose-600 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-emerald-400'
            }`}
          >
            {live.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            <span>{live.muted ? 'Live Audio Muted' : 'Live Audio ON'}</span>
          </button>
          <span className="text-slate-300 font-mono text-[11px]">
            Volume: {live.volume ?? 100}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={live.volume ?? 100}
          onChange={(e) =>
            onUpdateLiveInput({ volume: Number(e.target.value), muted: false })
          }
          className="w-44 accent-emerald-500"
        />
      </div>

      {/* EVERY N MIN ADS DURING LIVE INPUT OPTION */}
      <div className="bg-[#121929] border-2 border-indigo-500/40 rounded-lg p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <div className="font-bold text-white text-xs uppercase">
                EVERY N MIN ADS OPTION IN LIVE INPUT (PLAY OR DO NOT PLAY)
              </div>
              <div className="text-[11px] text-slate-400">
                Choose whether Every N Min Commercial Ads should interrupt Live Input or stay disabled during Live Input
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onUpdateLiveInput({ playEveryMinAdsOnLive: true });
                if (onChangeEveryNMin && !everyNMinEnabled) {
                  onChangeEveryNMin(true, everyNMinInterval);
                }
              }}
              className={`px-3 py-1.5 rounded-lg font-bold text-[11px] flex items-center gap-1 transition cursor-pointer ${
                playAdsOnLive
                  ? 'bg-emerald-600 text-white shadow ring-1 ring-emerald-300'
                  : 'bg-slate-900 text-slate-400 border border-slate-700'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>PLAY EVERY N MIN ADS ON LIVE</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateLiveInput({ playEveryMinAdsOnLive: false })}
              className={`px-3 py-1.5 rounded-lg font-bold text-[11px] transition cursor-pointer ${
                !playAdsOnLive
                  ? 'bg-rose-600 text-white shadow ring-1 ring-rose-300'
                  : 'bg-slate-900 text-slate-400 border border-slate-700'
              }`}
            >
              <span>DO NOT PLAY ADS ON LIVE</span>
            </button>
          </div>
        </div>
      </div>

      {/* LIVE OVERLAY L-SHAPE, SCROLL TICKER & LOGOS CONTROLS ON LIVE INPUT */}
      <div className="bg-[#121929] border-2 border-amber-500/40 rounded-lg p-3.5 space-y-3">
        <div>
          <div className="font-bold text-amber-300 text-xs uppercase flex items-center gap-2">
            <span>LIVE CG GRAPHICS OVERLAYS (SHOWING / NOT SHOWING CONTROLS)</span>
          </div>
          <div className="text-[11px] text-slate-400">
            Choose whether Scroll Tickers or L-Shape Ads show over the Live Input stream
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* 1. SCROLL TICKER: SHOW vs HIDE */}
          <div className="p-2.5 rounded-lg bg-[#090d16] border border-[#232e44] flex items-center justify-between gap-2">
            <div className="text-[11px] font-bold text-sky-300">
              1. SCROLL TICKER ON LIVE:
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (onUpdateGraphics) {
                    onUpdateGraphics({ tickerEnabled: true, topTickerEnabled: true });
                  }
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                  channel.graphics.tickerEnabled
                    ? 'bg-sky-600 text-white shadow ring-1 ring-sky-300'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-700'
                }`}
              >
                ✓ SHOW TICKER
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onUpdateGraphics) {
                    onUpdateGraphics({ tickerEnabled: false, topTickerEnabled: false });
                  }
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                  !channel.graphics.tickerEnabled
                    ? 'bg-rose-600 text-white shadow ring-1 ring-rose-300'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-700'
                }`}
              >
                ✕ HIDE TICKER
              </button>
            </div>
          </div>

          {/* 2. L-SHAPE AD: SHOW vs HIDE */}
          <div className="p-2.5 rounded-lg bg-[#090d16] border border-[#232e44] flex items-center justify-between gap-2">
            <div className="text-[11px] font-bold text-amber-300">
              2. L-SHAPE AD ON LIVE:
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (onUpdateLShape) {
                    onUpdateLShape({
                      enabled: true,
                      keyEnabled: true,
                      isPlaying: true,
                      presetSize: 'full_image',
                      renderMode: 'overlay',
                      squeezeProgramVideo: false,
                      periodicActive: true,
                      periodicCounter: 0,
                      currentTime: 0,
                    });
                  }
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                  channel.lShape?.enabled
                    ? 'bg-amber-500 text-black shadow ring-1 ring-amber-300'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-700'
                }`}
              >
                ✓ SHOW L-SHAPE
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onUpdateLShape) {
                    onUpdateLShape({ enabled: false, isPlaying: false });
                  }
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                  !channel.lShape?.enabled
                    ? 'bg-rose-600 text-white shadow ring-1 ring-rose-300'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-700'
                }`}
              >
                ✕ HIDE L-SHAPE
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
