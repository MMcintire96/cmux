const { app, BrowserWindow, ipcMain, Menu, globalShortcut, Notification, nativeTheme, shell } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');
const { setupPtyHandlers, killAll: killAllPty } = require('./pty-manager');

const store = new Store({
  defaults: {
    sidebarWidth: 260,
    theme: 'system',
    fontFamily: 'monospace',
    fontSize: 14,
    socketControl: 'cmux-only',
    newWorkspacePlacement: 'afterCurrent',
    workspaceAutoReorder: true,
    sidebarActiveIndicator: 'leftRail',
    windowBounds: null,
    sessions: [],
    shortcuts: {
      toggleSidebar: 'CommandOrControl+B',
      newWorkspace: 'CommandOrControl+T',
      newWindow: 'CommandOrControl+Shift+N',
      showNotifications: 'CommandOrControl+Shift+A',
      splitRight: 'CommandOrControl+D',
      splitDown: 'CommandOrControl+Shift+D',
      nextWorkspace: 'CommandOrControl+Shift+]',
      prevWorkspace: 'CommandOrControl+Shift+[',
      closeWorkspace: 'CommandOrControl+W',
      find: 'CommandOrControl+F',
    }
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
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', () => {
    store.set('windowBounds', mainWindow.getBounds());
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Socket API for CLI control
function startSocketServer() {
  const socketPath = path.join(os.tmpdir(), `cmux-${process.pid}.sock`);

  // Clean up old socket
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
    // Write socket path so CLI can find it
    const infoPath = path.join(os.tmpdir(), 'cmux-socket-path');
    fs.writeFileSync(infoPath, socketPath);
  });

  socketServer.on('error', (err) => {
    console.error('Socket server error:', err);
  });
}

function handleSocketCommand(command, connection) {
  const parts = command.split(' ');
  const cmd = parts[0];
  const args = parts.slice(1);

  let response = { ok: true };

  switch (cmd) {
    case 'workspace.list':
      mainWindow?.webContents.send('socket-command', { cmd, args });
      break;
    case 'workspace.select':
      mainWindow?.webContents.send('socket-command', { cmd, args });
      break;
    case 'workspace.new':
      mainWindow?.webContents.send('socket-command', { cmd, args });
      break;
    case 'workspace.close':
      mainWindow?.webContents.send('socket-command', { cmd, args });
      break;
    case 'pane.split':
      mainWindow?.webContents.send('socket-command', { cmd, args });
      break;
    case 'notification.list':
      mainWindow?.webContents.send('socket-command', { cmd, args });
      break;
    case 'notification.send':
      mainWindow?.webContents.send('socket-command', { cmd, args });
      break;
    default:
      response = { ok: false, error: `Unknown command: ${cmd}` };
  }

  connection.write(JSON.stringify(response) + '\n');
}

// IPC Handlers
ipcMain.handle('store-get', (_, key) => store.get(key));
ipcMain.handle('store-set', (_, key, value) => store.set(key, value));

ipcMain.handle('get-shell', () => {
  return process.env.SHELL || '/bin/bash';
});

ipcMain.handle('get-home-dir', () => os.homedir());
ipcMain.handle('get-platform', () => process.platform);

ipcMain.handle('show-notification', (_, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized());

ipcMain.on('window-drag', () => {
  // Handled by CSS -webkit-app-region: drag
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  setupPtyHandlers(mainWindow);
  startSocketServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killAllPty();
  if (socketServer) {
    socketServer.close();
    try {
      const infoPath = path.join(os.tmpdir(), 'cmux-socket-path');
      const socketPath = fs.readFileSync(infoPath, 'utf8');
      fs.unlinkSync(socketPath);
      fs.unlinkSync(infoPath);
    } catch {}
  }
  app.quit();
});

// Build application menu
function buildMenu() {
  const template = [
    {
      label: 'cmux',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CommandOrControl+,',
          click: () => mainWindow?.webContents.send('open-settings'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Workspace',
          accelerator: store.get('shortcuts.newWorkspace'),
          click: () => mainWindow?.webContents.send('new-workspace'),
        },
        {
          label: 'New Window',
          accelerator: store.get('shortcuts.newWindow'),
          click: () => createWindow(),
        },
        { type: 'separator' },
        {
          label: 'Split Right',
          accelerator: store.get('shortcuts.splitRight'),
          click: () => mainWindow?.webContents.send('split-right'),
        },
        {
          label: 'Split Down',
          accelerator: store.get('shortcuts.splitDown'),
          click: () => mainWindow?.webContents.send('split-down'),
        },
        { type: 'separator' },
        {
          label: 'Close Workspace',
          accelerator: store.get('shortcuts.closeWorkspace'),
          click: () => mainWindow?.webContents.send('close-workspace'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: store.get('shortcuts.find'),
          click: () => mainWindow?.webContents.send('toggle-find'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: store.get('shortcuts.toggleSidebar'),
          click: () => mainWindow?.webContents.send('toggle-sidebar'),
        },
        {
          label: 'Notifications',
          accelerator: store.get('shortcuts.showNotifications'),
          click: () => mainWindow?.webContents.send('show-notifications'),
        },
        { type: 'separator' },
        {
          label: 'Next Workspace',
          accelerator: store.get('shortcuts.nextWorkspace'),
          click: () => mainWindow?.webContents.send('next-workspace'),
        },
        {
          label: 'Previous Workspace',
          accelerator: store.get('shortcuts.prevWorkspace'),
          click: () => mainWindow?.webContents.send('prev-workspace'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(buildMenu);

// Theme handling
ipcMain.handle('get-theme', () => {
  const pref = store.get('theme');
  if (pref === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return pref;
});

nativeTheme.on('updated', () => {
  mainWindow?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});
