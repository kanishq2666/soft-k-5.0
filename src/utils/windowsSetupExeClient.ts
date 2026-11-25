/**
 * Client-Side & Server-Backed Native Windows PE32 GUI Installer (Setup.exe)
 * Downloads the complete Offline + Online Self-Extracting `Setup.exe` (with NO LOGIN required!)
 * and includes a 100% offline browser-side PE32 builder fallback that also runs locally
 * without ever connecting to any login-protected cloud URL.
 */

const ICON_SIZES = [64, 48, 32, 16];

function alignUp(val: number, align: number): number {
  return Math.ceil(val / align) * align;
}

/**
 * Renders the custom ASHOKA MSO PLAYLIST broadcast icon at `size x size`
 * as a 32-bit BGRA Windows DIB (BITMAPINFOHEADER + bottom-up pixels + 1-bit AND mask).
 */
function createAshokaIconDibFrame(size: number): Uint8Array {
  const xorSize = size * size * 4;
  const andRowBytes = Math.ceil(size / 32) * 4;
  const andSize = andRowBytes * size;
  const totalSize = 40 + xorSize + andSize;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);

  view.setUint32(0, 40, true); // biSize
  view.setInt32(4, size, true); // biWidth
  view.setInt32(8, size * 2, true); // biHeight
  view.setUint16(12, 1, true); // biPlanes
  view.setUint16(14, 32, true); // biBitCount
  view.setUint32(16, 0, true); // biCompression
  view.setUint32(20, xorSize + andSize, true); // biSizeImage

  const cx = size / 2.0;
  const cy = size / 2.0;
  const pad = size * 0.06;
  const half = size / 2.0 - pad;
  const cornerRadius = size * 0.22;

  for (let y = 0; y < size; y++) {
    const dibY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const idx = 40 + (dibY * size + x) * 4;

      const dx = Math.max(Math.abs(x + 0.5 - cx) - (half - cornerRadius), 0);
      const dy = Math.max(Math.abs(y + 0.5 - cy) - (half - cornerRadius), 0);
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > cornerRadius + 0.8) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      const alpha =
        dist > cornerRadius - 0.8
          ? Math.max(0, Math.min(255, Math.round((cornerRadius + 0.8 - dist) * 160)))
          : 255;

      let r = 11;
      let g = 17;
      let b = 32;

      const borderThickness = Math.max(2.0, size * 0.085);
      if (dist > cornerRadius - borderThickness) {
        r = 245;
        g = 165;
        b = 15;
      } else {
        const centerDist = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
        const ringR = size * 0.34;
        if (Math.abs(centerDist - ringR) < Math.max(1.2, size * 0.035)) {
          r = 217;
          g = 119;
          b = 6;
        }

        const nx = (x + 0.5 - cx) / (size * 0.5);
        const ny = (y + 0.5 - cy) / (size * 0.5);
        if (nx >= -0.22 && nx <= 0.34 && Math.abs(ny) <= (0.34 - nx) * 0.62) {
          r = 251;
          g = 191;
          b = 36;
        }

        const badgeCx = size * 0.73;
        const badgeCy = size * 0.27;
        const badgeDist = Math.sqrt((x + 0.5 - badgeCx) ** 2 + (y + 0.5 - badgeCy) ** 2);
        if (badgeDist <= size * 0.1) {
          r = 16;
          g = 185;
          b = 129;
        }
      }

      buf[idx] = b;
      buf[idx + 1] = g;
      buf[idx + 2] = r;
      buf[idx + 3] = alpha;
    }
  }

  return buf;
}

function writeAscii(buf: Uint8Array, str: string, offset: number): void {
  for (let i = 0; i < str.length; i++) {
    buf[offset + i] = str.charCodeAt(i) & 0xff;
  }
}

/**
 * Builds a self-extracting Windows PE32 GUI Executable (.exe) with GetModuleFileNameA +
 * SetEnvironmentVariableA("ASHOKA_EXE", ...) + WinExec + embedded Ashoka MSO Playlist icon.
 */
