const { app, BrowserWindow } = require("electron");
// Booted as a bare script there is no package.json, so Electron would resolve
// userData to %APPDATA%\Electron — a FRESH profile (empty engine cache,
// onboarding) that does not reflect the real app. Pin it to the real one.
app.setName("MultiZen");
app.setPath("userData", require("node:path").join(app.getPath("appData"), "MultiZen"));
app.whenReady().then(() => {
  const poll = setInterval(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) { console.log("t: no window yet"); return; }
    console.log("t+" + Date.now() % 100000, JSON.stringify({
      visible: win.isVisible(),
      ready: true,
      maximized: win.isMaximized(),
      minimized: win.isMinimized(),
    }));
  }, 2000);
  setTimeout(async () => {
    clearInterval(poll);
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      const img = await win.webContents.capturePage();
      require("node:fs").writeFileSync(process.argv[2], img.toPNG());
      console.log("captured");
    }
    app.exit(0);
  }, 16000);
});
import("./out/main/index.js").catch((e) => { console.error(e); app.exit(1); });
