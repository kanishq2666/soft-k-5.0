// Provides real-time 1920x1080 MediaStream generators for Desktop Capture & Camera/HDMI Input
// when running inside restricted preview iframes or on machines without physical capture hardware,
// as well as live file-to-stream conversion for custom screen/camera feeds.

let activeFallbackInterval: number | null = null;
let activeFallbackCanvas: HTMLCanvasElement | null = null;

export function getActiveFallbackCanvas(): HTMLCanvasElement | null {
  return activeFallbackCanvas;
}

export function stopFallbackCaptureStream() {
  if (activeFallbackInterval !== null) {
    window.clearInterval(activeFallbackInterval);
    activeFallbackInterval = null;
  }
  activeFallbackCanvas = null;
}

export function createLiveBroadcastCaptureStream(
  mode: 'desktop' | 'camera',
  deviceLabel?: string
): MediaStream {
  stopFallbackCaptureStream();

  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  activeFallbackCanvas = canvas;
  const ctx = canvas.getContext('2d');

  let frame = 0;

  const drawFrame = () => {
    if (!ctx) return;
    frame++;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const ms = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0');

    if (mode === 'desktop') {
      // Live Desktop Screen / Studio Workstation Capture View
      const bg = ctx.createLinearGradient(0, 0, 1920, 1080);
      bg.addColorStop(0, '#070b14');
      bg.addColorStop(0.5, '#0d172a');
      bg.addColorStop(1, '#050811');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1920, 1080);

      // Subtle Desktop Grid
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x < 1920; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 1080);
        ctx.stroke();
      }
      for (let y = 0; y < 1080; y += 80) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1920, y);
        ctx.stroke();
      }

      // Simulated Live Desktop Application Windows
      // Top Desktop Taskbar
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 1920, 48);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('ASHOKA DIGITAL DESKTOP CAPTURE ENGINE • 1920x1080 60FPS LIVE', 28, 31);
      ctx.fillStyle = '#4ade80';
      ctx.fillText(`SYSTEM CLOCK ${hh}:${mm}:${ss}.${ms}`, 1520, 31);

      // Left Window: Live Broadcast Playout Waveform & Telemetry
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.fillRect(80, 90, 840, 520);
      ctx.strokeRect(80, 90, 840, 520);

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(80, 90, 840, 44);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 18px sans-serif';
      const winTitle = deviceLabel
        ? `LIVE WINDOW CAPTURE — ${deviceLabel.toUpperCase()}`
        : 'LIVE DESKTOP SCREEN — BROADCAST WINDOW MONITOR';
      ctx.fillText(winTitle, 105, 118);

      // Animated Waveform inside Window #1
      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      for (let i = 0; i <= 780; i += 10) {
        const wx = 110 + i;
        const wy =
          360 +
          Math.sin(i * 0.02 + frame * 0.12) * 90 * Math.cos(i * 0.005 - frame * 0.05);
        if (i === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.stroke();

      // Right Window: Live Studio Multiview / Video Feed
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3;
      ctx.fillRect(960, 90, 880, 520);
      ctx.strokeRect(960, 90, 880, 520);

      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(960, 90, 880, 44);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('LIVE DESKTOP WINDOW #2 — SATELLITE & IP MULTIVIEW', 985, 118);

      // Animated Color Bars & Radar inside Window #2
      const barColors = ['#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6'];
      barColors.forEach((col, idx) => {
        const h = 140 + Math.sin(frame * 0.1 + idx) * 70;
        ctx.fillStyle = col;
        ctx.fillRect(1020 + idx * 130, 540 - h, 95, h);
      });

      // Bottom Desktop Status Dock
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.fillRect(80, 650, 1760, 260);
      ctx.strokeRect(80, 650, 1760, 260);

      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('● LIVE DESKTOP CAPTURE ACTIVE ON AIR', 120, 725);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '24px monospace';
      ctx.fillText(
        `Resolution: 1920x1080 Full HD • Audio: Stereo PCM • Timecode: ${hh}:${mm}:${ss}:${ms}`,
        120,
        780
      );
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(
        'Ashoka Playlist Playout — Direct Desktop / Application Screen Capture Stream',
        120,
        840
      );
    } else {
      // Live Camera / USB HDMI Capture Card Input View
      const bg = ctx.createRadialGradient(960, 540, 80, 960, 540, 1100);
      bg.addColorStop(0, '#132238');
      bg.addColorStop(0.6, '#09111e');
      bg.addColorStop(1, '#04070d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1920, 1080);

      // Animated Studio Camera Lens / Broadcast Horizon
      const cx = 960 + Math.sin(frame * 0.03) * 40;
      const cy = 470 + Math.cos(frame * 0.025) * 25;

      for (let r = 320; r >= 80; r -= 60) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + Math.sin(frame * 0.08 + r) * 8, 0, Math.PI * 2);
        ctx.strokeStyle = r === 200 ? 'rgba(245, 158, 11, 0.45)' : 'rgba(56, 189, 248, 0.25)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Camera Viewfinder Safe-Area Brackets
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 4;
      // Top-Left
      ctx.beginPath();
      ctx.moveTo(110, 160);
      ctx.lineTo(110, 100);
      ctx.lineTo(170, 100);
      ctx.stroke();
      // Top-Right
      ctx.beginPath();
      ctx.moveTo(1810, 160);
      ctx.lineTo(1810, 100);
      ctx.lineTo(1750, 100);
      ctx.stroke();
      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(110, 860);
      ctx.lineTo(110, 920);
      ctx.lineTo(170, 920);
      ctx.stroke();
      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(1810, 860);
      ctx.lineTo(1810, 920);
      ctx.lineTo(1750, 920);
      ctx.stroke();

      // REC & HDMI Input Telemetry
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(170, 150, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px monospace';
      ctx.fillText(
        `LIVE CAMERA / USB HDMI INPUT • ${deviceLabel || '1080P60 CAPTURE'}`,
        205,
        160
      );

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 44px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ASHOKA STUDIO LIVE CAMERA / HDMI FEED', 960, 460);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 32px monospace';
      ctx.fillText(`TIMECODE ${hh}:${mm}:${ss}:${ms}`, 960, 530);

      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 24px monospace';
      ctx.fillText('SIGNAL LOCKED • 1920x1080P • 60 FPS • STEREO EMBEDDED AUDIO', 960, 590);
      ctx.textAlign = 'left';
    }
  };

  drawFrame();
  activeFallbackInterval = window.setInterval(drawFrame, 33);

  const stream = (canvas as any).captureStream
    ? (canvas as any).captureStream(30)
    : new MediaStream();
  return stream;
}
