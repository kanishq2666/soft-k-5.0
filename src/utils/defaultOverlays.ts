import { OverlayBannerConfig, OverlayPlaylistItem, LShapeConfig, LShapePlaylistItem } from '../types/playout';

/**
 * Creates high-contrast, broadcast-certified 1920x200 banner SVG data URLs.
 * High-definition graphics for local Salem sponsors, breaking news L-band,
 * flash cinema promotions, and commercial banners.
 */
export const create1920x200BannerSvg = (
  channelId: number,
  accentColor: string,
  title: string,
  subtitle: string,
  badgeText: string = 'EXCLUSIVE AD'
): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="200" viewBox="0 0 1920 200">
    <defs>
      <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#05070e" stop-opacity="0.96"/>
        <stop offset="35%" stop-color="#0b101c" stop-opacity="0.94"/>
        <stop offset="70%" stop-color="#0f172a" stop-opacity="0.94"/>
        <stop offset="100%" stop-color="#04060b" stop-opacity="0.98"/>
      </linearGradient>
      <linearGradient id="glowGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${accentColor}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.2"/>
      </linearGradient>
      <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fbbf24"/>
        <stop offset="100%" stop-color="#d97706"/>
      </linearGradient>
    </defs>
    <!-- Background Frame -->
    <rect x="0" y="0" width="1920" height="200" fill="url(#bgGrad)"/>
    <rect x="0" y="0" width="1920" height="6" fill="url(#glowGrad)"/>
    <rect x="0" y="194" width="1920" height="6" fill="${accentColor}" fill-opacity="0.6"/>

    <!-- Left Accent Pillar -->
    <rect x="0" y="0" width="18" height="200" fill="${accentColor}"/>

    <!-- Channel / Sponsor Station Badge Box -->
    <rect x="36" y="24" width="220" height="152" rx="12" fill="#090d16" stroke="${accentColor}" stroke-width="2.5"/>
    <circle cx="90" cy="100" r="44" fill="${accentColor}"/>
    <circle cx="90" cy="100" r="38" fill="#030509"/>
    <text x="90" y="112" fill="#ffffff" font-family="'Inter', Arial, sans-serif" font-weight="900" font-size="34" text-anchor="middle">0${channelId}</text>
    <text x="146" y="88" fill="#ffffff" font-family="'Inter', Arial, sans-serif" font-weight="900" font-size="20">CH 0${channelId}</text>
    <rect x="146" y="98" width="94" height="26" rx="6" fill="${accentColor}"/>
    <text x="193" y="116" fill="#ffffff" font-family="'Inter', Arial, sans-serif" font-weight="800" font-size="13" text-anchor="middle" letter-spacing="1">1920x200</text>
    <text x="148" y="148" fill="#94a3b8" font-family="monospace" font-weight="700" font-size="14">OVERLAY 1</text>

    <!-- Center Banner Headline -->
    <g transform="translate(290, 0)">
      <!-- Badge Pill -->
      <rect x="0" y="32" width="180" height="32" rx="6" fill="url(#goldGrad)"/>
      <text x="90" y="54" fill="#050505" font-family="'Inter', Arial, sans-serif" font-weight="900" font-size="14" text-anchor="middle" letter-spacing="1.5">${badgeText}</text>
      
      <!-- Main Title -->
      <text x="0" y="108" fill="#ffffff" font-family="'Inter', Arial, sans-serif" font-weight="900" font-size="38" letter-spacing="0.5">${title}</text>
      <!-- Subtitle -->
      <text x="0" y="152" fill="#cbd5e1" font-family="'Inter', Arial, sans-serif" font-weight="600" font-size="22">${subtitle}</text>
    </g>

    <!-- Right Call To Action / QR / Contact -->
    <g transform="translate(1540, 24)">
      <rect x="0" y="0" width="340" height="152" rx="12" fill="#090d18" stroke="#334155" stroke-width="2"/>
      <rect x="16" y="20" width="112" height="112" rx="8" fill="#ffffff"/>
      <!-- QR mock matrix -->
      <rect x="26" y="30" width="36" height="36" fill="#000000"/>
      <rect x="34" y="38" width="20" height="20" fill="#ffffff"/>
      <rect x="82" y="30" width="36" height="36" fill="#000000"/>
      <rect x="90" y="38" width="20" height="20" fill="#ffffff"/>
      <rect x="26" y="86" width="36" height="36" fill="#000000"/>
      <rect x="34" y="94" width="20" height="20" fill="#ffffff"/>
      <rect x="74" y="74" width="16" height="16" fill="#000000"/>
      <rect x="100" y="100" width="16" height="16" fill="#000000"/>

      <text x="144" y="52" fill="#38bdf8" font-family="'Inter', Arial, sans-serif" font-weight="800" font-size="15">SALEM LIVE DESK</text>
      <text x="144" y="80" fill="#ffffff" font-family="'Inter', Arial, sans-serif" font-weight="900" font-size="22">+91 94432 00000</text>
      <text x="144" y="112" fill="#94a3b8" font-family="'Inter', Arial, sans-serif" font-weight="600" font-size="13">SCAN TO WATCH 1080p</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/**
 * Creates default 1920x200 Bottom Overlay Config for a channel
 * with a mix of PNG/JPG/GIF graphics and MP4 video items!
 */
