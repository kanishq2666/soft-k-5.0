import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Upload,
  Check,
  Save,
  Shield,
  Monitor,
  Clock as ClockIcon,
  Layers,
  Image as ImageIcon,
  Sliders,
  Video,
  Phone,
  Sparkles
} from 'lucide-react';
import {
  TVChannel,
  BottomScrollConfig,
  LogoItemConfig,
  LogoCornerPosition,
  LShapeConfig,
  LShapePlaylistItem,
  OverlayBannerConfig,
  TransmissionConfig,
  AspectRatioMode,
  OutputResolution,
  TickerScrollItem,
  LiveInputConfig
} from '../types/playout';
import { CGGraphicsEditor } from './CGGraphicsEditor';
import { TickerTopBottomStudio } from './TickerTopBottomStudio';
import { LiveInputStudioPanel } from './LiveInputStudioPanel';
import { LShapeStudioPanel } from './LShapeStudioPanel';
import { ClockStudioPanel } from './ClockStudioPanel';
import { MeetDeveloperVfxModal } from './MeetDeveloperVfxModal';
import { LicenseActivationVfxModal } from './LicenseActivationVfxModal';
import {
  BackInTimerEditorModal,
  DEFAULT_BACK_IN_TIMER_CONFIG,
} from './BackInTimerEditorModal';
import { StationLicenseRecord } from '../utils/licenseCrypto';
import { createChannelLogoSvg, createSponsor1LogoSvg, createSponsor2LogoSvg } from '../utils/defaultLogos';
import {
  ALL_CG_MEDIA_ACCEPT,
  filterFolderCgMediaFiles,
  isSwfFile,
  isVideoOrSwfFile,
  probeMediaFileDuration
} from '../services/swfEngine';
import { extractFolderName } from '../services/offlineMediaVault';

export type ActiveModalType =
  | null
  | 'stream_setup'
  | 'scrolling_ads'
  | 'lshape_ad'
  | 'logos_overlays'
  | 'clock'
  | 'live_input'
  | 'auto_stream'
  | 'license'
  | 'developer'
  | 'back_in_timer';

interface StudioFeatureModalsProps {
  activeModal: ActiveModalType;
  onClose: () => void;
  channel: TVChannel;
  onUpdateGraphics: (
    id: number,
    graphics: BottomScrollConfig | ((prev: BottomScrollConfig) => BottomScrollConfig)
  ) => void;
  onUpdateBottomOverlay: (
    id: number,
    overlay: OverlayBannerConfig | ((prev: OverlayBannerConfig) => OverlayBannerConfig)
  ) => void;
  onUpdateTopOverlay: (
    id: number,
    overlay: OverlayBannerConfig | ((prev: OverlayBannerConfig) => OverlayBannerConfig)
  ) => void;
  onUpdateLShape: (
    id: number,
    lShape: LShapeConfig | ((prev: LShapeConfig) => LShapeConfig)
  ) => void;
  onUpdateTransmission: (id: number, transmission: TransmissionConfig) => void;
  isLicensed: boolean;
  licenseRecord?: StationLicenseRecord | null;
  onActivateLicense: (licensed: boolean, updatedRecord?: StationLicenseRecord) => void;
  liveCameraActive: boolean;
  onToggleLiveCamera: () => void;
  everyNMinEnabled: boolean;
  everyNMinInterval: number;
  onChangeEveryNMin: (enabled: boolean, intervalMin: number) => void;
  activeVideoElement?: HTMLVideoElement | null;
  activeOverlayVideoElement?: HTMLVideoElement | null;
  activeTopOverlayVideoElement?: HTMLVideoElement | null;
  activeLShapeVideoElement?: HTMLVideoElement | null;
  onTogglePlay: (id: number) => void;
  onSkipNext: (id: number) => void;
  onImportVideos: (id: number, files: FileList | File[]) => void;
  onUpdateLiveInput?: (partial: Partial<LiveInputConfig>) => void;
  onStartCameraCapture?: (deviceId?: string) => void;
  onStopLiveInput?: () => void;
  onSaveChannel?: () => void;
  activeLiveStream?: MediaStream | null;
}

