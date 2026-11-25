/**
 * Genuine Windows NSIS Installer Builder (Setup.exe & Uninstall.exe)
 * Powered by makensis (Nullsoft Scriptable Install System) & Modern UI 2 (MUI2)
 *
 * Produces 100% authentic, signed-quality Windows installer executables:
 * - Real OBS Studio-style Modern UI 2 multi-page wizard
 * - Embedded multi-resolution Ashoka Broadcast Icon (.ico)
 * - Self-contained offline application bundle (HTML, Ruffle SWF engine, media, local server)
 * - Native desktop application launcher (Ashoka_MSO_Playlist.exe) with custom icon
 * - Full uninstaller (Uninstall.exe) with Windows "Add or Remove Programs" registry integration
 * - Zero admin rights required (installs to $LOCALAPPDATA, runs without UAC blocks)
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { buildSelfContainedOfflineHtml, generateOfflineBackendPs1 } from './windowsExeBuilder';

const execFileAsync = promisify(execFile);

let cachedSetupExeBuffer: Buffer | null = null;
let cachedUninstallExeBuffer: Buffer | null = null;
let isBuilding = false;


/**
 * Builds and returns the genuine NSIS Setup.exe binary buffer.
 */
export async function getNsisSetupExeBuffer(rootDir = process.cwd()): Promise<Buffer> {
  if (cachedSetupExeBuffer) {
    return cachedSetupExeBuffer;
  }
  await buildAllNsisExecutables(rootDir);
  if (!cachedSetupExeBuffer) {
    throw new Error('NSIS Setup.exe compilation failed to produce output binary.');
  }
  return cachedSetupExeBuffer;
}

/**
 * Builds and returns the genuine NSIS Uninstall.exe binary buffer.
 */
export async function getNsisUninstallExeBuffer(rootDir = process.cwd()): Promise<Buffer> {
  if (cachedUninstallExeBuffer) {
    return cachedUninstallExeBuffer;
  }
  await buildAllNsisExecutables(rootDir);
  if (!cachedUninstallExeBuffer) {
    throw new Error('NSIS Uninstall.exe compilation failed to produce output binary.');
  }
  return cachedUninstallExeBuffer;
}

/**
 * Compiles Setup.exe, Ashoka_MSO_Playlist.exe launcher, and Uninstall.exe using makensis.
 */
