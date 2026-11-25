export type ChannelGenre = 'News' | 'Cinema' | 'Music' | 'Devotional' | 'Regional' | 'Sports';

export type AspectRatioMode = '16:9' | '4:3' | 'FIT' | 'FILL' | 'STRETCH' | '720p' | '576p' | '720x576' | '720x756';

export type OutputResolution = '1080p' | '720p' | '576p' | '720x576' | '720x756' | '720x480' | '1280x720' | '1920x1080' | '4K';

export type ChannelStatus = 'PLAYING' | 'PAUSED' | 'STOPPED' | 'CUEING' | 'ERROR';

export type ClipCategory = 'PROGRAM' | 'PROMO' | 'FILLER' | 'LIVE_FEED' | 'COMMERCIAL' | 'IDENT' | 'LOCAL';

export interface PlaylistItem {
  id: string;
  title: string;
  category: ClipCategory;
  duration: number; // in seconds
  enabled?: boolean; // True (default): play this file; False: disabled (skip during playout)
  url?: string;
  videoUrl?: string;
  sourceType?: 'local' | 'url' | 'demo';
  fileName?: string;
  fileSize?: number;
  file?: File;
  isTranscoding?: boolean;
  folderId?: string; // Folder grouping ID (for 10,000+ file folders)
  folderName?: string; // Display folder name e.g. "Movies Folder"
  vaultId?: string; // Offline IndexedDB media vault ID
  resolution?: string;
  aspectRatio?: string;
  inPoint?: number;
  outPoint?: number;
  thumbnailColor?: string;
  notes?: string;
}

export type ProgramOverlayMode = 'all_overlays' | 'logo_only' | 'banners_only' | 'lshape_only' | 'clean_none';

export type ProgramScheduleType = 'daily' | 'once' | 'one_time' | 'queue_after_previous';

export type EveryNMinIntervalOption =
  | 1
  | 2
  | 3
  | 5
  | 10
  | 15
  | 20
  | 25
  | 30
  | 35
  | 40
  | 45
  | 50
  | 55
  | 60;

export type AdOverlayMode = 'logo_only' | 'all_overlays' | 'clean_none';

export interface CustomAdTrack {
  id: string;
  trackNumber: number;
  name: string;
  minA: number;
  minB: number;
  slots: string[]; // 48 'HH:MM' 24h strings
}

export interface EveryNMinAdItem extends PlaylistItem {
  intervalMin?: EveryNMinIntervalOption;
  overlayMode: AdOverlayMode;
  orderIndex: number; // 1 = 1st Ad, 2 = 2nd Ad, etc.
  enabled: boolean;
  elapsedSec?: number;
  selectedTracks?: number[]; // e.g. [1], [2], [1, 2, 3, 4, 5, 6]
  tickedSlots?: string[]; // 24-hour 'HH:MM' ticked time slots across Track 1..6
  slotsMask?: string; // Compact 52-char bitmask encoding canonical 312 slots
  extraSlots?: string[]; // Non-canonical 'HH:MM' slots if custom tracks are used
  track6Mode?: '25_55' | '12_25';
  track6Preset?: 'text' | 'video';
  customTracks?: CustomAdTrack[];
  dateMode?: 'every_day' | 'specific_date' | 'date_range';
  scheduledDate?: string; // YYYY-MM-DD
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  lastTriggeredSlotKey?: string;
}

export interface ScheduledProgram {
  id: string;
  name: string;
  title?: string;
  enabled: boolean;
  scheduleType: ProgramScheduleType;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD (used for daily schedule range)
  dayOfWeek?: string; // 'ALL' | 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT'
  startTime: string; // HH:MM or HH:MM:SS
  overlayMode: ProgramOverlayMode;
  playlist: PlaylistItem[];
  loopProgram?: boolean;
  loopMode?: 'playlist' | 'single' | 'off';
  shuffle?: boolean;
  playedClipIds?: string[];
  status?: 'scheduled' | 'playing' | 'completed';
  completed?: boolean;
  lastTriggeredDate?: string;
  lastCompletedDate?: string;
}

