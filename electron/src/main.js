const { app, BrowserWindow, ipcMain, Menu, Notification, nativeTheme, shell, dialog } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');
const { setupPtyHandlers, killAll: killAllPty } = require('./pty-manager');

const store = new Store({
  defaults: {
    sidebarWidth: 260,
    sidebarVisible: true,
    theme: 'dark',
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', monospace",
    fontSize: 14,
    scrollback: 10000,
    cursorStyle: 'bar',
    cursorBlink: true,
    socketControl: 'cmux-only',
    newWorkspacePlacement: 'afterCurrent',
    workspaceAutoReorder: true,
    windowBounds: null,
  }
});

let mainWindow = null;
let socketServer = null;

function createWindow() {
  const savedBounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: savedBounds?.width || 1200,
    height: savedBounds?.height || 800,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.svg'),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('close', () => {
    store.set('windowBounds', mainWindow.getBounds());
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  setupPtyHandlers(mainWindow);
}

// Socket API
function startSocketServer() {
  const socketPath = path.join(os.tmpdir(), `cmux-${process.pid}.sock`);
  try { fs.unlinkSync(socketPath); } catch {}

  socketServer = net.createServer((connection) => {
    let buffer = '';
    connection.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        handleSocketCommand(line.trim(), connection);
      }
    });
  });

  socketServer.listen(socketPath, () => {
    fs.writeFileSync(path.join(os.tmpdir(), 'cmux-socket-path'), socketPath);
  });
  socketServer.on('error', (err) => console.error('Socket error:', err));
}

function handleSocketCommand(command, connection) {
  mainWindow?.webContents.send('socket-command', command);
  connection.write(JSON.stringify({ ok: true }) + '\n');
}

// IPC handlers
ipcMain.handle('store-get', (_, key) => store.get(key));
ipcMain.handle('store-set', (_, key, value) => { store.set(key, value); });
ipcMain.handle('store-get-all', () => store.store);

ipcMain.handle('get-shell', () => process.env.SHELL || '/bin/bash');
ipcMain.handle('get-home-dir', () => os.homedir());
ipcMain.handle('get-platform', () => process.platform);

ipcMain.handle('show-notification', (_, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
  return mainWindow?.isMaximized();
});
ipcMain.handle('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() || false);
ipcMain.handle('window-is-focused', () => mainWindow?.isFocused() || false);

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-theme', () => {
  const pref = store.get('theme');
  if (pref === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return pref;
});

nativeTheme.on('updated', () => {
  mainWindow?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});

// Menu
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 'Cmd' : 'Ctrl';

  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Workspace', accelerator: `${mod}+T`, click: () => mainWindow?.webContents.send('menu-action', 'new-workspace') },
        { label: 'Open Folder...', accelerator: `${mod}+O`, click: () => mainWindow?.webContents.send('menu-action', 'open-folder') },
        { type: 'separator' },
        { label: 'Split Right', accelerator: `${mod}+D`, click: () => mainWindow?.webContents.send('menu-action', 'split-right') },
        { label: 'Split Down', accelerator: `${mod}+Shift+D`, click: () => mainWindow?.webContents.send('menu-action', 'split-down') },
        { type: 'separator' },
        { label: 'Close Pane', accelerator: `${mod}+W`, click: () => mainWindow?.webContents.send('menu-action', 'close-pane') },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Copy', accelerator: `${mod}+Shift+C`, click: () => mainWindow?.webContents.send('menu-action', 'copy') },
        { label: 'Paste', accelerator: `${mod}+Shift+V`, click: () => mainWindow?.webContents.send('menu-action', 'paste') },
        { type: 'separator' },
        { label: 'Find', accelerator: `${mod}+F`, click: () => mainWindow?.webContents.send('menu-action', 'toggle-find') },
        { type: 'separator' },
        { label: 'Settings', accelerator: `${mod}+,`, click: () => mainWindow?.webContents.send('menu-action', 'open-settings') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: `${mod}+B`, click: () => mainWindow?.webContents.send('menu-action', 'toggle-sidebar') },
        { label: 'Notifications', accelerator: `${mod}+Shift+A`, click: () => mainWindow?.webContents.send('menu-action', 'toggle-notifications') },
        { type: 'separator' },
        { label: 'Next Workspace', accelerator: `${mod}+Shift+]`, click: () => mainWindow?.webContents.send('menu-action', 'next-workspace') },
        { label: 'Previous Workspace', accelerator: `${mod}+Shift+[`, click: () => mainWindow?.webContents.send('menu-action', 'prev-workspace') },
        { type: 'separator' },
        { label: 'Next Pane', accelerator: `${mod}+]`, click: () => mainWindow?.webContents.send('menu-action', 'next-pane') },
        { label: 'Previous Pane', accelerator: `${mod}+[`, click: () => mainWindow?.webContents.send('menu-action', 'prev-pane') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: `${mod}+=`, click: () => mainWindow?.webContents.send('menu-action', 'zoom-in') },
        { label: 'Zoom Out', accelerator: `${mod}+-`, click: () => mainWindow?.webContents.send('menu-action', 'zoom-out') },
        { label: 'Reset Zoom', accelerator: `${mod}+0`, click: () => mainWindow?.webContents.send('menu-action', 'zoom-reset') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Lifecycle
app.whenReady().then(() => {
  createWindow();
  buildMenu();
  startSocketServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  killAllPty();
  if (socketServer) {
    socketServer.close();
    try {
      const infoPath = path.join(os.tmpdir(), 'cmux-socket-path');
      const sp = fs.readFileSync(infoPath, 'utf8');
      fs.unlinkSync(sp);
      fs.unlinkSync(infoPath);
    } catch {}
  }
  app.quit();
});
