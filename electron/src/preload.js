const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

// Load xterm and addons from node_modules (available in preload context)
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { SearchAddon } = require('@xterm/addon-search');
const { WebLinksAddon } = require('@xterm/addon-web-links');

contextBridge.exposeInMainWorld('cmux', {
  // Store
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),

  // System
  getShell: () => ipcRenderer.invoke('get-shell'),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Notifications
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (_, theme) => callback(theme)),

  // Events from main process
  on: (channel, callback) => {
    const validChannels = [
      'new-workspace', 'close-workspace', 'split-right', 'split-down',
      'toggle-sidebar', 'show-notifications', 'next-workspace', 'prev-workspace',
      'toggle-find', 'open-settings', 'socket-command', 'theme-changed',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});

// Expose node-pty through IPC for terminal
contextBridge.exposeInMainWorld('pty', {
  spawn: (opts) => ipcRenderer.invoke('pty-spawn', opts),
  write: (id, data) => ipcRenderer.send('pty-write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty-resize', id, cols, rows),
  kill: (id) => ipcRenderer.send('pty-kill', id),
  onData: (callback) => ipcRenderer.on('pty-data', (_, id, data) => callback(id, data)),
  onExit: (callback) => ipcRenderer.on('pty-exit', (_, id, code) => callback(id, code)),
  getCwd: (id) => ipcRenderer.invoke('pty-get-cwd', id),
});

// Terminal instances live in preload scope (contextBridge can't pass live objects)
const terminalInstances = new Map();

contextBridge.exposeInMainWorld('terminalApi', {
  create: (opts) => {
    const term = new Terminal(opts);
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);

    const id = `term-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    terminalInstances.set(id, { term, fitAddon, searchAddon, webLinksAddon });
    return id;
  },

  open: (id, selector) => {
    const inst = terminalInstances.get(id);
    if (!inst) return;
    // selector can be a CSS selector string; we look up the element in the DOM
    const element = document.querySelector(selector);
    if (element) inst.term.open(element);
  },

  write: (id, data) => {
    const inst = terminalInstances.get(id);
    if (inst) inst.term.write(data);
  },

  fit: (id) => {
    const inst = terminalInstances.get(id);
    if (inst) {
      inst.fitAddon.fit();
      return { cols: inst.term.cols, rows: inst.term.rows };
    }
    return null;
  },

  onData: (id, callback) => {
    const inst = terminalInstances.get(id);
    if (inst) inst.term.onData(callback);
  },

  focus: (id) => {
    const inst = terminalInstances.get(id);
    if (inst) inst.term.focus();
  },

  dispose: (id) => {
    const inst = terminalInstances.get(id);
    if (inst) {
      inst.term.dispose();
      terminalInstances.delete(id);
    }
  },

  getDimensions: (id) => {
    const inst = terminalInstances.get(id);
    if (inst) return { cols: inst.term.cols, rows: inst.term.rows };
    return null;
  },

  findNext: (id, query) => {
    const inst = terminalInstances.get(id);
    if (inst && query) return inst.searchAddon.findNext(query);
    return false;
  },

  findPrevious: (id, query) => {
    const inst = terminalInstances.get(id);
    if (inst && query) return inst.searchAddon.findPrevious(query);
    return false;
  },
});