export interface TickerScrollItem {
  id: string;
  title?: string;
  text: string;
  enabled: boolean;
  priority?: 'normal' | 'breaking' | 'flash';
  folderName?: string;
  durationSec?: number; // Minimum hold/repeat duration in seconds before moving to next item
  expiresAt?: number | null; // Optional epoch ms expiry timestamp for this scroll item
}

export type LogoCornerPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type LogoDisplayMode = 'all' | 'channel_only' | 'sponsor1_only' | 'sponsor2_only' | 'cycle';

export interface LogoPlaylistItem {
  id: string;
  title: string;
  fileName?: string;
  folderName?: string;
  vaultId?: string;
  url: string;
  isSwf?: boolean;
  isGif?: boolean;
  isVideo?: boolean;
  duration?: number;
  enabled?: boolean;
}

export interface LogoItemConfig {
  id?: string;
  name?: string; // e.g. "Channel Logo", "Sponsor 1", "Sponsor 2"
  label?: string;
  fileName?: string;
  folderName?: string;
  vaultId?: string;
  enabled: boolean;
  keyEnabled?: boolean; // Key ON / Key OFF (DSK overlay)
  type?: 'channel' | 'sponsor1' | 'sponsor2' | 'sponsor3' | 'sponsor4';
  url: string; // PNG / GIF data URI or image link
  position: LogoCornerPosition;
  offsetX: number; // horizontal move offset in px (-1920 to 1920)
  offsetY: number; // vertical move offset in px (-1080 to 1080)
  size: number; // pixel width (30 to 1920px Full Screen)
  customWidth?: number; // explicit width in px (30 to 1920px)
  customHeight?: number; // explicit height in px (30 to 1080px)
  fullScreen?: boolean; // true = 1920x1080 Full Screen
  fitMode?: OverlayFitMode; // 'contain' | 'fill' | 'cover' | 'stretch'
  opacity: number; // 0 to 1
  priority?: number; // 1, 2, 3
  isGif?: boolean;
  isSwf?: boolean;
  duration?: number;
  shadow?: boolean;
  border?: boolean;
  currentIndex?: number;
  playlist?: LogoPlaylistItem[];
}

export interface BottomScrollConfig {
  // Master DSK Key Active (Key On / Key Off for all graphics)
  dskKeyActive?: boolean;
  studioTheme?: 'dark' | 'light';

  // Bottom Scrolling Ticker
  tickerEnabled: boolean; // "With Scroll" vs "Without Scroll" Clean Feed
  tickerKeyEnabled?: boolean; // DSK Key ON/OFF specifically for crawler
  tickerSpeed: number; // 1 to 15
  tickerTextColor: string;
  tickerBgColor: string;
  tickerFontFamily: string;
  tickerBadgeText?: string;
  tickerIs3DText: boolean;
  tickerIsAnimatedBg: boolean;
  tickerDirection: 'rtl' | 'ltr';
  tickerHeight: 'compact' | 'normal' | 'large';
  tickerPresetSize?: 'small' | 'medium' | 'large';
  tickerFontSize?: number;
  tickerPosition?: 'bottom' | 'top' | 'custom';
  customX?: number;
  customY?: number;
  customWidth?: number;
  tickerCustomX?: number;
  tickerCustomY?: number;
  tickerCustomWidth?: number;
  tickerCustomHeight?: number;
  tickerMode?: 'continuous' | 'one_by_one';
  tickerOneByOneDurationSec?: number;
  tickerDurationSec?: number; // Default scroll pass/hold duration in seconds (0 = natural 1 pass)
  tickerExpiresAt?: number | null; // Epoch ms auto-expiry timestamp for bottom ticker bar
  tickerExpiryMinutes?: number; // Helper preset minutes selected in studio
  tickerItems: TickerScrollItem[];

