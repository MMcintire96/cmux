// Sidebar - renders workspace list and handles interactions

class Sidebar {
  constructor(workspaceManager, notificationManager) {
    this.workspaceManager = workspaceManager;
    this.notificationManager = notificationManager;
    this.listEl = document.getElementById('workspace-list');
    this.badgeEl = document.getElementById('notification-badge');
    this.sidebarEl = document.getElementById('sidebar');
    this.resizeEl = document.getElementById('sidebar-resize');
    this.visible = true;
    this.dragState = null;

    this._setupResize();
    this._setupDragAndDrop();
    this.workspaceManager.onChange(() => this.render());
    this.notificationManager.onChange(() => this._updateBadge());
  }

  toggle() {
    this.visible = !this.visible;
    this.sidebarEl.classList.toggle('hidden', !this.visible);
    this.resizeEl.style.display = this.visible ? '' : 'none';
  }

  render() {
    const workspaces = this.workspaceManager.workspaces;
    const activeId = this.workspaceManager.activeWorkspaceId;

    this.listEl.innerHTML = '';

    for (let i = 0; i < workspaces.length; i++) {
      const ws = workspaces[i];
      const el = document.createElement('div');
      el.className = 'workspace-item';
      el.dataset.workspaceId = ws.id;
      el.dataset.index = i;
      el.draggable = true;

      if (ws.id === activeId) el.classList.add('active');
      if (ws.hasNotification) el.classList.add('has-notification');

      const homeDir = '~'; // Will be resolved async
      const displayCwd = ws.cwd ? ws.cwd.replace(/^\/home\/[^/]+/, '~') : '~';

      el.innerHTML = `
        <div class="workspace-notification-ring"></div>
        <div class="workspace-info">
          <div class="workspace-name">${this._escapeHtml(ws.name)}</div>
          <div class="workspace-meta">
            ${ws.branch ? `<span class="workspace-branch"> ${this._escapeHtml(ws.branch)}</span>` : ''}
            <span>${this._escapeHtml(displayCwd)}</span>
          </div>
        </div>
        <button class="workspace-close" title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        </button>
      `;

      // Click to select
      el.addEventListener('click', (e) => {
        if (e.target.closest('.workspace-close')) return;
        this.workspaceManager.selectWorkspace(ws.id);
      });

      // Close button
      el.querySelector('.workspace-close').addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onCloseWorkspace) this.onCloseWorkspace(ws.id);
      });

      // Double-click to rename
      el.addEventListener('dblclick', (e) => {
        if (e.target.closest('.workspace-close')) return;
        this._startRename(ws.id, el);
      });

      // Context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContextMenu(e, ws);
      });

      this.listEl.appendChild(el);
    }
  }

  _startRename(id, el) {
    const nameEl = el.querySelector('.workspace-name');
    const ws = this.workspaceManager.workspaces.find(w => w.id === id);
    if (!ws) return;

    const input = document.createElement('input');
    input.className = 'workspace-rename-input';
    input.value = ws.name;
    input.select();

    nameEl.replaceWith(input);
    input.focus();

    const finishRename = () => {
      const newName = input.value.trim();
      if (newName) {
        this.workspaceManager.renameWorkspace(id, newName);
      }
      this.render();
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finishRename();
      if (e.key === 'Escape') this.render();
    });
  }

  _showContextMenu(e, workspace) {
    // Remove any existing context menu
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const items = [
      { label: 'Rename', action: () => this._startRename(workspace.id, this.listEl.querySelector(`[data-workspace-id="${workspace.id}"]`)) },
      { label: workspace.pinned ? 'Unpin' : 'Pin to Top', action: () => this.workspaceManager.togglePin(workspace.id) },
      { separator: true },
      { label: 'Split Right', action: () => { if (this.onSplitRight) this.onSplitRight(workspace.id); } },
      { label: 'Split Down', action: () => { if (this.onSplitDown) this.onSplitDown(workspace.id); } },
      { separator: true },
      { label: 'Close', action: () => { if (this.onCloseWorkspace) this.onCloseWorkspace(workspace.id); }, danger: true },
    ];

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.className = 'context-menu-item';
        if (item.danger) el.style.color = 'var(--danger)';
        el.textContent = item.label;
        el.addEventListener('click', () => {
          menu.remove();
          item.action();
        });
        menu.appendChild(el);
      }
    }

    document.body.appendChild(menu);

    // Close on click outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('mousedown', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeMenu), 0);
  }

  _setupResize() {
    let startX = 0;
    let startWidth = 0;

    this.resizeEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = this.sidebarEl.offsetWidth;
      this.resizeEl.classList.add('dragging');

      const onMouseMove = (e) => {
        const newWidth = Math.max(180, Math.min(400, startWidth + (e.clientX - startX)));
        this.sidebarEl.style.width = `${newWidth}px`;
        document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
      };

      const onMouseUp = () => {
        this.resizeEl.classList.remove('dragging');
        window.cmux.storeSet('sidebarWidth', this.sidebarEl.offsetWidth);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // Restore saved width
    window.cmux.storeGet('sidebarWidth').then(width => {
      if (width) {
        this.sidebarEl.style.width = `${width}px`;
        document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
      }
    });
  }

  _setupDragAndDrop() {
    this.listEl.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.workspace-item');
      if (!item) return;
      e.dataTransfer.setData('text/plain', item.dataset.index);
      e.dataTransfer.effectAllowed = 'move';
      item.style.opacity = '0.5';
      this.dragState = { index: parseInt(item.dataset.index) };
    });

    this.listEl.addEventListener('dragend', (e) => {
      const item = e.target.closest('.workspace-item');
      if (item) item.style.opacity = '';
      this.dragState = null;
    });

    this.listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    this.listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!this.dragState) return;
      const target = e.target.closest('.workspace-item');
      if (!target) return;
      const toIndex = parseInt(target.dataset.index);
      this.workspaceManager.reorder(this.dragState.index, toIndex);
    });
  }

  _updateBadge() {
    const count = this.notificationManager.getUnreadCount();
    if (count > 0) {
      this.badgeEl.textContent = count > 99 ? '99+' : count;
      this.badgeEl.classList.remove('hidden');
    } else {
      this.badgeEl.classList.add('hidden');
    }
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

window.Sidebar = Sidebar;