export const StudioFeatureModals: React.FC<StudioFeatureModalsProps> = ({
  activeModal,
  onClose,
  channel,
  onUpdateGraphics,
  onUpdateBottomOverlay,
  onUpdateTopOverlay,
  onUpdateLShape,
  onUpdateTransmission,
  isLicensed,
  licenseRecord,
  onActivateLicense,
  liveCameraActive,
  onToggleLiveCamera,
  everyNMinEnabled,
  everyNMinInterval,
  onChangeEveryNMin,
  activeVideoElement,
  activeOverlayVideoElement,
  activeTopOverlayVideoElement,
  activeLShapeVideoElement,
  onTogglePlay,
  onSkipNext,
  onImportVideos,
  onUpdateLiveInput,
  onStartCameraCapture,
  onStopLiveInput,
  onSaveChannel,
  activeLiveStream,
}) => {
  const [newBottomAdText, setNewBottomAdText] = useState('');
  const [newTopAdText, setNewTopAdText] = useState('');
  const [licenseKeyInput, setLicenseKeyInput] = useState('ASHOKA-PRO-2026-FULL');

  const [cgDraftDirty, setCgDraftDirty] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const cgCommitSaveRef = useRef<(() => void) | null>(null);

  const defaultLShape: LShapeConfig = {
    enabled: false,
    side: 'left',
    presetSize: 'medium',
    sideWidth: 380,
    bottomHeight: 180,
    squeezeProgramVideo: true,
    backgroundColor: '#06080e',
    backgroundStyle: 'dark_glass',
    opacity: 1,
    intervalSeconds: 15,
    playlist: [],
    currentIndex: 0,
    currentTime: 0,
    isPlaying: true,
  };

  const [modalDraftGraphics, setModalDraftGraphics] = useState<BottomScrollConfig>(channel.graphics);
  const [modalDraftBottomOverlay, setModalDraftBottomOverlay] = useState<OverlayBannerConfig | undefined>(
    channel.bottomOverlay
  );
  const [modalDraftTopOverlay, setModalDraftTopOverlay] = useState<OverlayBannerConfig | undefined>(
    channel.topOverlay
  );
  const [modalDraftLShape, setModalDraftLShape] = useState<LShapeConfig>(
    channel.lShape || defaultLShape
  );
  const [modalDraftDirty, setModalDraftDirty] = useState(false);
  const [modalSavedToast, setModalSavedToast] = useState(false);

  const channelRef = useRef(channel);
  channelRef.current = channel;
  const modalSessionRef = useRef(0);
  const committedUploadIdsRef = useRef<Set<string>>(new Set());

  const isStandaloneCgDraftModal =
    activeModal === 'scrolling_ads' || activeModal === 'lshape_ad' || activeModal === 'clock';

  useEffect(() => {
    modalSessionRef.current += 1;
    setShowCloseConfirm(false);
    setModalSavedToast(false);

    if (activeModal === 'logos_overlays') {
      setCgDraftDirty(false);
      setModalDraftDirty(false);
      return;
    }

    if (
      activeModal === 'scrolling_ads' ||
      activeModal === 'lshape_ad' ||
      activeModal === 'clock'
    ) {
      const ch = channelRef.current;
      setModalDraftGraphics({ ...ch.graphics });
      setModalDraftBottomOverlay(
        ch.bottomOverlay
          ? { ...ch.bottomOverlay, playlist: [...(ch.bottomOverlay.playlist || [])] }
          : undefined
      );
      setModalDraftTopOverlay(
        ch.topOverlay
          ? { ...ch.topOverlay, playlist: [...(ch.topOverlay.playlist || [])] }
          : undefined
      );
      setModalDraftLShape(
        ch.lShape
          ? { ...ch.lShape, playlist: [...(ch.lShape.playlist || [])] }
          : defaultLShape
      );
      setModalDraftDirty(false);
    } else {
      setCgDraftDirty(false);
      setModalDraftDirty(false);
    }
  }, [activeModal, channel.id]);

  useEffect(() => {
    if (!activeModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeModal === 'logos_overlays') {
        if (cgDraftDirty) {
          setShowCloseConfirm(true);
        } else {
          onClose();
        }
        return;
      }
      if (isStandaloneCgDraftModal && modalDraftDirty) {
        setShowCloseConfirm(true);
        return;
      }
      setShowCloseConfirm(false);
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeModal, cgDraftDirty, isStandaloneCgDraftModal, modalDraftDirty, onClose]);

  if (!activeModal) return null;

  const lShape: LShapeConfig = channel.lShape || defaultLShape;

  const updateG = (partial: Record<string, any>) => {
    onUpdateGraphics(channel.id, { ...channel.graphics, ...partial } as BottomScrollConfig);
  };

  const updateDraftG = (partial: Record<string, any>) => {
    setModalDraftGraphics((prev) => ({ ...prev, ...partial } as BottomScrollConfig));
    setModalDraftDirty(true);
  };

  const updateDraftBottomOverlay = (
    partialOrUpdater:
      | Partial<OverlayBannerConfig>
      | ((prev: OverlayBannerConfig) => OverlayBannerConfig)
  ) => {
    setModalDraftBottomOverlay((prev) => {
      const base: OverlayBannerConfig = prev ||
        channelRef.current.bottomOverlay || {
          enabled: false,
          keyEnabled: true,
          position: 'bottom',
          x: 0,
          y: 900,
          width: 1920,
          height: 180,
          opacity: 1,
          fitMode: 'fill',
          backgroundColor: 'rgba(6, 8, 14, 0.94)',
          backgroundStyle: 'dark_glass',
          loopMode: 'playlist',
          autoPlayNext: true,
          transition: 'cut',
          showTickerInside: false,
          playlist: [],
          currentIndex: 0,
          currentTime: 0,
          isPlaying: true,
        };
      if (typeof partialOrUpdater === 'function') {
        return partialOrUpdater(base);
      }
      return { ...base, ...partialOrUpdater };
    });
    setModalDraftDirty(true);
  };

  const updateDraftTopOverlay = (
    partialOrUpdater:
      | Partial<OverlayBannerConfig>
      | ((prev: OverlayBannerConfig) => OverlayBannerConfig)
  ) => {
    setModalDraftTopOverlay((prev) => {
      const base: OverlayBannerConfig = prev ||
        channelRef.current.topOverlay || {
          enabled: false,
          keyEnabled: true,
          position: 'top',
          x: 0,
          y: 0,
          width: 1920,
          height: 140,
          opacity: 1,
          fitMode: 'fill',
          backgroundColor: 'rgba(6, 8, 14, 0.94)',
          backgroundStyle: 'dark_glass',
          loopMode: 'playlist',
          autoPlayNext: true,
          transition: 'cut',
          showTickerInside: false,
          playlist: [],
          currentIndex: 0,
          currentTime: 0,
          isPlaying: true,
        };
      if (typeof partialOrUpdater === 'function') {
        return partialOrUpdater(base);
      }
      return { ...base, ...partialOrUpdater };
    });
    setModalDraftDirty(true);
  };

  const updateDraftLShape = (
    partialOrUpdater: Partial<LShapeConfig> | ((prev: LShapeConfig) => LShapeConfig)
  ) => {
    setModalDraftLShape((prev) => {
      const base = prev || defaultLShape;
      if (typeof partialOrUpdater === 'function') {
        return { ...base, ...partialOrUpdater(base) };
      }
      return { ...base, ...partialOrUpdater };
    });
    setModalDraftDirty(true);
  };

  const handleCommitModalDraft = () => {
    if (activeModal === 'scrolling_ads') {
      onUpdateGraphics(channel.id, (prev) => ({
        ...prev,
        ...modalDraftGraphics,
      }));
      if (modalDraftBottomOverlay) {
        (modalDraftBottomOverlay.playlist || []).forEach((it) => {
          committedUploadIdsRef.current.add(it.id);
        });
        onUpdateBottomOverlay(channel.id, () => modalDraftBottomOverlay);
      }
      if (modalDraftTopOverlay) {
        (modalDraftTopOverlay.playlist || []).forEach((it) => {
          committedUploadIdsRef.current.add(it.id);
        });
        onUpdateTopOverlay(channel.id, () => modalDraftTopOverlay);
      }
    } else if (activeModal === 'lshape_ad') {
      onUpdateLShape(channel.id, () => modalDraftLShape);
    } else if (activeModal === 'clock') {
      onUpdateGraphics(channel.id, (prev) => ({
        ...prev,
        ...modalDraftGraphics,
      }));
    }
    setModalDraftDirty(false);
    setModalSavedToast(true);
    setTimeout(() => setModalSavedToast(false), 2000);
    if (onSaveChannel) onSaveChannel();
  };

  const handleRequestCloseStandaloneModal = () => {
    if (isStandaloneCgDraftModal && modalDraftDirty) {
      setShowCloseConfirm(true);
      return;
    }
    setShowCloseConfirm(false);
    onClose();
  };

  const draftModalChannel: TVChannel = {
    ...channel,
    graphics: modalDraftGraphics,
    bottomOverlay: modalDraftBottomOverlay,
    topOverlay: modalDraftTopOverlay,
    lShape: modalDraftLShape,
  };

  // Full CG Studio Modal for Logos & Overlays
  if (activeModal === 'logos_overlays') {
    const handleRequestCloseCgStudio = () => {
      if (cgDraftDirty) {
        setShowCloseConfirm(true);
        return;
      }
      onClose();
    };

    return (
      <div className="fixed inset-0 bg-black/95 z-50 flex flex-col overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[#0d111a] border-b border-[#1f293d] sticky top-0 z-20">
          <div className="flex items-center gap-2.5">
            <ImageIcon className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Logos &amp; Overlays Studio (5 Logos • Top &amp; Bottom Banners • Ticker)
            </span>
            {cgDraftDirty && (
              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-300 text-[10px] font-bold uppercase tracking-wide">
                Draft Only — Click Save CG to Apply Live
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showCloseConfirm && cgDraftDirty && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-950/80 border border-amber-500/60 text-[11px]">
                <span className="text-amber-200 font-semibold">Unsaved CG changes:</span>
                <button
                  onClick={() => {
                    cgCommitSaveRef.current?.();
                    setShowCloseConfirm(false);
                    onClose();
                  }}
                  className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold"
                >
                  Save &amp; Close
                </button>
                <button
                  onClick={() => {
                    setShowCloseConfirm(false);
                    setCgDraftDirty(false);
                    onClose();
                  }}
                  className="px-2 py-0.5 bg-rose-700 hover:bg-rose-600 text-white rounded font-bold"
                >
                  Discard
                </button>
                <button
                  onClick={() => setShowCloseConfirm(false)}
                  className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded font-bold"
                >
                  Cancel
                </button>
              </div>
            )}
            <button
              onClick={handleRequestCloseCgStudio}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-bold flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> Close Studio
            </button>
          </div>
        </div>
        <div className="flex-1">
          <CGGraphicsEditor
            channel={channel}
            onUpdateGraphics={onUpdateGraphics}
            onUpdateBottomOverlay={onUpdateBottomOverlay}
            onUpdateTopOverlay={onUpdateTopOverlay}
            onUpdateLShape={onUpdateLShape}
            activeVideoElement={activeVideoElement}
            activeOverlayVideoElement={activeOverlayVideoElement}
            activeTopOverlayVideoElement={activeTopOverlayVideoElement}
            activeLShapeVideoElement={activeLShapeVideoElement}
            onTogglePlay={onTogglePlay}
            onSkipNext={onSkipNext}
            onImportVideos={onImportVideos}
            onSaveChannel={onSaveChannel}
            onDraftDirtyChange={setCgDraftDirty}
            commitSaveRef={cgCommitSaveRef}
          />
        </div>
      </div>
    );
  }

  // Meet the Developer & Leadership Modal
  if (activeModal === 'developer') {
    return <MeetDeveloperVfxModal onClose={onClose} />;
  }

  // Full VFX Animated Overlay Modal for License Activation
  if (activeModal === 'license') {
    return (
      <LicenseActivationVfxModal
        isLicensed={isLicensed}
        licenseRecord={licenseRecord}
        onActivateLicense={onActivateLicense}
        onUpdateWatermark={(enabled) => updateG({ demoWatermarkEnabled: enabled })}
        onSaveChannel={onSaveChannel}
        onClose={onClose}
      />
    );
  }

  // "BACK IN XX SEC" Countdown Badge Customization Modal
  if (activeModal === 'back_in_timer') {
    const existingConfig =
      (channel.graphics as any)?.backInTimer ||
      channel.backInTimer ||
      DEFAULT_BACK_IN_TIMER_CONFIG;
    return (
      <BackInTimerEditorModal
        config={existingConfig}
        onSave={(updated) => {
          onUpdateGraphics(channel.id, (prev) => ({
            ...prev,
            backInTimer: updated,
          }));
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d111a] border border-[#232e42] rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl text-white overflow-hidden">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 bg-[#111726] border-b border-[#1e2738]">
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-bold tracking-wide text-white flex items-center gap-2">
              {activeModal === 'stream_setup' && <><Sliders className="w-4 h-4 text-emerald-400" /> Playout Output Setup</>}
              {activeModal === 'scrolling_ads' && <><Layers className="w-4 h-4 text-sky-400" /> Scrolling Ads (Top &amp; Bottom Tickers)</>}
              {activeModal === 'lshape_ad' && <><Layers className="w-4 h-4 text-amber-400" /> L-Shape Ad Studio</>}
              {activeModal === 'clock' && <><ClockIcon className="w-4 h-4 text-yellow-400" /> Broadcast Clock Overlay</>}
              {activeModal === 'live_input' && <><Video className="w-4 h-4 text-blue-400" /> Live Input Studio (M3U8 / RTMP • USB Camera)</>}
              {activeModal === 'auto_stream' && <><ClockIcon className="w-4 h-4 text-rose-400" /> Every N Min Auto Interrupt</>}
            </h3>
            {isStandaloneCgDraftModal && modalDraftDirty && (
              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-300 text-[10px] font-bold uppercase tracking-wide">
                Unsaved Draft
              </span>
            )}
            {isStandaloneCgDraftModal && modalSavedToast && !modalDraftDirty && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1">
                <Check className="w-3 h-3" /> Live Updated
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isStandaloneCgDraftModal && (
              <button
                onClick={handleCommitModalDraft}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  modalDraftDirty
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/50'
                    : 'bg-[#192132] hover:bg-[#253047] text-emerald-300 border border-emerald-500/30'
                }`}
              >
                <Save className="w-3.5 h-3.5" /> Save &amp; Apply Live
              </button>
            )}
            <button
              onClick={handleRequestCloseStandaloneModal}
              className="p-1.5 rounded-lg bg-[#192132] hover:bg-[#253047] text-slate-400 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isStandaloneCgDraftModal && showCloseConfirm && modalDraftDirty && (
          <div className="px-5 py-2.5 bg-amber-950/80 border-b border-amber-500/50 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-amber-200 font-semibold">
              You have unsaved CG draft changes. Live PGM OUT &amp; 2nd Display will only update after you click Save.
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  handleCommitModalDraft();
                  setShowCloseConfirm(false);
                  onClose();
                }}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold"
              >
                Save &amp; Close
              </button>
              <button
                onClick={() => {
                  setShowCloseConfirm(false);
                  setModalDraftDirty(false);
                  onClose();
                }}
                className="px-3 py-1 bg-rose-700 hover:bg-rose-600 text-white rounded font-bold"
              >
                Discard &amp; Close
              </button>
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded font-bold"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* 1. PLAYOUT SETUP */}
          {activeModal === 'stream_setup' && (
            <div className="space-y-4">
              <div>
                <label className="block text-slate-400 font-semibold mb-1.5">Master Output Resolution</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['1080p', '720p', '576p', '4K'] as OutputResolution[]).map((res) => (
                    <button
                      key={res}
                      onClick={() =>
                        onUpdateTransmission(channel.id, {
                          ...channel.transmission,
                          outputResolution: res,
                        })
                      }
                      className={`py-2 rounded-lg font-mono font-bold border transition ${
                        channel.transmission.outputResolution === res
                          ? 'bg-emerald-600 border-emerald-400 text-white'
                          : 'bg-[#131926] border-[#222c40] text-slate-300 hover:text-white'
                      }`}
                    >
                      {res.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1.5">
                  TV Screen Fit &amp; Video Size Scaling (Default: Full Screen Fit All Sizes)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      { id: 'FILL', label: 'FULL SCREEN FIT (ALL SIZES)' },
                      { id: 'STRETCH', label: 'STRETCH TO TV SCREEN' },
                      { id: '16:9', label: '16:9 HD FULL' },
                      { id: '4:3', label: '4:3 SD FULL' },
                    ] as { id: AspectRatioMode; label: string }[]
                  ).map((item) => (
                    <button
                      key={item.id}
                      onClick={() =>
                        onUpdateTransmission(channel.id, {
                          ...channel.transmission,
                          aspectRatioMode: item.id,
                        })
                      }
                      className={`py-2 px-2 rounded-lg font-mono font-bold border transition ${
                        (channel.transmission.aspectRatioMode || 'FILL') === item.id
                          ? 'bg-blue-600 border-blue-400 text-white'
                          : 'bg-[#131926] border-[#222c40] text-slate-300 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1.5">Frame Rate (FPS)</label>
                <div className="grid grid-cols-4 gap-2">
                  {([25, 30, 50, 60] as const).map((fps) => (
                    <button
                      key={fps}
                      onClick={() =>
                        onUpdateTransmission(channel.id, {
                          ...channel.transmission,
                          fps,
                        })
                      }
                      className={`py-2 rounded-lg font-mono font-bold border transition ${
                        channel.transmission.fps === fps
                          ? 'bg-emerald-600 border-emerald-400 text-white'
                          : 'bg-[#131926] border-[#222c40] text-slate-300 hover:text-white'
                      }`}
                    >
                      {fps} FPS
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 2. SCROLLING ADS (TOP & BOTTOM TICKERS) */}
          {activeModal === 'scrolling_ads' && (
            <TickerTopBottomStudio
              channel={draftModalChannel}
              onUpdateGraphics={updateDraftG}
              onSaveChannel={handleCommitModalDraft}
              bottomOverlay={modalDraftBottomOverlay}
              topOverlay={modalDraftTopOverlay}
              onUpdateBottomOverlay={updateDraftBottomOverlay}
              onUpdateTopOverlay={updateDraftTopOverlay}
              onUploadOverlayMedia={(files, position) => {
                if (!files || files.length === 0) return;
                const fileArr: File[] = filterFolderCgMediaFiles(files);
                if (fileArr.length === 0) return;
                const sessionAtUpload = modalSessionRef.current;
                const batchTs = Date.now();
                const uploadedItems = fileArr.map((file: File, idx: number) => {
                  const objectUrl = URL.createObjectURL(file);
                  const isSwf = isSwfFile(file);
                  const isVid = !isSwf && isVideoOrSwfFile(file);
                  const folderName = extractFolderName(file);
                  return {
                    id: `${position}-scroll-swf-${batchTs}-${idx}`,
                    title: file.name.replace(/\.[^/.]+$/, ''),
                    fileName: file.name,
                    folderName,
                    url: objectUrl,
                    mediaType: (isSwf ? 'swf' : isVid ? 'video' : 'image') as 'swf' | 'video' | 'image',
                    fitMode: 'fill' as const,
                    duration: 15,
                    enabled: true,
                    file,
                  };
                });

                const updater = (prev: OverlayBannerConfig): OverlayBannerConfig => {
                  const existing = prev.playlist || [];
                  const hasOnlyDefaultSvg =
                    existing.length > 0 &&
                    existing.every((it) => it.url.startsWith('data:image/svg+xml'));
                  const baseList = hasOnlyDefaultSvg ? [] : existing;
                  return {
                    ...prev,
                    enabled: true,
                    keyEnabled: true,
                    currentIndex: baseList.length,
                    currentTime: 0,
                    playlist: [...baseList, ...uploadedItems],
                  };
                };

                if (position === 'bottom') {
                  updateDraftBottomOverlay(updater);
                } else {
                  updateDraftTopOverlay(updater);
                }

                uploadedItems.forEach((item) => {
                  probeMediaFileDuration(item.file, item.url).then(
                    ({ duration, serverUrl, vaultId, folderName }) => {
                      const syncUpdater = (prev: OverlayBannerConfig): OverlayBannerConfig => ({
                        ...prev,
                        playlist: (prev.playlist || []).map((it) =>
                          it.id === item.id
                            ? {
                                ...it,
                                duration: duration || it.duration,
                                url: serverUrl || it.url,
                                vaultId: vaultId || it.vaultId,
                                folderName: folderName || it.folderName,
                              }
                            : it
                        ),
                      });

                      if (modalSessionRef.current === sessionAtUpload) {
                        if (position === 'bottom') {
                          setModalDraftBottomOverlay((prev) =>
                            prev ? syncUpdater(prev) : prev
                          );
                        } else {
                          setModalDraftTopOverlay((prev) =>
                            prev ? syncUpdater(prev) : prev
                          );
                        }
                      }

                      if (committedUploadIdsRef.current.has(item.id)) {
                        if (position === 'bottom') {
                          onUpdateBottomOverlay(channel.id, syncUpdater);
                        } else {
                          onUpdateTopOverlay(channel.id, syncUpdater);
                        }
                      }
                    }
                  );
                });
              }}
            />
          )}

          {/* 3. L-SHAPE AD */}
          {activeModal === 'lshape_ad' && (
            <LShapeStudioPanel
              channel={draftModalChannel}
              lShape={modalDraftLShape}
              onUpdateLShape={updateDraftLShape}
              onSaveChannel={handleCommitModalDraft}
            />
          )}

          {/* 4. CLOCK OVERLAY */}
          {activeModal === 'clock' && (
            <ClockStudioPanel
              channel={draftModalChannel}
              onUpdateGraphics={updateDraftG}
              onSaveChannel={handleCommitModalDraft}
            />
          )}

          {/* 5. LIVE INPUT (M3U8 / RTMP STREAM • USB CAMERA / HDMI) */}
          {activeModal === 'live_input' && (
            <LiveInputStudioPanel
              channel={channel}
              onUpdateLiveInput={(partial) => {
                if (onUpdateLiveInput) onUpdateLiveInput(partial);
              }}
              onStartCameraCapture={(deviceId) => {
                if (onStartCameraCapture) onStartCameraCapture(deviceId);
                else onToggleLiveCamera();
              }}
              onStopLiveInput={() => {
                if (onStopLiveInput) onStopLiveInput();
              }}
              everyNMinEnabled={everyNMinEnabled}
              everyNMinInterval={everyNMinInterval}
              onChangeEveryNMin={onChangeEveryNMin}
              onUpdateLShape={(partial) =>
                onUpdateLShape(channel.id, (prev) => ({ ...(prev || lShape), ...partial }))
              }
              onUpdateGraphics={(partial) => updateG(partial)}
              onSaveChannel={onSaveChannel}
              activeStream={activeLiveStream}
            />
          )}

          {/* 6. EVERY N MIN AUTO INTERRUPT */}
          {activeModal === 'auto_stream' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-[#121826] rounded-lg border border-[#1f293d] flex items-center justify-between">
                <div>
                  <div className="font-bold text-white">Automated Every N Minutes Ad Trigger</div>
                  <div className="text-[11px] text-slate-400">Automatically plays scheduled commercial/promo clips every N minutes</div>
                </div>
                <button
                  onClick={() => onChangeEveryNMin(!everyNMinEnabled, everyNMinInterval)}
                  className={`px-4 py-1.5 rounded-lg font-bold ${
                    everyNMinEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {everyNMinEnabled ? 'ACTIVE' : 'IDLE'}
                </button>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1.5">Select Interval (Minutes)</label>
                <div className="grid grid-cols-6 gap-2">
                  {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map((min) => (
                    <button
                      key={min}
                      onClick={() => onChangeEveryNMin(everyNMinEnabled, min)}
                      className={`py-2 rounded-lg font-mono font-bold border ${
                        everyNMinInterval === min
                          ? 'bg-rose-600 border-rose-400 text-white'
                          : 'bg-[#121826] border-[#222c40] text-slate-300'
                      }`}
                    >
                      {min}m
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
