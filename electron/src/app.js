// cmux - Electron renderer process
// All UI logic lives here. We use nodeIntegration so we can require() directly.

const { ipcRenderer, clipboard } = require('electron');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { SearchAddon } = require('@xterm/addon-search');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Helpers ───────────────────────────────────────────────────────────────────

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function formatTimeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortenPath(p) {
  const home = os.homedir();
  return p ? p.replace(home, '~') : '~';
}

function getGitBranch(cwd) {
  try {
    let headPath = path.join(cwd, '.git', 'HEAD');
    const gitPath = path.join(cwd, '.git');
    const stat = fs.lstatSync(gitPath);
    if (stat.isFile()) {
      const content = fs.readFileSync(gitPath, 'utf8').trim();
      const m = content.match(/^gitdir:\s*(.+)/);
      if (m) headPath = path.join(path.resolve(cwd, m[1]), 'HEAD');
    }
    if (!fs.existsSync(headPath)) return null;
    const ref = fs.readFileSync(headPath, 'utf8').trim();
    const bm = ref.match(/^ref:\s*refs\/heads\/(.+)/);
    return bm ? bm[1] : ref.slice(0, 8);
  } catch { return null; }
}

function getPtyCwd(pid) {
  try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return null; }
}

// ─── State ─────────────────────────────────────────────────────────────────────

const state = {
  workspaces: [],
  activeWorkspaceId: null,
  notifications: [],
  nextWorkspaceNum: 1,
  nextPaneNum: 1,
  sidebarVisible: true,
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', monospace",
};

// ─── Terminal Theme ────────────────────────────────────────────────────────────

const TERM_THEME = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: 'rgba(0, 145, 255, 0.3)',
  selectionForeground: '#cdd6f4',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
};

// ─── Pane Management ───────────────────────────────────────────────────────────

function createPane(container, opts = {}) {
  const paneId = `pane-${state.nextPaneNum++}`;
  const cwd = opts.cwd || os.homedir();

  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: state.fontSize,
    fontFamily: state.fontFamily,
    theme: TERM_THEME,
    allowTransparency: true,
    scrollback: 10000,
    drawBoldTextInBrightColors: true,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const webLinksAddon = new WebLinksAddon((e, uri) => {
    require('electron').shell.openExternal(uri);
  });
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(webLinksAddon);

  // Build DOM
  const paneEl = document.createElement('div');
  paneEl.className = 'pane';
  paneEl.dataset.paneId = paneId;

  const header = document.createElement('div');
  header.className = 'pane-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'pane-title';
  titleEl.innerHTML = `<span class="pane-cwd">${escapeHtml(shortenPath(cwd))}</span><span class="pane-branch"></span>`;

  const actions = document.createElement('div');
  actions.className = 'pane-actions';
  actions.innerHTML = `
    <button class="pane-action-btn" data-action="split-right" title="Split Right (Ctrl+D)">⫿</button>
    <button class="pane-action-btn" data-action="split-down" title="Split Down (Ctrl+Shift+D)">⫠</button>
    <button class="pane-action-btn" data-action="close" title="Close (Ctrl+W)">✕</button>
  `;

  header.appendChild(titleEl);
  header.appendChild(actions);

  const termEl = document.createElement('div');
  termEl.className = 'pane-terminal';

  paneEl.appendChild(header);
  paneEl.appendChild(termEl);
  container.appendChild(paneEl);

  term.open(termEl);
  requestAnimationFrame(() => { try { fitAddon.fit(); } catch {} });

  // Spawn PTY
  const shell = process.env.SHELL || '/bin/bash';
  const ptyResult = ipcRenderer.sendSync
    ? null : null; // we use async

  const pane = {
    id: paneId,
    ptyId: null,
    pid: null,
    term,
    fitAddon,
    searchAddon,
    element: paneEl,
    termEl,
    cwd,
    branch: null,
    cwdPoller: null,
    resizeObserver: null,
    workspaceId: opts.workspaceId || null,
  };

  // Async PTY spawn
  ipcRenderer.invoke('pty-spawn', {
    shell,
    cwd,
    cols: term.cols || 80,
    rows: term.rows || 24,
  }).then(result => {
    if (result.error) {
      term.write(`\r\n\x1b[31mError: ${result.error}\x1b[0m\r\n`);
      return;
    }
    pane.ptyId = result.id;
    pane.pid = result.pid;

    // Terminal -> PTY
    term.onData(data => ipcRenderer.send('pty-write', result.id, data));

    // Resize
    pane.resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        ipcRenderer.send('pty-resize', result.id, term.cols, term.rows);
      } catch {}
    });
    pane.resizeObserver.observe(termEl);

    // CWD polling
    pane.cwdPoller = setInterval(() => {
      if (!pane.pid) return;
      const newCwd = getPtyCwd(pane.pid);
      if (newCwd && newCwd !== pane.cwd) {
        pane.cwd = newCwd;
        const cwdEl = paneEl.querySelector('.pane-cwd');
        if (cwdEl) cwdEl.textContent = shortenPath(newCwd);

        // Update workspace cwd
        const ws = state.workspaces.find(w => w.id === pane.workspaceId);
        if (ws) { ws.cwd = newCwd; renderSidebar(); }
      }
      const branch = newCwd ? getGitBranch(newCwd) : null;
      if (branch !== pane.branch) {
        pane.branch = branch;
        const branchEl = paneEl.querySelector('.pane-branch');
        if (branchEl) branchEl.textContent = branch ? `  ${branch}` : '';
        const ws = state.workspaces.find(w => w.id === pane.workspaceId);
        if (ws) { ws.branch = branch; renderSidebar(); }
      }
    }, 2000);

    fitAddon.fit();
    ipcRenderer.send('pty-resize', result.id, term.cols, term.rows);
  });

  // Focus handling
  paneEl.addEventListener('mousedown', () => focusPane(paneId));
  term.onFocus = undefined; // not a real event in xterm
  term.textarea?.addEventListener('focus', () => focusPane(paneId));

  // Pane header actions
  actions.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;
    if (action === 'close') closePane(paneId);
    else if (action === 'split-right') splitPane(paneId, 'vertical');
    else if (action === 'split-down') splitPane(paneId, 'horizontal');
  });

  return pane;
}