  // Top Scrolling Ticker
  topTickerEnabled?: boolean;
  topTickerSpeed?: number;
  topTickerTextColor?: string;
  topTickerBgColor?: string;
  topTickerFontFamily?: string;
  topTickerFontSize?: number;
  topTickerHeight?: number;
  topTickerCustomX?: number;
  topTickerCustomY?: number;
  topTickerCustomWidth?: number;
  topTickerCustomHeight?: number;
  topTickerPresetSize?: 'small' | 'medium' | 'large';
  topTickerDirection?: 'rtl' | 'ltr';
  topTickerBadgeText?: string;
  topTickerDurationSec?: number; // Default scroll pass/hold duration in seconds (0 = natural 1 pass)
  topTickerExpiresAt?: number | null; // Epoch ms auto-expiry timestamp for top ticker bar
  topTickerExpiryMinutes?: number; // Helper preset minutes selected in studio
  topTickerItems?: TickerScrollItem[];

  // Logos System: Channel Logo, Sponsor Logo 1, Sponsor Logo 2, Sponsor Logo 3, Sponsor Logo 4
  logoDisplayMode?: LogoDisplayMode; // 'all' | 'channel_only' | 'sponsor1_only' | 'sponsor2_only' | 'cycle'
  logoCycleIntervalSec?: number; // seconds between logo switch in cycle mode
  channelLogo?: LogoItemConfig;
  sponsorLogo1?: LogoItemConfig;
  sponsorLogo2?: LogoItemConfig;
  sponsorLogo3?: LogoItemConfig;
  sponsorLogo4?: LogoItemConfig;
  sponsor1Logo?: LogoItemConfig;
  sponsor2Logo?: LogoItemConfig;

  // Small Sleek Station Bug (Corner Logo) - legacy compatibility
  logoEnabled: boolean;
  logoText: string;
  logoPosition: LogoCornerPosition;
  logoOpacity: number;
  logoScale: number;
  logoSize?: number;
  customLogoUrl?: string;

  // SMPTE & Custom Broadcast Clock
  clockEnabled: boolean;
  clockFormat?: 'time_only' | 'time_date' | 'only_date' | 'date_day' | 'day_time' | 'full_day_date_time';
  clockShowDate?: boolean;
  clockUse12Hour?: boolean;
  clockShowSeconds?: boolean;
  clockPosition?: LogoCornerPosition;
  clockOffsetX?: number;
  clockOffsetY?: number;
  clockFontSize?: number;
  clockFontFamily?: string;
  clockTextColor?: string;
  clockTextOpacity?: number;
  clockIs3D?: boolean;
  clock3DColor?: string;
  clock3DDepth?: number;
  clockTransparentBg?: boolean;
  clockBgColor?: string;
  clockBgOpacity?: number;
  clockBorderColor?: string;
  clockShowBorder?: boolean;
  clockSpecialStyle?: 'standard' | 'glass_3d' | 'neon_glow' | 'news_badge' | 'gold_3d' | 'minimal_clean';

  // "BACK IN XX SEC" Commercial Break & Program Countdown Badge
  backInTimer?: BackInTimerConfig;
}

export type BackInTimerStyle = 'split_badge' | 'glass_pill' | 'news_box';

export interface BackInTimerConfig {
  enabled: boolean;
  style: BackInTimerStyle;
  labelText: string;
  position: 'top-left' | 'top-right' | 'top-center' | 'bottom-left' | 'bottom-right';
  offsetX: number;
  offsetY: number;
  fontSize: number;
  fontFamily: string;
  labelBgColor: string;
  labelTextColor: string;
  timerBgColor: string;
  timerTextColor: string;
  borderColor: string;
  showBorder: boolean;
  showShadow: boolean;
  timeFormat: 'mm_ss' | 'seconds_only';
  showDuringAds: boolean;
  showDuringPrograms: boolean;
  scale: number;
}

