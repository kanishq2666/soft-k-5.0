/**
 * Native Windows PE32 (.exe), Multi-Resolution Icon (.ico), and
 * 100% Self-Contained Offline + Online Setup.exe Builder (ZERO LOGIN REQUIRED)
 *
 * Builds genuine Windows GUI Executables (Setup.exe & Ashoka_MSO_Playlist.exe)
 * with embedded RT_ICON & RT_GROUP_ICON resources, plus an embedded ZIP archive
 * containing the compiled React application, all 6 channel MP4 videos, custom icon,
 * and local offline OBS-style installer wizard so the software installs and runs
 * 100% Offline and Online on Windows without EVER asking for a login.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const ICON_SIZES = [256, 64, 48, 32, 16];

function alignUp(val: number, align: number): number {
  return Math.ceil(val / align) * align;
}

/**
 * Standard CRC-32 calculation for ZIP archive entries
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds a standard ZIP archive buffer in memory compatible with Windows ZipFile / Expand-Archive
 */
export function buildZipArchiveBuffer(
  entries: Array<{ name: string; data: Buffer; compress?: boolean }>
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const uncompressedSize = entry.data.length;
    const crc = crc32(entry.data);
    const shouldCompress = entry.compress !== false && uncompressedSize > 128;
    const compressedData = shouldCompress
      ? zlib.deflateRawSync(entry.data, { level: 9 })
      : entry.data;
    const method = shouldCompress ? 8 : 0; // 8 = DEFLATE, 0 = STORE

    // Local File Header (30 bytes + file name)
    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0); // signature
    lfh.writeUInt16LE(20, 4); // version needed (2.0)
    lfh.writeUInt16LE(0, 6); // general purpose bit flag
    lfh.writeUInt16LE(method, 8); // compression method
    lfh.writeUInt16LE(0, 10); // last mod time
    lfh.writeUInt16LE(0x5421, 12); // last mod date
    lfh.writeUInt32LE(crc, 14); // crc-32
    lfh.writeUInt32LE(compressedData.length, 18); // compressed size
    lfh.writeUInt32LE(uncompressedSize, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26); // file name length
    lfh.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(lfh, 30);

    localParts.push(lfh, compressedData);

    // Central Directory File Header (46 bytes + file name)
    const cdfh = Buffer.alloc(46 + nameBuf.length);
    cdfh.writeUInt32LE(0x02014b50, 0); // signature
    cdfh.writeUInt16LE(20, 4); // version made by
    cdfh.writeUInt16LE(20, 6); // version needed
    cdfh.writeUInt16LE(0, 8); // flags
    cdfh.writeUInt16LE(method, 10); // compression method
    cdfh.writeUInt16LE(0, 12); // last mod time
    cdfh.writeUInt16LE(0x5421, 14); // last mod date
    cdfh.writeUInt32LE(crc, 16); // crc-32
    cdfh.writeUInt32LE(compressedData.length, 20); // compressed size
    cdfh.writeUInt32LE(uncompressedSize, 24); // uncompressed size
    cdfh.writeUInt16LE(nameBuf.length, 28); // file name length
    cdfh.writeUInt16LE(0, 30); // extra field length
    cdfh.writeUInt16LE(0, 32); // file comment length
    cdfh.writeUInt16LE(0, 34); // disk number start
    cdfh.writeUInt16LE(0, 36); // internal file attributes
    cdfh.writeUInt32LE(0, 38); // external file attributes
    cdfh.writeUInt32LE(localOffset, 42); // relative offset of local header
    nameBuf.copy(cdfh, 46);

    centralParts.push(cdfh);
    localOffset += lfh.length + compressedData.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // number of this disk
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirBuf.length, 12); // size of central directory
  eocd.writeUInt32LE(localOffset, 16); // offset of start of central directory
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function pointToSegmentDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - x1, py - y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - x2, py - y2);
  const b = c1 / c2;
  return Math.hypot(px - (x1 + b * vx), py - (y1 + b * vy));
}

function roundedRectSdf(
  px: number,
  py: number,
  rx0: number,
  ry0: number,
  rw: number,
  rh: number,
  rad: number
): number {
  const cx = rx0 + rw * 0.5;
  const cy = ry0 + rh * 0.5;
  const hx = rw * 0.5 - rad;
  const hy = rh * 0.5 - rad;
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - rad;
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Samples the exact 256x256 Ashoka SVG icon geometry at coordinate (u, v) in [0..256]
 * returning [r, g, b, a] in 0..255.
 */
function sampleAshokaSvgPixel(u: number, v: number): [number, number, number, number] {
  // 1. Outer Rounded Badge Rect (x:8..248, y:8..248, rx:54)
  const outerDist = roundedRectSdf(u, v, 8, 8, 240, 240, 54);
  if (outerDist > 0.8) {
    return [0, 0, 0, 0];
  }
  const outerAlpha = outerDist > -0.8 ? Math.round(((0.8 - outerDist) / 1.6) * 255) : 255;

  // Outer pure white stroke (stroke-width 11)
  if (outerDist >= -11) {
    return [255, 255, 255, outerAlpha];
  }

  let lum = 0; // monochrome high-contrast pure black (#000) & white (#FFF) icon

  // Subtle inner frame accent (x:20..236, y:20..236, rx:44)
  const innerFrameDist = Math.abs(roundedRectSdf(u, v, 20, 20, 216, 216, 44));
  if (innerFrameDist <= 1.2) {
    lum = 90;
  }

  // 2. Broadcast Antennas & Tips
  const antLeft = pointToSegmentDist(u, v, 112, 74, 78, 36);
  const antRight = pointToSegmentDist(u, v, 128, 74, 164, 36);
  const tipLeft = Math.hypot(u - 76, v - 34);
  const tipRight = Math.hypot(u - 166, v - 34);
  if (antLeft <= 4.5 || antRight <= 4.5 || tipLeft <= 7 || tipRight <= 7) {
    lum = 255;
  }

  // 3. TV Stand Legs
  const legL = pointToSegmentDist(u, v, 74, 196, 62, 214);
  const legR = pointToSegmentDist(u, v, 158, 196, 170, 214);
  if (legL <= 4.5 || legR <= 4.5) {
    lum = 255;
  }

  // 4. TV Outer Cabinet (x:34..198, y:74..194, rx:24)
  const tvCabDist = roundedRectSdf(u, v, 34, 74, 164, 120, 24);
  if (tvCabDist <= 4.5) {
    if (tvCabDist >= -5) {
      lum = 255;
    } else {
      lum = 0;
      // Inner TV Screen Frame (x:48..164, y:88..180, rx:14)
      const scrDist = roundedRectSdf(u, v, 48, 88, 116, 92, 14);
      if (scrDist <= 2.8 && scrDist >= -2.8) {
        lum = 255;
      }

      // Bold Geometric "TV" Inside Screen
      const inTBar = u >= 62 && u <= 100 && v >= 110 && v <= 122;
      const inTStem = u >= 75 && u <= 87 && v >= 122 && v <= 160;
      const inVLeft =
        v >= 110 &&
        v <= 160 &&
        (() => {
          const t = (v - 110) / 50;
          const xL = 104 + t * 16;
          const xR = 117 + t * 9;
          return u >= xL && u <= xR;
        })();
      const inVRight =
        v >= 110 &&
        v <= 160 &&
        (() => {
          const t = (v - 110) / 50;
          const xL = 135 - t * 9;
          const xR = 148 - t * 16;
          return u >= xL && u <= xR;
        })();
      if (inTBar || inTStem || inVLeft || inVRight) {
        lum = 255;
      }

      // Right-Side TV Dials & Speaker Grille Bars
      const d1 = Math.hypot(u - 181, v - 108);
      const d2 = Math.hypot(u - 181, v - 128);
      const g1 = pointToSegmentDist(u, v, 175, 148, 187, 148);
      const g2 = pointToSegmentDist(u, v, 175, 158, 187, 158);
      const g3 = pointToSegmentDist(u, v, 175, 168, 187, 168);
      if (d1 <= 7 || (d2 <= 6.5 && d2 >= 3.0) || g1 <= 2.2 || g2 <= 2.2 || g3 <= 2.2) {
        lum = 255;
      }
    }
  }

  // 5. Overlapping Bottom-Right Play Broadcast Circle (cx:188, cy:178, r:36)
  const playCircleDist = Math.hypot(u - 188, v - 178);
  if (playCircleDist <= 40) {
    if (playCircleDist >= 31.5) {
      lum = 255;
    } else if (pointInTriangle(u, v, 177, 160, 209, 178, 177, 196)) {
      lum = 255;
    } else {
      lum = 0;
    }
  }

  return [lum, lum, lum, outerAlpha];
}

/**
 * Renders the custom ASHOKA MSO PLAYLIST broadcast icon at `size x size`
 * as a 32-bit BGRA Windows DIB (BITMAPINFOHEADER + bottom-up pixels + 1-bit AND mask)
 * using 2x2 supersampled anti-aliasing matching /public/assets/ashoka-icon.svg.
 */
export function createAshokaIconDibFrame(size: number): Buffer {
  const xorSize = size * size * 4;
  const andRowBytes = Math.ceil(size / 32) * 4;
  const andSize = andRowBytes * size;
  const totalSize = 40 + xorSize + andSize;

  const buf = Buffer.alloc(totalSize, 0);

  buf.writeUInt32LE(40, 0); // biSize
  buf.writeInt32LE(size, 4); // biWidth
  buf.writeInt32LE(size * 2, 8); // biHeight
  buf.writeUInt16LE(1, 12); // biPlanes
  buf.writeUInt16LE(32, 14); // biBitCount (32-bit BGRA)
  buf.writeUInt32LE(0, 16); // biCompression (BI_RGB)
  buf.writeUInt32LE(xorSize + andSize, 20); // biSizeImage

  const scaleToSvg = 256.0 / size;
  const subOffsets = [0.25, 0.75];

  for (let y = 0; y < size; y++) {
    const dibY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const idx = 40 + (dibY * size + x) * 4;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;

      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const u = (x + subOffsets[sx]) * scaleToSvg;
          const v = (y + subOffsets[sy]) * scaleToSvg;
          const [sr, sg, sb, sa] = sampleAshokaSvgPixel(u, v);
          sumR += sr * (sa / 255);
          sumG += sg * (sa / 255);
          sumB += sb * (sa / 255);
          sumA += sa;
        }
      }

      const avgA = Math.round(sumA / 4);
      if (avgA <= 0) {
        buf.writeUInt32LE(0x00000000, idx);
        continue;
      }
      const norm = sumA / 255;
      const r = norm > 0 ? Math.min(255, Math.round(sumR / norm)) : 0;
      const g = norm > 0 ? Math.min(255, Math.round(sumG / norm)) : 0;
      const b = norm > 0 ? Math.min(255, Math.round(sumB / norm)) : 0;

      buf[idx] = b;
      buf[idx + 1] = g;
      buf[idx + 2] = r;
      buf[idx + 3] = avgA;
    }
  }

  return buf;
}

/**
 * Generates a standalone multi-resolution Windows `.ico` file buffer
 */
export function generateAshokaIcoBuffer(): Buffer {
  const frames = ICON_SIZES.map((sz) => createAshokaIconDibFrame(sz));
  const headerSize = 6 + frames.length * 16;
  const dirBuf = Buffer.alloc(headerSize, 0);

  dirBuf.writeUInt16LE(0, 0);
  dirBuf.writeUInt16LE(1, 2);
  dirBuf.writeUInt16LE(frames.length, 4);

  let dataOffset = headerSize;
  for (let i = 0; i < frames.length; i++) {
    const sz = ICON_SIZES[i];
    const frame = frames[i];
    const entryPos = 6 + i * 16;
    dirBuf.writeUInt8(sz === 256 ? 0 : sz, entryPos);
    dirBuf.writeUInt8(sz === 256 ? 0 : sz, entryPos + 1);
    dirBuf.writeUInt8(0, entryPos + 2);
    dirBuf.writeUInt8(0, entryPos + 3);
    dirBuf.writeUInt16LE(1, entryPos + 4);
    dirBuf.writeUInt16LE(32, entryPos + 6);
    dirBuf.writeUInt32LE(frame.length, entryPos + 8);
    dirBuf.writeUInt32LE(dataOffset, entryPos + 12);
    dataOffset += frame.length;
  }

  return Buffer.concat([dirBuf, ...frames]);
}

/**
 * Builds a complete, valid Windows 32-bit GUI Executable (.exe) that runs on both
 * 32-bit and 64-bit Windows 10/11, with:
 * - Embedded Ashoka MSO Playlist icon in `.rsrc`
 * - `GetModuleFileNameA` + `SetEnvironmentVariableA("ASHOKA_EXE", ...)` so the process
 *   and any child script knows the exact path of the running `.exe`
 * - Optional appended overlay payload (for self-extracting offline+online installer)
 */
export function buildWindowsGuiExeWithIcon(
  commandLine: string,
  showWindow = 0,
  overlayPayload?: Buffer
): Buffer {
  const frames = ICON_SIZES.map((sz) => createAshokaIconDibFrame(sz));
  const n = frames.length;
  const rsrcRva = 0x3000;

  // Dynamic PE .rsrc tree layout supporting any number of icon resolutions cleanly
  const rootDirOffset = 0x00;
  const rtIconDirOffset = 0x20; // 16 + 2*8
  const rtIconDirSize = 16 + n * 8;
  const rtGroupDirOffset = rtIconDirOffset + rtIconDirSize;
  const rtGroupDirSize = 16 + 8; // 0x18
  const langDirsStart = rtGroupDirOffset + rtGroupDirSize;
  const totalLangDirs = n + 1; // N icons + 1 group icon
  const dataEntriesStart = langDirsStart + totalLangDirs * 0x18;
  const grpIconSize = 6 + n * 14;
  const grpIconOffset = alignUp(dataEntriesStart + totalLangDirs * 0x10, 8);

  const grpIconBuf = Buffer.alloc(grpIconSize, 0);
  grpIconBuf.writeUInt16LE(0, 0);
  grpIconBuf.writeUInt16LE(1, 2);
  grpIconBuf.writeUInt16LE(n, 4);

  let currentDataOffset = alignUp(grpIconOffset + grpIconSize, 8);
  const frameOffsets: number[] = [];
  for (let i = 0; i < n; i++) {
    frameOffsets.push(currentDataOffset);
    currentDataOffset = alignUp(currentDataOffset + frames[i].length, 8);

    const sz = ICON_SIZES[i];
    const entryPos = 6 + i * 14;
    grpIconBuf.writeUInt8(sz === 256 ? 0 : sz, entryPos);
    grpIconBuf.writeUInt8(sz === 256 ? 0 : sz, entryPos + 1);
    grpIconBuf.writeUInt8(0, entryPos + 2);
    grpIconBuf.writeUInt8(0, entryPos + 3);
    grpIconBuf.writeUInt16LE(1, entryPos + 4);
    grpIconBuf.writeUInt16LE(32, entryPos + 6);
    grpIconBuf.writeUInt32LE(frames[i].length, entryPos + 8);
    grpIconBuf.writeUInt16LE(i + 1, entryPos + 12);
  }

  const rsrcVirtualSize = currentDataOffset;
  const rsrcRawSize = alignUp(rsrcVirtualSize, 0x200);
  const rsrcBuf = Buffer.alloc(rsrcRawSize, 0);

  // Root Directory at 0x00
  rsrcBuf.writeUInt16LE(0, rootDirOffset + 12);
  rsrcBuf.writeUInt16LE(2, rootDirOffset + 14);
  rsrcBuf.writeUInt32LE(3, rootDirOffset + 16); // RT_ICON
  rsrcBuf.writeUInt32LE((0x80000000 | rtIconDirOffset) >>> 0, rootDirOffset + 20);
  rsrcBuf.writeUInt32LE(14, rootDirOffset + 24); // RT_GROUP_ICON
  rsrcBuf.writeUInt32LE((0x80000000 | rtGroupDirOffset) >>> 0, rootDirOffset + 28);

  // RT_ICON Subdirectory
  rsrcBuf.writeUInt16LE(0, rtIconDirOffset + 12);
  rsrcBuf.writeUInt16LE(n, rtIconDirOffset + 14);
  for (let i = 0; i < n; i++) {
    const entryPos = rtIconDirOffset + 16 + i * 8;
    const langDirOffset = langDirsStart + i * 0x18;
    rsrcBuf.writeUInt32LE(i + 1, entryPos);
    rsrcBuf.writeUInt32LE((0x80000000 | langDirOffset) >>> 0, entryPos + 4);
  }

  // RT_GROUP_ICON Subdirectory (1 group ID = 1)
  const groupLangDirOffset = langDirsStart + n * 0x18;
  rsrcBuf.writeUInt16LE(0, rtGroupDirOffset + 12);
  rsrcBuf.writeUInt16LE(1, rtGroupDirOffset + 14);
  rsrcBuf.writeUInt32LE(1, rtGroupDirOffset + 16);
  rsrcBuf.writeUInt32LE((0x80000000 | groupLangDirOffset) >>> 0, rtGroupDirOffset + 20);

  for (let i = 0; i < totalLangDirs; i++) {
    const langDirOffset = langDirsStart + i * 0x18;
    const dataEntryOffset = dataEntriesStart + i * 0x10;
    rsrcBuf.writeUInt16LE(0, langDirOffset + 12);
    rsrcBuf.writeUInt16LE(1, langDirOffset + 14);
    rsrcBuf.writeUInt32LE(0x0409, langDirOffset + 16);
    rsrcBuf.writeUInt32LE(dataEntryOffset, langDirOffset + 20);

    if (i < n) {
      rsrcBuf.writeUInt32LE(rsrcRva + frameOffsets[i], dataEntryOffset);
      rsrcBuf.writeUInt32LE(frames[i].length, dataEntryOffset + 4);
    } else {
      rsrcBuf.writeUInt32LE(rsrcRva + grpIconOffset, dataEntryOffset);
      rsrcBuf.writeUInt32LE(grpIconSize, dataEntryOffset + 4);
    }
  }

  grpIconBuf.copy(rsrcBuf, grpIconOffset);
  for (let i = 0; i < n; i++) {
    frames[i].copy(rsrcBuf, frameOffsets[i]);
  }

  // 2. Construct .text section (RVA 0x1000, RawOffset 0x400, RawSize 0x200)
  const textBuf = Buffer.alloc(0x200, 0);
  const code = Buffer.from([
    // GetModuleFileNameA(0, 0x00402500, 512)
    0x68, 0x00, 0x02, 0x00, 0x00, // push 512
    0x68, 0x00, 0x25, 0x40, 0x00, // push 0x00402500 (exePath buffer)
    0x6a, 0x00, // push 0
    0xff, 0x15, 0x50, 0x20, 0x40, 0x00, // call dword ptr [0x00402050] (GetModuleFileNameA)

    // SetEnvironmentVariableA("ASHOKA_EXE", 0x00402500)
    0x68, 0x00, 0x25, 0x40, 0x00, // push 0x00402500
    0x68, 0xc0, 0x20, 0x40, 0x00, // push 0x004020C0 ("ASHOKA_EXE")
    0xff, 0x15, 0x54, 0x20, 0x40, 0x00, // call dword ptr [0x00402054] (SetEnvironmentVariableA)

    // WinExec(0x00402100, showWindow)
    0x6a, showWindow & 0xff, // push uCmdShow
    0x68, 0x00, 0x21, 0x40, 0x00, // push 0x00402100 (lpCmdLine)
    0xff, 0x15, 0x48, 0x20, 0x40, 0x00, // call dword ptr [0x00402048] (WinExec)

    // ExitProcess(0)
    0x6a, 0x00, // push 0
    0xff, 0x15, 0x4c, 0x20, 0x40, 0x00, // call dword ptr [0x0040204C] (ExitProcess)
    0xc3, // ret
  ]);
  code.copy(textBuf, 0);

  // 3. Construct .rdata section (RVA 0x2000, RawOffset 0x600, RawSize 0x800, Writable)
  const rdataBuf = Buffer.alloc(0x800, 0);
  rdataBuf.writeUInt32LE(0x2030, 0); // OriginalFirstThunk
  rdataBuf.writeUInt32LE(0, 4);
  rdataBuf.writeUInt32LE(0, 8);
  rdataBuf.writeUInt32LE(0x2060, 12); // Name RVA ("KERNEL32.dll")
  rdataBuf.writeUInt32LE(0x2048, 16); // FirstThunk (IAT RVA)

  // ILT at 0x30
  rdataBuf.writeUInt32LE(0x2070, 0x30); // WinExec
  rdataBuf.writeUInt32LE(0x207a, 0x34); // ExitProcess
  rdataBuf.writeUInt32LE(0x2088, 0x38); // GetModuleFileNameA
  rdataBuf.writeUInt32LE(0x209e, 0x3c); // SetEnvironmentVariableA
  rdataBuf.writeUInt32LE(0, 0x40);

  // IAT at 0x48
  rdataBuf.writeUInt32LE(0x2070, 0x48); // WinExec
  rdataBuf.writeUInt32LE(0x207a, 0x4c); // ExitProcess
  rdataBuf.writeUInt32LE(0x2088, 0x50); // GetModuleFileNameA
  rdataBuf.writeUInt32LE(0x209e, 0x54); // SetEnvironmentVariableA
  rdataBuf.writeUInt32LE(0, 0x58);

  rdataBuf.write('KERNEL32.dll\0', 0x60, 'ascii');
  rdataBuf.writeUInt16LE(0, 0x70);
  rdataBuf.write('WinExec\0', 0x72, 'ascii');
  rdataBuf.writeUInt16LE(0, 0x7a);
  rdataBuf.write('ExitProcess\0', 0x7c, 'ascii');
  rdataBuf.writeUInt16LE(0, 0x88);
  rdataBuf.write('GetModuleFileNameA\0', 0x8a, 'ascii');
  rdataBuf.writeUInt16LE(0, 0x9e);
  rdataBuf.write('SetEnvironmentVariableA\0', 0xa0, 'ascii');

  // Environment variable name at 0xC0 (VA 0x004020C0)
  rdataBuf.write('ASHOKA_EXE\0', 0xc0, 'ascii');

  // Command Line String at 0x100 (VA 0x00402100)
  rdataBuf.write(commandLine.slice(0, 0x3f0) + '\0', 0x100, 'ascii');

  // 4. Construct DOS + PE32 + Section Headers (0x400 bytes)
  const headersBuf = Buffer.alloc(0x400, 0);
  headersBuf.write('MZ', 0, 'ascii');
  headersBuf.writeUInt32LE(0x80, 0x3c);

  headersBuf.write('PE\0\0', 0x80, 'ascii');

  headersBuf.writeUInt16LE(0x014c, 0x84);
  headersBuf.writeUInt16LE(3, 0x86);
  headersBuf.writeUInt32LE(Math.floor(Date.now() / 1000), 0x88);
  headersBuf.writeUInt32LE(0, 0x8c);
  headersBuf.writeUInt32LE(0, 0x90);
  headersBuf.writeUInt16LE(0x00e0, 0x94);
  headersBuf.writeUInt16LE(0x010f, 0x96);

  const opt = 0x98;
  headersBuf.writeUInt16LE(0x010b, opt + 0);
  headersBuf.writeUInt8(14, opt + 2);
  headersBuf.writeUInt8(0, opt + 3);
  headersBuf.writeUInt32LE(0x200, opt + 4);
  headersBuf.writeUInt32LE(0x800 + rsrcRawSize, opt + 8);
  headersBuf.writeUInt32LE(0, opt + 12);
  headersBuf.writeUInt32LE(0x1000, opt + 16);
  headersBuf.writeUInt32LE(0x1000, opt + 20);
  headersBuf.writeUInt32LE(0x2000, opt + 24);
  headersBuf.writeUInt32LE(0x00400000, opt + 28);
  headersBuf.writeUInt32LE(0x1000, opt + 32);
  headersBuf.writeUInt32LE(0x0200, opt + 36);
  headersBuf.writeUInt16LE(5, opt + 40);
  headersBuf.writeUInt16LE(1, opt + 42);
  headersBuf.writeUInt16LE(5, opt + 44);
  headersBuf.writeUInt16LE(0, opt + 46);
  headersBuf.writeUInt16LE(5, opt + 48);
  headersBuf.writeUInt16LE(1, opt + 50);
  headersBuf.writeUInt32LE(0, opt + 52);
  const sizeOfImage = 0x3000 + alignUp(rsrcVirtualSize, 0x1000);
  headersBuf.writeUInt32LE(sizeOfImage, opt + 56);
  headersBuf.writeUInt32LE(0x0400, opt + 60);
  headersBuf.writeUInt32LE(0, opt + 64);
  headersBuf.writeUInt16LE(2, opt + 68); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  headersBuf.writeUInt16LE(0, opt + 70);
  headersBuf.writeUInt32LE(0x00100000, opt + 72);
  headersBuf.writeUInt32LE(0x00001000, opt + 76);
  headersBuf.writeUInt32LE(0x00100000, opt + 80);
  headersBuf.writeUInt32LE(0x00001000, opt + 84);
  headersBuf.writeUInt32LE(0, opt + 88);
  headersBuf.writeUInt32LE(16, opt + 92);

  headersBuf.writeUInt32LE(0x2000, opt + 96 + 1 * 8);
  headersBuf.writeUInt32LE(40, opt + 96 + 1 * 8 + 4);
  headersBuf.writeUInt32LE(0x3000, opt + 96 + 2 * 8);
  headersBuf.writeUInt32LE(rsrcVirtualSize, opt + 96 + 2 * 8 + 4);
  headersBuf.writeUInt32LE(0x2048, opt + 96 + 12 * 8);
  headersBuf.writeUInt32LE(20, opt + 96 + 12 * 8 + 4);

  const sec = 0x178;
  headersBuf.write('.text\0\0\0', sec + 0, 'ascii');
  headersBuf.writeUInt32LE(code.length, sec + 8);
  headersBuf.writeUInt32LE(0x1000, sec + 12);
  headersBuf.writeUInt32LE(0x200, sec + 16);
  headersBuf.writeUInt32LE(0x400, sec + 20);
  headersBuf.writeUInt32LE(0x60000020, sec + 36);

  const sec1 = sec + 40;
  headersBuf.write('.rdata\0\0', sec1 + 0, 'ascii');
  headersBuf.writeUInt32LE(0x800, sec1 + 8);
  headersBuf.writeUInt32LE(0x2000, sec1 + 12);
  headersBuf.writeUInt32LE(0x800, sec1 + 16);
  headersBuf.writeUInt32LE(0x600, sec1 + 20);
  headersBuf.writeUInt32LE(0xc0000040, sec1 + 36); // Read + Write + Initialized Data

  const sec2 = sec + 80;
  headersBuf.write('.rsrc\0\0\0', sec2 + 0, 'ascii');
  headersBuf.writeUInt32LE(rsrcVirtualSize, sec2 + 8);
  headersBuf.writeUInt32LE(0x3000, sec2 + 12);
  headersBuf.writeUInt32LE(rsrcRawSize, sec2 + 16);
  headersBuf.writeUInt32LE(0xe00, sec2 + 20);
  headersBuf.writeUInt32LE(0x40000040, sec2 + 36);

  const parts: Uint8Array[] = [headersBuf, textBuf, rdataBuf, rsrcBuf];
  if (overlayPayload) {
    parts.push(overlayPayload);
  }
  return Buffer.concat(parts);
}

