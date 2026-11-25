import {
  BottomScrollConfig,
  LShapeConfig,
  OverlayBannerConfig,
  TVChannel,
} from '../types/playout';
import { compactCgStatePayload } from '../utils/stateCompactor';

export interface CgBackendSnapshot {
  ok?: boolean;
  updatedAt?: string;
  updatedAtMs: number;
  channelId: number;
  bottomOverlay?: OverlayBannerConfig;
  topOverlay?: OverlayBannerConfig;
  lShape?: LShapeConfig;
  graphics?: BottomScrollConfig;
}

export async function fetchCgBackendState(): Promise<CgBackendSnapshot | null> {
  try {
    const res = await fetch('/api/cg/state', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return data as CgBackendSnapshot;
  } catch {
    return null;
  }
}

export async function saveCgBackendState(channel: TVChannel): Promise<boolean> {
  try {
    const payload: CgBackendSnapshot = compactCgStatePayload({
      updatedAtMs: Date.now(),
      channelId: channel.id || 1,
      bottomOverlay: channel.bottomOverlay,
      topOverlay: channel.topOverlay,
      lShape: channel.lShape,
      graphics: channel.graphics,
    });
    const res = await fetch('/api/cg/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