export type RtmpPlatformPreset =
  | 'youtube'
  | 'facebook'
  | 'twitch'
  | 'satellite_mso'
  | 'custom';

export type RtmpResolutionOption =
  | '1080p'
  | '720p'
  | '720x576'
  | '720x756'
  | '720x480'
  | '576p'
  | 'custom';

export type RtmpStreamHealthStatus = 'GREEN' | 'YELLOW' | 'RED' | 'OFFLINE';

export interface RTMPConfig {
  enabled: boolean;
  serverUrl: string;
  streamKey: string;
  showKey: boolean;
  profile: 'main' | 'high' | 'baseline';
  platform?: RtmpPlatformPreset;
  resolution?: RtmpResolutionOption;
  videoBitrateKbps?: number; // 100 to 6000 kbps
  audioBitrateKbps?: 64 | 96 | 128 | 192 | 256 | 320;
  fps?: 25 | 30 | 50 | 60;
  autoReconnect?: boolean; // Automatically reconnect on internet drops / socket disconnects
  reconnectDelaySec?: number; // 1, 2, 3, or 5 seconds
  maxReconnectAttempts?: number; // 0 for infinite, or 10, 25, 50
  adContinuityProtection?: boolean; // Ensure Every N Min ad switches do not interrupt stream
  isStreaming?: boolean;
  isReconnecting?: boolean;
  reconnectAttempts?: number;
  reconnectCountdownSec?: number;
  streamHealth?: RtmpStreamHealthStatus;
  streamHealthMessage?: string;
  outgoingBitrateKbps?: number;
  outgoingFps?: number;
  droppedFrames?: number;
  uptimeSeconds?: number;
  lastErrorMessage?: string | null;
}

export interface UDPConfig {
  enabled: boolean;
  ipAddress: string;
  port: number;
  packetSize: number; // 1316 or 188
  ttl: number;
  protocol: 'udp' | 'rtp';
  // MSO DVB-C & LAN Headend specifics
  lanInterfaceIp?: string;
  serviceId?: number; // e.g. 101
  serviceName?: string; // e.g. "CH 01 HD"
  providerName?: string; // e.g. "ASHOKA MSO"
  videoPid?: number; // e.g. 256
  audioPid?: number; // e.g. 257
  pmtPid?: number; // e.g. 4096
  pcrPid?: number; // e.g. 256
  cbrMode?: boolean;
}

export interface HlsConfig {
  enabled: boolean;
  serverIp: string; // e.g. "192.168.1.100" or local IP
  port: number; // 3000
}

export interface AudioConfig {
  masterVolume: number; // 0 to 1
  muted: boolean; // Master broadcast transmission mute (default false: ON AIR)
  softwareAudioEnabled?: boolean; // PGM Software Player audio ON/OFF (default false = OFF)
  display2AudioEnabled?: boolean; // 2nd Display Output audio ON/OFF (default true = ON)
  audioOutputTarget?: 'both' | 'software' | 'display2'; // Audio routing: Software Only, 2nd Display Only, or Both
  studioPreviewMuted?: boolean; // Control room studio desktop speaker mute (default true to prevent delay/echo)
  transmissionAudioActive?: boolean; // Broadcast transmission audio status
  codec: 'AAC' | 'MP3' | 'AC3' | 'MP2';
  sampleRate: 48000 | 44100;
  bitrate: 128 | 192 | 256 | 320;
  gainDb: number;
  channels: 'stereo' | 'mono';
  audioSyncDelayMs?: number; // -500ms to +500ms Audio match/lip-sync delay
  meterL: number;
  meterR: number;
}

export type OverlayFitMode = 'contain' | 'cover' | 'fill' | 'stretch' | '16:9' | 'center';