/**
 * Generates a 100% Local Offline + Online OBS Studio-style Windows Setup Wizard (.hta)
 * Runs directly from `%LOCALAPPDATA%\Ashoka_MSO_Playlist\OBS_Setup_Wizard.hta` on disk
 * so it NEVER connects to any remote URL and NEVER asks for any login!
 */
/**
 * Generates an authentic OBS Studio-style Windows Setup Wizard (.hta)
 * Supports Multi-Step Wizard:
 * 1. Welcome Screen
 * 2. License Agreement / Offline Zero-Login Guarantee
 * 3. Choose Install Location & Components / Shortcuts
 * 4. Extraction & Installation Progress Log
 * 5. Finish & Launch Fullscreen
 */
export function generateObsStyleInstallerHta(svgDataUri?: string): string {
  const iconSrc = svgDataUri || 'app/assets/ashoka-icon.svg';
  return `<!DOCTYPE html>
<html>
<head>
  <title>Ashoka MSO Playlist 5.0.0 Setup</title>
  <meta http-equiv="x-ua-compatible" content="ie=edge" />
  <HTA:APPLICATION
    ID="AshokaMSOPlaylistSetupWizard"
    APPLICATIONNAME="Ashoka MSO Playlist Setup"
    BORDER="dialog"
    BORDERSTYLE="FixedDialog"
    CAPTION="yes"
    ICON="app\\assets\\ashoka-icon.ico"
    MAXIMIZEBUTTON="no"
    MINIMIZEBUTTON="yes"
    SHOWINTASKBAR="yes"
    SINGLEINSTANCE="yes"
    SYSMENU="yes"
    VERSION="5.0.0"
    SCROLL="no"
  />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: #0f172a;
      color: #f1f5f9;
      font-family: "Segoe UI", Tahoma, sans-serif;
      font-size: 13px;
      overflow: hidden;
    }
    .wizard-shell {
      display: flex;
      width: 680px;
      height: 440px;
      background: #111827;
    }
    .sidebar {
      width: 210px;
      background: linear-gradient(180deg, #090d16 0%, #131c2e 100%);
      border-right: 1px solid #1f293d;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .logo-box {
      width: 80px;
      height: 80px;
      border-radius: 16px;
      border: 2px solid #f59e0b;
      background: #0b1120;
      padding: 6px;
      margin-bottom: 12px;
      box-shadow: 0 6px 20px rgba(245, 158, 11, 0.2);
    }
    .logo-box img {
      width: 100%;
      height: 100%;
    }
    .brand-title {
      font-size: 13px;
      font-weight: 800;
      color: #fbbf24;
      letter-spacing: 0.5px;
      margin-bottom: 3px;
    }
    .brand-sub {
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 16px;
    }
    .step-list {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .step-badge {
      width: 100%;
      text-align: left;
      font-size: 11px;
      padding: 6px 10px;
      border-radius: 6px;
      color: #64748b;
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid transparent;
      transition: all 0.2s ease;
    }
    .step-badge.active {
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.35);
      font-weight: 700;
    }
    .step-badge.done {
      color: #10b981;
      background: rgba(16, 185, 129, 0.1);
      border-color: rgba(16, 185, 129, 0.3);
    }
    .main-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .content-pane {
      padding: 24px 26px;
      height: 375px;
      overflow-y: auto;
    }
    .step-section {
      display: none;
    }
    .step-section.current {
      display: block;
    }
    h1 {
      font-size: 18px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 6px;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 12px;
      line-height: 1.5;
      margin-bottom: 14px;
    }
    .feature-box {
      background: #090d16;
      border: 1px solid #1f293d;
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 12px;
    }
    .feature-item {
      font-size: 12px;
      color: #e2e8f0;
      margin-bottom: 6px;
    }
    .feature-item b {
      color: #fbbf24;
    }
    .license-box {
      width: 100%;
      height: 190px;
      background: #090d16;
      border: 1px solid #1f293d;
      border-radius: 6px;
      padding: 10px;
      font-size: 11px;
      color: #cbd5e1;
      line-height: 1.5;
      overflow-y: scroll;
      margin-bottom: 12px;
    }
    .path-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
    }
    .path-input {
      flex: 1;
      padding: 7px 10px;
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 5px;
      color: #f8fafc;
      font-size: 12px;
      font-family: Consolas, monospace;
    }
    .chk-row {
      display: block;
      margin: 8px 0;
      font-size: 12px;
      color: #f8fafc;
      cursor: pointer;
    }
    .chk-row input {
      margin-right: 8px;
    }
    .progress-outer {
      width: 100%;
      height: 20px;
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 6px;
      overflow: hidden;
      margin: 12px 0;
    }
    .progress-inner {
      height: 100%;
      width: 100%;
      background: linear-gradient(90deg, #3b82f6 0%, #10b981 100%);
    }
    .log-box {
      width: 100%;
      height: 160px;
      background: #090d16;
      border: 1px solid #1f293d;
      border-radius: 6px;
      padding: 10px;
      font-family: Consolas, monospace;
      font-size: 11px;
      color: #34d399;
      overflow-y: auto;
      line-height: 1.5;
    }
    .footer-bar {
      height: 65px;
      background: #090d16;
      border-top: 1px solid #1f293d;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .btn {
      padding: 7px 18px;
      border-radius: 5px;
      font-family: "Segoe UI", sans-serif;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid #334155;
      background: #1e293b;
      color: #f8fafc;
      margin-left: 6px;
    }
    .btn:hover { background: #334155; }
    .btn-primary {
      background: #2563eb;
      color: #ffffff;
      border-color: #3b82f6;
    }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-success {
      background: #059669;
      color: #ffffff;
      border-color: #10b981;
      padding: 8px 22px;
    }
    .btn-success:hover { background: #047857; }
  </style>
  <script language="JScript">
    var currentStep = 1;
    var totalSteps = 4;

    function initWindow() {
      try {
        window.resizeTo(696, 478);
        var sw = screen.availWidth;
        var sh = screen.availHeight;
        window.moveTo((sw - 696) / 2, (sh - 478) / 2);
      } catch (e) {}
    }

    function setStep(step) {
      currentStep = step;
      for (var i = 1; i <= totalSteps; i++) {
        var sec = document.getElementById("stepSection" + i);
        var badge = document.getElementById("badge" + i);
        if (sec) {
          sec.className = (i === currentStep) ? "step-section current" : "step-section";
        }
        if (badge) {
          if (i < currentStep) {
            badge.className = "step-badge done";
          } else if (i === currentStep) {
            badge.className = "step-badge active";
          } else {
            badge.className = "step-badge";
          }
        }
      }

      var btnBack = document.getElementById("btnBack");
      var btnNext = document.getElementById("btnNext");
      var btnFinish = document.getElementById("btnFinish");

      if (btnBack) btnBack.style.display = (currentStep > 1 && currentStep < totalSteps) ? "inline" : "none";
      if (btnNext) btnNext.style.display = (currentStep < totalSteps) ? "inline" : "none";
      if (btnFinish) btnFinish.style.display = (currentStep === totalSteps) ? "inline" : "none";

      if (currentStep === 3) {
        if (btnNext) btnNext.innerText = "Install >";
      } else if (currentStep < 3) {
        if (btnNext) btnNext.innerText = "Next >";
      }
    }

    function nextStep() {
      if (currentStep < totalSteps) {
        setStep(currentStep + 1);
      }
    }

    function prevStep() {
      if (currentStep > 1) {
        setStep(currentStep - 1);
      }
    }

    function cancelSetup() {
      window.close();
    }

    function launchSoftwareNow() {
      try {
        var shell = new ActiveXObject("WScript.Shell");
        var fso = new ActiveXObject("Scripting.FileSystemObject");
        var installDir = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") + "\\\\Ashoka_MSO_Playlist";
        var appHtml = installDir + "\\\\app\\\\index.html";
        var appExe = installDir + "\\\\Ashoka_MSO_Playlist.exe";
        var icoPath = installDir + "\\\\app\\\\assets\\\\ashoka-icon.ico";

        if (document.getElementById("chkDesktop").checked) {
          var deskLnk = shell.SpecialFolders("Desktop") + "\\\\Ashoka MSO Playlist.lnk";
          var sc = shell.CreateShortcut(deskLnk);
          sc.TargetPath = appExe;
          sc.WorkingDirectory = installDir;
          sc.Description = "Ashoka MSO Playlist - Single-Channel Broadcast Studio";
          sc.IconLocation = fso.FileExists(appExe) ? (appExe + ",0") : icoPath;
          sc.Save();
        }

        if (document.getElementById("chkStartMenu").checked) {
          var smFolder = shell.SpecialFolders("Programs") + "\\\\Ashoka MSO Playlist";
          if (!fso.FolderExists(smFolder)) { fso.CreateFolder(smFolder); }
          var smLnk = smFolder + "\\\\Ashoka MSO Playlist.lnk";
          var sc2 = shell.CreateShortcut(smLnk);
          sc2.TargetPath = appExe;
          sc2.WorkingDirectory = installDir;
          sc2.Description = "Ashoka MSO Playlist - Single-Channel Broadcast Studio";
          sc2.IconLocation = fso.FileExists(appExe) ? (appExe + ",0") : icoPath;
          sc2.Save();
        }

        if (document.getElementById("chkLaunch").checked) {
          try {
            shell.Run('"' + appExe + '"', 1, false);
          } catch (e2) {}
        }
      } catch (err) {}
      window.close();
    }
  </script>
</head>
<body onload="initWindow()">
  <div class="wizard-shell">
    <div class="sidebar">
      <div class="logo-box">
        <img src="${iconSrc}" alt="Ashoka Icon" />
      </div>
      <div class="brand-title">ASHOKA MSO PLAYLIST</div>
      <div class="brand-sub">Setup Wizard v5.0.0</div>

      <div class="step-list">
        <div id="badge1" class="step-badge active">1. Welcome</div>
        <div id="badge2" class="step-badge">2. Offline License</div>
        <div id="badge3" class="step-badge">3. Install Options</div>
        <div id="badge4" class="step-badge">4. Complete &amp; Launch</div>
      </div>
    </div>

    <div class="main-area">
      <div class="content-pane">
        <!-- Step 1: Welcome -->
        <div id="stepSection1" class="step-section current">
          <h1>Welcome to Ashoka MSO Playlist Setup</h1>
          <p class="subtitle">
            This wizard will guide you through installing <b>Ashoka MSO Playlist v5.0</b> on your Windows PC.<br/>
            It runs <b>100% Offline and Online with ZERO Login required</b>.
          </p>
          <div class="feature-box">
            <div class="feature-item">&#10004; <b>Dedicated Single-Channel MSO Playout Engine:</b> Seamless loop &amp; live switching</div>
            <div class="feature-item">&#10004; <b>Display &amp; Window Capture:</b> Direct live capture of full desktop &amp; any open app window</div>
            <div class="feature-item">&#10004; <b>Built-in Offline HTTP Playout Server:</b> Auto-saves playlist states &amp; media locally</div>
            <div class="feature-item">&#10004; <b>Complete With Uninstaller:</b> Clean uninstaller utility included in Windows Control Panel</div>
          </div>
          <p style="font-size:11px;color:#94a3b8;margin-top:10px;">
            Click <b>Next</b> to continue the setup process.
          </p>
        </div>

        <!-- Step 2: License Agreement -->
        <div id="stepSection2" class="step-section">
          <h1>License &amp; Offline Operation Agreement</h1>
          <p class="subtitle">
            Please review the terms of the Ashoka Digital Broadcast Systems offline software:
          </p>
          <div class="license-box">
            ASHOKA DIGITAL BROADCAST SYSTEMS END-USER LICENSE AGREEMENT<br/><br/>
            1. 100% OFFLINE CAPABILITY: Ashoka MSO Playlist is designed to operate completely offline on this computer without requiring an active internet connection, user login, cloud authentication, or account registration.<br/><br/>
            2. LOCAL STORAGE: All channel schedules, playlists, overlay logos, bottom banners, and media assets are stored safely on your local disk in %LOCALAPPDATA%\\Ashoka_MSO_Playlist.<br/><br/>
            3. DISPLAY &amp; WINDOW CAPTURE: The software includes native live screen and application window capture drivers with automatic hardware acceleration.<br/><br/>
            4. UNINSTALLATION: A complete uninstaller is registered in Windows Control Panel (Add/Remove Programs) and can be executed at any time via Uninstall.exe or uninstall.bat.
          </div>
          <p style="font-size:11px;color:#10b981;">
            &#10004; By continuing, you agree to run Ashoka MSO Playlist as your offline broadcast playout studio.
          </p>
        </div>

        <!-- Step 3: Install Options -->
        <div id="stepSection3" class="step-section">
          <h1>Choose Install Location &amp; Components</h1>
          <p class="subtitle">
            Select the destination folder and shortcuts for Ashoka MSO Playlist:
          </p>
          <label style="font-size:12px;color:#cbd5e1;display:block;margin-bottom:6px;">Destination Folder:</label>
          <div class="path-row">
            <input type="text" class="path-input" value="%LOCALAPPDATA%\\Ashoka_MSO_Playlist" readonly="readonly" />
          </div>
          <div class="feature-box" style="margin-top:10px;">
            <label class="chk-row">
              <input type="checkbox" id="chkCore" checked="checked" disabled="disabled" />
              <b>Ashoka MSO Broadcast Engine (Required — 100% Offline)</b>
            </label>
            <label class="chk-row">
              <input type="checkbox" id="chkDesktop" checked="checked" />
              Create Desktop Shortcut with Custom Ashoka Broadcast Icon
            </label>
            <label class="chk-row">
              <input type="checkbox" id="chkStartMenu" checked="checked" />
              Create Start Menu Program Group &amp; Shortcut
            </label>
            <label class="chk-row">
              <input type="checkbox" id="chkUninstaller" checked="checked" disabled="disabled" />
              Register Clean Uninstaller in Windows Control Panel (Uninstall.exe)
            </label>
          </div>
        </div>

        <!-- Step 4: Complete & Launch -->
        <div id="stepSection4" class="step-section">
          <h1>Ashoka MSO Playlist v5.0 Ready!</h1>
          <p class="subtitle">
            Installation is complete. The software has been installed and configured on your PC.
          </p>
          <div class="log-box">
[SETUP] Extracting core offline playout bundle... OK
[SETUP] Initializing local HTTP playout backend (127.0.0.1:38550)... OK
[SETUP] Deploying Ruffle SWF WebAssembly engine... OK
[SETUP] Registering native Windows PE32 launcher (Ashoka_MSO_Playlist.exe)... OK
[SETUP] Creating Desktop & Start Menu shortcuts... OK
[SETUP] Registering Uninstaller (Uninstall.exe & uninstall.bat)... OK
[SETUP] Zero-login offline broadcast configuration active. READY!
          </div>
          <div style="margin-top:12px;">
            <label class="chk-row">
              <input type="checkbox" id="chkLaunch" checked="checked" />
              <b>Launch Ashoka MSO Playlist Studio in FULL SCREEN now</b>
            </label>
          </div>
        </div>
      </div>

      <div class="footer-bar">
        <span style="font-size:11px;color:#94a3b8;font-family:Consolas,monospace;">
          Ashoka Digital Broadcast Systems
        </span>
        <div>
          <button id="btnBack" class="btn" onclick="prevStep()" style="display:none;">&lt; Back</button>
          <button id="btnNext" class="btn btn-primary" onclick="nextStep()">Next &gt;</button>
          <button id="btnFinish" class="btn btn-success" onclick="launchSoftwareNow()" style="display:none;">Finish &amp; Launch Software &#9654;</button>
          <button id="btnCancel" class="btn" onclick="cancelSetup()">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates an OBS Studio-style Windows Uninstaller Wizard (.hta)
 * Safely removes Ashoka MSO Playlist, background processes, shortcuts, and registry entries
 */
export function generateUninstallerHta(svgDataUri?: string): string {
  const iconSrc = svgDataUri || 'app/assets/ashoka-icon.svg';
  return `<!DOCTYPE html>
<html>
<head>
  <title>Ashoka MSO Playlist 5.0.0 Uninstall</title>
  <meta http-equiv="x-ua-compatible" content="ie=edge" />
  <HTA:APPLICATION
    ID="AshokaMSOPlaylistUninstallerWizard"
    APPLICATIONNAME="Ashoka MSO Playlist Uninstaller"
    BORDER="dialog"
    BORDERSTYLE="FixedDialog"
    CAPTION="yes"
    ICON="app\\assets\\ashoka-icon.ico"
    MAXIMIZEBUTTON="no"
    MINIMIZEBUTTON="yes"
    SHOWINTASKBAR="yes"
    SINGLEINSTANCE="yes"
    SYSMENU="yes"
    VERSION="5.0.0"
    SCROLL="no"
  />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: #0f172a;
      color: #f1f5f9;
      font-family: "Segoe UI", Tahoma, sans-serif;
      font-size: 13px;
      overflow: hidden;
    }
    .wizard-shell {
      display: flex;
      width: 680px;
      height: 440px;
      background: #111827;
    }
    .sidebar {
      width: 210px;
      background: linear-gradient(180deg, #181016 0%, #20111a 100%);
      border-right: 1px solid #3b1d28;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .logo-box {
      width: 80px;
      height: 80px;
      border-radius: 16px;
      border: 2px solid #ef4444;
      background: #0b1120;
      padding: 6px;
      margin-bottom: 12px;
      box-shadow: 0 6px 20px rgba(239, 68, 68, 0.2);
    }
    .logo-box img {
      width: 100%;
      height: 100%;
    }
    .brand-title {
      font-size: 13px;
      font-weight: 800;
      color: #f87171;
      letter-spacing: 0.5px;
      margin-bottom: 3px;
    }
    .brand-sub {
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 16px;
    }
    .step-badge {
      width: 100%;
      text-align: left;
      font-size: 11px;
      padding: 6px 10px;
      border-radius: 6px;
      margin-bottom: 5px;
      color: #64748b;
      background: rgba(15, 23, 42, 0.5);
    }
    .step-badge.active {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      font-weight: 700;
    }
    .main-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .content-pane {
      padding: 24px 26px;
      height: 375px;
    }
    h1 {
      font-size: 18px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 6px;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 12px;
      line-height: 1.5;
      margin-bottom: 14px;
    }
    .feature-box {
      background: #090d16;
      border: 1px solid #1f293d;
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 12px;
    }
    .chk-row {
      display: block;
      margin: 8px 0;
      font-size: 12px;
      color: #f8fafc;
      cursor: pointer;
    }
    .chk-row input {
      margin-right: 8px;
    }
    .log-box {
      width: 100%;
      height: 180px;
      background: #090d16;
      border: 1px solid #1f293d;
      border-radius: 6px;
      padding: 10px;
      font-family: Consolas, monospace;
      font-size: 11px;
      color: #38bdf8;
      overflow-y: auto;
      line-height: 1.5;
    }
    .footer-bar {
      height: 65px;
      background: #090d16;
      border-top: 1px solid #1f293d;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .btn {
      padding: 7px 18px;
      border-radius: 5px;
      font-family: "Segoe UI", sans-serif;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid #334155;
      background: #1e293b;
      color: #f8fafc;
      margin-left: 6px;
    }
    .btn:hover { background: #334155; }
    .btn-danger {
      background: #dc2626;
      color: #ffffff;
      border-color: #ef4444;
      padding: 8px 22px;
    }
    .btn-danger:hover { background: #b91c1c; }
  </style>
  <script language="JScript">
    function initWindow() {
      try {
        window.resizeTo(696, 478);
        var sw = screen.availWidth;
        var sh = screen.availHeight;
        window.moveTo((sw - 696) / 2, (sh - 478) / 2);
      } catch (e) {}
    }

    function doUninstall() {
      document.getElementById("viewConfirm").style.display = "none";
      document.getElementById("viewProgress").style.display = "block";
      document.getElementById("btnUninstall").style.display = "none";
      document.getElementById("btnCancel").style.display = "none";

      var logEl = document.getElementById("uninstallLog");
      function log(msg) {
        if (logEl) logEl.innerHTML += msg + "\\n";
      }

      log("[UNINSTALL] Stopping background services...");
      try {
        var shell = new ActiveXObject("WScript.Shell");
        var fso = new ActiveXObject("Scripting.FileSystemObject");
        var installDir = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") + "\\\\Ashoka_MSO_Playlist";

        // 1. Terminate background processes
        try {
          shell.Run('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.CommandLine -like \\'*offline_backend.ps1*\\' -or $_.MainWindowTitle -like \\'*Ashoka*\\' } | Stop-Process -Force -ErrorAction SilentlyContinue"', 0, true);
        } catch (e1) {}

        // 2. Remove desktop shortcut
        try {
          var deskLnk = shell.SpecialFolders("Desktop") + "\\\\Ashoka MSO Playlist.lnk";
          if (fso.FileExists(deskLnk)) {
            fso.DeleteFile(deskLnk, true);
            log("[UNINSTALL] Removed Desktop shortcut: Ashoka MSO Playlist.lnk");
          }
        } catch (e2) {}

        // 3. Remove start menu shortcut
        try {
          var smFolder = shell.SpecialFolders("Programs") + "\\\\Ashoka MSO Playlist";
          if (fso.FolderExists(smFolder)) {
            fso.DeleteFolder(smFolder, true);
            log("[UNINSTALL] Removed Start Menu program folder.");
          }
        } catch (e3) {}

        // 4. Remove Windows Registry Uninstall Entry
        try {
          shell.RegDelete("HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\Ashoka_MSO_Playlist\\\\");
          log("[UNINSTALL] Cleaned Windows Registry Add/Remove Programs entry.");
        } catch (e4) {}

        // 5. Clean app files
        if (document.getElementById("chkRemoveData") && document.getElementById("chkRemoveData").checked) {
          try {
            if (fso.FolderExists(installDir + "\\\\data")) fso.DeleteFolder(installDir + "\\\\data", true);
            if (fso.FolderExists(installDir + "\\\\uploads")) fso.DeleteFolder(installDir + "\\\\uploads", true);
            log("[UNINSTALL] Removed user playout data and uploaded media library.");
          } catch (e5) {}
        }

        try {
          if (fso.FolderExists(installDir + "\\\\app")) fso.DeleteFolder(installDir + "\\\\app", true);
          log("[UNINSTALL] Removed application core bundle.");
        } catch (e6) {}

        log("\\n[UNINSTALL] UNINSTALLATION COMPLETE!");
        log("Ashoka MSO Playlist was successfully removed from your computer.");

        var btnClose = document.getElementById("btnClose");
        if (btnClose) btnClose.style.display = "inline";
      } catch (err) {
        log("[UNINSTALL] Note: " + err.message);
        var btnClose = document.getElementById("btnClose");
        if (btnClose) btnClose.style.display = "inline";
      }
    }
  </script>
</head>
<body onload="initWindow()">
  <div class="wizard-shell">
    <div class="sidebar">
      <div class="logo-box">
        <img src="${iconSrc}" alt="Ashoka Icon" />
      </div>
      <div class="brand-title">ASHOKA MSO PLAYLIST</div>
      <div class="brand-sub">Uninstaller Wizard</div>

      <div class="step-badge active">1. Uninstall Confirmation</div>
      <div class="step-badge">2. Clean Removal</div>
    </div>

    <div class="main-area">
      <div class="content-pane">
        <div id="viewConfirm">
          <h1>Uninstall Ashoka MSO Playlist v5.0</h1>
          <p class="subtitle">
            Are you sure you want to completely remove <b>Ashoka MSO Playlist</b> and all of its components from your PC?
          </p>
          <div class="feature-box">
            <label class="chk-row">
              <input type="checkbox" id="chkShortcuts" checked="checked" />
              Remove Desktop and Start Menu Shortcuts
            </label>
            <label class="chk-row">
              <input type="checkbox" id="chkStopServices" checked="checked" />
              Terminate running background offline playout server process
            </label>
            <label class="chk-row">
              <input type="checkbox" id="chkRemoveData" checked="checked" />
              Remove user playout channels, schedules, and uploaded media files
            </label>
          </div>
          <p style="font-size:11px;color:#94a3b8;margin-top:14px;">
            Click <b>Uninstall</b> to proceed with removing the software from your system.
          </p>
        </div>

        <div id="viewProgress" style="display:none;">
          <h1>Uninstallation in Progress</h1>
          <p class="subtitle">
            Removing files, shortcuts, and registry keys from your computer...
          </p>
          <pre id="uninstallLog" class="log-box"></pre>
        </div>
      </div>

      <div class="footer-bar">
        <span style="font-size:11px;color:#94a3b8;font-family:Consolas,monospace;">
          Uninstall Location: %LOCALAPPDATA%\\Ashoka_MSO_Playlist
        </span>
        <div>
          <button id="btnUninstall" class="btn btn-danger" onclick="doUninstall()">Uninstall Now</button>
          <button id="btnCancel" class="btn" onclick="window.close()">Cancel</button>
          <button id="btnClose" class="btn btn-primary" onclick="window.close()" style="display:none;">Finish &amp; Close</button>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates standalone uninstall.bat script for command-line or silent uninstall
 */
export function generateUninstallBat(): string {
  return `@echo off
setlocal
echo ========================================================
echo   ASHOKA MSO PLAYLIST - UNINSTALLER
echo ========================================================
echo.
echo Stopping Ashoka MSO Playlist desktop application and background services...
taskkill /F /IM Ashoka_MSO_Playlist.exe >nul 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*offline_backend.ps1*' -or $_.Name -eq 'Ashoka_MSO_Playlist.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo Removing desktop and start menu shortcuts...
del /f /q "%USERPROFILE%\\Desktop\\Ashoka Cable TV Playout.lnk" >nul 2>&1
del /f /q "%USERPROFILE%\\Desktop\\Ashoka MSO Playlist.lnk" >nul 2>&1
del /f /q "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Ashoka Cable TV Playout\\Ashoka Cable TV Playout.lnk" >nul 2>&1
del /f /q "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Ashoka Cable TV Playout\\Uninstall Ashoka Cable TV Playout.lnk" >nul 2>&1
rmdir /s /q "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Ashoka Cable TV Playout" >nul 2>&1
del /f /q "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Ashoka MSO Playlist\\Ashoka MSO Playlist.lnk" >nul 2>&1
del /f /q "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Ashoka MSO Playlist\\Uninstall Ashoka MSO Playlist.lnk" >nul 2>&1
rmdir /s /q "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Ashoka MSO Playlist" >nul 2>&1

echo Cleaning Windows Registry uninstaller entries...
reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist" /f >nul 2>&1
reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_Cable_TV_Playout" /f >nul 2>&1

echo Removing application files...
set "APP_DIR=%LOCALAPPDATA%\\Ashoka_MSO_Playlist"
if exist "%APP_DIR%" (
  rd /s /q "%APP_DIR%\\app" >nul 2>&1
  rd /s /q "%APP_DIR%\\webview_data" >nul 2>&1
  rd /s /q "%APP_DIR%\\profile" >nul 2>&1
  rd /s /q "%APP_DIR%\\profile_out2" >nul 2>&1
  rd /s /q "%APP_DIR%\\uploads" >nul 2>&1
  rd /s /q "%APP_DIR%\\data" >nul 2>&1
  del /f /q "%APP_DIR%\\*.*" >nul 2>&1
)

echo.
echo Ashoka MSO Playlist uninstallation complete.
echo.
pause
`;
}

/**
 * Builds the self-contained `app/index.html` by inlining the compiled CSS, JS, and SVG icon
 * from `dist/` so that the application runs 100% Offline from `file:///` or `http://127.0.0.1`
 * on any Windows PC without ever asking for any login.
 */
export function buildSelfContainedOfflineHtml(rootDir: string): {
  html: string;
  svgDataUri: string;
} {
  const distDir = path.join(rootDir, 'dist');
  const distAssetsDir = path.join(distDir, 'assets');
  const svgPath = path.join(rootDir, 'public', 'assets', 'ashoka-icon.svg');

  const svgContent = fs.existsSync(svgPath)
    ? fs.readFileSync(svgPath, 'utf8')
    : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b1120" stroke="#f59e0b" stroke-width="4"/><polygon points="24,18 24,46 48,32" fill="#fbbf24"/></svg>';
  const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svgContent, 'utf8').toString('base64')}`;

  let cssContent = '';
  let jsContent = '';

  if (fs.existsSync(distAssetsDir)) {
    const assetFiles = fs.readdirSync(distAssetsDir);
    for (const file of assetFiles) {
      if (file.endsWith('.css')) {
        cssContent += fs.readFileSync(path.join(distAssetsDir, file), 'utf8') + '\n';
      } else if (file.endsWith('.js')) {
        jsContent += fs.readFileSync(path.join(distAssetsDir, file), 'utf8') + '\n';
      }
    }
  }

  // Replace /assets/ashoka-icon.svg (including any ?v=... cache-buster) with embedded data URI
  // and /videos/ch with relative ./videos/ch so all icons and channel video work 100% offline!
  jsContent = jsContent
    .replace(/\/assets\/ashoka-icon\.svg(?:\?[^'"`)\s\\]+)?/g, svgDataUri)
    .split('"/videos/ch')
    .join('"./videos/ch')
    .split("'/videos/ch")
    .join("'./videos/ch")
    .split('`/videos/ch')
    .join('`./videos/ch')
    .replace(/<\/script/gi, '<\\/script');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ASHOKA MSO PLAYLIST — Single-Channel Broadcast Playout Studio</title>
    <link rel="icon" type="image/svg+xml" href="${svgDataUri}" />
    <script>window.__ASHOKA_INSTALLED_SOFTWARE__ = true;</script>
    <style>${cssContent}</style>
  </head>
  <body class="bg-black text-white select-none">
    <div id="root"></div>
    <script type="module">${jsContent}</script>
  </body>
