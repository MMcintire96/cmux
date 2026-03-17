// Pane Manager - manages terminal panes with splits (replaces Bonsplit)

class PaneManager {
  constructor() {
    this.panes = new Map();
    this.focusedPaneId = null;
    this.nextId = 1;
    this.listeners = new Set();
    this.cwdPollers = new Map();
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _emit() {
    for (const cb of this.listeners) cb();
  }

  async createPane(container, opts = {}) {
    const id = `pane-${this.nextId++}`;

    // Create terminal via preload bridge
    const termId = window.terminalApi.create({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: opts.fontSize || 14,
      fontFamily: opts.fontFamily || "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', monospace",
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        cursorAccent: '#1e1e2e',
        selectionBackground: 'rgba(0, 145, 255, 0.3)',
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
      },
      allowTransparency: true,
      scrollback: 10000,
      convertEol: true,
    });

    // Create pane DOM
    const paneEl = document.createElement('div');
    paneEl.className = 'pane';
    paneEl.id = id;
    paneEl.dataset.paneId = id;

    const header = document.createElement('div');
    header.className = 'pane-header';
    header.innerHTML = `
      <div class="pane-title">
        <span class="pane-cwd">~</span>
        <span class="pane-branch"></span>
      </div>
      <div class="pane-actions">
        <button class="pane-action-btn" data-action="split-right" title="Split Right">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 1h10v10H1z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
        </button>
        <button class="pane-action-btn" data-action="split-down" title="Split Down">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 6h10M1 1h10v10H1z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
        </button>
        <button class="pane-action-btn" data-action="close" title="Close Pane">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;

    const terminalEl = document.createElement('div');
    terminalEl.className = 'pane-terminal';

    // Give terminal element a unique ID for selector-based opening
    terminalEl.id = `${id}-terminal`;

    paneEl.appendChild(header);
    paneEl.appendChild(terminalEl);
    container.appendChild(paneEl);

    window.terminalApi.open(termId, `#${id}-terminal`);

    // Fit after a tick to get correct dimensions
    requestAnimationFrame(() => {
      window.terminalApi.fit(termId);
    });

    // Spawn PTY
    const shell = opts.shell || await window.cmux.getShell();
    const cwd = opts.cwd || await window.cmux.getHomeDir();
    const dims = window.terminalApi.getDimensions(termId) || { cols: 80, rows: 24 };

    const result = await window.pty.spawn({ shell, cwd, cols: dims.cols, rows: dims.rows });
    if (result.error) {
      window.terminalApi.write(termId, `\r\nError spawning shell: ${result.error}\r\n`);
      return null;
    }

    const pane = {
      id,
      termId,
      ptyId: result.id,
      pid: result.pid,
      element: paneEl,
      terminalEl,
      cwd,
      branch: null,
      type: opts.type || 'terminal',
    };

    this.panes.set(id, pane);

    // Wire up terminal data -> PTY
    window.terminalApi.onData(termId, (data) => {
      window.pty.write(result.id, data);
    });

    // Focus handling
    paneEl.addEventListener('mousedown', () => this.focusPane(id));
    terminalEl.addEventListener('focus', () => this.focusPane(id), true);

    // Handle pane actions
    header.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'close') this.closePane(id);
      else if (action === 'split-right') this.splitPane(id, 'vertical');
      else if (action === 'split-down') this.splitPane(id, 'horizontal');
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      const dims = window.terminalApi.fit(termId);
      if (dims) {
        try { window.pty.resize(result.id, dims.cols, dims.rows); } catch {}
      }
    });
    resizeObserver.observe(terminalEl);
    pane.resizeObserver = resizeObserver;

    // Poll CWD periodically
    const poller = setInterval(async () => {
      try {
        const info = await window.pty.getCwd(result.id);
        if (info && info.cwd) {
          const homeDir = await window.cmux.getHomeDir();
          const displayCwd = info.cwd.replace(homeDir, '~');
          const cwdEl = paneEl.querySelector('.pane-cwd');
          const branchEl = paneEl.querySelector('.pane-branch');
          if (cwdEl) cwdEl.textContent = displayCwd;
          if (branchEl) branchEl.textContent = info.branch ? ` ${info.branch}` : '';
          pane.cwd = info.cwd;
          pane.branch = info.branch;
        }
      } catch {}
    }, 2000);
    this.cwdPollers.set(id, poller);

    this.focusPane(id);
    this._emit();
    return pane;
  }

  focusPane(id) {
    if (this.focusedPaneId === id) return;
    if (this.focusedPaneId) {
      const prev = this.panes.get(this.focusedPaneId);
      if (prev) prev.element.classList.remove('focused');
    }
    this.focusedPaneId = id;
    const pane = this.panes.get(id);
    if (pane) {
      pane.element.classList.add('focused');
      window.terminalApi.focus(pane.termId);
    }
    this._emit();
  }

  closePane(id) {
    const pane = this.panes.get(id);
    if (!pane) return;

    clearInterval(this.cwdPollers.get(id));
    this.cwdPollers.delete(id);
    pane.resizeObserver?.disconnect();
    window.terminalApi.dispose(pane.termId);
    window.pty.kill(pane.ptyId);

    // If pane is in a split container, clean up the container
    const parent = pane.element.parentElement;
    pane.element.remove();

    if (parent && parent.classList.contains('split-container')) {
      const remaining = [...parent.children].filter(el => !el.classList.contains('split-handle'));
      if (remaining.length === 1) {
        // Unwrap: replace the split container with the remaining child
        parent.replaceWith(remaining[0]);
      }
      // Remove orphaned handles
      parent.querySelectorAll('.split-handle').forEach(h => {
        if (!h.nextElementSibling || h.nextElementSibling.classList.contains('split-handle')) {
          h.remove();
        }
      });
    }

    this.panes.delete(id);

    if (this.focusedPaneId === id) {
      const remaining = [...this.panes.keys()];
      this.focusedPaneId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      if (this.focusedPaneId) {
        const next = this.panes.get(this.focusedPaneId);
        if (next) {
          next.element.classList.add('focused');
          window.terminalApi.focus(next.termId);
        }
      }
    }

    this._emit();
    return this.panes.size;
  }

  splitPane(id, direction = 'vertical') {
    const pane = this.panes.get(id);
    if (!pane) return;

    const container = document.createElement('div');
    container.className = `split-container ${direction}`;

    const handle = document.createElement('div');
    handle.className = `split-handle ${direction}`;

    pane.element.replaceWith(container);
    container.appendChild(pane.element);
    container.appendChild(handle);

    // Create new pane in the split
    this.createPane(container, { cwd: pane.cwd });

    // Setup drag resize
    this._setupSplitResize(handle, container, direction);

    // Refit existing pane
    requestAnimationFrame(() => {
      const dims = window.terminalApi.fit(pane.termId);
      if (dims) {
        try { window.pty.resize(pane.ptyId, dims.cols, dims.rows); } catch {}
      }
    });
  }

  _setupSplitResize(handle, container, direction) {
    let startPos = 0;
    let startSizes = [];

    const onMouseDown = (e) => {
      e.preventDefault();
      handle.classList.add('dragging');
      startPos = direction === 'vertical' ? e.clientX : e.clientY;

      const children = [...container.children].filter(el => !el.classList.contains('split-handle'));
      const totalSize = direction === 'vertical' ? container.offsetWidth : container.offsetHeight;
      startSizes = children.map(el => {
        const size = direction === 'vertical' ? el.offsetWidth : el.offsetHeight;
        return size / totalSize;
      });

      const onMouseMove = (e) => {
        const currentPos = direction === 'vertical' ? e.clientX : e.clientY;
        const totalSize = direction === 'vertical' ? container.offsetWidth : container.offsetHeight;
        const delta = (currentPos - startPos) / totalSize;

        const newSizes = [...startSizes];
        newSizes[0] = Math.max(0.1, Math.min(0.9, startSizes[0] + delta));
        newSizes[1] = 1 - newSizes[0];

        const children = [...container.children].filter(el => !el.classList.contains('split-handle'));
        children.forEach((el, i) => {
          if (i < newSizes.length) el.style.flex = `${newSizes[i]} 1 0%`;
        });

        // Refit all terminals
        for (const [, p] of this.panes) {
          requestAnimationFrame(() => {
            const dims = window.terminalApi.fit(p.termId);
            if (dims) {
              try { window.pty.resize(p.ptyId, dims.cols, dims.rows); } catch {}
            }
          });
        }
      };

      const onMouseUp = () => {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener('mousedown', onMouseDown);
  }

  getFocusedPane() {
    return this.panes.get(this.focusedPaneId) || null;
  }

  search(query) {
    const pane = this.getFocusedPane();
    if (pane && query) window.terminalApi.findNext(pane.termId, query);
  }

  searchNext(query) {
    const pane = this.getFocusedPane();
    if (pane && query) window.terminalApi.findNext(pane.termId, query);
  }

  searchPrev(query) {
    const pane = this.getFocusedPane();
    if (pane && query) window.terminalApi.findPrevious(pane.termId, query);
  }

  disposeAll() {
    for (const [id] of this.panes) {
      this.closePane(id);
    }
  }
}

window.PaneManager = PaneManager;