export interface OverlayPlaylistItem {
  id: string;
  title: string;
  fileName?: string;
  folderName?: string;
  vaultId?: string;
  enabled?: boolean; // Tick checkbox: whether item shows in output sequence
  mediaType: 'image' | 'video' | 'swf'; // PNG, JPG, GIF, MP4, MOV, MKV, SWF, etc.
  url: string;
  file?: File;
  duration: number; // in seconds (for images or default video duration)
  autoVideoDuration?: boolean; // if true, plays full video duration automatically
  fitMode: OverlayFitMode; // Fit options: contain, cover, fill/stretch, 16:9, center
  opacity?: number; // 0 to 1
  notes?: string;
  badgeText?: string;
  headline?: string;
  subline?: string;
  inPoint?: number;
  outPoint?: number;
}

export interface LShapePlaylistItem {
  id: string;
  title: string;
  fileName?: string;
  folderName?: string;
  vaultId?: string;
  enabled?: boolean; // Tick checkbox: when ticked (true), this L-Shape item shows on output playout
  mediaType: 'image' | 'video' | 'swf'; // PNG, JPG, GIF, MP4, MOV, MKV, SWF, etc.
  url: string;
  file?: File;
  duration: number; // in seconds: 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60 or custom
  autoVideoDuration?: boolean; // if true, uses natural full video clip duration
  fitMode: OverlayFitMode;
  side?: 'left' | 'right'; // Left or Right side for this L-Shape item
  renderMode?: 'squeeze' | 'overlay'; // Squeeze main video into corner OR overlay on top
  presetSize?: 'full_image' | 'too_small' | 'extra_small' | 'very_small' | 'small' | 'compact' | 'medium' | 'large' | 'full_fit' | 'custom';
  sideWidth?: number; // Custom or preset width for this item (e.g. 100 for Too Small, 140 for Extra Small)
  bottomHeight?: number; // Custom or preset height for this item (e.g. 48 for Too Small, 68 for Extra Small)
  repeatEveryMin?: number;
  repeatEverySec?: number;
  selectedTracks?: number[]; // Track 1..6 selection for L-Shape
  tickedSlots?: string[]; // 24-hour 'HH:MM' ticked time slots across Track 1..6
  slotsMask?: string; // Compact 52-char bitmask encoding canonical 312 slots
  extraSlots?: string[]; // Non-canonical 'HH:MM' slots if custom tracks are used
  track6Mode?: '25_55' | '12_25';
  track6Preset?: 'text' | 'video';
  customTracks?: CustomAdTrack[];
  dateMode?: 'every_day' | 'specific_date' | 'date_range';
  scheduledDate?: string; // YYYY-MM-DD
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  lastTriggeredSlotKey?: string;
  opacity?: number;
  notes?: string;
  price?: string; // Teleshop / sponsor price tag e.g. "₹999" or "SPECIAL OFFER"
  phone?: string; // hotline / call to order e.g. "0427-2444555"
  subtitle?: string; // e.g. "FREE HOME DELIVERY • SALEM"
  displayZone?: 'smart_l' | 'clean_l' | 'full_l_canvas' | 'chroma_key' | 'full_screen';
  cgOverlayMode?: 'all_overlays' | 'lshape_and_logo' | 'lshape_all_logos' | 'lshape_only';
  sideHeadline?: string;
  sideSubline?: string;
  bottomHeadline?: string;
  bottomSubline?: string;
  priceTag?: string;
  ctaBadge?: string;
  accentColor?: string;
}