</html>`;

  return { html, svgDataUri };
}

let cachedSelfExtractingSetupExe: Buffer | null = null;
let cachedDistMtimeMs = 0;

function getDistMaxMtimeMs(rootDir: string): number {
  let maxMtime = 0;
  try {
    const idxPath = path.join(rootDir, 'dist', 'index.html');
    if (fs.existsSync(idxPath)) {
      maxMtime = Math.max(maxMtime, fs.statSync(idxPath).mtimeMs);
    }
    const assetsDir = path.join(rootDir, 'dist', 'assets');
    if (fs.existsSync(assetsDir)) {
      for (const f of fs.readdirSync(assetsDir)) {
        const st = fs.statSync(path.join(assetsDir, f));
        if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
      }
    }
    const hostCsPath = path.join(rootDir, 'src', 'server', 'webview2', 'AshokaHost.cs');
    if (fs.existsSync(hostCsPath)) {
      maxMtime = Math.max(maxMtime, fs.statSync(hostCsPath).mtimeMs);
    }
  } catch {}
  return maxMtime;
}

/**
 * Reliable Windows native desktop app launcher (`app/launch.ps1`):
 * Starts `offline_backend.ps1` if port 38550 is closed, ensures `Ashoka_MSO_Playlist.exe`
 * (native WinForms + embedded WebView2 executable) is compiled, and launches it directly
 * with zero browser bars or Microsoft Edge browser windows.
 */
function generateLaunchPs1(): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Ashoka_MSO_Playlist'
if ($PSScriptRoot) {
  $parentDir = Split-Path $PSScriptRoot -Parent
  if ($parentDir -and (Test-Path (Join-Path $parentDir 'app\\index.html'))) {
    $InstallDir = $parentDir
  }
}
$AppDir = Join-Path $InstallDir 'app'
$BackendScript = Join-Path $AppDir 'offline_backend.ps1'
$PsExe = Join-Path $PSHOME 'powershell.exe'
if (!(Test-Path $PsExe)) { $PsExe = "$env:WINDIR\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" }

function Test-BackendReady {
  try {
    $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:38550/api/health')
    $req.Method = 'GET'
    $req.Timeout = 350
    $req.ReadWriteTimeout = 350
    $resp = $req.GetResponse()
    if ($resp) {
      $resp.Close()
      return $true
    }
  } catch {}
  return $false
}

function Ensure-AshokaNativeHostExe([string]$RootDir) {
  $aDir = Join-Path $RootDir 'app'
  $csFile = Join-Path $aDir 'AshokaHost.cs'
  $outExe = Join-Path $RootDir 'Ashoka_MSO_Playlist.exe'
  $coreSrc = Join-Path $aDir 'Microsoft.Web.WebView2.Core.dll'
  $wfSrc = Join-Path $aDir 'Microsoft.Web.WebView2.WinForms.dll'
  $coreDst = Join-Path $RootDir 'Microsoft.Web.WebView2.Core.dll'
  $wfDst = Join-Path $RootDir 'Microsoft.Web.WebView2.WinForms.dll'
  $ldrDst = Join-Path $RootDir 'WebView2Loader.dll'

  if ((Test-Path $coreSrc) -and !(Test-Path $coreDst)) { Copy-Item $coreSrc $coreDst -Force -ErrorAction SilentlyContinue }
  if ((Test-Path $wfSrc) -and !(Test-Path $wfDst)) { Copy-Item $wfSrc $wfDst -Force -ErrorAction SilentlyContinue }

  $is64 = [Environment]::Is64BitOperatingSystem
  $csc64 = "$env:WINDIR\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
  $csc32 = "$env:WINDIR\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
  $use64 = ($is64 -and (Test-Path $csc64))
  $cscExe = if ($use64) { $csc64 } elseif (Test-Path $csc32) { $csc32 } else { $null }
  $plat = if ($use64) { 'x64' } else { 'x86' }
  $ldrSrc = Join-Path (Join-Path $aDir $plat) 'WebView2Loader.dll'
  if ((Test-Path $ldrSrc) -and !(Test-Path $ldrDst)) { Copy-Item $ldrSrc $ldrDst -Force -ErrorAction SilentlyContinue }

  $needsCompile = (!(Test-Path $outExe) -or ((Get-Item $outExe).Length -lt 12288))
  if ($needsCompile -and $cscExe -and (Test-Path $csFile) -and (Test-Path $coreDst) -and (Test-Path $wfDst)) {
    $icoPath = Join-Path $aDir 'assets\\ashoka-icon.ico'
    $cArgs = @('/nologo', '/optimize+', '/target:winexe', "/platform:$plat", ('/out:"' + $outExe + '"'))
    if (Test-Path $icoPath) { $cArgs += ('/win32icon:"' + $icoPath + '"') }
    $cArgs += '/reference:System.dll'
    $cArgs += '/reference:System.Core.dll'
    $cArgs += '/reference:System.Drawing.dll'
    $cArgs += '/reference:System.Windows.Forms.dll'
    $cArgs += ('/reference:"' + $coreDst + '"')
    $cArgs += ('/reference:"' + $wfDst + '"')
    $cArgs += ('"' + $csFile + '"')
    try {
      $cPsi = New-Object System.Diagnostics.ProcessStartInfo
      $cPsi.FileName = $cscExe
      $cPsi.Arguments = ($cArgs -join ' ')
      $cPsi.WorkingDirectory = $RootDir
      $cPsi.UseShellExecute = $false
      $cPsi.CreateNoWindow = $true
      $cProc = [System.Diagnostics.Process]::Start($cPsi)
      if ($cProc) { $cProc.WaitForExit(30000) | Out-Null }
    } catch {}
  }
  return ((Test-Path $outExe) -and ((Get-Item $outExe).Length -ge 12288))
}

if (-not (Test-BackendReady)) {
  try {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object {
      $_.CommandLine -and $_.CommandLine -like '*offline_backend.ps1*'
    } | ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  } catch {}

  if (Test-Path $BackendScript) {
    try {
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = $PsExe
      $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $BackendScript + '"'
      $psi.WorkingDirectory = $InstallDir
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
      $backendProc = [System.Diagnostics.Process]::Start($psi)
      for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 60
        if (Test-BackendReady) { break }
        if ($backendProc -and $backendProc.HasExited) { break }
      }
    } catch {}
  }
}

$nativeReady = Ensure-AshokaNativeHostExe $InstallDir
$hostExe = Join-Path $InstallDir 'Ashoka_MSO_Playlist.exe'
$forwardArgs = if ($args -and $args.Count -gt 0) { ($args -join ' ') } else { '' }

if ($nativeReady -and (Test-Path $hostExe)) {
  try {
    $hPsi = New-Object System.Diagnostics.ProcessStartInfo
    $hPsi.FileName = $hostExe
    if ($forwardArgs) { $hPsi.Arguments = $forwardArgs }
    $hPsi.WorkingDirectory = $InstallDir
    $hPsi.UseShellExecute = $false
    [System.Diagnostics.Process]::Start($hPsi) | Out-Null
  } catch {}
}
`.trim();
}

/**
 * Local Offline Backend Server script (`app/offline_backend.ps1`) for Windows PC:
 * Runs a lightweight local HTTP server on `http://127.0.0.1:38550/` with:
 * 1. Persistent `/api/playout/state`, `/api/playout/save`, `/api/license/*`, `/api/health`, `/api/system/stats`
 * 2. Media persistence (`/api/media/upload`, `/uploads/*`, `/api/media/by-name/*`) with HTTP Range support
 * 3. Self-contained offline static serving (`app/index.html`, `/ruffle/*`, `/videos/*`, `/assets/*`)
 */
export function generateOfflineBackendPs1(): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'

$createdMutex = $false
$backendMutex = $null
try {
  $backendMutex = New-Object System.Threading.Mutex($true, 'Local\\Ashoka_Offline_Backend_38550', [ref]$createdMutex)
} catch {
  $createdMutex = $true
}
if (-not $createdMutex) { exit 0 }

$InstallDir = Join-Path $env:LOCALAPPDATA 'Ashoka_MSO_Playlist'
if ($PSScriptRoot) {
  $parentDir = Split-Path $PSScriptRoot -Parent
  if ($parentDir -and (Test-Path (Join-Path $parentDir 'app\\index.html'))) {
    $InstallDir = $parentDir
  }
}
$AppDir = Join-Path $InstallDir 'app'
$UploadsDir = Join-Path $InstallDir 'uploads'
$DataDir = Join-Path $InstallDir 'data'

if (!(Test-Path $UploadsDir)) { New-Item -ItemType Directory -Force -Path $UploadsDir | Out-Null }
if (!(Test-Path $DataDir)) { New-Item -ItemType Directory -Force -Path $DataDir | Out-Null }