// PTY data handler (from main process)
ipcRenderer.on('pty-data', (_, ptyId, data) => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  for (const pane of ws.panes) {
    if (pane.ptyId === ptyId) {
      pane.term.write(data);

      // Bell / notification detection
      if (data.includes('\x07') || data.includes('\x1b]777;notify;')) {
        const paneWs = state.workspaces.find(w => w.panes.some(p => p.ptyId === ptyId));
        if (paneWs && paneWs.id !== state.activeWorkspaceId) {
          paneWs.hasNotification = true;
          addNotification({
            title: paneWs.name,
            body: 'Terminal requires attention',
            workspaceId: paneWs.id,
          });
          renderSidebar();
        }
      }
      return;
    }
  }
  // Check all workspaces (background panes)
  for (const ws of state.workspaces) {
    for (const pane of ws.panes) {
      if (pane.ptyId === ptyId) {
        pane.term.write(data);
        if (data.includes('\x07') && ws.id !== state.activeWorkspaceId) {
          ws.hasNotification = true;
          addNotification({ title: ws.name, body: 'Terminal bell', workspaceId: ws.id });
          renderSidebar();
        }
        return;
      }
    }
  }
});

// PTY exit handler
ipcRenderer.on('pty-exit', (_, ptyId, code) => {
  for (const ws of state.workspaces) {
    const pane = ws.panes.find(p => p.ptyId === ptyId);
    if (pane) {
      closePane(pane.id);
      return;
    }
  }
});

function findPaneById(id) {
  for (const ws of state.workspaces) {
    const p = ws.panes.find(p => p.id === id);
    if (p) return { pane: p, workspace: ws };
  }
  return null;
}

function getFocusedPane() {
  const ws = getActiveWorkspace();
  if (!ws) return null;
  return ws.panes.find(p => p.element.classList.contains('focused')) || ws.panes[0] || null;
}

function focusPane(paneId) {
  const ws = getActiveWorkspace();
  if (!ws) return;
  for (const p of ws.panes) {
    p.element.classList.toggle('focused', p.id === paneId);
  }
  const target = ws.panes.find(p => p.id === paneId);
  if (target) {
    target.term.focus();
    // Update titlebar
    const title = `cmux — ${shortenPath(target.cwd)}${target.branch ? ` (${target.branch})` : ''}`;
    $('#titlebar-title').textContent = title;
  }
}