export async function buildAllNsisExecutables(rootDir = process.cwd()): Promise<void> {
  if (isBuilding) {
    while (isBuilding) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return;
  }

  isBuilding = true;
  try {
    const buildDir = path.join('/tmp', 'ashoka-nsis-build');
    const stagingDir = path.join(buildDir, 'staging');
    const appDir = path.join(stagingDir, 'app');
    const assetsDir = path.join(appDir, 'assets');
    const videosDir = path.join(appDir, 'videos');
    const ruffleDir = path.join(appDir, 'ruffle');

    fs.mkdirSync(buildDir, { recursive: true });
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.mkdirSync(videosDir, { recursive: true });
    fs.mkdirSync(ruffleDir, { recursive: true });

    // 1. Icon assets
    const iconSrc = path.join(rootDir, 'public', 'assets', 'ashoka-icon.ico');
    const svgSrc = path.join(rootDir, 'public', 'assets', 'ashoka-icon.svg');
    if (fs.existsSync(iconSrc)) {
      fs.copyFileSync(iconSrc, path.join(assetsDir, 'ashoka-icon.ico'));
      fs.copyFileSync(iconSrc, path.join(buildDir, 'ashoka-icon.ico'));
    }
    if (fs.existsSync(svgSrc)) {
      fs.copyFileSync(svgSrc, path.join(assetsDir, 'ashoka-icon.svg'));
    }

    // 2. Build Self-Contained Offline HTML
    const { html } = buildSelfContainedOfflineHtml(rootDir);
    fs.writeFileSync(path.join(appDir, 'index.html'), html, 'utf8');

    // 3. Offline Backend PowerShell script
    const ps1Script = generateOfflineBackendPs1();
    fs.writeFileSync(path.join(appDir, 'offline_backend.ps1'), ps1Script, 'utf8');

    // 4. Copy built-in sample videos (ch1..ch6)
    const publicVideosDir = path.join(rootDir, 'public', 'videos');
    if (fs.existsSync(publicVideosDir)) {
      const vidFiles = fs.readdirSync(publicVideosDir).filter((vf) => vf.toLowerCase().endsWith('.mp4'));
      for (const vf of vidFiles) {
        fs.copyFileSync(path.join(publicVideosDir, vf), path.join(videosDir, vf));
      }
    }

    // 5. Copy Ruffle SWF WebAssembly runtime
    const nodeRuffleDir = path.join(rootDir, 'node_modules', '@ruffle-rs', 'ruffle');
    if (fs.existsSync(nodeRuffleDir)) {
      const rFiles = fs.readdirSync(nodeRuffleDir);
      for (const rf of rFiles) {
        if (rf.endsWith('.js') || rf.endsWith('.wasm')) {
          fs.copyFileSync(path.join(nodeRuffleDir, rf), path.join(ruffleDir, rf));
        }
      }
    }

    // 6. Compile Standalone Application Launcher: Ashoka_MSO_Playlist.exe
    const launcherNsiPath = path.join(buildDir, 'launcher.nsi');
    const launcherNsi = `
Name "Ashoka MSO Playlist"
OutFile "${stagingDir}/Ashoka_MSO_Playlist.exe"
Icon "${iconSrc}"
SilentInstall silent
RequestExecutionLevel user

Section
  ; Start local offline backend HTTP listener in hidden window
  ExecShell "" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$EXEDIR\\app\\offline_backend.ps1"' SW_HIDE
  Sleep 1000

  ; Launch in fullscreen browser app mode (Edge -> Chrome -> Direct HTML)
  ExecShell "" "msedge.exe" '--start-fullscreen --app="http://127.0.0.1:38550/?desktop=1&fullscreen=1"'
  IfErrors 0 done
  ExecShell "" "chrome.exe" '--start-fullscreen --app="http://127.0.0.1:38550/?desktop=1&fullscreen=1"'
  IfErrors 0 done
  ExecShell "open" "$EXEDIR\\app\\index.html"
done:
SectionEnd
`.trim();
    fs.writeFileSync(launcherNsiPath, launcherNsi, 'utf8');
    await execFileAsync('makensis', [launcherNsiPath]);

    // 7. Write EULA / License text for installer wizard
    const licenseTxtPath = path.join(buildDir, 'license.txt');
    const licenseTxt = `
ASHOKA MSO PLAYLIST — BROADCAST PLAYOUT STUDIO
Single-Channel Broadcast Playout & Master Control Playout License

1. LICENSE GRANT & ACTIVATION
Ashoka Digital Broadcast Systems grants you an authorized license to install and operate Ashoka MSO Playlist on Windows 10 / Windows 11 PCs.

2. FEATURES INCLUDED
- Dual Display Output (Main Operator Deck + Dedicated 2nd Display On-Air Feed)
- Full Broadcast Graphics: Animated SWF Vector Logos, PNG/GIF Logos, Top Breaking Tickers, Lower Third Crawls, L-Shape Squeeze Banners
- Every-N-Minute Commercial Break Scheduler with Auto Return
- 100% Offline Capability with Local Ruffle WebAssembly Engine

3. INSTALLATION & UNINSTALLATION
The software installs into your user local application directory (%LOCALAPPDATA%\\Ashoka_MSO_Playlist). Standard Windows Desktop and Start Menu shortcuts are created with custom broadcast icons. You can uninstall at any time via Windows Control Panel or the Start Menu Uninstall shortcut.

Copyright (c) 2026 Ashoka Digital Broadcast Systems. All rights reserved.
`.trim();
    fs.writeFileSync(licenseTxtPath, licenseTxt, 'utf8');

    // 8. Compile Main OBS Studio-Style Setup.exe
    const installerNsiPath = path.join(buildDir, 'installer.nsi');
    const installerNsi = `
!include "MUI2.nsh"

Name "Ashoka MSO Playlist"
OutFile "${buildDir}/Setup.exe"
InstallDir "$LOCALAPPDATA\\Ashoka_MSO_Playlist"
InstallDirRegKey HKCU "Software\\Ashoka_MSO_Playlist" "Install_Dir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

; Visual Branding
!define MUI_ICON "${iconSrc}"
!define MUI_UNICON "${iconSrc}"
!define MUI_ABORTWARNING

; Welcome Page (OBS Style)
!define MUI_WELCOMEPAGE_TITLE "Welcome to Ashoka MSO Playlist Setup"
!define MUI_WELCOMEPAGE_TEXT "Setup will guide you through installing Ashoka MSO Playlist 5.0 - Single-Channel Broadcast Playout Studio.\\r\\n\\r\\nIncludes Dual Display On-Air Playout, Animated SWF Graphics, Commercial Scheduler, and 100% Offline Capability.\\r\\n\\r\\nClick Next to continue."
!insertmacro MUI_PAGE_WELCOME

; License Page
!define MUI_LICENSEPAGE_CHECKBOX
!insertmacro MUI_PAGE_LICENSE "${licenseTxtPath}"

; Components Selection Page
!insertmacro MUI_PAGE_COMPONENTS

; Install Location Page
!insertmacro MUI_PAGE_DIRECTORY

; Extraction / Installation Progress Page
!insertmacro MUI_PAGE_INSTFILES

; Finish Page with 1-Click Launch Checkbox
!define MUI_FINISHPAGE_RUN "$INSTDIR\\Ashoka_MSO_Playlist.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Ashoka MSO Playlist now"
!insertmacro MUI_PAGE_FINISH

; Uninstaller Pages (OBS Style)
!define MUI_WELCOMEPAGE_TITLE "Uninstall Ashoka MSO Playlist"
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

; Component Section 1: Core Playout Engine
Section "Ashoka Broadcast Engine (Required)" SEC_CORE
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Create genuine uninstaller binary
  WriteUninstaller "$INSTDIR\\Uninstall.exe"

  ; Install primary launcher executable
  File "${stagingDir}/Ashoka_MSO_Playlist.exe"

  ; Install application files
  SetOutPath "$INSTDIR\\app"
  File /r "${stagingDir}/app/*.*"

  ; Register in Windows Control Panel "Add or Remove Programs"
  WriteRegStr HKCU "Software\\Ashoka_MSO_Playlist" "Install_Dir" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist" "DisplayName" "Ashoka MSO Playlist"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist" "DisplayVersion" "5.0.0"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist" "Publisher" "Ashoka Digital Broadcast Systems"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist" "DisplayIcon" "$INSTDIR\\Ashoka_MSO_Playlist.exe,0"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist" "UninstallString" "$\\"$INSTDIR\\Uninstall.exe$\\""
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist" "QuietUninstallString" "$\\"$INSTDIR\\Uninstall.exe$\\" /S"
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist" "NoRepair" 1
SectionEnd

; Component Section 2: Desktop Shortcut
Section "Desktop Shortcut" SEC_DESKTOP
  CreateShortcut "$DESKTOP\\Ashoka MSO Playlist.lnk" "$INSTDIR\\Ashoka_MSO_Playlist.exe" "" "$INSTDIR\\Ashoka_MSO_Playlist.exe" 0
SectionEnd

; Component Section 3: Start Menu Shortcuts
Section "Start Menu Shortcuts" SEC_STARTMENU
  CreateDirectory "$SMPROGRAMS\\Ashoka MSO Playlist"
  CreateShortcut "$SMPROGRAMS\\Ashoka MSO Playlist\\Ashoka MSO Playlist.lnk" "$INSTDIR\\Ashoka_MSO_Playlist.exe" "" "$INSTDIR\\Ashoka_MSO_Playlist.exe" 0
  CreateShortcut "$SMPROGRAMS\\Ashoka MSO Playlist\\Uninstall Ashoka MSO Playlist.lnk" "$INSTDIR\\Uninstall.exe" "" "$INSTDIR\\Uninstall.exe" 0
SectionEnd

; Descriptions
LangString DESC_Core \${LANG_ENGLISH} "Core broadcast playout engine, offline HTTP server, and media assets."
LangString DESC_Desktop \${LANG_ENGLISH} "Create a shortcut on your Windows desktop."
LangString DESC_Startmenu \${LANG_ENGLISH} "Create shortcuts in your Windows Start Menu."

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT \${SEC_CORE} $(DESC_Core)
  !insertmacro MUI_DESCRIPTION_TEXT \${SEC_DESKTOP} $(DESC_Desktop)
  !insertmacro MUI_DESCRIPTION_TEXT \${SEC_STARTMENU} $(DESC_Startmenu)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; Built-in Uninstaller Section
Section "Uninstall"
  ; Stop any running instances
  ExecWait '"$SYSDIR\\cmd.exe" /c taskkill /f /im msedge.exe /fi "WINDOWTITLE eq Ashoka*"'

  ; Remove shortcuts
  Delete "$DESKTOP\\Ashoka MSO Playlist.lnk"
  Delete "$SMPROGRAMS\\Ashoka MSO Playlist\\Ashoka MSO Playlist.lnk"
  Delete "$SMPROGRAMS\\Ashoka MSO Playlist\\Uninstall Ashoka MSO Playlist.lnk"
  RMDir "$SMPROGRAMS\\Ashoka MSO Playlist"

  ; Clean files
  RMDir /r "$INSTDIR\\app"
  RMDir /r "$INSTDIR\\uploads"
  RMDir /r "$INSTDIR\\data"
  Delete "$INSTDIR\\Ashoka_MSO_Playlist.exe"
  Delete "$INSTDIR\\Uninstall.exe"
  RMDir "$INSTDIR"

  ; Clean Windows Registry
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist"
  DeleteRegKey HKCU "Software\\Ashoka_MSO_Playlist"
SectionEnd
`.trim();
    fs.writeFileSync(installerNsiPath, installerNsi, 'utf8');
    await execFileAsync('makensis', [installerNsiPath]);

    const setupExePath = path.join(buildDir, 'Setup.exe');
    if (fs.existsSync(setupExePath)) {
      cachedSetupExeBuffer = fs.readFileSync(setupExePath);
    }

    // 9. Compile Standalone Uninstaller Executable: Uninstall.exe
    const uninstallerNsiPath = path.join(buildDir, 'standalone_uninstaller.nsi');
    const uninstallerNsi = `
!include "MUI2.nsh"

Name "Ashoka MSO Playlist Uninstaller"
OutFile "${buildDir}/Uninstall.exe"
RequestExecutionLevel user
!define MUI_ICON "${iconSrc}"
!define MUI_UNICON "${iconSrc}"

!define MUI_WELCOMEPAGE_TITLE "Uninstall Ashoka MSO Playlist"
!define MUI_WELCOMEPAGE_TEXT "This wizard will completely remove Ashoka MSO Playlist and all of its components from your computer.\\r\\n\\r\\nClick Next to continue."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Ashoka MSO Playlist Uninstalled"
!define MUI_FINISHPAGE_TEXT "Ashoka MSO Playlist has been successfully removed from your computer."
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Section "Remove Ashoka MSO Playlist" SEC_REMOVE
  ; Stop any running instances
  ExecWait '"$SYSDIR\\cmd.exe" /c taskkill /f /im msedge.exe /fi "WINDOWTITLE eq Ashoka*"'

  ; Remove shortcuts
  Delete "$DESKTOP\\Ashoka MSO Playlist.lnk"
  Delete "$SMPROGRAMS\\Ashoka MSO Playlist\\Ashoka MSO Playlist.lnk"
  Delete "$SMPROGRAMS\\Ashoka MSO Playlist\\Uninstall Ashoka MSO Playlist.lnk"
  RMDir "$SMPROGRAMS\\Ashoka MSO Playlist"

  ; Remove app files
  RMDir /r "$LOCALAPPDATA\\Ashoka_MSO_Playlist\\app"
  RMDir /r "$LOCALAPPDATA\\Ashoka_MSO_Playlist\\uploads"
  RMDir /r "$LOCALAPPDATA\\Ashoka_MSO_Playlist\\data"
  Delete "$LOCALAPPDATA\\Ashoka_MSO_Playlist\\Ashoka_MSO_Playlist.exe"
  Delete "$LOCALAPPDATA\\Ashoka_MSO_Playlist\\Uninstall.exe"
  RMDir "$LOCALAPPDATA\\Ashoka_MSO_Playlist"

  ; Clean registry
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Ashoka_MSO_Playlist"
  DeleteRegKey HKCU "Software\\Ashoka_MSO_Playlist"
SectionEnd
`.trim();
    fs.writeFileSync(uninstallerNsiPath, uninstallerNsi, 'utf8');
    await execFileAsync('makensis', [uninstallerNsiPath]);

    const uninstallExePath = path.join(buildDir, 'Uninstall.exe');
    if (fs.existsSync(uninstallExePath)) {
      cachedUninstallExeBuffer = fs.readFileSync(uninstallExePath);
    }
  } finally {
    isBuilding = false;
  }
}