$serverSource = @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace AshokaBackend
{
    public static class AshokaHttpServer
    {
        private static HttpListener _listener;
        private static volatile bool _shouldStop = false;
        private static string _installDir;
        private static string _appDir;
        private static string _uploadsDir;
        private static string _dataDir;
        private static string _stateFile;
        private static string _cgStateFile;
        private static string _licenseFile;

        private static readonly object _syncLock = new object();
        private static string _liveSyncJson = "";
        private static long _liveSyncSeq = 0;

        private static readonly object _cgLock = new object();
        private static string _cgStateJson = "";

        private static readonly object _stateLock = new object();
        private static readonly object _childLock = new object();
        private static readonly List<Process> _childOutputs = new List<Process>();

        public static void Run(string installDir, string appDir, string uploadsDir, string dataDir)
        {
            _installDir = installDir;
            _appDir = appDir;
            _uploadsDir = uploadsDir;
            _dataDir = dataDir;
            _stateFile = Path.Combine(dataDir, "ashoka_playout_state.json");
            _cgStateFile = Path.Combine(dataDir, "ashoka_cg_state.json");
            _licenseFile = Path.Combine(dataDir, "license.json");

            try { ServicePointManager.DefaultConnectionLimit = 32; } catch { }

            _listener = new HttpListener();
            _listener.Prefixes.Add("http://127.0.0.1:38550/");
            try { _listener.IgnoreWriteExceptions = true; } catch { }
            try { _listener.Start(); } catch { return; }

            while (_listener.IsListening && !_shouldStop)
            {
                try
                {
                    HttpListenerContext ctx = _listener.GetContext();
                    ThreadPool.QueueUserWorkItem(new WaitCallback(ProcessRequest), ctx);
                }
                catch
                {
                    if (_shouldStop || _listener == null || !_listener.IsListening) break;
                }
            }
        }

        private static void ProcessRequest(object stateObj)
        {
            HttpListenerContext ctx = (HttpListenerContext)stateObj;
            HttpListenerRequest req = ctx.Request;
            HttpListenerResponse res = ctx.Response;
            try
            {
                res.Headers.Add("Access-Control-Allow-Origin", "*");
                res.Headers.Add("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
                res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, X-File-Name, Range");

                string urlPath = req.Url != null ? req.Url.AbsolutePath : "/";
                string method = req.HttpMethod != null ? req.HttpMethod.ToUpperInvariant() : "GET";

                if (method == "OPTIONS")
                {
                    res.StatusCode = 200;
                    CloseQuiet(res);
                    return;
                }

                if (urlPath == "/api/health")
                {
                    SendJson(res, "{\\"ok\\":true,\\"app\\":\\"ashoka\\",\\"mode\\":\\"desktop-offline\\"}", 200);
                    return;
                }

                if (urlPath == "/api/system/stats")
                {
                    SendJson(res, "{\\"cpuPercent\\":12,\\"ramPercent\\":38,\\"version\\":\\"v5.0 MSO PRO\\"}", 200);
                    return;
                }

                if (urlPath == "/api/system/displays" && method == "GET")
                {
                    HandleGetDisplays(res);
                    return;
                }

                if (urlPath == "/api/display/open-fullscreen" && method == "POST")
                {
                    HandleOpenDisplayFullscreen(req, res);
                    return;
                }

                if (urlPath == "/api/app/exit" && method == "POST")
                {
                    KillTrackedOutputChildren();
                    SendJson(res, "{\\"ok\\":true}", 200);
                    _shouldStop = true;
                    try { _listener.Stop(); } catch { }
                    return;
                }

                if (urlPath == "/api/license/status" && method == "GET")
                {
                    if (File.Exists(_licenseFile))
                    {
                        SendJson(res, File.ReadAllText(_licenseFile, Encoding.UTF8), 200);
                    }
                    else
                    {
                        SendJson(res, "{\\"licensed\\":false,\\"isLicensed\\":false}", 200);
                    }
                    return;
                }

                if (urlPath == "/api/license/activate" && method == "POST")
                {
                    HandleLicenseActivate(req, res);
                    return;
                }

                if (urlPath == "/api/playout/license/activate" && method == "POST")
                {
                    HandlePlayoutLicenseActivate(req, res);
                    return;
                }

                if (urlPath == "/api/playout/live-sync")
                {
                    HandleLiveSync(req, res, method);
                    return;
                }

                if (urlPath == "/api/cg/state" && method == "GET")
                {
                    string snap = "";
                    lock (_cgLock)
                    {
                        if (!string.IsNullOrEmpty(_cgStateJson))
                        {
                            snap = _cgStateJson;
                        }
                        else if (File.Exists(_cgStateFile))
                        {
                            _cgStateJson = File.ReadAllText(_cgStateFile, Encoding.UTF8);
                            snap = _cgStateJson;
                        }
                    }
                    if (!string.IsNullOrEmpty(snap))
                    {
                        SendJson(res, snap, 200);
                    }
                    else
                    {
                        SendJson(res, "{\\"ok\\":true,\\"updatedAtMs\\":0,\\"bottomOverlay\\":null,\\"topOverlay\\":null,\\"lShape\\":null,\\"graphics\\":null}", 200);
                    }
                    return;
                }

                if (urlPath == "/api/cg/save" && method == "POST")
                {
                    string body = ReadBodyText(req);
                    if (!string.IsNullOrEmpty(body))
                    {
                        lock (_cgLock)
                        {
                            _cgStateJson = body;
                            File.WriteAllText(_cgStateFile, body, Encoding.UTF8);
                        }
                    }
                    SendJson(res, "{\\"ok\\":true}", 200);
                    return;
                }

                if ((urlPath == "/api/playout/state" || urlPath == "/api/playout/load") && method == "GET")
                {
                    byte[] bytes = null;
                    lock (_stateLock)
                    {
                        if (File.Exists(_stateFile)) bytes = File.ReadAllBytes(_stateFile);
                    }
                    if (bytes != null)
                    {
                        res.StatusCode = 200;
                        res.ContentType = "application/json; charset=utf-8";
                        res.Headers.Add("Cache-Control", "no-store");
                        res.ContentLength64 = bytes.Length;
                        res.OutputStream.Write(bytes, 0, bytes.Length);
                        CloseQuiet(res);
                    }
                    else
                    {
                        SendJson(res, "{\\"channels\\":[]}", 200);
                    }
                    return;
                }

                if ((urlPath == "/api/playout/save" || urlPath == "/api/playout/sync" || urlPath == "/api/playout/state") && method == "POST")
                {
                    byte[] bodyBytes = ReadBodyBytes(req);
                    lock (_stateLock)
                    {
                        File.WriteAllBytes(_stateFile, bodyBytes);
                    }
                    SendJson(res, "{\\"ok\\":true,\\"success\\":true}", 200);
                    return;
                }

                if (urlPath == "/api/playout/reset" && method == "POST")
                {
                    HandlePlayoutReset(req, res);
                    return;
                }

                if (urlPath == "/api/playout/toggle-enable" && method == "POST")
                {
                    HandleToggleEnable(req, res);
                    return;
                }

                if (urlPath == "/api/media/upload-chunk" && method == "POST")
                {
                    HandleUploadChunk(req, res);
                    return;
                }

                if (urlPath == "/api/media/upload-complete" && method == "POST")
                {
                    HandleUploadComplete(req, res);
                    return;
                }

                if (urlPath == "/api/media/upload" && method == "POST")
                {
                    HandleUploadDirect(req, res);
                    return;
                }

                if (urlPath.StartsWith("/api/media/by-name", StringComparison.OrdinalIgnoreCase) && (method == "GET" || method == "HEAD"))
                {
                    HandleMediaByName(req, res, urlPath);
                    return;
                }

                if (urlPath.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase) && (method == "GET" || method == "HEAD"))
                {
                    HandleServeUpload(req, res, urlPath);
                    return;
                }

                if (urlPath == "/api/live/m3u8-proxy" && (method == "GET" || method == "HEAD"))
                {
                    HandleM3u8Proxy(req, res);
                    return;
                }

                if (urlPath == "/api/live/youtube/resolve" && method == "POST")
                {
                    HandleYouTubeResolve(req, res);
                    return;
                }

                if (urlPath == "/api/live/rtmp-pull" && (method == "GET" || method == "HEAD"))
                {
                    HandleRtmpPull(req, res);
                    return;
                }

                if (urlPath == "/api/media/vlc-stream" && (method == "GET" || method == "HEAD"))
                {
                    HandleVlcStreamFallback(req, res);
                    return;
                }

                string relPath = urlPath.TrimStart('/');
                if (string.IsNullOrWhiteSpace(relPath)) relPath = "index.html";
                string localFile = SafeJoin(_appDir, relPath.Replace('/', Path.DirectorySeparatorChar));
                if (localFile == null || !File.Exists(localFile))
                {
                    if (urlPath.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) ||
                        urlPath.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase) ||
                        urlPath.StartsWith("/videos/", StringComparison.OrdinalIgnoreCase) ||
                        urlPath.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase) ||
                        urlPath.StartsWith("/ruffle/", StringComparison.OrdinalIgnoreCase) ||
                        Path.HasExtension(relPath))
                    {
                        res.StatusCode = 404;
                        CloseQuiet(res);
                        return;
                    }
                    localFile = Path.Combine(_appDir, "index.html");
                }
                if (File.Exists(localFile))
                {
                    SendFileWithRange(req, res, localFile, true);
                    return;
                }

                res.StatusCode = 404;
                CloseQuiet(res);
            }
            catch
            {
                CloseQuiet(res);
            }
        }

        private static void HandleGetDisplays(HttpListenerResponse res)
        {
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            try
            {
                Screen[] screens = Screen.AllScreens;
                if (screens != null)
                {
                    for (int i = 0; i < screens.Length; i++)
                    {
                        Screen sc = screens[i];
                        Dictionary<string, object> d = new Dictionary<string, object>();
                        d["index"] = i + 1;
                        d["id"] = "DISPLAY" + (i + 1);
                        d["name"] = sc.DeviceName;
                        d["left"] = sc.Bounds.X;
                        d["top"] = sc.Bounds.Y;
                        d["width"] = sc.Bounds.Width;
                        d["height"] = sc.Bounds.Height;
                        d["isPrimary"] = sc.Primary;
                        list.Add(d);
                    }
                }
            }
            catch { }
            if (list.Count == 0)
            {
                Dictionary<string, object> def = new Dictionary<string, object>();
                def["index"] = 1;
                def["id"] = "DISPLAY1";
                def["name"] = "Primary Display";
                def["left"] = 0;
                def["top"] = 0;
                def["width"] = 1920;
                def["height"] = 1080;
                def["isPrimary"] = true;
                list.Add(def);
            }
            SendJson(res, CreateSerializer().Serialize(list), 200);
        }

        private static void HandleOpenDisplayFullscreen(HttpListenerRequest req, HttpListenerResponse res)
        {
            string raw = ReadBodyText(req);
            int dispIdx = 2;
            string fitMode = "fill";
            string cleanFlag = "0";
            try
            {
                if (!string.IsNullOrEmpty(raw))
                {
                    Dictionary<string, object> cfg = CreateSerializer().Deserialize<Dictionary<string, object>>(raw);
                    if (cfg != null)
                    {
                        if (cfg.ContainsKey("displayIndex") && cfg["displayIndex"] != null)
                            dispIdx = Convert.ToInt32(cfg["displayIndex"]);
                        if (cfg.ContainsKey("fitMode") && Convert.ToString(cfg["fitMode"]) == "contain")
                            fitMode = "contain";
                        if (cfg.ContainsKey("cleanMode") && Convert.ToBoolean(cfg["cleanMode"]))
                            cleanFlag = "1";
                    }
                }
            }
            catch { }

            int posX = 0, posY = 0, winW = 1920, winH = 1080;
            try
            {
                Screen[] screens = Screen.AllScreens;
                if (screens != null && screens.Length > 0)
                {
                    int targetIdx = Math.Max(0, Math.Min(screens.Length - 1, dispIdx - 1));
                    Rectangle b = screens[targetIdx].Bounds;
                    posX = b.X;
                    posY = b.Y;
                    winW = b.Width;
                    winH = b.Height;
                }
            }
            catch { }

            KillTrackedOutputChildren();

            string hostExe = Path.Combine(_installDir, "Ashoka_MSO_Playlist.exe");
            string outArgs = "--output --display=" + dispIdx + " --fit=" + fitMode + " --clean=" + cleanFlag +
                             " --left=" + posX + " --top=" + posY + " --width=" + winW + " --height=" + winH;
            bool launched = false;

            if (File.Exists(hostExe) && new FileInfo(hostExe).Length >= 12288)
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = hostExe;
                    psi.Arguments = outArgs;
                    psi.WorkingDirectory = _installDir;
                    psi.UseShellExecute = false;
                    Process proc = Process.Start(psi);
                    if (proc != null)
                    {
                        lock (_childLock) { _childOutputs.Add(proc); }
                        launched = true;
                    }
                }
                catch { }
            }

            Dictionary<string, object> bounds = new Dictionary<string, object>();
            bounds["left"] = posX;
            bounds["top"] = posY;
            bounds["width"] = winW;
            bounds["height"] = winH;

            Dictionary<string, object> resp = new Dictionary<string, object>();
            resp["ok"] = launched;
            resp["launched"] = launched;
            resp["displayIndex"] = dispIdx;
            resp["fitMode"] = fitMode;
            resp["bounds"] = bounds;
            SendJson(res, CreateSerializer().Serialize(resp), 200);
        }

        private static void KillTrackedOutputChildren()
        {
            bool killed = false;
            lock (_childLock)
            {
                for (int i = _childOutputs.Count - 1; i >= 0; i--)
                {
                    try
                    {
                        if (!_childOutputs[i].HasExited)
                        {
                            _childOutputs[i].Kill();
                            killed = true;
                        }
                    }
                    catch { }
                    _childOutputs.RemoveAt(i);
                }
            }
            try
            {
                Process[] peers = Process.GetProcessesByName("Ashoka_MSO_Playlist");
                for (int i = 0; i < peers.Length; i++)
                {
                    string title = "";
                    try { title = peers[i].MainWindowTitle ?? ""; } catch { }
                    if (title.IndexOf("DISPLAY", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        try { peers[i].Kill(); killed = true; } catch { }
                    }
                }
            }
            catch { }
            KillAllRtmpPullSessions();
            if (killed) Thread.Sleep(80);
        }

        private static void HandleLicenseActivate(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = ReadBodyText(req);
                Dictionary<string, object> parsed = CreateSerializer().Deserialize<Dictionary<string, object>>(body);
                if (parsed != null && parsed.ContainsKey("licenseRecord") && parsed["licenseRecord"] != null)
                {
                    Dictionary<string, object> licOut = new Dictionary<string, object>();
                    licOut["licensed"] = true;
                    licOut["isLicensed"] = true;
                    licOut["licenseRecord"] = parsed["licenseRecord"];
                    File.WriteAllText(_licenseFile, CreateSerializer().Serialize(licOut), Encoding.UTF8);

                    Dictionary<string, object> resp = new Dictionary<string, object>();
                    resp["success"] = true;
                    resp["licensed"] = true;
                    resp["isLicensed"] = true;
                    resp["licenseRecord"] = parsed["licenseRecord"];
                    SendJson(res, CreateSerializer().Serialize(resp), 200);
                    return;
                }
            }
            catch { }
            SendJson(res, "{\\"success\\":false,\\"error\\":\\"Invalid license payload\\"}", 400);
        }

        private static void HandlePlayoutLicenseActivate(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = ReadBodyText(req);
                Dictionary<string, object> p2 = CreateSerializer().Deserialize<Dictionary<string, object>>(body);
                string mKey = p2 != null && p2.ContainsKey("masterKey") ? Convert.ToString(p2["masterKey"]) : "";
                if (mKey != "KANISHQ")
                {
                    SendJson(res, "{\\"success\\":false,\\"error\\":\\"Invalid Master Key\\"}", 403);
                    return;
                }
                string cName = p2.ContainsKey("clientName") && !string.IsNullOrEmpty(Convert.ToString(p2["clientName"]))
                    ? Convert.ToString(p2["clientName"]) : "ASHOKA STATION";
                string cExp = p2.ContainsKey("expiryDate") && !string.IsNullOrEmpty(Convert.ToString(p2["expiryDate"]))
                    ? Convert.ToString(p2["expiryDate"]) : DateTime.Now.AddYears(1).ToString("yyyy-MM-dd");
                string cStart = p2.ContainsKey("startDate") && !string.IsNullOrEmpty(Convert.ToString(p2["startDate"]))
                    ? Convert.ToString(p2["startDate"]) : DateTime.Now.ToString("yyyy-MM-dd");
                string cKey = p2.ContainsKey("licenseKey") && !string.IsNullOrEmpty(Convert.ToString(p2["licenseKey"]))
                    ? Convert.ToString(p2["licenseKey"]) : "ASHOKA-OFFLINE";

                Dictionary<string, object> rec = new Dictionary<string, object>();
                rec["clientName"] = cName;
                rec["licenseKey"] = cKey;
                rec["startDate"] = cStart;
                rec["expiryDate"] = cExp;
                rec["isLocked"] = true;
                rec["activatedAt"] = DateTime.UtcNow.ToString("o");

                Dictionary<string, object> licOut = new Dictionary<string, object>();
                licOut["licensed"] = true;
                licOut["isLicensed"] = true;
                licOut["licenseRecord"] = rec;
                File.WriteAllText(_licenseFile, CreateSerializer().Serialize(licOut), Encoding.UTF8);

                Dictionary<string, object> resp = new Dictionary<string, object>();
                resp["success"] = true;
                resp["isLicensed"] = true;
                resp["licenseRecord"] = rec;
                SendJson(res, CreateSerializer().Serialize(resp), 200);
                return;
            }
            catch { }
            SendJson(res, "{\\"success\\":false,\\"error\\":\\"Failed to activate offline license\\"}", 400);
        }

        private static void HandleLiveSync(HttpListenerRequest req, HttpListenerResponse res, string method)
        {
            if (method == "POST")
            {
                string body = ReadBodyText(req);
                if (!string.IsNullOrEmpty(body))
                {
                    long incomingSeq = 0;
                    Match m = Regex.Match(body, "\\"syncSeq\\"\\\\s*:\\\\s*(\\\\d+)");
                    if (m.Success) long.TryParse(m.Groups[1].Value, out incomingSeq);
                    lock (_syncLock)
                    {
                        if (incomingSeq <= 2 || incomingSeq >= _liveSyncSeq || _liveSyncSeq == 0)
                        {
                            if (incomingSeq > 0) _liveSyncSeq = incomingSeq;
                            _liveSyncJson = body;
                        }
                    }
                }
                SendJson(res, "{\\"ok\\":true}", 200);
                return;
            }

            string snap;
            lock (_syncLock) { snap = _liveSyncJson; }
            if (!string.IsNullOrEmpty(snap))
            {
                SendJson(res, snap, 200);
                return;
            }
            lock (_stateLock)
            {
                if (File.Exists(_stateFile))
                {
                    SendJson(res, File.ReadAllText(_stateFile, Encoding.UTF8), 200);
                    return;
                }
            }
            SendJson(res, "{\\"channel\\":null}", 200);
        }

        private static void HandlePlayoutReset(HttpListenerRequest req, HttpListenerResponse res)
        {
            string raw = ReadBodyText(req);
            object rstChannels = new object[0];
            try
            {
                if (!string.IsNullOrEmpty(raw))
                {
                    Dictionary<string, object> parsed = CreateSerializer().Deserialize<Dictionary<string, object>>(raw);
                    if (parsed != null && parsed.ContainsKey("channels") && parsed["channels"] != null)
                        rstChannels = parsed["channels"];
                }
            }
            catch { }

            Dictionary<string, object> rstObj = new Dictionary<string, object>();
            rstObj["appName"] = "ASHOKA MSO PLAYLIST";
            rstObj["updatedAt"] = DateTime.UtcNow.ToString("o");
            rstObj["everyNMinAds"] = new object[0];
            rstObj["everyNMinEnabled"] = false;
            rstObj["everyNMinInterval"] = 15;
            rstObj["channels"] = rstChannels;

            string rstJson = CreateSerializer().Serialize(rstObj);
            lock (_stateLock) { File.WriteAllText(_stateFile, rstJson, Encoding.UTF8); }
            lock (_syncLock) { _liveSyncJson = ""; _liveSyncSeq = 0; }
            lock (_cgLock)
            {
                _cgStateJson = "";
                try { if (File.Exists(_cgStateFile)) File.Delete(_cgStateFile); } catch { }
            }

            Dictionary<string, object> resp = new Dictionary<string, object>();
            resp["success"] = true;
            resp["state"] = rstObj;
            SendJson(res, CreateSerializer().Serialize(resp), 200);
        }

        private static void HandleToggleEnable(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string raw = ReadBodyText(req);
                Dictionary<string, object> tg = CreateSerializer().Deserialize<Dictionary<string, object>>(raw);
                bool enVal = tg.ContainsKey("enabled") && Convert.ToBoolean(tg["enabled"]);
                string section = tg.ContainsKey("section") ? Convert.ToString(tg["section"]) : "";
                if (string.IsNullOrEmpty(section) && tg.ContainsKey("scope"))
                    section = Convert.ToString(tg["scope"]);
                section = section ?? "";
                string folderName = tg.ContainsKey("folderName") ? Convert.ToString(tg["folderName"]) : "";
                string itemId = tg.ContainsKey("itemId") ? Convert.ToString(tg["itemId"]) : "";
                string programId = tg.ContainsKey("programId") ? Convert.ToString(tg["programId"]) : "";

                lock (_stateLock)
                {
                    if (File.Exists(_stateFile))
                    {
                        JavaScriptSerializer ser = CreateSerializer();
                        Dictionary<string, object> stObj = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(_stateFile, Encoding.UTF8));
                        if (stObj != null && stObj.ContainsKey("channels") && stObj["channels"] is ArrayList)
                        {
                            foreach (object chObj in (ArrayList)stObj["channels"])
                            {
                                Dictionary<string, object> ch = chObj as Dictionary<string, object>;
                                if (ch == null) continue;
                                if (section == "main" && ch.ContainsKey("playlist") && ch["playlist"] is ArrayList)
                                {
                                    foreach (object itObj in (ArrayList)ch["playlist"])
                                    {
                                        Dictionary<string, object> it = itObj as Dictionary<string, object>;
                                        if (it == null) continue;
                                        string fn = it.ContainsKey("folderName") ? Convert.ToString(it["folderName"]) : "";
                                        string id = it.ContainsKey("id") ? Convert.ToString(it["id"]) : "";
                                        if ((!string.IsNullOrEmpty(folderName) && fn == folderName) || (!string.IsNullOrEmpty(itemId) && id == itemId))
                                            it["enabled"] = enVal;
                                    }
                                }
                                else if (section == "every_n_min" && ch.ContainsKey("everyNMinAds") && ch["everyNMinAds"] is ArrayList)
                                {
                                    foreach (object adObj in (ArrayList)ch["everyNMinAds"])
                                    {
                                        Dictionary<string, object> ad = adObj as Dictionary<string, object>;
                                        if (ad == null) continue;
                                        string fn = ad.ContainsKey("folderName") ? Convert.ToString(ad["folderName"]) : "";
                                        string id = ad.ContainsKey("id") ? Convert.ToString(ad["id"]) : "";
                                        if ((!string.IsNullOrEmpty(folderName) && fn == folderName) || (!string.IsNullOrEmpty(itemId) && id == itemId))
                                            ad["enabled"] = enVal;
                                    }
                                }
                                else if (section == "program" && ch.ContainsKey("scheduledPrograms") && ch["scheduledPrograms"] is ArrayList)
                                {
                                    foreach (object prObj in (ArrayList)ch["scheduledPrograms"])
                                    {
                                        Dictionary<string, object> pr = prObj as Dictionary<string, object>;
                                        if (pr == null) continue;
                                        string pid = pr.ContainsKey("id") ? Convert.ToString(pr["id"]) : "";
                                        if (!string.IsNullOrEmpty(programId) && pid == programId)
                                        {
                                            ArrayList pl = pr.ContainsKey("playlist") ? pr["playlist"] as ArrayList : null;
                                            if (!string.IsNullOrEmpty(itemId) && pl != null)
                                            {
                                                foreach (object pcObj in pl)
                                                {
                                                    Dictionary<string, object> pc = pcObj as Dictionary<string, object>;
                                                    if (pc != null && pc.ContainsKey("id") && Convert.ToString(pc["id"]) == itemId)
                                                        pc["enabled"] = enVal;
                                                }
                                            }
                                            else
                                            {
                                                pr["enabled"] = enVal;
                                                if (pl != null)
                                                {
                                                    foreach (object pcObj in pl)
                                                    {
                                                        Dictionary<string, object> pc = pcObj as Dictionary<string, object>;
                                                        if (pc != null) pc["enabled"] = enVal;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                else if ((section == "bottom_overlay" || section == "top_overlay") &&
                                         ch.ContainsKey(section == "top_overlay" ? "topOverlay" : "bottomOverlay"))
                                {
                                    Dictionary<string, object> ov = ch[section == "top_overlay" ? "topOverlay" : "bottomOverlay"] as Dictionary<string, object>;
                                    ArrayList pl = (ov != null && ov.ContainsKey("playlist")) ? ov["playlist"] as ArrayList : null;
                                    if (pl != null)
                                    {
                                        foreach (object itObj in pl)
                                        {
                                            Dictionary<string, object> it = itObj as Dictionary<string, object>;
                                            if (it == null) continue;
                                            string fn = it.ContainsKey("folderName") ? Convert.ToString(it["folderName"]) : "";
                                            string id = it.ContainsKey("id") ? Convert.ToString(it["id"]) : "";
                                            if ((!string.IsNullOrEmpty(folderName) && fn == folderName) || (!string.IsNullOrEmpty(itemId) && id == itemId))
                                                it["enabled"] = enVal;
                                        }
                                    }
                                }
                                else if ((section == "bottom_ticker" || section == "top_ticker") && ch.ContainsKey("graphics"))
                                {
                                    Dictionary<string, object> gr = ch["graphics"] as Dictionary<string, object>;
                                    string tKey = section == "top_ticker" ? "topTickerItems" : "tickerItems";
                                    ArrayList pl = (gr != null && gr.ContainsKey(tKey)) ? gr[tKey] as ArrayList : null;
                                    if (pl != null)
                                    {
                                        foreach (object itObj in pl)
                                        {
                                            Dictionary<string, object> it = itObj as Dictionary<string, object>;
                                            if (it == null) continue;
                                            string fn = it.ContainsKey("folderName") ? Convert.ToString(it["folderName"]) : "";
                                            string id = it.ContainsKey("id") ? Convert.ToString(it["id"]) : "";
                                            if ((!string.IsNullOrEmpty(folderName) && fn == folderName) || (!string.IsNullOrEmpty(itemId) && id == itemId))
                                                it["enabled"] = enVal;
                                        }
                                    }
                                }
                                else if (section == "lshape" && ch.ContainsKey("lShape"))
                                {
                                    Dictionary<string, object> ls = ch["lShape"] as Dictionary<string, object>;
                                    ArrayList pl = (ls != null && ls.ContainsKey("playlist")) ? ls["playlist"] as ArrayList : null;
                                    if (pl != null)
                                    {
                                        foreach (object itObj in pl)
                                        {
                                            Dictionary<string, object> it = itObj as Dictionary<string, object>;
                                            if (it == null) continue;
                                            string fn = it.ContainsKey("folderName") ? Convert.ToString(it["folderName"]) : "";
                                            string id = it.ContainsKey("id") ? Convert.ToString(it["id"]) : "";
                                            if ((!string.IsNullOrEmpty(folderName) && fn == folderName) || (!string.IsNullOrEmpty(itemId) && id == itemId))
                                                it["enabled"] = enVal;
                                        }
                                    }
                                }
                            }
                            File.WriteAllText(_stateFile, ser.Serialize(stObj), Encoding.UTF8);
                        }
                    }
                }
            }
            catch { }
            SendJson(res, "{\\"success\\":true}", 200);
        }

        private static void HandleUploadChunk(HttpListenerRequest req, HttpListenerResponse res)
        {
            string rawUid = req.QueryString["uploadId"] ?? "";
            string uid = Regex.Replace(rawUid, "[^a-zA-Z0-9_-]", "");
            int cIdx = 0;
            int.TryParse(req.QueryString["index"] ?? "0", out cIdx);
            if (string.IsNullOrWhiteSpace(uid))
            {
                SendJson(res, "{\\"success\\":false,\\"error\\":\\"Missing uploadId\\"}", 400);
                return;
            }
            string partFile = Path.Combine(_uploadsDir, ".part_" + uid + ".bin");
            FileMode fm = (cIdx == 0) ? FileMode.Create : FileMode.Append;
            using (FileStream fs = File.Open(partFile, fm, FileAccess.Write, FileShare.Read))
            {
                req.InputStream.CopyTo(fs);
            }
            SendJson(res, "{\\"success\\":true,\\"index\\":" + cIdx + "}", 200);
        }

        private static int _uploadSeq = 0;

        private static string FindFfmpegTool(string exeName)
        {
            try
            {
                string[] directCandidates = new string[] {
                    Path.Combine(_installDir ?? "", exeName),
                    Path.Combine(_appDir ?? "", exeName),
                    Path.Combine(_installDir ?? "", "ffmpeg", exeName),
                    Path.Combine(_installDir ?? "", "ffmpeg", "bin", exeName),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "ffmpeg", "bin", exeName),
                    "C:\\\\ffmpeg\\\\bin\\\\" + exeName
                };
                foreach (string c in directCandidates)
                {
                    if (!string.IsNullOrEmpty(c) && File.Exists(c)) return c;
                }
                string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
                foreach (string dir in pathEnv.Split(Path.PathSeparator))
                {
                    string trimmed = (dir ?? "").Trim();
                    if (string.IsNullOrEmpty(trimmed)) continue;
                    try
                    {
                        string p = Path.Combine(trimmed, exeName);
                        if (File.Exists(p)) return p;
                    }
                    catch { }
                }
            }
            catch { }
            return null;
        }

        private static bool RunToolWithTimeout(string exePath, string args, int timeoutMs, out string stdOut)
        {
            stdOut = "";
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = exePath;
                psi.Arguments = args;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (Process proc = Process.Start(psi))
                {
                    if (proc == null) return false;
                    string err = "";
                    System.Threading.Tasks.Task<string> outTask = proc.StandardOutput.ReadToEndAsync();
                    System.Threading.Tasks.Task<string> errTask = proc.StandardError.ReadToEndAsync();
                    if (!proc.WaitForExit(timeoutMs))
                    {
                        try { proc.Kill(); } catch { }
                        return false;
                    }
                    try { stdOut = outTask.Result ?? ""; } catch { }
                    try { err = errTask.Result ?? ""; } catch { }
                    return proc.ExitCode == 0;
                }
            }
            catch { return false; }
        }

        private static Dictionary<string, object> ProcessUploadedMediaOnDisk(string destFile, string rawName, string safeName, string stampTag)
        {
            string ext = Path.GetExtension(safeName).TrimStart('.').ToLowerInvariant();
            string finalUrl = "/uploads/" + Path.GetFileName(destFile);
            bool isTranscoded = false;
            int finalDuration = 0;

            HashSet<string> skipExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
                "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "apng", "swf"
            };

            if (!skipExts.Contains(ext))
            {
                string ffprobe = FindFfmpegTool("ffprobe.exe");
                string ffmpeg = FindFfmpegTool("ffmpeg.exe");
                string vCodec = "";
                string pixFmt = "";
                string aCodec = "";
                int aChannels = 0;
                int aSampleRate = 0;
                bool hasAudio = false;
                bool probedOk = false;

                if (!string.IsNullOrEmpty(ffprobe))
                {
                    string pOut;
                    if (RunToolWithTimeout(ffprobe, "-v quiet -analyzeduration 100M -probesize 100M -print_format json -show_format -show_streams \\"" + destFile + "\\"", 15000, out pOut) && !string.IsNullOrEmpty(pOut))
                    {
                        try
                        {
                            Dictionary<string, object> pJson = CreateSerializer().Deserialize<Dictionary<string, object>>(pOut);
                            if (pJson != null)
                            {
                                object fmtObj;
                                if (pJson.TryGetValue("format", out fmtObj) && fmtObj is Dictionary<string, object>)
                                {
                                    Dictionary<string, object> fmt = (Dictionary<string, object>)fmtObj;
                                    if (fmt.ContainsKey("duration") && fmt["duration"] != null)
                                    {
                                        double dVal;
                                        if (double.TryParse(Convert.ToString(fmt["duration"]), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out dVal) && dVal > 0)
                                            finalDuration = (int)Math.Max(1, Math.Ceiling(dVal));
                                    }
                                }
                                object stObj;
                                if (pJson.TryGetValue("streams", out stObj) && stObj is ArrayList)
                                {
                                    foreach (object sItem in (ArrayList)stObj)
                                    {
                                        Dictionary<string, object> sDict = sItem as Dictionary<string, object>;
                                        if (sDict == null) continue;
                                        string ct = Convert.ToString(sDict.ContainsKey("codec_type") ? sDict["codec_type"] : "").ToLowerInvariant();
                                        if (ct == "video" && string.IsNullOrEmpty(vCodec))
                                        {
                                            vCodec = Convert.ToString(sDict.ContainsKey("codec_name") ? sDict["codec_name"] : "").ToLowerInvariant();
                                            pixFmt = Convert.ToString(sDict.ContainsKey("pix_fmt") ? sDict["pix_fmt"] : "").ToLowerInvariant();
                                            probedOk = true;
                                        }
                                        else if (ct == "audio" && !hasAudio)
                                        {
                                            hasAudio = true;
                                            aCodec = Convert.ToString(sDict.ContainsKey("codec_name") ? sDict["codec_name"] : "").ToLowerInvariant();
                                            if (sDict.ContainsKey("channels") && sDict["channels"] != null)
                                                int.TryParse(Convert.ToString(sDict["channels"]), out aChannels);
                                            if (sDict.ContainsKey("sample_rate") && sDict["sample_rate"] != null)
                                                int.TryParse(Convert.ToString(sDict["sample_rate"]), out aSampleRate);
                                        }
                                    }
                                }
                            }
                        }
                        catch { }
                    }
                }

                HashSet<string> forceContainers = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
                    "mkv","avi","mpg","mpeg","vob","ts","m2ts","mts","flv","f4v","wmv","asf","3gp","3g2","dat","divx","xvid","rm","rmvb","mxf","mp2","m2v","mpv","ogv","dv","mov","m4v"
                };
                bool needTranscode = forceContainers.Contains(ext) || !probedOk;
                if (probedOk)
                {
                    if (vCodec != "h264" && vCodec != "vp8" && vCodec != "vp9" && vCodec != "av1") needTranscode = true;
                    if (!string.IsNullOrEmpty(pixFmt) && pixFmt != "yuv420p" && pixFmt != "yuvj420p" && pixFmt != "nv12") needTranscode = true;
                    if (hasAudio)
                    {
                        bool validAudio = (ext == "webm") ? (aCodec == "opus" || aCodec == "vorbis") : (aCodec == "aac" || aCodec == "mp3");
                        if (!validAudio || aChannels > 2 || aChannels == 0 || (aSampleRate > 0 && (aSampleRate < 22050 || aSampleRate > 48000)))
                            needTranscode = true;
                    }
                }

                if (needTranscode && !string.IsNullOrEmpty(ffmpeg))
                {
                    string baseNoExt = Path.GetFileNameWithoutExtension(safeName);
                    string outName = stampTag + "_" + baseNoExt + "_vlc.mp4";
                    string outPath = Path.Combine(_uploadsDir, outName);
                    bool canCopyVideo = !forceContainers.Contains(ext) && probedOk && vCodec == "h264" && (pixFmt == "yuv420p" || pixFmt == "yuvj420p" || pixFmt == "nv12");
                    string vArgs = canCopyVideo
                        ? "-c:v copy"
                        : "-c:v libx264 -preset ultrafast -crf 22 -profile:v high -level:v 4.1 -pix_fmt yuv420p -vf \\"scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1\\" -r 30";
                    string aArgs = (!probedOk || hasAudio)
                        ? "-map 0:a:0? -c:a aac -ac 2 -ar 48000 -b:a 192k -af aresample=async=1:first_pts=0"
                        : "-an";
                    string ffArgs = "-y -fflags +genpts+igndts -err_detect ignore_err -analyzeduration 100M -probesize 100M -i \\"" + destFile + "\\" -map 0:v:0? " + vArgs + " " + aArgs + " -movflags +faststart \\"" + outPath + "\\"";
                    string dummyOut;
                    bool ok = RunToolWithTimeout(ffmpeg, ffArgs, 300000, out dummyOut);
                    if (!ok || !File.Exists(outPath) || new FileInfo(outPath).Length == 0)
                    {
                        string ffArgsFull = "-y -fflags +genpts+igndts -err_detect ignore_err -i \\"" + destFile + "\\" -map 0:v:0? -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -vf \\"scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1\\" -r 30 " + aArgs + " -movflags +faststart \\"" + outPath + "\\"";
                        ok = RunToolWithTimeout(ffmpeg, ffArgsFull, 300000, out dummyOut);
                    }
                    if (ok && File.Exists(outPath) && new FileInfo(outPath).Length > 0)
                    {
                        try { File.Delete(destFile); } catch { }
                        finalUrl = "/uploads/" + outName;
                        isTranscoded = true;
                    }
                }
            }

            Dictionary<string, object> resp = new Dictionary<string, object>();
            resp["success"] = true;
            resp["ok"] = true;
            resp["url"] = finalUrl;
            resp["fileName"] = rawName;
            resp["transcoded"] = isTranscoded;
            if (finalDuration > 0) resp["duration"] = finalDuration;
            return resp;
        }

        private static void HandleUploadComplete(HttpListenerRequest req, HttpListenerResponse res)
        {
            string raw = ReadBodyText(req);
            string uid = "";
            string rawName = "media.mp4";
            try
            {
                Dictionary<string, object> comp = CreateSerializer().Deserialize<Dictionary<string, object>>(raw);
                if (comp != null)
                {
                    if (comp.ContainsKey("uploadId")) uid = Regex.Replace(Convert.ToString(comp["uploadId"]) ?? "", "[^a-zA-Z0-9_-]", "");
                    if (comp.ContainsKey("fileName") && !string.IsNullOrEmpty(Convert.ToString(comp["fileName"])))
                        rawName = Convert.ToString(comp["fileName"]);
                }
            }
            catch { }
            try { rawName = Uri.UnescapeDataString(rawName); } catch { }
            string safeName = Regex.Replace(rawName, "[^a-zA-Z0-9._-]", "_");
            string partFile = Path.Combine(_uploadsDir, ".part_" + uid + ".bin");
            if (string.IsNullOrEmpty(uid) || !File.Exists(partFile))
            {
                SendJson(res, "{\\"success\\":false,\\"error\\":\\"Chunk file missing\\"}", 400);
                return;
            }
            int seq = Interlocked.Increment(ref _uploadSeq) % 10000;
            string stampTag = ToUnixMs(DateTime.UtcNow) + "_" + seq.ToString("0000");
            string finalFile = stampTag + "_" + safeName;
            string destFile = Path.Combine(_uploadsDir, finalFile);
            if (File.Exists(destFile)) { try { File.Delete(destFile); } catch { } }
            File.Move(partFile, destFile);

            Dictionary<string, object> resp = ProcessUploadedMediaOnDisk(destFile, rawName, safeName, stampTag);
            SendJson(res, CreateSerializer().Serialize(resp), 200);
        }

        private static void HandleUploadDirect(HttpListenerRequest req, HttpListenerResponse res)
        {
            string rawName = req.Headers["X-File-Name"];
            if (string.IsNullOrWhiteSpace(rawName)) rawName = req.QueryString["name"];
            if (string.IsNullOrWhiteSpace(rawName)) rawName = "media.mp4";
            try { rawName = Uri.UnescapeDataString(rawName); } catch { }
            string safeName = Regex.Replace(rawName, "[^a-zA-Z0-9._-]", "_");

            int seq = Interlocked.Increment(ref _uploadSeq) % 10000;
            string stampTag = ToUnixMs(DateTime.UtcNow) + "_" + seq.ToString("0000");
            string finalFile = stampTag + "_" + safeName;
            string destFile = Path.Combine(_uploadsDir, finalFile);
            using (FileStream fs = File.Open(destFile, FileMode.Create, FileAccess.Write, FileShare.Read))
            {
                req.InputStream.CopyTo(fs);
            }
            Dictionary<string, object> resp = ProcessUploadedMediaOnDisk(destFile, rawName, safeName, stampTag);
            SendJson(res, CreateSerializer().Serialize(resp), 200);
        }

        private static void HandleMediaByName(HttpListenerRequest req, HttpListenerResponse res, string urlPath)
        {
            string qName = req.QueryString["name"];
            if (string.IsNullOrWhiteSpace(qName) && urlPath.Length > 19)
                qName = urlPath.Substring(19);
            if (string.IsNullOrWhiteSpace(qName))
            {
                res.StatusCode = 404;
                CloseQuiet(res);
                return;
            }
            try { qName = Uri.UnescapeDataString(qName); } catch { }
            string safeQ = Regex.Replace(qName, "[^a-zA-Z0-9._-]", "_").ToLowerInvariant();
            string safeBase = Regex.Replace(safeQ, "\\\\.[^.]+$", "");

            string found = null;
            try
            {
                string[] files = Directory.GetFiles(_uploadsDir);
                for (int i = files.Length - 1; i >= 0; i--)
                {
                    string nl = Path.GetFileName(files[i]).ToLowerInvariant();
                    if (nl.StartsWith(".part_")) continue;
                    if (nl == safeQ || nl.EndsWith("_" + safeQ) || (!string.IsNullOrEmpty(safeBase) && nl.IndexOf("_" + safeBase + ".") >= 0))
                    {
                        found = files[i];
                        break;
                    }
                }
            }
            catch { }

            if (found == null)
            {
                string videosDir = Path.Combine(_appDir, "videos");
                if (Directory.Exists(videosDir))
                {
                    string[] vFiles = Directory.GetFiles(videosDir);
                    for (int i = vFiles.Length - 1; i >= 0; i--)
                    {
                        string nl = Path.GetFileName(vFiles[i]).ToLowerInvariant();
                        if (nl == safeQ || (!string.IsNullOrEmpty(safeBase) && nl.StartsWith(safeBase + ".")))
                        {
                            found = vFiles[i];
                            break;
                        }
                    }
                }
            }

            if (found != null && File.Exists(found))
            {
                SendFileWithRange(req, res, found, true);
                return;
            }
            res.StatusCode = 404;
            CloseQuiet(res);
        }

        private static void HandleServeUpload(HttpListenerRequest req, HttpListenerResponse res, string urlPath)
        {
            string fName = urlPath.Substring(9);
            try { fName = Uri.UnescapeDataString(fName); } catch { }
            string fPath = SafeJoin(_uploadsDir, fName);
            if (fPath == null || !File.Exists(fPath))
            {
                string tail = Regex.Replace(Path.GetFileName(fName), "^[0-9]+_", "").ToLowerInvariant();
                if (!string.IsNullOrEmpty(tail))
                {
                    string[] all = Directory.GetFiles(_uploadsDir);
                    for (int i = all.Length - 1; i >= 0; i--)
                    {
                        string fn = Path.GetFileName(all[i]).ToLowerInvariant();
                        if (!fn.StartsWith(".part_") && fn.EndsWith(tail))
                        {
                            fPath = all[i];
                            break;
                        }
                    }
                }
            }
            if (fPath != null && File.Exists(fPath))
            {
                SendFileWithRange(req, res, fPath, true);
                return;
            }
            res.StatusCode = 404;
            CloseQuiet(res);
        }

        private static void HandleM3u8Proxy(HttpListenerRequest req, HttpListenerResponse res)
        {
            string targetRaw = req.QueryString["url"] ?? "";
            try { targetRaw = Uri.UnescapeDataString(targetRaw); } catch { }
            if (string.IsNullOrWhiteSpace(targetRaw) ||
                (!targetRaw.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !targetRaw.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
            {
                SendJson(res, "{\\"error\\":\\"Invalid stream url\\"}", 400);
                return;
            }
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
                HttpWebRequest hReq = (HttpWebRequest)WebRequest.Create(targetRaw);
                hReq.Method = "GET";
                hReq.Timeout = 10000;
                hReq.ReadWriteTimeout = 10000;
                hReq.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
                using (HttpWebResponse hResp = (HttpWebResponse)hReq.GetResponse())
                {
                    string ct = !string.IsNullOrEmpty(hResp.ContentType) ? hResp.ContentType : "application/octet-stream";
                    Uri finalUri = hResp.ResponseUri;
                    bool isM3u8 = ct.ToLowerInvariant().Contains("mpegurl") || targetRaw.ToLowerInvariant().Contains(".m3u8");
                    using (Stream rStream = hResp.GetResponseStream())
                    {
                        if (isM3u8)
                        {
                            string mTxt;
                            using (StreamReader sr = new StreamReader(rStream, Encoding.UTF8)) mTxt = sr.ReadToEnd();
                            string[] lines = mTxt.Split(new string[] { "\\r\\n", "\\n" }, StringSplitOptions.None);
                            List<string> outLines = new List<string>(lines.Length);
                            for (int i = 0; i < lines.Length; i++)
                            {
                                string tr = lines[i].Trim();
                                if (!string.IsNullOrEmpty(tr) && !tr.StartsWith("#"))
                                {
                                    try
                                    {
                                        string absU = new Uri(finalUri, tr).AbsoluteUri;
                                        outLines.Add("/api/live/m3u8-proxy?url=" + Uri.EscapeDataString(absU));
                                    }
                                    catch { outLines.Add(lines[i]); }
                                }
                                else
                                {
                                    outLines.Add(lines[i]);
                                }
                            }
                            byte[] outBytes = Encoding.UTF8.GetBytes(string.Join("\\n", outLines.ToArray()));
                            res.StatusCode = 200;
                            res.ContentType = "application/vnd.apple.mpegurl; charset=utf-8";
                            res.ContentLength64 = outBytes.Length;
                            res.OutputStream.Write(outBytes, 0, outBytes.Length);
                            CloseQuiet(res);
                        }
                        else
                        {
                            res.StatusCode = 200;
                            res.ContentType = ct;
                            rStream.CopyTo(res.OutputStream);
                            CloseQuiet(res);
                        }
                    }
                }
            }
            catch
            {
                SendJson(res, "{\\"error\\":\\"Upstream stream unreachable\\"}", 502);
            }
        }

        private static void HandleYouTubeResolve(HttpListenerRequest req, HttpListenerResponse res)
        {
            string rawYt = ReadBodyText(req);
            List<Dictionary<string, object>> ytList = new List<Dictionary<string, object>>();
            HashSet<string> seen = new HashSet<string>();
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
                JavaScriptSerializer ser = CreateSerializer();
                Dictionary<string, object> ytObj = ser.Deserialize<Dictionary<string, object>>(rawYt);
                string ytText = "";
                if (ytObj != null)
                {
                    if (ytObj.ContainsKey("rawText")) ytText = Convert.ToString(ytObj["rawText"]) ?? "";
                    else if (ytObj.ContainsKey("input")) ytText = Convert.ToString(ytObj["input"]) ?? "";
                }
                string[] tokens = Regex.Split(ytText, "[\\\\r\\\\n,\\\\s]+");
                foreach (string tok in tokens)
                {
                    string tClean = (tok ?? "").Trim();
                    if (string.IsNullOrEmpty(tClean)) continue;
                    string vidId = "";
                    Match m1 = Regex.Match(tClean, "(?:youtu\\\\.be/|youtube\\\\.com/(?:watch\\\\?(?:.*&)?v=|live/|shorts/|embed/))([A-Za-z0-9_-]{11})");
                    if (m1.Success) vidId = m1.Groups[1].Value;
                    else if (Regex.IsMatch(tClean, "^[A-Za-z0-9_-]{11}$")) vidId = tClean;
                    else if (Regex.IsMatch(tClean, "youtube\\\\.com/@[^/\\\\s]+/live"))
                    {
                        try
                        {
                            using (WebClient wc = new WebClient())
                            {
                                wc.Headers.Add("User-Agent", "Mozilla/5.0");
                                string htmlLive = wc.DownloadString(tClean);
                                Match hm = Regex.Match(htmlLive, "\\"videoId\\":\\"([A-Za-z0-9_-]{11})\\"");
                                if (hm.Success) vidId = hm.Groups[1].Value;
                            }
                        }
                        catch { }
                    }
                    if (!string.IsNullOrEmpty(vidId) && !seen.Contains(vidId))
                    {
                        seen.Add(vidId);
                        string titleStr = "YouTube Stream (" + vidId + ")";
                        try
                        {
                            using (WebClient oeWc = new WebClient())
                            {
                                oeWc.Encoding = Encoding.UTF8;
                                string oeRaw = oeWc.DownloadString("https://www.youtube.com/oembed?url=" + Uri.EscapeDataString("https://www.youtube.com/watch?v=" + vidId) + "&format=json");
                                Dictionary<string, object> oeJson = ser.Deserialize<Dictionary<string, object>>(oeRaw);
                                if (oeJson != null && oeJson.ContainsKey("title") && oeJson["title"] != null)
                                    titleStr = Convert.ToString(oeJson["title"]);
                            }
                        }
                        catch { }
                        Dictionary<string, object> item = new Dictionary<string, object>();
                        item["id"] = "yt_" + vidId;
                        item["videoId"] = vidId;
                        item["title"] = titleStr;
                        item["sourceUrl"] = "https://www.youtube.com/watch?v=" + vidId;
                        item["enabled"] = true;
                        ytList.Add(item);
                    }
                }
            }
            catch { }

            Dictionary<string, object> resp = new Dictionary<string, object>();
            resp["success"] = true;
            resp["items"] = ytList;
            resp["invalidTokens"] = new object[0];
            resp["unresolvedPlaylists"] = new object[0];
            SendJson(res, CreateSerializer().Serialize(resp), 200);
        }

        private static void HandleVlcStreamFallback(HttpListenerRequest req, HttpListenerResponse res)
        {
            string uParam = req.QueryString["url"] ?? "";
            try { uParam = Uri.UnescapeDataString(uParam); } catch { }
            string vPath = null;
            if (uParam.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase))
            {
                string unesc = uParam.Substring(9);
                try { unesc = Uri.UnescapeDataString(unesc); } catch { }
                string cand = SafeJoin(_uploadsDir, unesc);
                if (cand != null && File.Exists(cand)) vPath = cand;
            }
            else if (uParam.StartsWith("/videos/", StringComparison.OrdinalIgnoreCase))
            {
                string cand = SafeJoin(Path.Combine(_appDir, "videos"), Path.GetFileName(uParam));
                if (cand != null && File.Exists(cand)) vPath = cand;
            }
            if (vPath != null)
            {
                string baseNoExt = Path.GetFileNameWithoutExtension(vPath);
                string cachedName = baseNoExt.EndsWith("_reencoded_h264") ? (baseNoExt + ".mp4") : (baseNoExt + "_reencoded_h264.mp4");
                string cachedPath = Path.Combine(_uploadsDir, cachedName);
                if (!File.Exists(cachedPath))
                {
                    string ffmpeg = FindFfmpegTool("ffmpeg.exe");
                    if (!string.IsNullOrEmpty(ffmpeg))
                    {
                        string ffArgs = "-y -fflags +genpts+igndts -err_detect ignore_err -i \\"" + vPath + "\\" -map 0:v:0? -map 0:a:0? -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -vf \\"scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1\\" -r 30 -c:a aac -ac 2 -ar 48000 -b:a 192k -af aresample=async=1:first_pts=0 -movflags +faststart \\"" + cachedPath + "\\"";
                        string dummyOut;
                        if (RunToolWithTimeout(ffmpeg, ffArgs, 300000, out dummyOut) && File.Exists(cachedPath) && new FileInfo(cachedPath).Length > 0)
                        {
                            SendFileWithRange(req, res, cachedPath, true);
                            return;
                        }
                    }
                }
                else
                {
                    SendFileWithRange(req, res, cachedPath, true);
                    return;
                }
                SendFileWithRange(req, res, vPath, true);
                return;
            }
            res.StatusCode = 404;
            CloseQuiet(res);
        }

        private sealed class RtmpSubscriber
        {
            public readonly object Sync = new object();
            public readonly Queue<byte[]> Queue = new Queue<byte[]>();
            public bool Closed = false;
        }

        private sealed class RtmpHubSession
        {
            public string Key;
            public Process Child;
            public readonly object LockObj = new object();
            public readonly List<RtmpSubscriber> Subscribers = new List<RtmpSubscriber>();
            public readonly List<byte[]> InitBoxes = new List<byte[]>();
            public byte[] InitSegment = null;
            public readonly List<byte[]> GopChunks = new List<byte[]>();
            public int GopBytes = 0;
            public byte[] Pending = new byte[0];
            public volatile bool Ended = false;
            public long EmptySinceTick = 0;
        }

        private static readonly object _rtmpHubLock = new object();
        private static readonly Dictionary<string, RtmpHubSession> _rtmpSessions = new Dictionary<string, RtmpHubSession>(StringComparer.Ordinal);

        private static void KillAllRtmpPullSessions()
        {
            List<RtmpHubSession> snap = new List<RtmpHubSession>();
            lock (_rtmpHubLock)
            {
                foreach (KeyValuePair<string, RtmpHubSession> kv in _rtmpSessions)
                    snap.Add(kv.Value);
                _rtmpSessions.Clear();
            }
            for (int i = 0; i < snap.Count; i++)
            {
                FinalizeRtmpSession(snap[i]);
            }
        }

        private static void FinalizeRtmpSession(RtmpHubSession session)
        {
            if (session == null) return;
            session.Ended = true;
            lock (_rtmpHubLock)
            {
                RtmpHubSession existing;
                if (_rtmpSessions.TryGetValue(session.Key, out existing) && existing == session)
                    _rtmpSessions.Remove(session.Key);
            }
            try
            {
                if (session.Child != null && !session.Child.HasExited)
                    session.Child.Kill();
            }
            catch { }
            lock (session.LockObj)
            {
                for (int i = 0; i < session.Subscribers.Count; i++)
                {
                    RtmpSubscriber sub = session.Subscribers[i];
                    lock (sub.Sync)
                    {
                        sub.Closed = true;
                        Monitor.PulseAll(sub.Sync);
                    }
                }
                session.Subscribers.Clear();
            }
        }

        private static void AppendMp4Boxes(RtmpHubSession session, byte[] incoming, int count)
        {
            byte[] combined = new byte[session.Pending.Length + count];
            if (session.Pending.Length > 0)
                Buffer.BlockCopy(session.Pending, 0, combined, 0, session.Pending.Length);
            Buffer.BlockCopy(incoming, 0, combined, session.Pending.Length, count);

            int offset = 0;
            while (combined.Length - offset >= 8)
            {
                uint size32 = ((uint)combined[offset] << 24) | ((uint)combined[offset + 1] << 16) | ((uint)combined[offset + 2] << 8) | (uint)combined[offset + 3];
                if (size32 < 8 || size32 > 32 * 1024 * 1024)
                {
                    offset = combined.Length;
                    break;
                }
                int boxSize = (int)size32;
                if (combined.Length - offset < boxSize) break;

                string boxType = Encoding.ASCII.GetString(combined, offset + 4, 4);
                byte[] box = new byte[boxSize];
                Buffer.BlockCopy(combined, offset, box, 0, boxSize);
                offset += boxSize;

                if (session.InitSegment == null)
                {
                    if (boxType == "ftyp" || boxType == "moov")
                    {
                        session.InitBoxes.Add(box);
                        if (boxType == "moov")
                        {
                            int total = 0;
                            for (int i = 0; i < session.InitBoxes.Count; i++) total += session.InitBoxes[i].Length;
                            byte[] initBuf = new byte[total];
                            int pos = 0;
                            for (int i = 0; i < session.InitBoxes.Count; i++)
                            {
                                Buffer.BlockCopy(session.InitBoxes[i], 0, initBuf, pos, session.InitBoxes[i].Length);
                                pos += session.InitBoxes[i].Length;
                            }
                            session.InitSegment = initBuf;
                        }
                        continue;
                    }
                    if (session.InitBoxes.Count > 0)
                    {
                        int total = 0;
                        for (int i = 0; i < session.InitBoxes.Count; i++) total += session.InitBoxes[i].Length;
                        byte[] initBuf = new byte[total];
                        int pos = 0;
                        for (int i = 0; i < session.InitBoxes.Count; i++)
                        {
                            Buffer.BlockCopy(session.InitBoxes[i], 0, initBuf, pos, session.InitBoxes[i].Length);
                            pos += session.InitBoxes[i].Length;
                        }
                        session.InitSegment = initBuf;
                    }
                }

                if (boxType == "moof")
                {
                    session.GopChunks.Clear();
                    session.GopChunks.Add(box);
                    session.GopBytes = box.Length;
                }
                else if (session.GopChunks.Count > 0)
                {
                    session.GopChunks.Add(box);
                    session.GopBytes += box.Length;
                    while (session.GopBytes > 8 * 1024 * 1024 && session.GopChunks.Count > 1)
                    {
                        session.GopBytes -= session.GopChunks[0].Length;
                        session.GopChunks.RemoveAt(0);
                    }
                }
            }

            int rem = combined.Length - offset;
            if (rem > 0)
            {
                session.Pending = new byte[rem];
                Buffer.BlockCopy(combined, offset, session.Pending, 0, rem);
            }
            else
            {
                session.Pending = new byte[0];
            }
        }

        private static RtmpHubSession StartRtmpSessionLocked(string rawUrl, string ffmpegPath)
        {
            string lower = rawUrl.ToLowerInvariant();
            string inputFlags;
            if (lower.StartsWith("rtmp://") || lower.StartsWith("rtmps://"))
            {
                inputFlags = "-rtmp_live live -fflags +genpts+discardcorrupt+nobuffer -flags low_delay -analyzeduration 3000000 -probesize 3000000";
            }
            else if (lower.StartsWith("rtsp://"))
            {
                inputFlags = "-rtsp_transport tcp -fflags +genpts+discardcorrupt+nobuffer -flags low_delay -analyzeduration 3000000 -probesize 3000000";
            }
            else
            {
                inputFlags = "-rw_timeout 10000000 -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 2 -fflags +genpts+discardcorrupt";
            }

            string ffArgs = inputFlags +
                " -i \\"" + rawUrl + "\\"" +
                " -map 0:v:0 -map 0:a:0? -c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -level 4.0 -pix_fmt yuv420p" +
                " -vf \\"scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1\\"" +
                " -g 30 -keyint_min 30 -sc_threshold 0 -c:a aac -b:a 128k -ar 44100 -ac 2 -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof pipe:1";

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = ffmpegPath;
            psi.Arguments = ffArgs;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;

            Process proc = Process.Start(psi);
            RtmpHubSession session = new RtmpHubSession();
            session.Key = rawUrl;
            session.Child = proc;
            _rtmpSessions[rawUrl] = session;

            ThreadPool.QueueUserWorkItem(delegate {
                try
                {
                    Stream err = proc.StandardError.BaseStream;
                    byte[] eBuf = new byte[4096];
                    while (!session.Ended && err.Read(eBuf, 0, eBuf.Length) > 0) { }
                }
                catch { }
            });

            ThreadPool.QueueUserWorkItem(delegate {
                try
                {
                    Stream outStream = proc.StandardOutput.BaseStream;
                    byte[] buf = new byte[32768];
                    while (!session.Ended)
                    {
                        int n = outStream.Read(buf, 0, buf.Length);
                        if (n <= 0) break;
                        byte[] chunk = new byte[n];
                        Buffer.BlockCopy(buf, 0, chunk, 0, n);
                        lock (session.LockObj)
                        {
                            AppendMp4Boxes(session, chunk, n);
                            for (int i = session.Subscribers.Count - 1; i >= 0; i--)
                            {
                                RtmpSubscriber sub = session.Subscribers[i];
                                lock (sub.Sync)
                                {
                                    if (sub.Closed)
                                    {
                                        session.Subscribers.RemoveAt(i);
                                        continue;
                                    }
                                    if (sub.Queue.Count < 256)
                                        sub.Queue.Enqueue(chunk);
                                    Monitor.Pulse(sub.Sync);
                                }
                            }
                        }
                    }
                }
                catch { }
                FinalizeRtmpSession(session);
            });

            return session;
        }

        private static void HandleRtmpPull(HttpListenerRequest req, HttpListenerResponse res)
        {
            string rawUrl = (req.QueryString["url"] ?? "").Trim();
            try { rawUrl = Uri.UnescapeDataString(rawUrl); } catch { }
            rawUrl = rawUrl.Trim().Trim('"', '\\'');
            if (string.IsNullOrWhiteSpace(rawUrl))
            {
                SendJson(res, "{\\"error\\":\\"Missing url\\"}", 400);
                return;
            }
            string lower = rawUrl.ToLowerInvariant();
            if (!lower.StartsWith("rtmp://") && !lower.StartsWith("rtmps://") && !lower.StartsWith("rtsp://") &&
                !lower.StartsWith("http://") && !lower.StartsWith("https://"))
            {
                SendJson(res, "{\\"error\\":\\"Unsupported live stream protocol\\"}", 400);
                return;
            }

            string ffmpeg = FindFfmpegTool("ffmpeg.exe");
            if (string.IsNullOrEmpty(ffmpeg))
            {
                SendJson(res, "{\\"error\\":\\"ffmpeg.exe not found on Windows system\\"}", 503);
                return;
            }

            res.Headers.Add("Cache-Control", "no-cache, no-store, must-revalidate");
            res.ContentType = "video/mp4";
            if (string.Equals(req.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase))
            {
                res.StatusCode = 200;
                CloseQuiet(res);
                return;
            }

            RtmpHubSession session = null;
            RtmpSubscriber sub = new RtmpSubscriber();
            lock (_rtmpHubLock)
            {
                if (!_rtmpSessions.TryGetValue(rawUrl, out session) || session.Ended)
                {
                    session = StartRtmpSessionLocked(rawUrl, ffmpeg);
                }
            }

            lock (session.LockObj)
            {
                session.EmptySinceTick = 0;
                if (session.InitSegment != null)
                {
                    sub.Queue.Enqueue(session.InitSegment);
                    for (int i = 0; i < session.GopChunks.Count; i++)
                        sub.Queue.Enqueue(session.GopChunks[i]);
                }
                session.Subscribers.Add(sub);
            }

            res.StatusCode = 200;
            try
            {
                while (!session.Ended)
                {
                    byte[] nextChunk = null;
                    lock (sub.Sync)
                    {
                        while (sub.Queue.Count == 0 && !sub.Closed && !session.Ended)
                        {
                            Monitor.Wait(sub.Sync, 500);
                        }
                        if (sub.Queue.Count > 0)
                            nextChunk = sub.Queue.Dequeue();
                        else if (sub.Closed || session.Ended)
                            break;
                    }
                    if (nextChunk != null)
                    {
                        res.OutputStream.Write(nextChunk, 0, nextChunk.Length);
                    }
                }
            }
            catch { }

            lock (sub.Sync) { sub.Closed = true; }
            bool shouldScheduleStop = false;
            long stamp = Environment.TickCount;
            lock (session.LockObj)
            {
                session.Subscribers.Remove(sub);
                if (session.Subscribers.Count == 0 && !session.Ended)
                {
                    session.EmptySinceTick = stamp;
                    shouldScheduleStop = true;
                }
            }
            if (shouldScheduleStop)
            {
                RtmpHubSession targetSession = session;
                ThreadPool.QueueUserWorkItem(delegate {
                    Thread.Sleep(4000);
                    bool killIt = false;
                    lock (targetSession.LockObj)
                    {
                        if (!targetSession.Ended && targetSession.Subscribers.Count == 0 && targetSession.EmptySinceTick == stamp)
                            killIt = true;
                    }
                    if (killIt) FinalizeRtmpSession(targetSession);
                });
            }
            CloseQuiet(res);
        }

        private static void SendFileWithRange(HttpListenerRequest req, HttpListenerResponse res, string filePath, bool cacheStatic)
        {
            string ext = Path.GetExtension(filePath).ToLowerInvariant();
            res.ContentType = GetMimeType(ext);
            res.Headers.Add("Accept-Ranges", "bytes");
            if (cacheStatic && ext != ".html")
                res.Headers.Add("Cache-Control", "public, max-age=3600");
            else
                res.Headers.Add("Cache-Control", "no-store");

            long total = new FileInfo(filePath).Length;
            if (string.Equals(req.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase))
            {
                res.StatusCode = 200;
                res.ContentLength64 = total;
                CloseQuiet(res);
                return;
            }

            string rangeHeader = req.Headers["Range"];
            if (!string.IsNullOrEmpty(rangeHeader))
            {
                Match m = Regex.Match(rangeHeader, "^bytes=(\\\\d*)-(\\\\d*)$");
                if (m.Success)
                {
                    long start = !string.IsNullOrEmpty(m.Groups[1].Value) ? long.Parse(m.Groups[1].Value) : 0;
                    long end = !string.IsNullOrEmpty(m.Groups[2].Value) ? long.Parse(m.Groups[2].Value) : (total - 1);
                    if (total > 0 && end >= total) end = total - 1;
                    // Stream open-ended video ranges in 4 MB chunks so WebView2 seeks & playback start immediately with zero stall
                    if (string.IsNullOrEmpty(m.Groups[2].Value) && (end - start + 1) > 4194304)
                        end = start + 4194304 - 1;
                    if (start > end) start = 0;

                    long chunkLen = total == 0 ? 0 : (end - start + 1);
                    res.StatusCode = 206;
                    res.Headers.Add("Content-Range", "bytes " + start + "-" + end + "/" + total);
                    res.ContentLength64 = chunkLen;
                    try
                    {
                        using (FileStream fs = File.Open(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                        {
                            fs.Seek(start, SeekOrigin.Begin);
                            byte[] buf = new byte[65536];
                            long remaining = chunkLen;
                            while (remaining > 0)
                            {
                                int toRead = (int)Math.Min((long)buf.Length, remaining);
                                int read = fs.Read(buf, 0, toRead);
                                if (read <= 0) break;
                                res.OutputStream.Write(buf, 0, read);
                                remaining -= read;
                            }
                        }
                    }
                    catch { }
                    CloseQuiet(res);
                    return;
                }
            }

            res.StatusCode = 200;
            res.ContentLength64 = total;
            try
            {
                using (FileStream fs = File.Open(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    byte[] buf = new byte[65536];
                    int read;
                    while ((read = fs.Read(buf, 0, buf.Length)) > 0)
                    {
                        res.OutputStream.Write(buf, 0, read);
                    }
                }
            }
            catch { }
            CloseQuiet(res);
        }

        private static string GetMimeType(string ext)
        {
            switch (ext)
            {
                case ".html": return "text/html; charset=utf-8";
                case ".js": return "application/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".wasm": return "application/wasm";
                case ".svg": return "image/svg+xml";
                case ".ico": return "image/x-icon";
                case ".png": return "image/png";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".webp": return "image/webp";
                case ".gif": return "image/gif";
                case ".swf": return "application/x-shockwave-flash";
                case ".mp4":
                case ".m4v": return "video/mp4";
                case ".mov": return "video/quicktime";
                case ".avi": return "video/x-msvideo";
                case ".ts":
                case ".mts": return "video/mp2t";
                case ".flv": return "video/x-flv";
                case ".wmv": return "video/x-ms-wmv";
                case ".mp3": return "audio/mpeg";
                case ".aac": return "audio/aac";
                case ".wav": return "audio/wav";
                case ".webm": return "video/webm";
                case ".mkv": return "video/x-matroska";
                case ".json": return "application/json; charset=utf-8";
                default: return "application/octet-stream";
            }
        }

        private static string SafeJoin(string baseDir, string rel)
        {
            try
            {
                string fullBase = Path.GetFullPath(baseDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                string combined = Path.GetFullPath(Path.Combine(fullBase, rel));
                if (!combined.StartsWith(fullBase, StringComparison.OrdinalIgnoreCase)) return null;
                return combined;
            }
            catch { return null; }
        }

        private static string ReadBodyText(HttpListenerRequest req)
        {
            using (StreamReader sr = new StreamReader(req.InputStream, Encoding.UTF8))
            {
                return sr.ReadToEnd();
            }
        }

        private static byte[] ReadBodyBytes(HttpListenerRequest req)
        {
            using (MemoryStream ms = new MemoryStream())
            {
                req.InputStream.CopyTo(ms);
                return ms.ToArray();
            }
        }

        private static void SendJson(HttpListenerResponse res, string jsonText, int status)
        {
            try
            {
                res.StatusCode = status;
                res.ContentType = "application/json; charset=utf-8";
                res.Headers.Add("Cache-Control", "no-store");
                byte[] bytes = Encoding.UTF8.GetBytes(jsonText ?? "{}");
                res.ContentLength64 = bytes.Length;
                res.OutputStream.Write(bytes, 0, bytes.Length);
            }
            catch { }
            CloseQuiet(res);
        }

        private static void CloseQuiet(HttpListenerResponse res)
        {
            try { res.Close(); } catch { }
        }

        private static JavaScriptSerializer CreateSerializer()
        {
            JavaScriptSerializer ser = new JavaScriptSerializer();
            ser.MaxJsonLength = int.MaxValue;
            return ser;
        }

        private static long ToUnixMs(DateTime dtUtc)
        {
            DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            return (long)(dtUtc - epoch).TotalMilliseconds;
        }
    }
}
'@

$backendDll = Join-Path $DataDir 'AshokaBackendServer_v3.dll'
if (!(Test-Path $backendDll)) {
  try {
    Add-Type -TypeDefinition $serverSource -OutputAssembly $backendDll -ReferencedAssemblies @('System.Web.Extensions.dll','System.Windows.Forms.dll','System.Drawing.dll') -ErrorAction Stop
  } catch {
    try {
      Add-Type -TypeDefinition $serverSource -ReferencedAssemblies @('System.Web.Extensions.dll','System.Windows.Forms.dll','System.Drawing.dll') -ErrorAction Stop
    } catch {}
  }
}
if (Test-Path $backendDll) {
  try { [void][System.Reflection.Assembly]::LoadFrom($backendDll) } catch {}
}
if (-not ('AshokaBackend.AshokaHttpServer' -as [type])) {
  try {
    Add-Type -TypeDefinition $serverSource -ReferencedAssemblies @('System.Web.Extensions.dll','System.Windows.Forms.dll','System.Drawing.dll')
  } catch {}
}

try {
  [AshokaBackend.AshokaHttpServer]::Run($InstallDir, $AppDir, $UploadsDir, $DataDir)
} catch {}

try { if ($backendMutex) { $backendMutex.ReleaseMutex(); $backendMutex.Dispose() } } catch {}
`.trim();
}

/**
 * Native Windows Forms Uninstaller script (`app/uninstall_gui.ps1`):
 * Cleanly stops running instances, removes Desktop & Start Menu shortcuts,
 * removes Control Panel / Registry uninstall entry, and deletes all installed files
 * even when triggered from inside `%LOCALAPPDATA%\Ashoka_MSO_Playlist`.
 */
function generateUninstallGuiPs1(): string {
  return `
param([switch]$Silent)
$ErrorActionPreference = 'SilentlyContinue'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Ashoka_MSO_Playlist'

function Stop-AshokaProcesses {
  try {
    Get-Process -Name 'Ashoka_MSO_Playlist' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  } catch {}
  try {
    Get-CimInstance Win32_Process | Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -like '*offline_backend.ps1*' -or
        $_.CommandLine -like '*Ashoka_MSO_Playlist\\profile*' -or
        $_.CommandLine -like '*profile_out2*' -or
        $_.CommandLine -like '*127.0.0.1:38550*'
      )
    } | ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}

function Invoke-CleanUninstall([bool]$removeData) {
  Stop-AshokaProcesses

  foreach ($lnkName in @('Ashoka Cable TV Playout.lnk', 'Ashoka MSO Playlist.lnk')) {
    $deskLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) $lnkName
    if (Test-Path $deskLnk) { Remove-Item $deskLnk -Force }
  }

  foreach ($smFolderName in @('Ashoka Cable TV Playout', 'Ashoka MSO Playlist')) {
    $smDir = Join-Path ([Environment]::GetFolderPath('Programs')) $smFolderName
    if (Test-Path $smDir) { Remove-Item $smDir -Recurse -Force }
  }

  Remove-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist' -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_Cable_TV_Playout' -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item 'HKCU:\\Software\\Ashoka_MSO_Playlist' -Recurse -Force -ErrorAction SilentlyContinue

  if (Test-Path $InstallDir) {
    Remove-Item (Join-Path $InstallDir 'app') -Recurse -Force
    Remove-Item (Join-Path $InstallDir 'webview_data') -Recurse -Force
    Remove-Item (Join-Path $InstallDir 'profile') -Recurse -Force
    Remove-Item (Join-Path $InstallDir 'profile_out2') -Recurse -Force
    if ($removeData) {
      Remove-Item (Join-Path $InstallDir 'data') -Recurse -Force
      Remove-Item (Join-Path $InstallDir 'uploads') -Recurse -Force
    }
    Get-ChildItem -Path $InstallDir -File | Remove-Item -Force -ErrorAction SilentlyContinue
    if ($removeData) {
      try {
        $cmdPsi = New-Object System.Diagnostics.ProcessStartInfo
        $cmdPsi.FileName = 'cmd.exe'
        $cmdPsi.Arguments = '/c ping 127.0.0.1 -n 2 >nul & rd /s /q "' + $InstallDir + '"'
        $cmdPsi.UseShellExecute = $false
        $cmdPsi.CreateNoWindow = $true
        [System.Diagnostics.Process]::Start($cmdPsi) | Out-Null
      } catch {}
    }
  }

  try {
    $iePsi = New-Object System.Diagnostics.ProcessStartInfo
    $iePsi.FileName = 'ie4uinit.exe'
    $iePsi.Arguments = '-show'
    $iePsi.UseShellExecute = $false
    $iePsi.CreateNoWindow = $true
    [System.Diagnostics.Process]::Start($iePsi) | Out-Null
  } catch {}
}

if ($Silent -or ($args -contains '/S')) {
  Invoke-CleanUninstall $true
  exit 0
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Uninstall Ashoka Cable TV Playout'
  $form.Size = New-Object System.Drawing.Size(480, 260)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
  $form.ForeColor = [System.Drawing.Color]::White
  $form.Add_Shown({ $form.Activate(); $form.TopMost = $true; $form.TopMost = $false })

  $icoFile = Join-Path $InstallDir 'app\\assets\\ashoka-icon.ico'
  if (Test-Path $icoFile) {
    try { $form.Icon = New-Object System.Drawing.Icon($icoFile) } catch {}
  } elseif ($env:ASHOKA_EXE -and (Test-Path $env:ASHOKA_EXE)) {
    try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:ASHOKA_EXE) } catch {}
  }

  $lblTitle = New-Object System.Windows.Forms.Label
  $lblTitle.Text = 'Uninstall Ashoka Cable TV Playout'
  $lblTitle.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
  $lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
  $lblTitle.Location = New-Object System.Drawing.Point(20, 18)
  $lblTitle.Size = New-Object System.Drawing.Size(420, 28)
  $form.Controls.Add($lblTitle)

  $lblSub = New-Object System.Windows.Forms.Label
  $lblSub.Text = 'Remove Ashoka Cable TV Playout software, shortcuts, background service, and Windows registry entry.'
  $lblSub.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
  $lblSub.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
  $lblSub.Location = New-Object System.Drawing.Point(20, 52)
  $lblSub.Size = New-Object System.Drawing.Size(425, 40)
  $form.Controls.Add($lblSub)

  $chkData = New-Object System.Windows.Forms.CheckBox
  $chkData.Text = 'Also remove saved playlists and uploaded media files'
  $chkData.Checked = $true
  $chkData.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
  $chkData.Location = New-Object System.Drawing.Point(22, 102)
  $chkData.Size = New-Object System.Drawing.Size(420, 24)
  $form.Controls.Add($chkData)

  $lblStatus = New-Object System.Windows.Forms.Label
  $lblStatus.Text = "Location: $InstallDir"
  $lblStatus.Font = New-Object System.Drawing.Font('Consolas', 8.5)
  $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
  $lblStatus.Location = New-Object System.Drawing.Point(20, 136)
  $lblStatus.Size = New-Object System.Drawing.Size(425, 22)
  $form.Controls.Add($lblStatus)

  $btnUninstall = New-Object System.Windows.Forms.Button
  $btnUninstall.Text = 'Uninstall Now'
  $btnUninstall.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
  $btnUninstall.ForeColor = [System.Drawing.Color]::White
  $btnUninstall.FlatStyle = 'Flat'
  $btnUninstall.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
  $btnUninstall.Location = New-Object System.Drawing.Point(225, 174)
  $btnUninstall.Size = New-Object System.Drawing.Size(120, 34)
  $form.Controls.Add($btnUninstall)

  $btnCancel = New-Object System.Windows.Forms.Button
  $btnCancel.Text = 'Cancel'
  $btnCancel.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
  $btnCancel.ForeColor = [System.Drawing.Color]::White
  $btnCancel.FlatStyle = 'Flat'
  $btnCancel.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
  $btnCancel.Location = New-Object System.Drawing.Point(355, 174)
  $btnCancel.Size = New-Object System.Drawing.Size(90, 34)
  $btnCancel.Add_Click({ $form.Close() })
  $form.Controls.Add($btnCancel)

  $btnUninstall.Add_Click({
    $btnUninstall.Enabled = $false
    $btnCancel.Enabled = $false
    $lblStatus.Text = 'Stopping background processes and uninstalling...'
    $form.Refresh()
    Invoke-CleanUninstall ([bool]$chkData.Checked)
    [System.Windows.Forms.MessageBox]::Show(
      'Ashoka MSO Playlist has been completely uninstalled.',
      'Uninstall Complete',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    $form.Close()
  })

  [void]$form.ShowDialog()
} catch {
  Invoke-CleanUninstall $true
}
`.trim();
}

/**
 * Builds a standalone Windows PE32 GUI Uninstaller binary (`Uninstall.exe`)
 * with embedded Ashoka icon, zero %ENV% WinExec bugs.
 */
export function buildStandaloneUninstallerExe(): Buffer {
  const uninstallerCmd =
    'powershell.exe -NoP -EP Bypass -W Hidden -C "$ErrorActionPreference=\'SilentlyContinue\';$p=if($env:ASHOKA_EXE){Join-Path (Split-Path $env:ASHOKA_EXE) \'app\\uninstall_gui.ps1\'}else{\'\'};if(!$p -or !(Test-Path $p)){$p=Join-Path $env:LOCALAPPDATA \'Ashoka_MSO_Playlist\\app\\uninstall_gui.ps1\'};if(Test-Path $p){$u=Join-Path $env:TEMP \'ashoka_uninst.ps1\';Copy-Item $p $u -Force;& $u}else{$r=Join-Path $env:LOCALAPPDATA \'Ashoka_MSO_Playlist\';if(Test-Path $r){Remove-Item $r -Recurse -Force}}"';
  return buildWindowsGuiExeWithIcon(uninstallerCmd, 0);
}

/**
 * Builds the complete, self-extracting Offline + Online `ashokacabletvplayout.settop.exe` Setup binary.
 * Contains:
 * 1. Native Windows PE32 GUI Header + `.rsrc` with crisp Ashoka MSO Playlist Icon
 * 2. Embedded ZIP payload with:
 *    - `app/index.html` (100% self-contained compiled React app, zero login, zero download buttons)
 *    - `app/offline_backend.ps1` (Local persistent offline HTTP backend server on 127.0.0.1:38550)
 *    - `app/launch.ps1` (Reliable Edge/Chrome dedicated-profile fullscreen immediate opener)
 *    - `app/uninstall_gui.ps1` (Clean native Windows uninstaller wizard)
 *    - `app/ruffle/*` (Local Ruffle SWF WebAssembly engine)
 *    - `app/assets/ashoka-icon.ico` & `app/assets/ashoka-icon.svg`
 *    - `app/videos/ch1.mp4`
 *    - `Ashoka_MSO_Playlist.exe` & `Uninstall.exe` & `uninstall.bat`
 */
