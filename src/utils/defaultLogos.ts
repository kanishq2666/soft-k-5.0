// Default SVG data URIs for broadcast logos (PNG & GIF compatible)
// Crisp transparent HD graphics for Channel Logo, Sponsor 1, and Sponsor 2

export const createChannelLogoSvg = (id: number, accentColor: string): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100">
    <defs>
      <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0a0d14" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#141824" stop-opacity="0.95"/>
      </linearGradient>
      <linearGradient id="accGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${accentColor}"/>
        <stop offset="100%" stop-color="#ffffff"/>
      </linearGradient>
    </defs>
    <!-- Border & Shadow Box -->
    <rect x="4" y="8" width="292" height="84" rx="14" fill="url(#bgGrad)" stroke="${accentColor}" stroke-width="2.5" />
    <rect x="8" y="12" width="6" height="76" rx="3" fill="${accentColor}" />
    <!-- Channel Badge Circle -->
    <circle cx="56" cy="50" r="32" fill="${accentColor}" />
    <circle cx="56" cy="50" r="28" fill="#090a0f" />
    <text x="56" y="59" fill="#ffffff" font-family="'Inter', Arial, sans-serif" font-weight="900" font-size="28" text-anchor="middle">0${id}</text>
    <!-- Broadcast Label -->
    <text x="105" y="44" fill="#ffffff" font-family="'Inter', Arial, sans-serif" font-weight="900" font-size="24" letter-spacing="2">CH 0${id} HD</text>
    <rect x="105" y="52" width="70" height="18" rx="4" fill="${accentColor}" />
    <text x="140" y="65" fill="#ffffff" font-family="'Inter', Arial, sans-serif" font-weight="800" font-size="11" text-anchor="middle" letter-spacing="1">LIVE ON AIR</text>
    <text x="188" y="66" fill="#94a3b8" font-family="monospace" font-weight="700" font-size="13">1080p DVB</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const createSponsor1LogoSvg = (_channelId?: number): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="90" viewBox="0 0 280 90">
    <defs>
      <linearGradient id="sp1Grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1e1b4b" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95"/>
      </linearGradient>
    </defs>
    <rect x="4" y="6" width="272" height="78" rx="10" fill="url(#sp1Grad)" stroke="#6366f1" stroke-width="2"/>
    <!-- Star Icon / Badge -->
    <rect x="16" y="20" width="48" height="48" rx="8" fill="#4f46e5"/>
    <polygon points="40,26 44,36 54,37 46,44 49,54 40,48 31,54 34,44 26,37 36,36" fill="#fbbf24"/>
    <!-- Text -->
    <text x="76" y="38" fill="#a5b4fc" font-family="'Inter', Arial, sans-serif" font-weight="800" font-size="12" letter-spacing="1">TITLE SPONSOR 1</text>
    <text x="76" y="62" fill="#ffffff" font-family="'Inter', Arial, sans-serif" font-weight="900" font-size="20" letter-spacing="1">GLOBAL MEDIA</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const createSponsor2LogoSvg = (_channelId?: number): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="90" viewBox="0 0 280 90">
    <defs>
      <linearGradient id="sp2Grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#064e3b" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#022c22" stop-opacity="0.95"/>
      </linearGradient>
    </defs>
    <rect x="4" y="6" width="272" height="78" rx="10" fill="url(#sp2Grad)" stroke="#10b981" stroke-width="2"/>
    <!-- Diamond Icon -->
    <rect x="16" y="20" width="48" height="48" rx="8" fill="#059669"/>
    <polygon points="40,24 54,44 40,64 26,44" fill="#6ee7b7"/>
    <!-- Text -->
    <text x="76" y="38" fill="#6ee7b7" font-family="'Inter', Arial, sans-serif" font-weight="800" font-size="12" letter-spacing="1">POWERED BY SPONSOR 2</text>
    <text x="76" y="62" fill="#ffffff" font-family="'Inter', Arial, sans-serif" font-weight="900" font-size="20" letter-spacing="1">TELECOM 5G</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const buildDefaultLogos = (channelId: number, accentColor: string) => {
  const sponsorLogo1 = {
    id: `sponsor1-ch-${channelId}`,
    name: 'Sponsor Logo 1',
    enabled: true,
    type: 'sponsor1' as const,
    url: createSponsor1LogoSvg(channelId),
    position: 'top-left' as const,
    offsetX: 0,
    offsetY: 0,
    size: 110,
    opacity: 0.85,
    priority: 2,
  };
  const sponsorLogo2 = {
    id: `sponsor2-ch-${channelId}`,
    name: 'Sponsor Logo 2',
    enabled: false,
    type: 'sponsor2' as const,
    url: createSponsor2LogoSvg(channelId),
    position: 'bottom-left' as const,
    offsetX: 0,
    offsetY: 0,
    size: 100,
    opacity: 0.85,
    priority: 3,
  };
  return {
    logoDisplayMode: 'all' as const,
    logoCycleIntervalSec: 10,
    channelLogo: {
      id: `logo-ch-${channelId}`,
      name: `CH 0${channelId} Logo`,
      enabled: true,
      type: 'channel' as const,
      url: createChannelLogoSvg(channelId, accentColor),
      position: 'top-right' as const,
      offsetX: 0,
      offsetY: 0,
      size: 130,
      opacity: 0.95,
      priority: 1,
    },
    sponsorLogo1,
    sponsorLogo2,
    sponsor1Logo: sponsorLogo1,
    sponsor2Logo: sponsorLogo2,
  };
};
