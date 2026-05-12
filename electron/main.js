const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');

const APP_ROOT = path.join(__dirname, '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.end(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) return reject(new Error('Server did not start in time'));
        setTimeout(tryConnect, 100);
      });
    };
    tryConnect();
  });
}

async function startEmbeddedServer() {
  const port = await getFreePort();
  process.env.PORT = String(port);

  const dataDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(APP_ROOT, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  process.env.CALORIES_DATA_DIR = dataDir;

  const envPath = app.isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.join(APP_ROOT, '.env');
  require('dotenv').config({ path: envPath });

  require(path.join(APP_ROOT, 'server.js'));

  await waitForServer(port);
  return port;
}

let mainWindow;

async function createWindow() {
  const port = await startEmbeddedServer();

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 360,
    minHeight: 600,
    title: 'Calories',
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(createWindow).catch((err) => {
  console.error('Failed to start:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