function closePane(paneId) {
  const found = findPaneById(paneId);
  if (!found) return;
  const { pane, workspace } = found;

  // Cleanup
  if (pane.cwdPoller) clearInterval(pane.cwdPoller);
  if (pane.resizeObserver) pane.resizeObserver.disconnect();
  pane.term.dispose();
  if (pane.ptyId) ipcRenderer.send('pty-kill', pane.ptyId);

  // Remove from split container if needed
  const parent = pane.element.parentElement;
  pane.element.remove();
  if (parent && parent.classList.contains('split-container')) {
    const children = [...parent.children].filter(el => !el.classList.contains('split-handle'));
    // Remove handles
    parent.querySelectorAll('.split-handle').forEach(h => h.remove());
    if (children.length === 1) {
      // Unwrap: promote the remaining child
      const remaining = children[0];
      parent.replaceWith(remaining);
    }
  }

  workspace.panes = workspace.panes.filter(p => p.id !== paneId);

  // If workspace has no panes left, remove it
  if (workspace.panes.length === 0) {
    removeWorkspace(workspace.id);
  } else {
    // Focus another pane
    focusPane(workspace.panes[workspace.panes.length - 1].id);
  }
}

function splitPane(paneId, direction) {
  const found = findPaneById(paneId);
  if (!found) return;
  const { pane, workspace } = found;

  const container = document.createElement('div');
  container.className = `split-container ${direction}`;

  const handle = document.createElement('div');
  handle.className = `split-handle ${direction}`;

  pane.element.replaceWith(container);
  container.appendChild(pane.element);
  container.appendChild(handle);

  const newPane = createPane(container, { cwd: pane.cwd, workspaceId: workspace.id });
  workspace.panes.push(newPane);

  setupSplitResize(handle, container, direction, workspace);
  requestAnimationFrame(() => {
    try { pane.fitAddon.fit(); } catch {}
    if (pane.ptyId) ipcRenderer.send('pty-resize', pane.ptyId, pane.term.cols, pane.term.rows);
  });
}