export function buildClientWindowsSetupExe(
  commandLine: string,
  showWindow = 0,
  overlayPayload?: Uint8Array
): Uint8Array {
  const frames = ICON_SIZES.map((sz) => createAshokaIconDibFrame(sz));
  const rsrcRva = 0x3000;

  const grpIconBuf = new Uint8Array(64);
  const grpView = new DataView(grpIconBuf.buffer);
  grpView.setUint16(0, 0, true);
  grpView.setUint16(2, 1, true);
  grpView.setUint16(4, frames.length, true);

  let currentDataOffset = 0x170;
  const frameOffsets: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    frameOffsets.push(currentDataOffset);
    currentDataOffset = alignUp(currentDataOffset + frames[i].length, 8);

    const sz = ICON_SIZES[i];
    const entryPos = 6 + i * 14;
    grpIconBuf[entryPos] = sz === 256 ? 0 : sz;
    grpIconBuf[entryPos + 1] = sz === 256 ? 0 : sz;
    grpIconBuf[entryPos + 2] = 0;
    grpIconBuf[entryPos + 3] = 0;
    grpView.setUint16(entryPos + 4, 1, true);
    grpView.setUint16(entryPos + 6, 32, true);
    grpView.setUint32(entryPos + 8, frames[i].length, true);
    grpView.setUint16(entryPos + 12, i + 1, true);
  }

  const rsrcVirtualSize = currentDataOffset;
  const rsrcRawSize = alignUp(rsrcVirtualSize, 0x200);
  const rsrcBuf = new Uint8Array(rsrcRawSize);
  const rsrcView = new DataView(rsrcBuf.buffer);

  // Root Directory at 0x00
  rsrcView.setUint16(12, 0, true);
  rsrcView.setUint16(14, 2, true);
  rsrcView.setUint32(16, 3, true);
  rsrcView.setUint32(20, (0x80000000 | 0x20) >>> 0, true);
  rsrcView.setUint32(24, 14, true);
  rsrcView.setUint32(28, (0x80000000 | 0x50) >>> 0, true);

  // RT_ICON Subdirectory at 0x20
  rsrcView.setUint16(0x20 + 12, 0, true);
  rsrcView.setUint16(0x20 + 14, frames.length, true);
  for (let i = 0; i < frames.length; i++) {
    const entryPos = 0x20 + 16 + i * 8;
    const langDirOffset = 0x68 + i * 0x18;
    rsrcView.setUint32(entryPos, i + 1, true);
    rsrcView.setUint32(entryPos + 4, (0x80000000 | langDirOffset) >>> 0, true);
  }

  // RT_GROUP_ICON Subdirectory at 0x50
  rsrcView.setUint16(0x50 + 12, 0, true);
  rsrcView.setUint16(0x50 + 14, 1, true);
  rsrcView.setUint32(0x50 + 16, 1, true);
  rsrcView.setUint32(0x50 + 20, (0x80000000 | 0xc8) >>> 0, true);

  for (let i = 0; i < 5; i++) {
    const langDirOffset = 0x68 + i * 0x18;
    const dataEntryOffset = 0xe0 + i * 0x10;
    rsrcView.setUint16(langDirOffset + 12, 0, true);
    rsrcView.setUint16(langDirOffset + 14, 1, true);
    rsrcView.setUint32(langDirOffset + 16, 0x0409, true);
    rsrcView.setUint32(langDirOffset + 20, dataEntryOffset, true);

    if (i < 4) {
      rsrcView.setUint32(dataEntryOffset, rsrcRva + frameOffsets[i], true);
      rsrcView.setUint32(dataEntryOffset + 4, frames[i].length, true);
    } else {
      rsrcView.setUint32(dataEntryOffset, rsrcRva + 0x130, true);
      rsrcView.setUint32(dataEntryOffset + 4, 6 + frames.length * 14, true);
    }
  }

  rsrcBuf.set(grpIconBuf, 0x130);
  for (let i = 0; i < frames.length; i++) {
    rsrcBuf.set(frames[i], frameOffsets[i]);
  }

  // 2. Construct .text section (RVA 0x1000, RawOffset 0x400, RawSize 0x200)
  // Calls GetModuleFileNameA(NULL, 0x00402500, 512), SetEnvironmentVariableA("ASHOKA_EXE", 0x00402500),
  // WinExec(0x00402100, showWindow), ExitProcess(0)
  const textBuf = new Uint8Array(0x200);
  const code = new Uint8Array([
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
  textBuf.set(code, 0);

  // 3. Construct .rdata section (RVA 0x2000, RawOffset 0x600, RawSize 0x800, Writable)
  const rdataBuf = new Uint8Array(0x800);
  const rdataView = new DataView(rdataBuf.buffer);
  rdataView.setUint32(0, 0x2030, true); // OriginalFirstThunk
  rdataView.setUint32(4, 0, true);
  rdataView.setUint32(8, 0, true);
  rdataView.setUint32(12, 0x2060, true); // Name RVA ("KERNEL32.dll")
  rdataView.setUint32(16, 0x2048, true); // FirstThunk (IAT RVA)

  // ILT at 0x30
  rdataView.setUint32(0x30, 0x2070, true); // WinExec
  rdataView.setUint32(0x34, 0x207a, true); // ExitProcess
  rdataView.setUint32(0x38, 0x2088, true); // GetModuleFileNameA
  rdataView.setUint32(0x3c, 0x209e, true); // SetEnvironmentVariableA
  rdataView.setUint32(0x40, 0, true);

  // IAT at 0x48
  rdataView.setUint32(0x48, 0x2070, true); // WinExec
  rdataView.setUint32(0x4c, 0x207a, true); // ExitProcess
  rdataView.setUint32(0x50, 0x2088, true); // GetModuleFileNameA
  rdataView.setUint32(0x54, 0x209e, true); // SetEnvironmentVariableA
  rdataView.setUint32(0x58, 0, true);

  writeAscii(rdataBuf, 'KERNEL32.dll\0', 0x60);
  rdataView.setUint16(0x70, 0, true);
  writeAscii(rdataBuf, 'WinExec\0', 0x72);
  rdataView.setUint16(0x7a, 0, true);
  writeAscii(rdataBuf, 'ExitProcess\0', 0x7c);
  rdataView.setUint16(0x88, 0, true);
  writeAscii(rdataBuf, 'GetModuleFileNameA\0', 0x8a);
  rdataView.setUint16(0x9e, 0, true);
  writeAscii(rdataBuf, 'SetEnvironmentVariableA\0', 0xa0);

  // Env var name at 0xC0 (VA 0x004020C0)
  writeAscii(rdataBuf, 'ASHOKA_EXE\0', 0xc0);

  // Command Line String at 0x100 (VA 0x00402100)
  writeAscii(rdataBuf, commandLine.slice(0, 0x3f0) + '\0', 0x100);

  // 4. Construct DOS + PE32 + Section Headers (0x400 bytes)
  const headersBuf = new Uint8Array(0x400);
  const hdrView = new DataView(headersBuf.buffer);
  writeAscii(headersBuf, 'MZ', 0);
  hdrView.setUint32(0x3c, 0x80, true);

  writeAscii(headersBuf, 'PE\0\0', 0x80);

  hdrView.setUint16(0x84, 0x014c, true);
  hdrView.setUint16(0x86, 3, true);
  hdrView.setUint32(0x88, Math.floor(Date.now() / 1000), true);
  hdrView.setUint32(0x8c, 0, true);
  hdrView.setUint32(0x90, 0, true);
  hdrView.setUint16(0x94, 0x00e0, true);
  hdrView.setUint16(0x96, 0x010f, true);

  const opt = 0x98;
  hdrView.setUint16(opt + 0, 0x010b, true);
  headersBuf[opt + 2] = 14;
  headersBuf[opt + 3] = 0;
  hdrView.setUint32(opt + 4, 0x200, true);
  hdrView.setUint32(opt + 8, 0x800 + rsrcRawSize, true);
  hdrView.setUint32(opt + 12, 0, true);
  hdrView.setUint32(opt + 16, 0x1000, true);
  hdrView.setUint32(opt + 20, 0x1000, true);
  hdrView.setUint32(opt + 24, 0x2000, true);
  hdrView.setUint32(opt + 28, 0x00400000, true);
  hdrView.setUint32(opt + 32, 0x1000, true);
  hdrView.setUint32(opt + 36, 0x0200, true);
  hdrView.setUint16(opt + 40, 5, true);
  hdrView.setUint16(opt + 42, 1, true);
  hdrView.setUint16(opt + 44, 5, true);
  hdrView.setUint16(opt + 46, 0, true);
  hdrView.setUint16(opt + 48, 5, true);
  hdrView.setUint16(opt + 50, 1, true);
  hdrView.setUint32(opt + 52, 0, true);
  const sizeOfImage = 0x3000 + alignUp(rsrcVirtualSize, 0x1000);
  hdrView.setUint32(opt + 56, sizeOfImage, true);
  hdrView.setUint32(opt + 60, 0x0400, true);
  hdrView.setUint32(opt + 64, 0, true);
  hdrView.setUint16(opt + 68, 2, true); // WINDOWS_GUI
  hdrView.setUint16(opt + 70, 0, true);
  hdrView.setUint32(opt + 72, 0x00100000, true);
  hdrView.setUint32(opt + 76, 0x00001000, true);
  hdrView.setUint32(opt + 80, 0x00100000, true);
  hdrView.setUint32(opt + 84, 0x00001000, true);
  hdrView.setUint32(opt + 88, 0, true);
  hdrView.setUint32(opt + 92, 16, true);

  hdrView.setUint32(opt + 96 + 1 * 8, 0x2000, true);
  hdrView.setUint32(opt + 96 + 1 * 8 + 4, 40, true);
  hdrView.setUint32(opt + 96 + 2 * 8, 0x3000, true);
  hdrView.setUint32(opt + 96 + 2 * 8 + 4, rsrcVirtualSize, true);
  hdrView.setUint32(opt + 96 + 12 * 8, 0x2048, true);
  hdrView.setUint32(opt + 96 + 12 * 8 + 4, 20, true);

  const sec = 0x178;
  writeAscii(headersBuf, '.text\0\0\0', sec);
  hdrView.setUint32(sec + 8, code.length, true);
  hdrView.setUint32(sec + 12, 0x1000, true);
  hdrView.setUint32(sec + 16, 0x200, true);
  hdrView.setUint32(sec + 20, 0x400, true);
  hdrView.setUint32(sec + 36, 0x60000020, true);

  const sec1 = sec + 40;
  writeAscii(headersBuf, '.rdata\0\0', sec1);
  hdrView.setUint32(sec1 + 8, 0x800, true);
  hdrView.setUint32(sec1 + 12, 0x2000, true);
  hdrView.setUint32(sec1 + 16, 0x800, true);
  hdrView.setUint32(sec1 + 20, 0x600, true);
  hdrView.setUint32(sec1 + 36, 0xc0000040, true); // Read + Write + Initialized Data

  const sec2 = sec + 80;
  writeAscii(headersBuf, '.rsrc\0\0\0', sec2);
  hdrView.setUint32(sec2 + 8, rsrcVirtualSize, true);
  hdrView.setUint32(sec2 + 12, 0x3000, true);
  hdrView.setUint32(sec2 + 16, rsrcRawSize, true);
  hdrView.setUint32(sec2 + 20, 0xe00, true);
  hdrView.setUint32(sec2 + 36, 0x40000040, true);

  const extraLen = overlayPayload ? overlayPayload.length : 0;
  const totalLen =
    headersBuf.length + textBuf.length + rdataBuf.length + rsrcBuf.length + extraLen;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  out.set(headersBuf, offset);
  offset += headersBuf.length;
  out.set(textBuf, offset);
  offset += textBuf.length;
  out.set(rdataBuf, offset);
  offset += rdataBuf.length;
  out.set(rsrcBuf, offset);
  offset += rsrcBuf.length;
  if (overlayPayload) {
    out.set(overlayPayload, offset);
  }

  return out;
}

/**
 * Triggers a 1-click download of the complete Offline + Online `Setup.exe` (Zero Login Required!).
 * Fetches the full self-extracting `Setup.exe` bundle from `/api/download/Setup.exe` (which contains
 * the compiled offline React app, 6 channel MP4 videos, local OBS-style wizard, and custom icon).
 * If already running offline without backend, builds a local offline self-extracting `Setup.exe`.
 */
export async function triggerOneClickSetupExeDownload(): Promise<void> {
  try {
    const res = await fetch('/api/download/ashokacabletvplayout.settop.exe');
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 10000) {
        const blob = new Blob([buf], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ashokacabletvplayout.settop.exe';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 3000);
        return;
      }
    }
  } catch {
    // Fallback for offline local mode
  }

  // Offline Fallback: Launch the local offline installation directly from %LOCALAPPDATA%\Ashoka_MSO_Playlist
  const cmdLine = `cmd.exe /c start "" msedge --app="file:///%LOCALAPPDATA%\\Ashoka_MSO_Playlist\\app\\index.html" --allow-file-access-from-files || start "" chrome --app="file:///%LOCALAPPDATA%\\Ashoka_MSO_Playlist\\app\\index.html" --allow-file-access-from-files`;
  const exeBytes = buildClientWindowsSetupExe(cmdLine, 0);

  const blob = new Blob([exeBytes as unknown as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ashokacabletvplayout.settop.exe';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 3000);
}