export interface LShapeConfig {
  enabled: boolean; // ON AIR / OFF AIR
  keyEnabled?: boolean; // DSK Key ON/OFF
  side: 'left' | 'right'; // Left side or Right side L-Shape
  presetSize: 'full_image' | 'too_small' | 'extra_small' | 'very_small' | 'small' | 'compact' | 'medium' | 'large' | 'full_fit' | 'custom'; // Full Image / Too Small / Extra Small / Very Small / Small / Compact / Medium / Big
  sideWidth: number; // e.g. 100px (too small), 140px (extra small), 180px (very small), 220px (small), 280px (compact), 360px (medium), 460px (large)
  bottomHeight: number; // e.g. 48px (too small), 68px (extra small), 88px (very small), 105px (small), 130px (compact), 170px (medium), 220px (large)
  offsetX?: number; // horizontal nudge offset in px
  offsetY?: number; // vertical nudge offset in px
  squeezeProgramVideo: boolean; // True: squeezes main program video into remaining 16:9 frame; False: transparent overlay
  renderMode?: 'squeeze' | 'overlay'; // 'squeeze': sharp L-shape squeeze; 'overlay': overlay on top of video
  fitMode?: OverlayFitMode; // Default fit mode for L-Shape media
  displayZone?: 'smart_l' | 'clean_l' | 'full_l_canvas' | 'full_screen'; // How media fits inside the L-Shape or full screen
  cgOverlayMode?: 'all_overlays' | 'lshape_and_logo' | 'lshape_all_logos' | 'lshape_only'; // Default 'lshape_and_logo' = 1st Logo Only (No Sponsor Logos) during L-Shape playing time
  playMode?: 'one_by_one' | 'single' | 'periodic'; // One-by-one continuous loop, Single hold, or Periodic auto-trigger
  periodicIntervalSec?: number;
  repeatEveryMin?: number;
  selectedTracks?: number[]; // Track 1..6 selection for L-Shape
  tickedSlots?: string[]; // 24-hour 'HH:MM' ticked time slots across Track 1..6
  slotsMask?: string; // Compact 52-char bitmask encoding canonical 312 slots
  extraSlots?: string[]; // Non-canonical 'HH:MM' slots if custom tracks are used
  track6Mode?: '25_55' | '12_25';
  track6Preset?: 'text' | 'video';
  customTracks?: CustomAdTrack[];
  dateMode?: 'every_day' | 'specific_date' | 'date_range';
  scheduledDate?: string; // YYYY-MM-DD
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  lastTriggeredSlotKey?: string;
  dueQueueIndices?: number[]; // Queued L-Shape item indices to play 1-by-1 for their full duration on this time slot
  periodicActive?: boolean; // Whether periodic pop-up is currently visible on screen
  periodicCounter?: number; // Seconds counter in periodic mode
  pendingAfterAd?: boolean; // Queued to play immediately after Every N Min Ad finishes
  backgroundColor: string; // e.g. '#06080e'
  backgroundStyle: 'dark_glass' | 'solid_black' | 'gradient' | 'transparent';
  opacity: number; // 0 to 1
  intervalSeconds: number; // 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60
  playlist: LShapePlaylistItem[];
  currentIndex: number;
  currentTime: number;
  isPlaying: boolean;
  title?: string;
  showTickerInBottom?: boolean;
  borderGlow?: boolean;
  showInfoOverlay?: boolean; // Show Teleshop title, price & phone badges over uploaded media
}

export interface OverlayBannerConfig {
  enabled: boolean; // ON AIR / OFF AIR
  keyEnabled?: boolean; // DSK Key ON/OFF
  position: 'bottom' | 'top' | 'custom';
  x: number; // default 0
  y: number; // default 880 (1920x1080 -> 1080 - 200 = 880)
  width: number; // default 1920
  height: number; // default 200 ("1920 into 200")
  opacity: number; // 0 to 1
  fitMode: OverlayFitMode;
  squeezeProgramVideo?: boolean; // True: shrinks main program video while overlay plays, then returns to BIG full screen
  imageFixedDurationSec?: number; // Fixed duration in seconds for image items in Top / Bottom overlay (default 10s)
  backgroundColor: string; // e.g. '#000000', 'rgba(6, 8, 14, 0.94)'
  backgroundStyle: 'dark_glass' | 'solid_black' | 'gradient' | 'transparent';
  loopMode: 'playlist' | 'single' | 'off';
  autoPlayNext: boolean;
  transition: 'cut' | 'fade' | 'slide';
  showTickerInside: boolean;
  playlist: OverlayPlaylistItem[];
  currentIndex: number;
  currentTime: number;
  isPlaying: boolean;
  borderGlow?: boolean;
}

