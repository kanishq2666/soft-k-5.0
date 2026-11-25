import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateAshokaIcoBuffer,
  buildStandaloneUninstallerExe,
  generateUninstallBat,
  buildSelfExtractingOfflineOnlineSetupExe,
} from './windowsExeBuilder.ts';

function assertValidPe32GuiExe(buf: Buffer, label: string) {
  assert.ok(buf.length > 1024, `${label} must be > 1KB`);
  assert.equal(buf.toString('ascii', 0, 2), 'MZ', `${label} must start with MZ DOS stub`);
  const peOffset = buf.readUInt32LE(0x3c);
  assert.ok(peOffset > 0 && peOffset + 24 < buf.length, `${label} valid e_lfanew`);
  assert.equal(buf.toString('ascii', peOffset, peOffset + 4), 'PE\0\0', `${label} must contain PE\\0\\0`);
  // IMAGE_SUBSYSTEM_WINDOWS_GUI = 2 at OptionalHeader + 68
  const optionalHeaderOffset = peOffset + 24;
  const subsystem = buf.readUInt16LE(optionalHeaderOffset + 68);
  assert.equal(subsystem, 2, `${label} subsystem should be Windows GUI (2)`);
  // Check .rsrc section header exists (contains embedded RT_ICON + RT_GROUP_ICON)
  const asciiHeader = buf.toString('ascii', peOffset, Math.min(buf.length, peOffset + 512));
  assert.ok(asciiHeader.includes('.rsrc'), `${label} must include .rsrc section for embedded icon`);
}

describe('windowsExeBuilder installer, icon & uninstaller', () => {
  it('generates a valid 5-resolution Windows .ico buffer', () => {
    const ico = generateAshokaIcoBuffer();
    assert.equal(ico.readUInt16LE(0), 0); // Reserved = 0
    assert.equal(ico.readUInt16LE(2), 1); // Type = 1 (ICO)
    assert.equal(ico.readUInt16LE(4), 5); // 5 resolutions: 256, 64, 48, 32, 16
    assert.ok(ico.length > 50_000, 'ICO buffer should contain 32-bit DIB frames');
  });

  it('builds a valid standalone PE32 GUI Uninstall.exe with embedded icon', () => {
    const uninst = buildStandaloneUninstallerExe();
    assertValidPe32GuiExe(uninst, 'Uninstall.exe');
    const text = uninst.toString('latin1');
    assert.ok(text.includes('uninstall_gui.ps1'), 'Uninstall.exe launches uninstall_gui.ps1');
  });

  it('generateUninstallBat cleans both Ashoka Cable TV Playout and legacy shortcuts & registry', () => {
    const bat = generateUninstallBat();
    assert.ok(bat.includes('Ashoka Cable TV Playout.lnk'));
    assert.ok(bat.includes('Ashoka MSO Playlist.lnk'));
    assert.ok(bat.includes('Uninstall\\Ashoka_MSO_Playlist'));
    assert.ok(bat.includes('Uninstall\\Ashoka_Cable_TV_Playout'));
  });

  it('builds self-extracting ashokacabletvplayout.settop.exe with embedded icon, setup PS1, and ZIP payload', () => {
    const rootDir = process.cwd();
    const distIndex = path.join(rootDir, 'dist', 'index.html');
    if (!fs.existsSync(distIndex)) {
      return; // Skip payload test only if dist has not been built yet
    }
    const exe = buildSelfExtractingOfflineOnlineSetupExe(rootDir);
    assertValidPe32GuiExe(exe, 'ashokacabletvplayout.settop.exe');

    const latin1 = exe.toString('latin1');
    assert.ok(latin1.includes('<<<ASHOKA_PS1_START>>>'), 'must embed PS1 installer script');
    assert.ok(latin1.includes('Ashoka Cable TV Playout 5.0 Setup'), 'setup wizard title updated');
    assert.ok(latin1.includes('Ashoka Media Technology'), 'publisher updated to Ashoka Media Technology');
    assert.ok(latin1.includes('ExtractAssociatedIcon($env:ASHOKA_EXE)'), 'setup form assigns Ashoka EXE icon');

    const startTag = '<<<ASHOKA_RAW_ZIP_START>>>';
    const endTag = '<<<ASHOKA_RAW_ZIP_END>>>';
    const startIdx = latin1.indexOf(startTag);
    const endIdx = latin1.lastIndexOf(endTag);
    assert.ok(startIdx > 0 && endIdx > startIdx, 'must contain raw ZIP markers');

    const zipSlice = exe.subarray(startIdx + startTag.length, endIdx);
    // ZIP local file header starts with PK\x03\x04 and ends with EOCD PK\x05\x06
    assert.equal(zipSlice.toString('ascii', 0, 2), 'PK');
    assert.ok(zipSlice.includes(Buffer.from('app/index.html', 'utf8')), 'ZIP bundles app/index.html');
    assert.ok(zipSlice.includes(Buffer.from('app/assets/ashoka-icon.ico', 'utf8')), 'ZIP bundles ashoka-icon.ico');
    assert.ok(zipSlice.includes(Buffer.from('Uninstall.exe', 'utf8')), 'ZIP bundles Uninstall.exe');
    assert.ok(zipSlice.includes(Buffer.from('uninstall.bat', 'utf8')), 'ZIP bundles uninstall.bat');
  });
});
