using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AshokaBroadcastHost
{
    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        private const string StudioTitle = "ASHOKA MSO PLAYLIST 5.0 PRO";
        private const string BackendHealthUrl = "http://127.0.0.1:38550/api/health";
        private const string WebView2BootstrapperUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

        private static bool _isOutputMode = false;
        private static int _displayIndex = 2;
        private static string _fitMode = "fill";
        private static string _cleanFlag = "0";
        private static int _argLeft = 0;
        private static int _argTop = 0;
        private static int _argWidth = 0;
        private static int _argHeight = 0;
        private static bool _hasExplicitBounds = false;

        [STAThread]
        private static void Main(string[] args)
        {
            EnablePerMonitorDpi();
            ParseArguments(args);

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Mutex studioMutex = null;
            if (!_isOutputMode)
            {
                bool createdNew = false;
                try
                {
                    studioMutex = new Mutex(true, "Local\\Ashoka_MSO_Playlist_Studio_Win32", out createdNew);
                }
                catch
                {
                    createdNew = true;
                }

                if (!createdNew)
                {
                    FocusExistingStudioWindow();
                    return;
                }
            }

            string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
            if (string.IsNullOrEmpty(exeDir))
            {
                exeDir = AppDomain.CurrentDomain.BaseDirectory;
            }

            Form hostForm = CreateHostForm(exeDir);
            WebView2 webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.DefaultBackgroundColor = _isOutputMode ? Color.Black : Color.FromArgb(6, 8, 14);

            // Lazy notice label: created ONLY if WebView2 Runtime is missing and needs one-time setup
            Label setupNoticeLabel = null;
            Action<string> showEmergencyNotice = delegate(string msg)
            {
                try
                {
                    if (hostForm.IsDisposed) return;
                    if (setupNoticeLabel == null)
                    {
                        setupNoticeLabel = new Label();
                        setupNoticeLabel.Dock = DockStyle.Fill;
                        setupNoticeLabel.TextAlign = ContentAlignment.MiddleCenter;
                        setupNoticeLabel.ForeColor = Color.FromArgb(251, 191, 36);
                        setupNoticeLabel.BackColor = _isOutputMode ? Color.Black : Color.FromArgb(6, 8, 14);
                        setupNoticeLabel.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
                        hostForm.Controls.Add(setupNoticeLabel);
                    }
                    setupNoticeLabel.Text = msg;
                    setupNoticeLabel.Visible = true;
                    setupNoticeLabel.BringToFront();
                }
                catch { }
            };

            hostForm.Controls.Add(webView);
            webView.BringToFront();

            bool isFullscreenStudio = false;
            FormBorderStyle savedBorder = hostForm.FormBorderStyle;
            FormWindowState savedState = hostForm.WindowState;
            Rectangle savedBounds = hostForm.Bounds;

            Action toggleFullscreen = delegate()
            {
                if (_isOutputMode) return;
                if (!isFullscreenStudio)
                {
                    savedBorder = hostForm.FormBorderStyle;
                    savedState = hostForm.WindowState;
                    savedBounds = hostForm.Bounds;
                    hostForm.WindowState = FormWindowState.Normal;
                    hostForm.FormBorderStyle = FormBorderStyle.None;
                    hostForm.Bounds = Screen.FromControl(hostForm).Bounds;
                    isFullscreenStudio = true;
                }
                else
                {
                    hostForm.FormBorderStyle = savedBorder;
                    hostForm.Bounds = savedBounds;
                    hostForm.WindowState = savedState;
                    isFullscreenStudio = false;
                }
            };

            hostForm.KeyPreview = true;
            hostForm.KeyDown += delegate(object sender, KeyEventArgs e)
            {
                if (_isOutputMode && e.KeyCode == Keys.Escape)
                {
                    e.Handled = true;
                    hostForm.Close();
                }
                else if (!_isOutputMode && e.KeyCode == Keys.F11)
                {
                    e.Handled = true;
                    toggleFullscreen();
                }
            };

            webView.KeyDown += delegate(object sender, KeyEventArgs e)
            {
                if (_isOutputMode && e.KeyCode == Keys.Escape)
                {
                    e.Handled = true;
                    hostForm.Close();
                }
                else if (!_isOutputMode && e.KeyCode == Keys.F11)
                {
                    e.Handled = true;
                    toggleFullscreen();
                }
            };

            bool coreReady = false;
            bool backendCheckDone = false;
            bool backendIsUp = false;
            bool navigated = false;
            bool skipBackendShutdownOnClose = false;
            int initAttempt = 0;
            int navRetries = 0;
            System.Windows.Forms.Timer navRetryTimer = new System.Windows.Forms.Timer();
            navRetryTimer.Interval = 150;

            Action navigateToCurrentTarget = delegate()
            {
                try
                {
                    if (hostForm.IsDisposed || webView.CoreWebView2 == null) return;
                    string targetUrl = BuildTargetUrl(exeDir, backendIsUp || IsBackendHealthy());
                    webView.Source = new Uri(targetUrl);
                }
                catch { }
            };

            navRetryTimer.Tick += delegate(object ts, EventArgs te)
            {
                navRetryTimer.Stop();
                if (hostForm.IsDisposed || webView.CoreWebView2 == null) return;
                if (IsBackendHealthy())
                {
                    backendIsUp = true;
                    navigateToCurrentTarget();
                    return;
                }
                if (navRetries < 25)
                {
                    navRetries++;
                    navRetryTimer.Start();
                    return;
                }
                // Final offline HTML fallback if backend could not bind
                backendIsUp = false;
                navigateToCurrentTarget();
            };

            Action tryNavigate = delegate()
            {
                if (navigated || !coreReady || !backendCheckDone) return;
                navigated = true;
                navigateToCurrentTarget();
            };

            webView.CoreWebView2InitializationCompleted += delegate(object sender, CoreWebView2InitializationCompletedEventArgs initArgs)
            {
                if (!initArgs.IsSuccess)
                {
                    return;
                }

                CoreWebView2 core = webView.CoreWebView2;
                try { core.Settings.AreDefaultContextMenusEnabled = false; } catch { }
                try { core.Settings.IsStatusBarEnabled = false; } catch { }
                try { core.Settings.IsZoomControlEnabled = false; } catch { }
                try { core.Settings.IsBuiltInErrorPageEnabled = false; } catch { }
                try { core.Settings.AreDevToolsEnabled = false; } catch { }

                core.PermissionRequested += delegate(object ps, CoreWebView2PermissionRequestedEventArgs pArgs)
                {
                    try
                    {
                        pArgs.State = CoreWebView2PermissionState.Allow;
                        pArgs.SavesInProfile = true;
                    }
                    catch { }
                };

                core.WindowCloseRequested += delegate(object ws, object wArgs)
                {
                    try { hostForm.Close(); } catch { }
                };

                core.NewWindowRequested += delegate(object ns, CoreWebView2NewWindowRequestedEventArgs nwArgs)
                {
                    try
                    {
                        string uri = nwArgs.Uri ?? "";
                        if (uri.IndexOf("output=true", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            nwArgs.Handled = true;
                            LaunchOutputChildFromUri(uri);
                        }
                        else if (uri.StartsWith("http://127.0.0.1:38550", StringComparison.OrdinalIgnoreCase))
                        {
                            nwArgs.Handled = true;
                        }
                    }
                    catch { }
                };

                core.NavigationCompleted += delegate(object navS, CoreWebView2NavigationCompletedEventArgs navArgs)
                {
                    try
                    {
                        if (!navArgs.IsSuccess && navRetries < 25)
                        {
                            navRetries++;
                            navRetryTimer.Start();
                            return;
                        }
                        if (setupNoticeLabel != null)
                        {
                            setupNoticeLabel.Visible = false;
                        }
                        webView.BringToFront();
                        webView.Focus();
                    }
                    catch { }
                };

                coreReady = true;
                tryNavigate();
            };

            Action<string, string, bool> startWebViewOnSta = null;
            startWebViewOnSta = delegate(string browserFolder, string userDataDir, bool includeExtraFlags)
            {
                if (hostForm.IsDisposed) return;
                initAttempt++;
                try { Directory.CreateDirectory(userDataDir); } catch { }

                CoreWebView2EnvironmentOptions opts = null;
                if (includeExtraFlags)
                {
                    opts = new CoreWebView2EnvironmentOptions();
                    opts.AdditionalBrowserArguments =
                        "--autoplay-policy=no-user-gesture-required " +
                        "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies " +
                        "--disable-background-timer-throttling " +
                        "--disable-renderer-backgrounding " +
                        "--disable-backgrounding-occluded-windows";
                }

                try
                {
                    CoreWebView2Environment.CreateAsync(browserFolder, userDataDir, opts).ContinueWith(
                        delegate(Task<CoreWebView2Environment> envTask)
                        {
                            try
                            {
                                if (hostForm.IsDisposed) return;
                                hostForm.BeginInvoke((Action)delegate()
                                {
                                    if (hostForm.IsDisposed) return;
                                    if (!envTask.IsFaulted && envTask.Result != null)
                                    {
                                        try
                                        {
                                            webView.EnsureCoreWebView2Async(envTask.Result);
                                            return;
                                        }
                                        catch { }
                                    }

                                    // Attempt 2: Retry on STA UI thread with isolated clean profile while keeping autoplay/anti-throttling flags
                                    if (initAttempt == 1)
                                    {
                                        string localFolder = FindLocalWebView2Folder();
                                        string altDir = Path.Combine(
                                            Path.GetTempPath(),
                                            _isOutputMode ? ("Ashoka_WV2_Out_" + _displayIndex) : "Ashoka_WV2_Studio"
                                        );
                                        startWebViewOnSta(localFolder, altDir, true);
                                        return;
                                    }

                                    // Attempt 3: Silent WebView2 runtime bootstrapper install + STA retry
                                    if (initAttempt == 2)
                                    {
                                        showEmergencyNotice("Preparing Ashoka Native Broadcast Engine (one-time setup)...");
                                        ThreadPool.QueueUserWorkItem(delegate(object st)
                                        {
                                            string installedFolder = InstallWebView2Bootstrapper();
                                            try
                                            {
                                                if (!hostForm.IsDisposed)
                                                {
                                                    hostForm.BeginInvoke((Action)delegate()
                                                    {
                                                        if (hostForm.IsDisposed) return;
                                                        string primaryDir = Path.Combine(exeDir, "webview_data");
                                                        startWebViewOnSta(installedFolder, primaryDir, true);
                                                    });
                                                }
                                            }
                                            catch { }
                                        });
                                        return;
                                    }

                                    // Attempt 4 (Offline emergency fallback if system has zero WebView2 runtime):
                                    string fallbackUrl = BuildTargetUrl(exeDir, backendIsUp);
                                    if (TryLaunchStandaloneWindowFallback(fallbackUrl))
                                    {
                                        skipBackendShutdownOnClose = true;
                                        hostForm.Close();
                                        return;
                                    }

                                    string errDetail = "";
                                    try
                                    {
                                        if (envTask.Exception != null && envTask.Exception.GetBaseException() != null)
                                        {
                                            errDetail = "\r\n(" + envTask.Exception.GetBaseException().Message + ")";
                                        }
                                    }
                                    catch { }
                                    showEmergencyNotice("Unable to start Ashoka display engine. Please check internet for one-time Microsoft WebView2 setup." + errDetail);
                                });
                            }
                            catch { }
                        }
                    );
                }
                catch
                {
                    if (initAttempt == 1)
                    {
                        string localFolder = FindLocalWebView2Folder();
                        string altDir = Path.Combine(Path.GetTempPath(), _isOutputMode ? ("Ashoka_WV2_Out_" + _displayIndex) : "Ashoka_WV2_Studio");
                        startWebViewOnSta(localFolder, altDir, true);
                    }
                    else
                    {
                        string fallbackUrl = BuildTargetUrl(exeDir, backendIsUp);
                        if (TryLaunchStandaloneWindowFallback(fallbackUrl))
                        {
                            skipBackendShutdownOnClose = true;
                            hostForm.Close();
                        }
                    }
                }
            };

            hostForm.Shown += delegate(object sender, EventArgs e)
            {
                if (_isOutputMode)
                {
                    Rectangle r = ResolveOutputBounds();
                    SetWindowPos(hostForm.Handle, IntPtr.Zero, r.X, r.Y, r.Width, r.Height, 0x0040);
                }
                hostForm.Activate();

                // 1. Start local offline HTTP backend in parallel with zero blocking UI text
                ThreadPool.QueueUserWorkItem(delegate(object state)
                {
                    bool up = EnsureBackendRunning(exeDir);
                    try
                    {
                        if (!hostForm.IsDisposed)
                        {
                            hostForm.BeginInvoke((Action)delegate()
                            {
                                backendIsUp = up;
                                backendCheckDone = true;
                                tryNavigate();
                            });
                        }
                    }
                    catch { }
                });

                // 2. Initialize WebView2 immediately on the STA UI thread
                string initialBrowserFolder = FindLocalWebView2Folder();
                string primaryUserDataDir = Path.Combine(exeDir, "webview_data");
                startWebViewOnSta(initialBrowserFolder, primaryUserDataDir, true);
            };

            if (!_isOutputMode)
            {
                hostForm.FormClosing += delegate(object sender, FormClosingEventArgs e)
                {
                    navRetryTimer.Stop();
                    navRetryTimer.Dispose();
                    if (!skipBackendShutdownOnClose)
                    {
                        ShutdownChildOutputsAndBackend();
                    }
                };
            }

            Application.Run(hostForm);

            if (studioMutex != null)
            {
                try { studioMutex.ReleaseMutex(); } catch { }
                GC.KeepAlive(studioMutex);
            }
        }

        private static void EnablePerMonitorDpi()
        {
            try
            {
                if (!SetProcessDpiAwarenessContext(new IntPtr(-4)))
                {
                    SetProcessDpiAwarenessContext(new IntPtr(-3));
                }
            }
            catch
            {
                try { SetProcessDPIAware(); } catch { }
            }
        }

        private static void EnableDarkTitleBar(Form form)
        {
            try
            {
                int useDark = 1;
                // DWMWA_USE_IMMERSIVE_DARK_MODE = 20 (Win11 / Win10 20H1+), 19 (older Win10)
                if (DwmSetWindowAttribute(form.Handle, 20, ref useDark, 4) != 0)
                {
                    DwmSetWindowAttribute(form.Handle, 19, ref useDark, 4);
                }
            }
            catch { }
        }

        private static void ParseArguments(string[] args)
        {
            if (args == null) return;
            for (int i = 0; i < args.Length; i++)
            {
                string raw = args[i] ?? "";
                string lower = raw.ToLowerInvariant();
                if (lower == "--output")
                {
                    _isOutputMode = true;
                }
                else if (lower.StartsWith("--display="))
                {
                    int parsed;
                    if (int.TryParse(raw.Substring(10), out parsed) && parsed >= 1 && parsed <= 8)
                    {
                        _displayIndex = parsed;
                    }
                }
                else if (lower.StartsWith("--fit="))
                {
                    string f = raw.Substring(6).Trim().ToLowerInvariant();
                    _fitMode = (f == "contain") ? "contain" : "fill";
                }
                else if (lower.StartsWith("--clean="))
                {
                    string c = raw.Substring(8).Trim().ToLowerInvariant();
                    _cleanFlag = (c == "1" || c == "true") ? "1" : "0";
                }
                else if (lower.StartsWith("--left="))
                {
                    int v;
                    if (int.TryParse(raw.Substring(7), out v)) { _argLeft = v; _hasExplicitBounds = true; }
                }
                else if (lower.StartsWith("--top="))
                {
                    int v;
                    if (int.TryParse(raw.Substring(6), out v)) { _argTop = v; _hasExplicitBounds = true; }
                }
                else if (lower.StartsWith("--width="))
                {
                    int v;
                    if (int.TryParse(raw.Substring(8), out v) && v > 0) { _argWidth = v; _hasExplicitBounds = true; }
                }
                else if (lower.StartsWith("--height="))
                {
                    int v;
                    if (int.TryParse(raw.Substring(9), out v) && v > 0) { _argHeight = v; _hasExplicitBounds = true; }
                }
            }
        }

        private static void FocusExistingStudioWindow()
        {
            try
            {
                IntPtr hWnd = FindWindow(null, StudioTitle);
                if (hWnd == IntPtr.Zero)
                {
                    Process self = Process.GetCurrentProcess();
                    Process[] procs = Process.GetProcessesByName(self.ProcessName);
                    for (int i = 0; i < procs.Length; i++)
                    {
                        if (procs[i].Id == self.Id) continue;
                        if (procs[i].MainWindowHandle != IntPtr.Zero &&
                            procs[i].MainWindowTitle.IndexOf("DISPLAY", StringComparison.OrdinalIgnoreCase) < 0)
                        {
                            hWnd = procs[i].MainWindowHandle;
                            break;
                        }
                    }
                }
                if (hWnd != IntPtr.Zero)
                {
                    ShowWindow(hWnd, 9);
                    ShowWindow(hWnd, 3);
                    SetForegroundWindow(hWnd);
                }
            }
            catch { }
        }

        private static bool IsBackendHealthy()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(BackendHealthUrl);
                req.Method = "GET";
                req.Timeout = 400;
                req.ReadWriteTimeout = 400;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return ((int)resp.StatusCode >= 200 && (int)resp.StatusCode < 300);
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool EnsureBackendRunning(string exeDir)
        {
            if (IsBackendHealthy()) return true;

            string backendScript = Path.Combine(Path.Combine(exeDir, "app"), "offline_backend.ps1");
            if (!File.Exists(backendScript)) return false;

            try
            {
                string psExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell\\v1.0\\powershell.exe");
                if (!File.Exists(psExe)) psExe = "powershell.exe";

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = psExe;
                psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + backendScript + "\"";
                psi.WorkingDirectory = exeDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                Process proc = Process.Start(psi);
                for (int i = 0; i < 65; i++)
                {
                    Thread.Sleep(35);
                    if (IsBackendHealthy()) return true;
                    if (proc != null && proc.HasExited && IsBackendHealthy()) return true;
                }
            }
            catch { }

            return IsBackendHealthy();
        }

        private static string BuildTargetUrl(string exeDir, bool backendUp)
        {
            if (backendUp)
            {
                if (_isOutputMode)
                {
                    return "http://127.0.0.1:38550/?output=true&kiosk=1&display=" + _displayIndex + "&fit=" + _fitMode + "&clean=" + _cleanFlag;
                }
                return "http://127.0.0.1:38550/?desktop=1";
            }

            string indexPath = Path.Combine(Path.Combine(exeDir, "app"), "index.html");
            string fileUri = new Uri(indexPath).AbsoluteUri;
            if (_isOutputMode)
            {
                return fileUri + "?output=true&kiosk=1&display=" + _displayIndex + "&fit=" + _fitMode + "&clean=" + _cleanFlag;
            }
            return fileUri + "?desktop=1";
        }

        private static Rectangle ResolveOutputBounds()
        {
            try
            {
                Screen[] screens = Screen.AllScreens;
                if (screens != null && screens.Length > 0)
                {
                    int idx = Math.Max(0, Math.Min(screens.Length - 1, _displayIndex - 1));
                    return screens[idx].Bounds;
                }
            }
            catch { }

            if (_hasExplicitBounds && _argWidth > 0 && _argHeight > 0)
            {
                return new Rectangle(_argLeft, _argTop, _argWidth, _argHeight);
            }
            return new Rectangle(0, 0, 1920, 1080);
        }

        private static Form CreateHostForm(string exeDir)
        {
            Form form = new Form();
            try
            {
                string icoPath = Path.Combine(Path.Combine(Path.Combine(exeDir, "app"), "assets"), "ashoka-icon.ico");
                if (File.Exists(icoPath))
                {
                    form.Icon = new Icon(icoPath);
                }
                else
                {
                    form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                }
            }
            catch { }

            if (_isOutputMode)
            {
                Rectangle bounds = ResolveOutputBounds();
                form.Text = "ASHOKA DISPLAY " + _displayIndex + " OUTPUT";
                form.FormBorderStyle = FormBorderStyle.None;
                form.StartPosition = FormStartPosition.Manual;
                form.Bounds = bounds;
                form.BackColor = Color.Black;
                form.ShowInTaskbar = true;
            }
            else
            {
                form.Text = StudioTitle;
                form.MinimumSize = new Size(1024, 640);
                form.StartPosition = FormStartPosition.CenterScreen;
                form.WindowState = FormWindowState.Maximized;
                form.BackColor = Color.FromArgb(6, 8, 14);
                EnableDarkTitleBar(form);
            }

            return form;
        }

        private static string FindLocalWebView2Folder()
        {
            try
            {
                string ver = CoreWebView2Environment.GetAvailableBrowserVersionString(null);
                if (!string.IsNullOrEmpty(ver)) return null;
            }
            catch { }

            string[] roots = new string[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
            };

            string[] subNames = new string[]
            {
                "Microsoft\\EdgeWebView\\Application",
                "Microsoft\\EdgeCore"
            };

            for (int s = 0; s < subNames.Length; s++)
            {
                for (int r = 0; r < roots.Length; r++)
                {
                    if (string.IsNullOrEmpty(roots[r])) continue;
                    string appRoot = Path.Combine(roots[r], subNames[s]);
                    if (!Directory.Exists(appRoot)) continue;
                    try
                    {
                        string[] dirs = Directory.GetDirectories(appRoot);
                        for (int d = dirs.Length - 1; d >= 0; d--)
                        {
                            if (File.Exists(Path.Combine(dirs[d], "msedgewebview2.exe")))
                            {
                                return dirs[d];
                            }
                        }
                    }
                    catch { }
                }
            }
            return null;
        }

        private static string InstallWebView2Bootstrapper()
        {
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
                string setupPath = Path.Combine(Path.GetTempPath(), "AshokaWebView2Setup.exe");
                using (WebClient wc = new WebClient())
                {
                    wc.DownloadFile(WebView2BootstrapperUrl, setupPath);
                }
                if (File.Exists(setupPath))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = setupPath;
                    psi.Arguments = "/silent /install";
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    Process p = Process.Start(psi);
                    if (p != null)
                    {
                        p.WaitForExit(120000);
                    }
                    try { File.Delete(setupPath); } catch { }
                }
            }
            catch { }

            return FindLocalWebView2Folder();
        }

        private static bool TryLaunchStandaloneWindowFallback(string targetUrl)
        {
            string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
            string profileDir = Path.Combine(exeDir ?? Path.GetTempPath(), _isOutputMode ? ("profile_out_" + _displayIndex) : "profile");
            try { Directory.CreateDirectory(profileDir); } catch { }

            string pfX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candidates = new string[]
            {
                Path.Combine(pf, "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(pfX86, "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(localApp, "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(pfX86, "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(localApp, "Microsoft\\Edge\\Application\\msedge.exe")
            };

            for (int i = 0; i < candidates.Length; i++)
            {
                if (string.IsNullOrEmpty(candidates[i]) || !File.Exists(candidates[i])) continue;
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = candidates[i];
                    if (_isOutputMode)
                    {
                        Rectangle r = ResolveOutputBounds();
                        psi.Arguments = "--new-window --user-data-dir=\"" + profileDir + "\" --kiosk \"" + targetUrl + "\" --window-position=" + r.X + "," + r.Y + " --window-size=" + r.Width + "," + r.Height + " --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required";
                    }
                    else
                    {
                        psi.Arguments = "--new-window --user-data-dir=\"" + profileDir + "\" --app=\"" + targetUrl + "\" --start-maximized --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required";
                    }
                    psi.UseShellExecute = false;
                    Process p = Process.Start(psi);
                    if (p != null) return true;
                }
                catch { }
            }
            return false;
        }

        private static void LaunchOutputChildFromUri(string uri)
        {
            try
            {
                int d = 2;
                string f = "fill";
                string c = "0";
                string q = "";
                int qIdx = uri.IndexOf('?');
                if (qIdx >= 0) q = uri.Substring(qIdx + 1);
                string[] parts = q.Split('&');
                for (int i = 0; i < parts.Length; i++)
                {
                    string[] kv = parts[i].Split('=');
                    if (kv.Length != 2) continue;
                    string k = kv[0].Trim().ToLowerInvariant();
                    string v = kv[1].Trim().ToLowerInvariant();
                    if (k == "display")
                    {
                        int dv;
                        if (int.TryParse(v, out dv) && dv >= 1 && dv <= 8) d = dv;
                    }
                    else if (k == "fit")
                    {
                        f = (v == "contain") ? "contain" : "fill";
                    }
                    else if (k == "clean")
                    {
                        c = (v == "1" || v == "true") ? "1" : "0";
                    }
                }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = Application.ExecutablePath;
                psi.Arguments = "--output --display=" + d + " --fit=" + f + " --clean=" + c;
                psi.WorkingDirectory = Path.GetDirectoryName(Application.ExecutablePath);
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            catch { }
        }

        private static void ShutdownChildOutputsAndBackend()
        {
            try
            {
                Process self = Process.GetCurrentProcess();
                Process[] peers = Process.GetProcessesByName(self.ProcessName);
                for (int i = 0; i < peers.Length; i++)
                {
                    if (peers[i].Id != self.Id)
                    {
                        try { peers[i].Kill(); } catch { }
                    }
                }
            }
            catch { }

            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:38550/api/app/exit");
                req.Method = "POST";
                req.Timeout = 400;
                req.ReadWriteTimeout = 400;
                req.ContentLength = 0;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) { }
            }
            catch { }
        }
    }
}