export type BottomOverlayConfig = OverlayBannerConfig;

export interface TransmissionConfig {
  outputResolution: OutputResolution;
  aspectRatioMode: AspectRatioMode;
  videoBitrateKbps: number; // 500 to 6000 kbps (up to 20000 for 4K)
  fps: 25 | 30 | 50 | 60 | 29.97;
  videoCodec?: 'H264' | 'MPEG2' | 'H265';
  scanMode?: 'progressive' | 'interlaced' | 'interlaced_tff' | 'interlaced_bff';
  rtmp: RTMPConfig;
  udp: UDPConfig;
  hls?: HlsConfig;
  audio: AudioConfig;
  outgoingBitrateKbps: number;
  outgoingFps: number;
  droppedFrames: number;
  jitterMs: number;
  uptimeSeconds: number;
}

export type LiveInputSourceType = 'camera' | 'm3u8' | 'stream' | 'youtube';

export interface LiveStreamItem {
  id: string;
  title: string;
  type: 'm3u8' | 'stream';
  url: string;
}

export interface YouTubeQueueItem {
  id: string;
  url: string;
  videoId?: string;
  playlistId?: string;
  title: string;
  isLive?: boolean;
  enabled?: boolean;
  durationSec?: number;
}

export interface LiveInputConfig {
  active: boolean;
  sourceType: LiveInputSourceType;
  streamUrl?: string;
  cameraDeviceId?: string;
  playEveryMinAdsOnLive?: boolean;
  playEveryNMinAdsOnLive?: boolean;
  showOverlaysOnLive?: boolean; // True: show CG overlays over Live Input; False: clean feed without overlays
  liveOverlayMode?: 'all_overlays' | 'logo_only' | 'logo_clock_only' | 'clean_none' | 'clean';
  volume?: number;
  muted?: boolean;
  activeStreamId?: string | null;
  streams?: LiveStreamItem[];
  youtubeInputText?: string;
  youtubeQueue?: YouTubeQueueItem[];
  youtubeQueueIndex?: number;
  youtubeLoop?: boolean;
  youtubeCycle?: number;
}

export interface TVChannel {
  id: number;
  name: string;
  callSign: string;
  frequency: string;
  genre: ChannelGenre;
  colorAccent: string;
  status: ChannelStatus;
  currentClipIndex: number;
  currentTime: number;
  totalDuration: number;
  autoPlayNext?: boolean;
  shuffle?: boolean;
  loopMode: 'playlist' | 'single' | 'off';
  defaultFillerMedia: {
    title: string;
    type: 'bars' | 'station_id' | 'video_loop';
    url?: string;
  };
  playlist: PlaylistItem[];
  scheduledPrograms?: ScheduledProgram[];
  activeProgramId?: string | null;
  activeProgramClipIndex?: number;
  activeProgramTime?: number;
  everyNMinAds?: EveryNMinAdItem[];
  activeEveryNMinAd?: EveryNMinAdItem | null;
  everyNMinQueue?: EveryNMinAdItem[];
  everyNMinTime?: number;
  standbyScreenMode?: 'black' | 'bars';
  savedDefaultIndex?: number;
  savedDefaultTime?: number;
  savedMainPlaybackState?: {
    clipIndex: number;
    currentTime: number;
  } | null;
  savedProgramPlaybackState?: {
    programId: string;
    clipIndex: number;
    currentTime: number;
  } | null;
  playedClipIds?: string[];
  loopFolders?: string[];
  loopCycle?: number;
  playbackContext?: 'main' | 'program' | 'everyNMinAd' | 'ad';
  liveInput?: LiveInputConfig;
  bottomOverlay?: OverlayBannerConfig;
  topOverlay?: OverlayBannerConfig;
  lShape?: LShapeConfig;
  bottomScroll?: any;
  backInTimer?: BackInTimerConfig;
  graphics: BottomScrollConfig;
  transmission: TransmissionConfig;
}