export const buildDefaultBottomOverlay = (
  channelId: number,
  accentColor: string,
  channelGenre: string
): OverlayBannerConfig => {
  const sampleItems: OverlayPlaylistItem[] = [
    {
      id: `bot-ov-item-1-ch${channelId}`,
      title: `${channelGenre.toUpperCase()} SPECIAL 1920x200 BANNER (IMAGE)`,
      mediaType: 'image',
      url: create1920x200BannerSvg(
        channelId,
        accentColor,
        `SALEM DIGITAL PLAYOUT — CH 0${channelId} PRIME 1080p`,
        'High-Definition 1920x200 Bottom Overlay Playlist with Video & Image Playout',
        'PLAYLIST 1 • ON AIR'
      ),
      duration: 10,
      fitMode: 'fill',
      opacity: 1,
      notes: 'PNG/SVG 1920x200 Broadcast Banner',
    },
    {
      id: `bot-ov-item-2-ch${channelId}`,
      title: `SALEM MSO COMMERCIAL STRIP (VIDEO 1080p)`,
      mediaType: 'video',
      url: `/videos/ch${channelId}.mp4`,
      duration: 15,
      autoVideoDuration: true,
      fitMode: 'fill',
      opacity: 1,
      notes: 'MP4 Video playout in 1920x200 bottom banner (Full video duration)',
    },
    {
      id: `bot-ov-item-3-ch${channelId}`,
      title: `SPONSOR SPOTLIGHT (GRAPHIC AD)`,
      mediaType: 'image',
      url: create1920x200BannerSvg(
        channelId,
        accentColor,
        'MEGA JEWELLERS & TEXTILES SALEM BAZAAR',
        'Festival Special Discounts • 100% Hallmarked Gold & Pure Kanchipuram Silk',
        'GOLD SPONSOR'
      ),
      duration: 10,
      autoVideoDuration: false,
      fitMode: 'fill',
      opacity: 1,
      notes: 'Commercial Ad 1920x200 (Fixed 10s image duration)',
    },
  ];

  return {
    enabled: true,
    keyEnabled: true,
    position: 'bottom',
    x: 0,
    y: 880, // 1080 - 200 = 880 (Bottom 200px of full 1920x1080 canvas)
    width: 1920,
    height: 200,
    opacity: 1,
    fitMode: 'fill',
    imageFixedDurationSec: 10,
    backgroundColor: '#06080e',
    backgroundStyle: 'dark_glass',
    loopMode: 'playlist',
    autoPlayNext: true,
    transition: 'fade',
    showTickerInside: false,
    playlist: sampleItems,
    currentIndex: 0,
    currentTime: 0,
    isPlaying: true,
    borderGlow: true,
  };
};