function setupSplitResize(handle, container, direction, workspace) {
  let startPos, startFractions;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    handle.classList.add('dragging');
    document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
    startPos = direction === 'vertical' ? e.clientX : e.clientY;

    const children = [...container.children].filter(el => !el.classList.contains('split-handle'));
    const total = direction === 'vertical' ? container.offsetWidth : container.offsetHeight;
    startFractions = children.map(el => (direction === 'vertical' ? el.offsetWidth : el.offsetHeight) / total);

    const onMove = e => {
      const pos = direction === 'vertical' ? e.clientX : e.clientY;
      const total = direction === 'vertical' ? container.offsetWidth : container.offsetHeight;
      const delta = (pos - startPos) / total;
      const f0 = Math.max(0.1, Math.min(0.9, startFractions[0] + delta));

      const children = [...container.children].filter(el => !el.classList.contains('split-handle'));
      if (children[0]) children[0].style.flex = `${f0} 1 0%`;
      if (children[1]) children[1].style.flex = `${1 - f0} 1 0%`;

      for (const p of workspace.panes) {
        try { p.fitAddon.fit(); } catch {}
        if (p.ptyId) try { ipcRenderer.send('pty-resize', p.ptyId, p.term.cols, p.term.rows); } catch {}
      }
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── Workspace Management ──────────────────────────────────────────────────────

function createWorkspace(opts = {}) {
  const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ws = {
    id,
    name: opts.name || `Workspace ${state.nextWorkspaceNum++}`,
    cwd: opts.cwd || os.homedir(),
    branch: null,
    panes: [],
    hasNotification: false,
    pinned: false,
    container: null,
  };

  // Insertion position
  const placement = opts.placement || 'afterCurrent';
  let idx = state.workspaces.length;
  if (placement === 'afterCurrent' && state.activeWorkspaceId) {
    const ci = state.workspaces.findIndex(w => w.id === state.activeWorkspaceId);
    if (ci >= 0) idx = ci + 1;
  } else if (placement === 'top') {
    idx = state.workspaces.filter(w => w.pinned).length;
  }

  state.workspaces.splice(idx, 0, ws);

  // Build container
  const container = document.createElement('div');
  container.className = 'workspace-root';
  container.dataset.workspaceId = id;
  ws.container = container;

  // Create initial pane
  const pane = createPane(container, { cwd: ws.cwd, workspaceId: id });
  ws.panes.push(pane);

  selectWorkspace(id);
  return ws;
}

function removeWorkspace(id) {
  const idx = state.workspaces.findIndex(w => w.id === id);
  if (idx < 0) return;
  const ws = state.workspaces[idx];

  // Kill all panes
  for (const pane of [...ws.panes]) {
    if (pane.cwdPoller) clearInterval(pane.cwdPoller);
    if (pane.resizeObserver) pane.resizeObserver.disconnect();
    pane.term.dispose();
    if (pane.ptyId) ipcRenderer.send('pty-kill', pane.ptyId);
  }
  ws.container?.remove();
  state.workspaces.splice(idx, 1);

  if (state.activeWorkspaceId === id) {
    if (state.workspaces.length > 0) {
      const newIdx = Math.min(idx, state.workspaces.length - 1);
      selectWorkspace(state.workspaces[newIdx].id);
    } else {
      state.activeWorkspaceId = null;
      createWorkspace();
    }
  }
  renderSidebar();
}

function selectWorkspace(id) {
  const ws = state.workspaces.find(w => w.id === id);
  if (!ws) return;

  state.activeWorkspaceId = id;
  ws.hasNotification = false;

  // Show/hide containers
  const paneContainer = $('#pane-container');
  for (const w of state.workspaces) {
    if (w.container) {
      if (w.id === id) {
        if (!w.container.parentElement) paneContainer.appendChild(w.container);
        w.container.style.display = 'flex';
      } else {
        w.container.style.display = 'none';
      }
    }
  }

  // Refit panes and focus
  requestAnimationFrame(() => {
    for (const pane of ws.panes) {
      try { pane.fitAddon.fit(); } catch {}
      if (pane.ptyId) try { ipcRenderer.send('pty-resize', pane.ptyId, pane.term.cols, pane.term.rows); } catch {}
    }
    if (ws.panes.length > 0) {
      const focused = ws.panes.find(p => p.element.classList.contains('focused')) || ws.panes[0];
      focusPane(focused.id);
    }
  });

  renderSidebar();
}

function getActiveWorkspace() {
  return state.workspaces.find(w => w.id === state.activeWorkspaceId) || null;
}

function selectNextWorkspace() {
  if (state.workspaces.length <= 1) return;
  const idx = state.workspaces.findIndex(w => w.id === state.activeWorkspaceId);
  selectWorkspace(state.workspaces[(idx + 1) % state.workspaces.length].id);
}

function selectPrevWorkspace() {
  if (state.workspaces.length <= 1) return;
  const idx = state.workspaces.findIndex(w => w.id === state.activeWorkspaceId);
  selectWorkspace(state.workspaces[(idx - 1 + state.workspaces.length) % state.workspaces.length].id);
}

function nextPane() {
  const ws = getActiveWorkspace();
  if (!ws || ws.panes.length <= 1) return;
  const focused = getFocusedPane();
  const idx = ws.panes.indexOf(focused);
  focusPane(ws.panes[(idx + 1) % ws.panes.length].id);
}

function prevPane() {
  const ws = getActiveWorkspace();
  if (!ws || ws.panes.length <= 1) return;
  const focused = getFocusedPane();
  const idx = ws.panes.indexOf(focused);
  focusPane(ws.panes[(idx - 1 + ws.panes.length) % ws.panes.length].id);
}

// ─── Sidebar Rendering ─────────────────────────────────────────────────────────

function renderSidebar() {
  const list = $('#workspace-list');
  list.innerHTML = '';

  for (let i = 0; i < state.workspaces.length; i++) {
    const ws = state.workspaces[i];
    const el = document.createElement('div');
    el.className = 'workspace-item';
    el.dataset.workspaceId = ws.id;
    el.dataset.index = i;
    el.draggable = true;

    if (ws.id === state.activeWorkspaceId) el.classList.add('active');
    if (ws.hasNotification) el.classList.add('has-notification');
    if (ws.pinned) el.classList.add('pinned');

    el.innerHTML = `
      <div class="workspace-notification-ring"></div>
      <div class="workspace-info">
        <div class="workspace-name">${escapeHtml(ws.name)}</div>
        <div class="workspace-meta">
          ${ws.branch ? `<span class="workspace-branch"> ${escapeHtml(ws.branch)}</span>` : ''}
          <span class="workspace-dir">${escapeHtml(shortenPath(ws.cwd))}</span>
        </div>
      </div>
      <button class="workspace-close" title="Close workspace">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </button>
    `;

    // Click = select
    el.addEventListener('click', e => {
      if (e.target.closest('.workspace-close')) return;
      selectWorkspace(ws.id);
    });

    // Close button
    el.querySelector('.workspace-close').addEventListener('click', e => {
      e.stopPropagation();
      removeWorkspace(ws.id);
    });

    // Double click = rename
    el.addEventListener('dblclick', e => {
      if (e.target.closest('.workspace-close')) return;
      startRename(ws.id, el);
    });

    // Right click context menu
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      showContextMenu(e, ws);
    });

    // Drag
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', i.toString());
      e.dataTransfer.effectAllowed = 'move';
      el.style.opacity = '0.4';
    });
    el.addEventListener('dragend', () => { el.style.opacity = ''; });
    el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('drop', e => {
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = i;
      if (fromIdx !== toIdx && !isNaN(fromIdx)) {
        const [moved] = state.workspaces.splice(fromIdx, 1);
        state.workspaces.splice(toIdx, 0, moved);
        renderSidebar();
      }
    });

    list.appendChild(el);
  }

  // Update notification badge
  const unread = state.notifications.filter(n => !n.read).length;
  const badge = $('#notification-badge');
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.classList.remove('badge-hidden');
  } else {
    badge.classList.add('badge-hidden');
  }
}