export function buildSelfExtractingOfflineOnlineSetupExe(rootDir = process.cwd()): Buffer {
  const currentDistMtimeMs = getDistMaxMtimeMs(rootDir);
  if (cachedSelfExtractingSetupExe && cachedDistMtimeMs === currentDistMtimeMs) {
    return cachedSelfExtractingSetupExe;
  }

  const { html, svgDataUri } = buildSelfContainedOfflineHtml(rootDir);
  const icoBuffer = generateAshokaIcoBuffer();
  const svgBuffer = fs.existsSync(path.join(rootDir, 'public', 'assets', 'ashoka-icon.svg'))
    ? fs.readFileSync(path.join(rootDir, 'public', 'assets', 'ashoka-icon.svg'))
    : Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"/>', 'utf8');
  const offlineBackendPs1 = generateOfflineBackendPs1();
  const launchPs1 = generateLaunchPs1();
  const uninstallGuiPs1 = generateUninstallGuiPs1();
  const obsSetupHta = generateObsStyleInstallerHta(svgDataUri);
  const uninstallerHta = generateUninstallerHta(svgDataUri);
  const uninstallBat = generateUninstallBat();

  // WinExec does NOT expand %LOCALAPPDATA%. Resolve installation directory cleanly inside PowerShell!
  const directLauncherCmd =
    'powershell.exe -NoP -EP Bypass -W Hidden -C "$ErrorActionPreference=\'SilentlyContinue\';$p=if($env:ASHOKA_EXE){Join-Path (Split-Path $env:ASHOKA_EXE) \'app\\launch.ps1\'}else{\'\'};if(!$p -or !(Test-Path $p)){$p=Join-Path $env:LOCALAPPDATA \'Ashoka_MSO_Playlist\\app\\launch.ps1\'};& $p"';
  const directExeBuffer = buildWindowsGuiExeWithIcon(directLauncherCmd, 0);
  const uninstallExeBuffer = buildStandaloneUninstallerExe();

  const manifestBuf = fs.existsSync(path.join(rootDir, 'public', 'manifest.json'))
    ? fs.readFileSync(path.join(rootDir, 'public', 'manifest.json'))
    : Buffer.from('{"name":"Ashoka Cable TV Playout","short_name":"Ashoka Playout"}', 'utf8');

  const wv2Dir = path.join(rootDir, 'src', 'server', 'webview2');
  const ashokaHostCsBuf = fs.readFileSync(path.join(wv2Dir, 'AshokaHost.cs'));
  const wv2CoreDllBuf = fs.readFileSync(path.join(wv2Dir, 'Microsoft.Web.WebView2.Core.dll'));
  const wv2WinFormsDllBuf = fs.readFileSync(path.join(wv2Dir, 'Microsoft.Web.WebView2.WinForms.dll'));
  const wv2LoaderX64Buf = fs.readFileSync(path.join(wv2Dir, 'x64', 'WebView2Loader.dll'));
  const wv2LoaderX86Buf = fs.readFileSync(path.join(wv2Dir, 'x86', 'WebView2Loader.dll'));

  const zipEntries: Array<{ name: string; data: Buffer; compress?: boolean }> = [
    { name: 'app/index.html', data: Buffer.from(html, 'utf8'), compress: true },
    { name: 'app/manifest.json', data: manifestBuf, compress: true },
    { name: 'app/offline_backend.ps1', data: Buffer.from(offlineBackendPs1, 'utf8'), compress: true },
    { name: 'app/launch.ps1', data: Buffer.from(launchPs1, 'utf8'), compress: true },
    { name: 'app/uninstall_gui.ps1', data: Buffer.from(uninstallGuiPs1, 'utf8'), compress: true },
    { name: 'app/AshokaHost.cs', data: ashokaHostCsBuf, compress: true },
    { name: 'app/Microsoft.Web.WebView2.Core.dll', data: wv2CoreDllBuf, compress: true },
    { name: 'app/Microsoft.Web.WebView2.WinForms.dll', data: wv2WinFormsDllBuf, compress: true },
    { name: 'app/x64/WebView2Loader.dll', data: wv2LoaderX64Buf, compress: true },
    { name: 'app/x86/WebView2Loader.dll', data: wv2LoaderX86Buf, compress: true },
    { name: 'app/assets/ashoka-icon.ico', data: icoBuffer, compress: true },
    { name: 'app/assets/ashoka-icon.svg', data: svgBuffer, compress: true },
    { name: 'app/AshokaFallback.exe', data: directExeBuffer, compress: true },
    { name: 'Uninstall.exe', data: uninstallExeBuffer, compress: true },
    { name: 'uninstall.bat', data: Buffer.from(uninstallBat, 'utf8'), compress: true },
    { name: 'OBS_Setup_Wizard.hta', data: Buffer.from(obsSetupHta, 'utf8'), compress: true },
    { name: 'Uninstaller_Wizard.hta', data: Buffer.from(uninstallerHta, 'utf8'), compress: true },
  ];

  // Bundle local Ruffle SWF WebAssembly engine (`app/ruffle/*`) so SWF files play 100% offline!
  const ruffleDir = path.join(rootDir, 'node_modules', '@ruffle-rs', 'ruffle');
  if (fs.existsSync(ruffleDir)) {
    const rFiles = fs.readdirSync(ruffleDir);
    for (const rf of rFiles) {
      if (rf.endsWith('.js') || rf.endsWith('.wasm')) {
        zipEntries.push({
          name: `app/ruffle/${rf}`,
          data: fs.readFileSync(path.join(ruffleDir, rf)),
          compress: true,
        });
      }
    }
  }

  // Include all built-in MP4 sample channels (ch1.mp4 .. ch6.mp4) so channels/ads/programs play 100% offline!
  const publicVideosDir = path.join(rootDir, 'public', 'videos');
  if (fs.existsSync(publicVideosDir)) {
    const vidFiles = fs.readdirSync(publicVideosDir).filter((vf) => vf.toLowerCase().endsWith('.mp4'));
    for (const vf of vidFiles) {
      zipEntries.push({
        name: `app/videos/${vf}`,
        data: fs.readFileSync(path.join(publicVideosDir, vf)),
        compress: false, // MP4 is already H.264 compressed; STORE is instant
      });
    }
  }

  const zipBuf = buildZipArchiveBuffer(zipEntries);

  // Native WinForms Setup Wizard + Clean Auto-Extractor + Immediate Zero-Error Software Opener
  const ps1Script = `
$ErrorActionPreference = 'SilentlyContinue'
$DefaultInstallDir = Join-Path $env:LOCALAPPDATA 'Ashoka_MSO_Playlist'
$PsExe = Join-Path $PSHOME 'powershell.exe'
if (!(Test-Path $PsExe)) { $PsExe = "$env:WINDIR\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" }

function Test-AshokaPortFast {
  try {
    $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:38550/api/health')
    $req.Method = 'GET'
    $req.Timeout = 350
    $req.ReadWriteTimeout = 350
    $resp = $req.GetResponse()
    if ($resp) {
      $resp.Close()
      return $true
    }
  } catch {}
  return $false
}

function Build-AshokaNativeExe([string]$InstallDir) {
  $appDir = Join-Path $InstallDir 'app'
  $csFile = Join-Path $appDir 'AshokaHost.cs'
  $outExe = Join-Path $InstallDir 'Ashoka_MSO_Playlist.exe'
  $coreSrc = Join-Path $appDir 'Microsoft.Web.WebView2.Core.dll'
  $wfSrc = Join-Path $appDir 'Microsoft.Web.WebView2.WinForms.dll'
  $coreDst = Join-Path $InstallDir 'Microsoft.Web.WebView2.Core.dll'
  $wfDst = Join-Path $InstallDir 'Microsoft.Web.WebView2.WinForms.dll'
  $ldrDst = Join-Path $InstallDir 'WebView2Loader.dll'

  if (Test-Path $coreSrc) { Copy-Item $coreSrc $coreDst -Force -ErrorAction SilentlyContinue }
  if (Test-Path $wfSrc) { Copy-Item $wfSrc $wfDst -Force -ErrorAction SilentlyContinue }

  $is64 = [Environment]::Is64BitOperatingSystem
  $csc64 = "$env:WINDIR\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
  $csc32 = "$env:WINDIR\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
  $use64 = ($is64 -and (Test-Path $csc64))
  $cscExe = if ($use64) { $csc64 } elseif (Test-Path $csc32) { $csc32 } else { $null }
  $plat = if ($use64) { 'x64' } else { 'x86' }
  $ldrSrc = Join-Path (Join-Path $appDir $plat) 'WebView2Loader.dll'
  if (Test-Path $ldrSrc) { Copy-Item $ldrSrc $ldrDst -Force -ErrorAction SilentlyContinue }

  $compiledOk = $false
  if ($cscExe -and (Test-Path $csFile) -and (Test-Path $coreDst) -and (Test-Path $wfDst)) {
    $icoPath = Join-Path $appDir 'assets\\ashoka-icon.ico'
    $tmpExe = Join-Path $InstallDir 'Ashoka_MSO_Playlist.tmp.exe'
    if (Test-Path $tmpExe) { Remove-Item $tmpExe -Force -ErrorAction SilentlyContinue }
    $cArgs = @('/nologo', '/optimize+', '/target:winexe', "/platform:$plat", ('/out:"' + $tmpExe + '"'))
    if (Test-Path $icoPath) { $cArgs += ('/win32icon:"' + $icoPath + '"') }
    $cArgs += '/reference:System.dll'
    $cArgs += '/reference:System.Core.dll'
    $cArgs += '/reference:System.Drawing.dll'
    $cArgs += '/reference:System.Windows.Forms.dll'
    $cArgs += ('/reference:"' + $coreDst + '"')
    $cArgs += ('/reference:"' + $wfDst + '"')
    $cArgs += ('"' + $csFile + '"')
    try {
      $cPsi = New-Object System.Diagnostics.ProcessStartInfo
      $cPsi.FileName = $cscExe
      $cPsi.Arguments = ($cArgs -join ' ')
      $cPsi.WorkingDirectory = $InstallDir
      $cPsi.UseShellExecute = $false
      $cPsi.CreateNoWindow = $true
      $cProc = [System.Diagnostics.Process]::Start($cPsi)
      if ($cProc) {
        $cProc.WaitForExit(30000) | Out-Null
        if ($cProc.ExitCode -eq 0 -and (Test-Path $tmpExe)) {
          Move-Item -Path $tmpExe -Destination $outExe -Force -ErrorAction SilentlyContinue
          if (Test-Path $outExe) { $compiledOk = $true }
        }
      }
    } catch {}
  }

  if (-not $compiledOk) {
    $fallbackExe = Join-Path $appDir 'AshokaFallback.exe'
    if (Test-Path $fallbackExe) { Copy-Item $fallbackExe $outExe -Force -ErrorAction SilentlyContinue }
  }
  return $compiledOk
}

function Launch-AshokaDirect([string]$InstallDir) {
  try {
    $AppDir = Join-Path $InstallDir 'app'
    $LaunchScript = Join-Path $AppDir 'launch.ps1'
    $BackendScript = Join-Path $AppDir 'offline_backend.ps1'
    $HostExe = Join-Path $InstallDir 'Ashoka_MSO_Playlist.exe'

    if (-not (Test-AshokaPortFast) -and (Test-Path $BackendScript) -and (Test-Path $PsExe)) {
      try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $PsExe
        $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $BackendScript + '"'
        $psi.WorkingDirectory = $InstallDir
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        [System.Diagnostics.Process]::Start($psi) | Out-Null
      } catch {}
    }

    if (!(Test-Path $HostExe) -or ((Get-Item $HostExe).Length -lt 12288)) {
      Build-AshokaNativeExe $InstallDir | Out-Null
    }

    if ((Test-Path $HostExe) -and ((Get-Item $HostExe).Length -ge 12288)) {
      try {
        $hPsi = New-Object System.Diagnostics.ProcessStartInfo
        $hPsi.FileName = $HostExe
        $hPsi.WorkingDirectory = $InstallDir
        $hPsi.UseShellExecute = $false
        [System.Diagnostics.Process]::Start($hPsi) | Out-Null
        return
      } catch {}
    }

    if (Test-Path $LaunchScript) {
      try {
        $lPsi = New-Object System.Diagnostics.ProcessStartInfo
        $lPsi.FileName = $PsExe
        $lPsi.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $LaunchScript + '"'
        $lPsi.WorkingDirectory = $InstallDir
        $lPsi.UseShellExecute = $false
        $lPsi.CreateNoWindow = $true
        $lPsi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        [System.Diagnostics.Process]::Start($lPsi) | Out-Null
        return
      } catch {}
    }
  } catch {}
}

function Ensure-WebView2Preinstalled {
  try {
    foreach ($rk in @(
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'HKLM:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'HKCU:\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    )) {
      if (Test-Path $rk) {
        $pv = (Get-ItemProperty -Path $rk -ErrorAction SilentlyContinue).pv
        if ($pv -and $pv -ne '0.0.0.0') { return }
      }
    }
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls11 -bor [System.Net.SecurityProtocolType]::Tls
    $wvSetup = Join-Path $env:TEMP 'AshokaWebView2Setup.exe'
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile('https://go.microsoft.com/fwlink/p/?LinkId=2124703', $wvSetup)
    if (Test-Path $wvSetup) {
      $wPsi = New-Object System.Diagnostics.ProcessStartInfo
      $wPsi.FileName = $wvSetup
      $wPsi.Arguments = '/silent /install'
      $wPsi.UseShellExecute = $false
      $wPsi.CreateNoWindow = $true
      $wp = [System.Diagnostics.Process]::Start($wPsi)
      if ($wp) { $wp.WaitForExit(60000) | Out-Null }
      Remove-Item $wvSetup -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}

function Invoke-AshokaInstall([string]$InstallDir, [bool]$MakeDesktop, [bool]$MakeStartMenu, [scriptblock]$OnProgress) {
  if (!(Test-Path $InstallDir)) { New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null }

  if ($OnProgress) { & $OnProgress 12 'Stopping any previous Ashoka background processes...' }
  try {
    $stoppedOld = $false
    Get-Process -Name 'Ashoka_MSO_Playlist' -ErrorAction SilentlyContinue | ForEach-Object {
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      $stoppedOld = $true
    }
    Get-CimInstance Win32_Process | Where-Object {
      ($_.CommandLine -and (
        $_.CommandLine -like '*offline_backend.ps1*' -or
        $_.CommandLine -like '*Ashoka_MSO_Playlist\\profile*' -or
        $_.CommandLine -like '*profile_out2*'
      )) -or ($_.ExecutablePath -and $_.ExecutablePath -like '*Ashoka_MSO_Playlist*')
    } | ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      $stoppedOld = $true
    }
    if ($stoppedOld) { Start-Sleep -Milliseconds 180 }
  } catch {}

  if ($OnProgress) { & $OnProgress 35 'Extracting Ashoka MSO Playlist application & offline engine...' }
  if (-not $t -and $env:ASHOKA_EXE) {
    $t = [IO.File]::ReadAllText($env:ASHOKA_EXE, [Text.Encoding]::GetEncoding(28591))
  }
  $zipPath = Join-Path $InstallDir 'ashoka_offline_bundle.zip'
  $hasZipBundle = $false
  $rawStartTag = '<<<ASHOKA_RAW_ZIP_' + 'START>>>'
  $rawEndTag = '<<<ASHOKA_RAW_ZIP_' + 'END>>>'
  $rawIdx = $t.IndexOf($rawStartTag)
  $rawEnd = $t.LastIndexOf($rawEndTag)
  if ($rawIdx -ge 0 -and $rawEnd -gt ($rawIdx + $rawStartTag.Length) -and $env:ASHOKA_EXE) {
    $rawStart = [int64]($rawIdx + $rawStartTag.Length)
    $rawLen = [int64]($rawEnd - $rawStart)
    $fsIn = [IO.File]::OpenRead($env:ASHOKA_EXE)
    $fsOut = [IO.File]::Create($zipPath)
    try {
      $fsIn.Seek($rawStart, [IO.SeekOrigin]::Begin) | Out-Null
      $buf = New-Object byte[] 65536
      $rem = $rawLen
      while ($rem -gt 0) {
        $toRead = [int][Math]::Min($buf.Length, $rem)
        $read = $fsIn.Read($buf, 0, $toRead)
        if ($read -le 0) { break }
        $fsOut.Write($buf, 0, $read)
        $rem -= $read
      }
      $hasZipBundle = ($rem -eq 0)
    } finally {
      $fsOut.Close()
      $fsIn.Close()
    }
  } else {
    $b64Start = $t.IndexOf('<<<ASHOKA_ZIP_' + 'B64_START>>>') + 26
    $b64End = $t.IndexOf('<<<ASHOKA_ZIP_' + 'B64_END>>>')
    if ($b64Start -gt 25 -and $b64End -gt $b64Start) {
      $b64 = $t.Substring($b64Start, $b64End - $b64Start)
      $zipBytes = [Convert]::FromBase64String($b64)
      [IO.File]::WriteAllBytes($zipPath, $zipBytes)
      $hasZipBundle = $true
    }
  }
  if ($hasZipBundle -and (Test-Path $zipPath)) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    foreach ($entry in $archive.Entries) {
      $destPath = Join-Path $InstallDir ($entry.FullName -replace '/', '\\')
      $destDir = Split-Path $destPath -Parent
      if (!(Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
      if ($entry.Name -ne '') {
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destPath, $true)
      }
    }
    $archive.Dispose()
    Remove-Item $zipPath -Force
  }

  if ($OnProgress) { & $OnProgress 60 'Building native Ashoka_MSO_Playlist.exe desktop executable...' }
  $nativeCompiled = Build-AshokaNativeExe $InstallDir
  Ensure-WebView2Preinstalled

  if ($OnProgress) { & $OnProgress 78 'Creating Desktop, Start Menu shortcuts & Uninstaller...' }
  $appExe = Join-Path $InstallDir 'Ashoka_MSO_Playlist.exe'
  $uninstExe = Join-Path $InstallDir 'Uninstall.exe'
  $launchPs1 = Join-Path $InstallDir 'app\\launch.ps1'
  $uninstallPs1 = Join-Path $InstallDir 'app\\uninstall_gui.ps1'
  $icoPath = Join-Path $InstallDir 'app\\assets\\ashoka-icon.ico'
  $shortcutIcon = if (Test-Path $icoPath) { "$icoPath,0" } else { "$appExe,0" }
  $launchArgsStr = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launchPs1 + '"'
  $uninstArgsStr = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $uninstallPs1 + '"'

  try {
    $WshShell = New-Object -ComObject WScript.Shell
    if ($MakeDesktop) {
      $oldDeskLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Ashoka MSO Playlist.lnk'
      if (Test-Path $oldDeskLnk) { Remove-Item $oldDeskLnk -Force -ErrorAction SilentlyContinue }
      $desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Ashoka Cable TV Playout.lnk'
      $sc1 = $WshShell.CreateShortcut($desktopLnk)
      if ($nativeCompiled -and (Test-Path $appExe)) {
        $sc1.TargetPath = $appExe
        $sc1.Arguments = ''
        $sc1.WindowStyle = 1
      } else {
        $sc1.TargetPath = $PsExe
        $sc1.Arguments = $launchArgsStr
        $sc1.WindowStyle = 7
      }
      $sc1.WorkingDirectory = $InstallDir
      $sc1.IconLocation = $shortcutIcon
      $sc1.Description = 'Ashoka Cable TV Playout - Broadcast Automation Studio'
      $sc1.Save()
    }

    $startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Ashoka Cable TV Playout'
    if ($MakeStartMenu) {
      if (!(Test-Path $startMenuDir)) { New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null }
      $startLnk = Join-Path $startMenuDir 'Ashoka Cable TV Playout.lnk'
      $sc2 = $WshShell.CreateShortcut($startLnk)
      if ($nativeCompiled -and (Test-Path $appExe)) {
        $sc2.TargetPath = $appExe
        $sc2.Arguments = ''
        $sc2.WindowStyle = 1
      } else {
        $sc2.TargetPath = $PsExe
        $sc2.Arguments = $launchArgsStr
        $sc2.WindowStyle = 7
      }
      $sc2.WorkingDirectory = $InstallDir
      $sc2.IconLocation = $shortcutIcon
      $sc2.Description = 'Ashoka Cable TV Playout - Broadcast Automation Studio'
      $sc2.Save()

      $uninstLnk = Join-Path $startMenuDir 'Uninstall Ashoka Cable TV Playout.lnk'
      $sc3 = $WshShell.CreateShortcut($uninstLnk)
      if (Test-Path $uninstExe) {
        $sc3.TargetPath = $uninstExe
        $sc3.Arguments = ''
        $sc3.WindowStyle = 1
      } else {
        $sc3.TargetPath = $PsExe
        $sc3.Arguments = $uninstArgsStr
        $sc3.WindowStyle = 7
      }
      $sc3.WorkingDirectory = $InstallDir
      $sc3.IconLocation = $shortcutIcon
      $sc3.Description = 'Uninstall Ashoka Cable TV Playout'
      $sc3.Save()
    }
  } catch {}

  if ($OnProgress) { & $OnProgress 88 'Registering Windows Add/Remove Programs uninstaller...' }
  try {
    $regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist'
    if (!(Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
    Set-ItemProperty -Path $regPath -Name 'DisplayName' -Value 'Ashoka Cable TV Playout'
    Set-ItemProperty -Path $regPath -Name 'DisplayVersion' -Value '5.0.0'
    Set-ItemProperty -Path $regPath -Name 'Publisher' -Value 'Ashoka Media Technology'
    Set-ItemProperty -Path $regPath -Name 'DisplayIcon' -Value $shortcutIcon
    Set-ItemProperty -Path $regPath -Name 'InstallLocation' -Value $InstallDir
    if (Test-Path $uninstExe) {
      Set-ItemProperty -Path $regPath -Name 'UninstallString' -Value ('"' + $uninstExe + '"')
    } else {
      Set-ItemProperty -Path $regPath -Name 'UninstallString' -Value ('"' + $PsExe + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $uninstallPs1 + '"')
    }
    Set-ItemProperty -Path $regPath -Name 'QuietUninstallString' -Value ('"' + $PsExe + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $uninstallPs1 + '" -Silent')
  } catch {}

  try {
    $ieCmd = Get-Command ie4uinit.exe -ErrorAction SilentlyContinue
    if ($ieCmd -and $ieCmd.Source) {
      $iePsi = New-Object System.Diagnostics.ProcessStartInfo
      $iePsi.FileName = $ieCmd.Source
      $iePsi.Arguments = '-show'
      $iePsi.UseShellExecute = $false
      $iePsi.CreateNoWindow = $true
      [System.Diagnostics.Process]::Start($iePsi) | Out-Null
    }
  } catch {}

  if ($OnProgress) { & $OnProgress 100 'Installation complete! Opening Ashoka Cable TV Playout...' }
}

$script:shouldLaunchAfterInstall = $false
$script:installCancelled = $false

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::ThrowException)
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Ashoka Cable TV Playout 5.0 Setup'
  $form.Size = New-Object System.Drawing.Size(540, 360)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.BackColor = [System.Drawing.Color]::FromArgb(11, 17, 32)
  $form.ForeColor = [System.Drawing.Color]::White
  if ($env:ASHOKA_EXE -and (Test-Path $env:ASHOKA_EXE)) {
    try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:ASHOKA_EXE) } catch {}
  }

  $lblTitle = New-Object System.Windows.Forms.Label
  $lblTitle.Text = 'ASHOKA CABLE TV PLAYOUT 5.0'
  $lblTitle.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
  $lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(251, 191, 36)
  $lblTitle.Location = New-Object System.Drawing.Point(22, 18)
  $lblTitle.Size = New-Object System.Drawing.Size(480, 28)
  $form.Controls.Add($lblTitle)

  $lblDesc = New-Object System.Windows.Forms.Label
  $lblDesc.Text = 'Broadcast Playout Studio Installer (Includes Ashoka Icon, Local Backend, Shortcuts & Uninstaller)'
  $lblDesc.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
  $lblDesc.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
  $lblDesc.Location = New-Object System.Drawing.Point(22, 50)
  $lblDesc.Size = New-Object System.Drawing.Size(480, 36)
  $form.Controls.Add($lblDesc)

  $txtPath = New-Object System.Windows.Forms.TextBox
  $txtPath.Text = $DefaultInstallDir
  $txtPath.ReadOnly = $true
  $txtPath.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
  $txtPath.ForeColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
  $txtPath.Font = New-Object System.Drawing.Font('Consolas', 9)
  $txtPath.Location = New-Object System.Drawing.Point(22, 92)
  $txtPath.Size = New-Object System.Drawing.Size(480, 24)
  $form.Controls.Add($txtPath)

  $chkDesk = New-Object System.Windows.Forms.CheckBox
  $chkDesk.Text = 'Create Desktop Shortcut'
  $chkDesk.Checked = $true
  $chkDesk.Location = New-Object System.Drawing.Point(24, 124)
  $chkDesk.Size = New-Object System.Drawing.Size(240, 22)
  $form.Controls.Add($chkDesk)

  $chkMenu = New-Object System.Windows.Forms.CheckBox
  $chkMenu.Text = 'Create Start Menu & Uninstaller Shortcuts'
  $chkMenu.Checked = $true
  $chkMenu.Location = New-Object System.Drawing.Point(24, 148)
  $chkMenu.Size = New-Object System.Drawing.Size(340, 22)
  $form.Controls.Add($chkMenu)

  $chkLaunch = New-Object System.Windows.Forms.CheckBox
  $chkLaunch.Text = 'Open Ashoka MSO Playlist immediately after install'
  $chkLaunch.Checked = $true
  $chkLaunch.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
  $chkLaunch.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
  $chkLaunch.Location = New-Object System.Drawing.Point(24, 174)
  $chkLaunch.Size = New-Object System.Drawing.Size(460, 24)
  $form.Controls.Add($chkLaunch)

  $bar = New-Object System.Windows.Forms.ProgressBar
  $bar.Location = New-Object System.Drawing.Point(22, 206)
  $bar.Size = New-Object System.Drawing.Size(480, 18)
  $bar.Minimum = 0
  $bar.Maximum = 100
  $bar.Value = 0
  $form.Controls.Add($bar)

  $lblStep = New-Object System.Windows.Forms.Label
  $lblStep.Text = 'Installing Ashoka MSO Playlist automatically...'
  $lblStep.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
  $lblStep.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
  $lblStep.Location = New-Object System.Drawing.Point(22, 230)
  $lblStep.Size = New-Object System.Drawing.Size(480, 22)
  $form.Controls.Add($lblStep)

  $btnInstall = New-Object System.Windows.Forms.Button
  $btnInstall.Text = 'Install && Open Software'
  $btnInstall.BackColor = [System.Drawing.Color]::FromArgb(5, 150, 105)
  $btnInstall.ForeColor = [System.Drawing.Color]::White
  $btnInstall.FlatStyle = 'Flat'
  $btnInstall.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
  $btnInstall.Location = New-Object System.Drawing.Point(230, 268)
  $btnInstall.Size = New-Object System.Drawing.Size(180, 34)
  $form.AcceptButton = $btnInstall
  $form.Controls.Add($btnInstall)

  $btnCancel = New-Object System.Windows.Forms.Button
  $btnCancel.Text = 'Cancel'
  $btnCancel.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
  $btnCancel.ForeColor = [System.Drawing.Color]::White
  $btnCancel.FlatStyle = 'Flat'
  $btnCancel.Location = New-Object System.Drawing.Point(418, 268)
  $btnCancel.Size = New-Object System.Drawing.Size(84, 34)
  $form.Controls.Add($btnCancel)

  $script:installStarted = $false

  $RunInstallFlow = {
    if ($script:installStarted -or $script:installCancelled) { return }
    $script:installStarted = $true
    try {
      $btnInstall.Enabled = $false
      $btnCancel.Enabled = $false
      Invoke-AshokaInstall $DefaultInstallDir ([bool]$chkDesk.Checked) ([bool]$chkMenu.Checked) {
        param([int]$pct, [string]$msg)
        $bar.Value = [Math]::Max(0, [Math]::Min(100, $pct))
        $lblStep.Text = $msg
        $form.Refresh()
      }
      $script:shouldLaunchAfterInstall = [bool]$chkLaunch.Checked
    } catch {
      $script:shouldLaunchAfterInstall = $true
    } finally {
      try { $Error.Clear() } catch {}
      try { $form.Hide() } catch {}
      try { $form.Close() } catch {}
    }
  }

  $btnCancel.Add_Click({
    $script:installCancelled = $true
    try { $form.Close() } catch {}
  })

  $btnInstall.Add_Click({
    try { & $RunInstallFlow } catch {}
  })

  $autoTimer = New-Object System.Windows.Forms.Timer
  $autoTimer.Interval = 220
  $autoTimer.Add_Tick({
    $autoTimer.Stop()
    try { & $RunInstallFlow } catch {}
  })

  $form.Add_Shown({
    try {
      $form.Activate()
      $form.TopMost = $true
      $form.TopMost = $false
      $autoTimer.Start()
    } catch {}
  })

  [void]$form.ShowDialog()
  if ($script:shouldLaunchAfterInstall -and -not $script:installCancelled) {
    Launch-AshokaDirect $DefaultInstallDir
  }
} catch {
  try {
    if (-not $script:installStarted) {
      Invoke-AshokaInstall $DefaultInstallDir $true $true $null
    }
    if (-not $script:installCancelled) {
      Launch-AshokaDirect $DefaultInstallDir
    }
  } catch {}
}
`.trim();

  const overlayHeader = Buffer.from(
    `\n<<<ASHOKA_PS1_START>>>${ps1Script}<<<ASHOKA_PS1_END>>>\n<<<ASHOKA_RAW_ZIP_START>>>`,
    'latin1'
  );
  const overlayFooter = Buffer.from(`<<<ASHOKA_RAW_ZIP_END>>>\n`, 'latin1');
  const overlayBuf = Buffer.concat([overlayHeader, zipBuf, overlayFooter]);

  const bootstrapCmd =
    'powershell.exe -NoP -EP Bypass -W Hidden -C "$t=[IO.File]::ReadAllText($env:ASHOKA_EXE,[Text.Encoding]::GetEncoding(28591));$i=$t.IndexOf(\'<<<ASHOKA_\'+\'PS1_START>>>\')+22;$j=$t.IndexOf(\'<<<ASHOKA_\'+\'PS1_END>>>\');iex $t.Substring($i,$j-$i)"';

  cachedDistMtimeMs = currentDistMtimeMs;
  cachedSelfExtractingSetupExe = buildWindowsGuiExeWithIcon(bootstrapCmd, 0, overlayBuf);
  return cachedSelfExtractingSetupExe;
}