/**
 * Creates default Top Overlay Config for a channel
 */
export const buildDefaultTopOverlay = (
  channelId: number,
  accentColor: string
): OverlayBannerConfig => {
  return {
    enabled: false,
    keyEnabled: true,
    position: 'top',
    x: 0,
    y: 0,
    width: 1920,
    height: 90,
    opacity: 1,
    fitMode: 'fill',
    imageFixedDurationSec: 10,
    backgroundColor: '#05070d',
    backgroundStyle: 'dark_glass',
    loopMode: 'playlist',
    autoPlayNext: true,
    transition: 'fade',
    showTickerInside: false,
    playlist: [
      {
        id: `top-ov-item-1-ch${channelId}`,
        title: `TOP SPONSOR BUG (CH 0${channelId} - IMAGE)`,
        mediaType: 'image',
        url: create1920x200BannerSvg(
          channelId,
          accentColor,
          `ASHOKA MSO PLAYLIST • TOP SPONSOR BANNER`,
          'Live MSO Transmission via 720x756 / 720x576 / 1080p DVB-C & IP Headends',
          'TOP BANNER'
        ),
        duration: 10,
        autoVideoDuration: false,
        fitMode: 'fill',
        opacity: 1,
      },
      {
        id: `top-ov-item-2-ch${channelId}`,
        title: `TOP PROMO VIDEO STRIP (CH 0${channelId} - FULL VIDEO)`,
        mediaType: 'video',
        url: `/videos/ch${channelId}.mp4`,
        duration: 15,
        autoVideoDuration: true,
        fitMode: 'fill',
        opacity: 1,
        notes: 'Full video duration playout in Top Overlay Banner',
      },
    ],
    currentIndex: 0,
    currentTime: 0,
    isPlaying: true,
  };
};

/**
 * Generates clean broadcast-grade 1920x1080 L-Shape graphic frame SVG data URL
 * with transparent upper video box and sharp Left or Right vertical pillar + bottom bar.
 */