function startRename(wsId, el) {
  const ws = state.workspaces.find(w => w.id === wsId);
  if (!ws) return;
  const nameEl = el.querySelector('.workspace-name');
  const oldName = ws.name;

  const input = document.createElement('input');
  input.className = 'workspace-rename-input';
  input.value = oldName;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = () => {
    const val = input.value.trim();
    if (val && val !== oldName) ws.name = val;
    renderSidebar();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
    if (e.key === 'Escape') { renderSidebar(); }
  });
}

function showContextMenu(e, ws) {
  $$('.context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const items = [
    { label: 'Rename', action: () => { const el = $(`[data-workspace-id="${ws.id}"]`); if (el) startRename(ws.id, el); } },
    { label: ws.pinned ? 'Unpin' : 'Pin to Top', action: () => {
      ws.pinned = !ws.pinned;
      if (ws.pinned) {
        const idx = state.workspaces.indexOf(ws);
        state.workspaces.splice(idx, 1);
        const pinnedCount = state.workspaces.filter(w => w.pinned).length;
        state.workspaces.splice(pinnedCount, 0, ws);
      }
      renderSidebar();
    }},
    null, // separator
    { label: 'Split Right', action: () => { const p = getFocusedPane(); if (p) splitPane(p.id, 'vertical'); } },
    { label: 'Split Down', action: () => { const p = getFocusedPane(); if (p) splitPane(p.id, 'horizontal'); } },
    null,
    { label: 'Close', action: () => removeWorkspace(ws.id), danger: true },
  ];

  for (const item of items) {
    if (item === null) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
    } else {
      const el = document.createElement('div');
      el.className = 'context-menu-item';
      if (item.danger) el.style.color = 'var(--danger)';
      el.textContent = item.label;
      el.addEventListener('click', () => { menu.remove(); item.action(); });
      menu.appendChild(el);
    }
  }

  document.body.appendChild(menu);
  const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

// ─── Notifications ─────────────────────────────────────────────────────────────

function addNotification(opts) {
  const n = {
    id: Date.now() + Math.random(),
    title: opts.title || 'Notification',
    body: opts.body || '',
    workspaceId: opts.workspaceId || null,
    timestamp: Date.now(),
    read: false,
  };
  state.notifications.unshift(n);
  ipcRenderer.invoke('show-notification', { title: n.title, body: n.body });
  renderSidebar();
  renderNotifications();
  return n;
}

