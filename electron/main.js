const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

// Calories Electron — thin wrapper around the live deployment.
// The "app" is just a dedicated browser window pointed at the production URL,
// so your data, login, and everything else stay in sync with the website + phone.
//
// Set CALORIES_URL in your environment to override the default URL.
const CALORIES_URL = process.env.CALORIES_URL || 'https://calories.coolvps.net';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 360,
    minHeight: 600,
    title: 'Calories',
    autoHideMenuBar: true,
    backgroundColor: '#0e1116',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Persist cookies/session in a named partition so Discord login survives restarts
      partition: 'persist:calories'
    }
  });

  Menu.setApplicationMenu(null);

  // Discord OAuth (and any external links) opens in the user's real browser, not in our window.
  // That keeps the Discord auth flow working — Discord refuses to authenticate inside
  // embedded/iframe-style browser sessions.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const u = new URL(url);
    const hostHere = new URL(CALORIES_URL).host;
    if (u.host === hostHere) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Intercept top-level navigations that leave our domain (e.g. clicking a Discord login link)
  // and send them to the external browser. After Discord auth completes, the browser redirects
  // back to https://calories.coolvps.net/... — the Electron window picks up the session via cookie.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const u = new URL(url);
    const hostHere = new URL(CALORIES_URL).host;
    if (u.host !== hostHere) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadURL(CALORIES_URL);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