export const createLShapeGraphicSvg = (
  channelId: number,
  accentColor: string = '#EF4444',
  side: 'left' | 'right' = 'left',
  title: string = 'ASHOKA SPECIAL OFFER',
  price: string = '₹999 ONLY',
  phone: string = '96003 29596'
): string => {
  const isLeft = side !== 'right';
  const pillarX = isLeft ? 0 : 1540;
  const centerPillarX = pillarX + 190;
  const borderX = isLeft ? 377 : 1540;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="lPillarGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0b1120"/>
        <stop offset="50%" stop-color="#1e1b4b"/>
        <stop offset="100%" stop-color="#050811"/>
      </linearGradient>
      <linearGradient id="lBotGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#050811"/>
        <stop offset="40%" stop-color="#172554"/>
        <stop offset="80%" stop-color="#3b0764"/>
        <stop offset="100%" stop-color="#090d16"/>
      </linearGradient>
      <linearGradient id="goldBadge" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fde047"/>
        <stop offset="100%" stop-color="#d97706"/>
      </linearGradient>
    </defs>

    <!-- Vertical Pillar (${isLeft ? 'Left' : 'Right'} 380x900) -->
    <rect x="${pillarX}" y="0" width="380" height="900" fill="url(#lPillarGrad)"/>
    
    <!-- Bottom Horizontal Bar (1920x180 at y=900) -->
    <rect x="0" y="900" width="1920" height="180" fill="url(#lBotGrad)"/>

    <!-- Sharp Inner L-Corner Accent Borders -->
    <rect x="${borderX}" y="0" width="4" height="900" fill="${accentColor}"/>
    <rect x="0" y="900" width="1920" height="4" fill="${accentColor}"/>

    <!-- Vertical Pillar Content -->
    <rect x="${pillarX + 24}" y="28" width="332" height="68" rx="10" fill="${accentColor}"/>
    <text x="${centerPillarX}" y="72" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="28" text-anchor="middle">CH 0${channelId} SPONSOR</text>

    <rect x="${pillarX + 24}" y="124" width="332" height="320" rx="16" fill="#090d16" stroke="#fbbf24" stroke-width="3"/>
    <text x="${centerPillarX}" y="200" fill="#fbbf24" font-family="Arial, sans-serif" font-weight="900" font-size="30" text-anchor="middle">MEGA OFFER</text>
    <text x="${centerPillarX}" y="268" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="44" text-anchor="middle">${price}</text>
    <rect x="${pillarX + 54}" y="310" width="272" height="54" rx="10" fill="url(#goldBadge)"/>
    <text x="${centerPillarX}" y="346" fill="#000000" font-family="Arial, sans-serif" font-weight="900" font-size="24" text-anchor="middle">LIMITED TIME</text>

    <rect x="${pillarX + 24}" y="476" width="332" height="380" rx="16" fill="#060913" stroke="#38bdf8" stroke-width="2"/>
    <text x="${centerPillarX}" y="545" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="900" font-size="24" text-anchor="middle">SALEM BAZAAR</text>
    <text x="${centerPillarX}" y="610" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="26" text-anchor="middle">100% QUALITY</text>
    <text x="${centerPillarX}" y="660" fill="#cbd5e1" font-family="Arial, sans-serif" font-weight="700" font-size="20" text-anchor="middle">BEST FESTIVAL PRICE</text>
    <rect x="${pillarX + 40}" y="710" width="300" height="100" rx="12" fill="#dc2626"/>
    <text x="${centerPillarX}" y="752" fill="#fde047" font-family="Arial, sans-serif" font-weight="900" font-size="20" text-anchor="middle">BOOK NOW</text>
    <text x="${centerPillarX}" y="790" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="24" text-anchor="middle">${phone}</text>

    <!-- Bottom Bar Content -->
    <rect x="32" y="924" width="240" height="132" rx="12" fill="url(#goldBadge)"/>
    <text x="152" y="982" fill="#000000" font-family="Arial, sans-serif" font-weight="900" font-size="28" text-anchor="middle">SPECIAL AD</text>
    <text x="152" y="1026" fill="#000000" font-family="Arial, sans-serif" font-weight="900" font-size="32" text-anchor="middle">${price}</text>

    <text x="310" y="982" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="48">${title}</text>
    <text x="310" y="1034" fill="#fde047" font-family="Arial, sans-serif" font-weight="800" font-size="28">ASHOKA DIGITAL SATELLITE L-SHAPE COMMERCIAL • ${phone}</text>

    <rect x="1520" y="924" width="368" height="132" rx="12" fill="#050811" stroke="#fbbf24" stroke-width="3"/>
    <text x="1704" y="974" fill="#38bdf8" font-family="Arial, sans-serif" font-weight="900" font-size="22" text-anchor="middle">CALL FOR BOOKING</text>
    <text x="1704" y="1024" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="34" text-anchor="middle">${phone}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/**
 * Default L-Shape configuration with full visibility (opacity: 1, 380x180 sharp squeeze)
 */
export const buildDefaultLShape = (
  _channelId: number,
  _accentColor: string,
  side: 'left' | 'right' = 'left'
): LShapeConfig => {
  return {
    enabled: false,
    keyEnabled: true,
    side,
    presetSize: 'medium',
    cgOverlayMode: 'lshape_and_logo',
    sideWidth: 380,
    bottomHeight: 180,
    offsetX: 0,
    offsetY: 0,
    squeezeProgramVideo: true,
    renderMode: 'squeeze',
    fitMode: 'fill',
    displayZone: 'clean_l',
    playMode: 'periodic',
    repeatEveryMin: 0,
    periodicIntervalSec: 15,
    periodicActive: true,
    periodicCounter: 0,
    backgroundColor: '#06080e',
    backgroundStyle: 'dark_glass',
    opacity: 1,
    intervalSeconds: 15,
    playlist: [],
    currentIndex: 0,
    currentTime: 0,
    isPlaying: true,
    showTickerInBottom: false,
    borderGlow: true,
    showInfoOverlay: false,
  };
};