function renderNotifications() {
  const list = $('#notifications-list');
  if (!list) return;

  if (state.notifications.length === 0) {
    list.innerHTML = '<div class="notifications-empty">No notifications yet</div>';
    return;
  }

  list.innerHTML = '';
  for (const n of state.notifications) {
    const el = document.createElement('div');
    el.className = `notification-item${n.read ? '' : ' unread'}`;
    const wsName = state.workspaces.find(w => w.id === n.workspaceId)?.name || '';
    el.innerHTML = `
      <div class="notification-title">${escapeHtml(n.title)}</div>
      <div class="notification-body">${escapeHtml(n.body)}</div>
      ${wsName ? `<div class="notification-workspace">${escapeHtml(wsName)}</div>` : ''}
      <div class="notification-time">${formatTimeAgo(n.timestamp)}</div>
    `;
    el.addEventListener('click', () => {
      n.read = true;
      if (n.workspaceId) selectWorkspace(n.workspaceId);
      renderNotifications();
      renderSidebar();
    });
    list.appendChild(el);
  }
}

function toggleNotifications() {
  const panel = $('#notifications-panel');
  const isHidden = panel.classList.contains('panel-hidden');
  // Close settings if open
  $('#settings-panel').classList.add('panel-hidden');
  panel.classList.toggle('panel-hidden', !isHidden);
  if (isHidden) renderNotifications();
}

// ─── Settings ──────────────────────────────────────────────────────────────────

function renderSettings() {
  const content = $('#settings-content');
  content.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Terminal</div>
      <div class="settings-row">
        <div><div class="settings-label">Font Size</div></div>
        <input type="number" class="settings-input" id="set-fontSize" value="${state.fontSize}" min="8" max="32" style="width:80px">
      </div>
      <div class="settings-row">
        <div><div class="settings-label">Font Family</div></div>
        <input type="text" class="settings-input" id="set-fontFamily" value="${state.fontFamily}" style="width:220px">
      </div>
      <div class="settings-row">
        <div><div class="settings-label">Cursor Style</div></div>
        <select class="settings-select" id="set-cursorStyle">
          <option value="bar" selected>Bar</option>
          <option value="block">Block</option>
          <option value="underline">Underline</option>
        </select>
      </div>
      <div class="settings-row">
        <div><div class="settings-label">Cursor Blink</div></div>
        <input type="checkbox" id="set-cursorBlink" checked>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Workspaces</div>
      <div class="settings-row">
        <div>
          <div class="settings-label">New Workspace Position</div>
          <div class="settings-description">Where to insert new workspaces</div>
        </div>
        <select class="settings-select" id="set-placement">
          <option value="top">Top</option>
          <option value="afterCurrent" selected>After Current</option>
          <option value="end">End</option>
        </select>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Keyboard Shortcuts</div>
      <div class="shortcuts-list">
        <div class="shortcut-row"><kbd>Ctrl+T</kbd> <span>New Workspace</span></div>
        <div class="shortcut-row"><kbd>Ctrl+W</kbd> <span>Close Pane</span></div>
        <div class="shortcut-row"><kbd>Ctrl+B</kbd> <span>Toggle Sidebar</span></div>
        <div class="shortcut-row"><kbd>Ctrl+D</kbd> <span>Split Right</span></div>
        <div class="shortcut-row"><kbd>Ctrl+Shift+D</kbd> <span>Split Down</span></div>
        <div class="shortcut-row"><kbd>Ctrl+O</kbd> <span>Open Folder</span></div>
        <div class="shortcut-row"><kbd>Ctrl+F</kbd> <span>Find in Terminal</span></div>
        <div class="shortcut-row"><kbd>Ctrl+Shift+C</kbd> <span>Copy</span></div>
        <div class="shortcut-row"><kbd>Ctrl+Shift+V</kbd> <span>Paste</span></div>
        <div class="shortcut-row"><kbd>Ctrl+Shift+A</kbd> <span>Notifications</span></div>
        <div class="shortcut-row"><kbd>Ctrl+Shift+]</kbd> <span>Next Workspace</span></div>
        <div class="shortcut-row"><kbd>Ctrl+Shift+[</kbd> <span>Previous Workspace</span></div>
        <div class="shortcut-row"><kbd>Ctrl+]</kbd> <span>Next Pane</span></div>
        <div class="shortcut-row"><kbd>Ctrl+[</kbd> <span>Previous Pane</span></div>
        <div class="shortcut-row"><kbd>Ctrl+=</kbd> <span>Zoom In</span></div>
        <div class="shortcut-row"><kbd>Ctrl+-</kbd> <span>Zoom Out</span></div>
        <div class="shortcut-row"><kbd>Ctrl+0</kbd> <span>Reset Zoom</span></div>
        <div class="shortcut-row"><kbd>F11</kbd> <span>Fullscreen</span></div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">About</div>
      <div style="color:var(--text-muted);font-size:12px;line-height:1.8">
        <div><strong>cmux</strong> — Terminal for AI coding agents</div>
        <div>Electron/Linux port</div>
        <div>License: AGPL-3.0</div>
      </div>
    </div>
  `;

  // Wire up settings changes
  const fontSizeInput = $('#set-fontSize');
  fontSizeInput.addEventListener('change', () => {
    state.fontSize = parseInt(fontSizeInput.value) || 14;
    ipcRenderer.invoke('store-set', 'fontSize', state.fontSize);
    applyFontSettings();
  });

  const fontFamilyInput = $('#set-fontFamily');
  fontFamilyInput.addEventListener('change', () => {
    state.fontFamily = fontFamilyInput.value;
    ipcRenderer.invoke('store-set', 'fontFamily', state.fontFamily);
    applyFontSettings();
  });
}

function applyFontSettings() {
  for (const ws of state.workspaces) {
    for (const pane of ws.panes) {
      pane.term.options.fontSize = state.fontSize;
      pane.term.options.fontFamily = state.fontFamily;
      try { pane.fitAddon.fit(); } catch {}
      if (pane.ptyId) try { ipcRenderer.send('pty-resize', pane.ptyId, pane.term.cols, pane.term.rows); } catch {}
    }
  }
}

function toggleSettings() {
  const panel = $('#settings-panel');
  const isHidden = panel.classList.contains('panel-hidden');
  $('#notifications-panel').classList.add('panel-hidden');
  panel.classList.toggle('panel-hidden', !isHidden);
  if (isHidden) renderSettings();
}

// ─── Find Bar ──────────────────────────────────────────────────────────────────

function toggleFind() {
  const bar = $('#find-bar');
  const isHidden = bar.classList.contains('panel-hidden');
  bar.classList.toggle('panel-hidden', !isHidden);
  if (isHidden) {
    const input = $('#find-input');
    input.focus();
    input.select();
  } else {
    const pane = getFocusedPane();
    if (pane) pane.term.focus();
  }
}

$('#find-input').addEventListener('input', () => {
  const q = $('#find-input').value;
  const pane = getFocusedPane();
  if (pane && q) pane.searchAddon.findNext(q);
});

$('#find-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const q = $('#find-input').value;
    const pane = getFocusedPane();
    if (pane && q) {
      if (e.shiftKey) pane.searchAddon.findPrevious(q);
      else pane.searchAddon.findNext(q);
    }
  }
  if (e.key === 'Escape') toggleFind();
});

$('#find-next').addEventListener('click', () => {
  const q = $('#find-input').value;
  const pane = getFocusedPane();
  if (pane && q) pane.searchAddon.findNext(q);
});

$('#find-prev').addEventListener('click', () => {
  const q = $('#find-input').value;
  const pane = getFocusedPane();
  if (pane && q) pane.searchAddon.findPrevious(q);
});

$('#find-close').addEventListener('click', toggleFind);

// ─── Sidebar Resize ────────────────────────────────────────────────────────────

(function setupSidebarResize() {
  const sidebar = $('#sidebar');
  const handle = $('#sidebar-resize');
  let startX, startW;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';

    const onMove = e => {
      const w = Math.max(180, Math.min(450, startW + (e.clientX - startX)));
      sidebar.style.width = `${w}px`;
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      ipcRenderer.invoke('store-set', 'sidebarWidth', sidebar.offsetWidth);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Refit all panes
      for (const ws of state.workspaces) {
        for (const p of ws.panes) {
          try { p.fitAddon.fit(); } catch {}
          if (p.ptyId) try { ipcRenderer.send('pty-resize', p.ptyId, p.term.cols, p.term.rows); } catch {}
        }
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Restore saved width
  ipcRenderer.invoke('store-get', 'sidebarWidth').then(w => {
    if (w) sidebar.style.width = `${w}px`;
  });
})();

function toggleSidebar() {
  state.sidebarVisible = !state.sidebarVisible;
  $('#sidebar').classList.toggle('sidebar-hidden', !state.sidebarVisible);
  $('#sidebar-resize').style.display = state.sidebarVisible ? '' : 'none';
  // Refit all terminals after sidebar toggle
  requestAnimationFrame(() => {
    for (const ws of state.workspaces) {
      for (const p of ws.panes) {
        try { p.fitAddon.fit(); } catch {}
        if (p.ptyId) try { ipcRenderer.send('pty-resize', p.ptyId, p.term.cols, p.term.rows); } catch {}
      }
    }
  });
}

// ─── Zoom ──────────────────────────────────────────────────────────────────────

function zoomIn() { state.fontSize = Math.min(32, state.fontSize + 1); applyFontSettings(); }
function zoomOut() { state.fontSize = Math.max(8, state.fontSize - 1); applyFontSettings(); }
function zoomReset() { state.fontSize = 14; applyFontSettings(); }

// ─── Button Wiring ─────────────────────────────────────────────────────────────

$('#btn-minimize').addEventListener('click', () => ipcRenderer.invoke('window-minimize'));
$('#btn-maximize').addEventListener('click', () => ipcRenderer.invoke('window-maximize'));
$('#btn-close').addEventListener('click', () => ipcRenderer.invoke('window-close'));
$('#btn-new-workspace').addEventListener('click', () => createWorkspace());
$('#btn-open-folder').addEventListener('click', openFolder);
$('#btn-notifications').addEventListener('click', toggleNotifications);
$('#btn-settings').addEventListener('click', toggleSettings);
$('#btn-close-notifications').addEventListener('click', () => $('#notifications-panel').classList.add('panel-hidden'));
$('#btn-close-settings').addEventListener('click', () => $('#settings-panel').classList.add('panel-hidden'));
$('#btn-mark-all-read').addEventListener('click', () => {
  state.notifications.forEach(n => n.read = true);
  renderNotifications();
  renderSidebar();
});

async function openFolder() {
  const dir = await ipcRenderer.invoke('open-folder-dialog');
  if (dir) createWorkspace({ cwd: dir, name: path.basename(dir) });
}

// ─── Menu / IPC Actions ────────────────────────────────────────────────────────

const menuActions = {
  'new-workspace': () => createWorkspace(),
  'open-folder': openFolder,
  'split-right': () => { const p = getFocusedPane(); if (p) splitPane(p.id, 'vertical'); },
  'split-down': () => { const p = getFocusedPane(); if (p) splitPane(p.id, 'horizontal'); },
  'close-pane': () => { const p = getFocusedPane(); if (p) closePane(p.id); },
  'toggle-sidebar': toggleSidebar,
  'toggle-notifications': toggleNotifications,
  'toggle-find': toggleFind,
  'open-settings': toggleSettings,
  'next-workspace': selectNextWorkspace,
  'prev-workspace': selectPrevWorkspace,
  'next-pane': nextPane,
  'prev-pane': prevPane,
  'zoom-in': zoomIn,
  'zoom-out': zoomOut,
  'zoom-reset': zoomReset,
  'copy': () => {
    const p = getFocusedPane();
    if (p) { const sel = p.term.getSelection(); if (sel) clipboard.writeText(sel); }
  },
  'paste': () => {
    const p = getFocusedPane();
    if (p) { const text = clipboard.readText(); if (text) p.term.paste(text); }
  },
};

ipcRenderer.on('menu-action', (_, action) => {
  const fn = menuActions[action];
  if (fn) fn();
});

// Socket commands from main
ipcRenderer.on('socket-command', (_, cmd) => {
  const parts = cmd.split(' ');
  const action = parts[0];
  const args = parts.slice(1);

  switch (action) {
    case 'workspace.new': createWorkspace({ name: args.join(' ') || undefined }); break;
    case 'workspace.list':
      console.log(state.workspaces.map(w => ({ name: w.name, cwd: w.cwd, branch: w.branch })));
      break;
    case 'workspace.select':
      const idx = parseInt(args[0]);
      if (!isNaN(idx) && state.workspaces[idx]) selectWorkspace(state.workspaces[idx].id);
      break;
    case 'notification.send':
      addNotification({ title: args[0] || 'Notification', body: args.slice(1).join(' ') });
      break;
  }
});

// ─── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  // Load persisted settings
  state.fontSize = (await ipcRenderer.invoke('store-get', 'fontSize')) || 14;
  state.fontFamily = (await ipcRenderer.invoke('store-get', 'fontFamily')) || state.fontFamily;

  // Create first workspace
  createWorkspace();
})();

// Refocus terminal on window focus
window.addEventListener('focus', () => {
  const p = getFocusedPane();
  if (p) p.term.focus();
});
