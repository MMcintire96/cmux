// Workspace Manager - manages workspaces (equivalent to Swift's TabManager)

class WorkspaceManager {
  constructor() {
    this.workspaces = [];
    this.activeWorkspaceId = null;
    this.nextId = 1;
    this.listeners = new Set();
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _emit() {
    for (const cb of this.listeners) cb();
  }

  createWorkspace(opts = {}) {
    const id = `workspace-${this.nextId++}`;
    const workspace = {
      id,
      name: opts.name || `Workspace ${this.workspaces.length + 1}`,
      cwd: opts.cwd || null,
      panes: [],
      notifications: [],
      hasNotification: false,
      branch: null,
      pinned: false,
      createdAt: Date.now(),
      metadata: {},
    };

    // Determine insertion index
    const placement = opts.placement || 'afterCurrent';
    let insertIndex = this.workspaces.length;

    if (placement === 'afterCurrent' && this.activeWorkspaceId) {
      const currentIdx = this.workspaces.findIndex(w => w.id === this.activeWorkspaceId);
      if (currentIdx >= 0) insertIndex = currentIdx + 1;
    } else if (placement === 'top') {
      const pinnedCount = this.workspaces.filter(w => w.pinned).length;
      insertIndex = pinnedCount;
    }

    this.workspaces.splice(insertIndex, 0, workspace);
    this.activeWorkspaceId = id;
    this._emit();
    return workspace;
  }

  removeWorkspace(id) {
    const idx = this.workspaces.findIndex(w => w.id === id);
    if (idx < 0) return;

    this.workspaces.splice(idx, 1);

    if (this.activeWorkspaceId === id) {
      if (this.workspaces.length > 0) {
        const newIdx = Math.min(idx, this.workspaces.length - 1);
        this.activeWorkspaceId = this.workspaces[newIdx].id;
      } else {
        this.activeWorkspaceId = null;
      }
    }
    this._emit();
  }

  selectWorkspace(id) {
    const ws = this.workspaces.find(w => w.id === id);
    if (!ws) return;
    this.activeWorkspaceId = id;
    ws.hasNotification = false;
    this._emit();
  }

  selectNext() {
    if (this.workspaces.length === 0) return;
    const idx = this.workspaces.findIndex(w => w.id === this.activeWorkspaceId);
    const nextIdx = (idx + 1) % this.workspaces.length;
    this.selectWorkspace(this.workspaces[nextIdx].id);
  }

  selectPrev() {
    if (this.workspaces.length === 0) return;
    const idx = this.workspaces.findIndex(w => w.id === this.activeWorkspaceId);
    const prevIdx = (idx - 1 + this.workspaces.length) % this.workspaces.length;
    this.selectWorkspace(this.workspaces[prevIdx].id);
  }

  getActive() {
    return this.workspaces.find(w => w.id === this.activeWorkspaceId) || null;
  }

  renameWorkspace(id, name) {
    const ws = this.workspaces.find(w => w.id === id);
    if (ws) {
      ws.name = name;
      this._emit();
    }
  }

  updateWorkspaceMeta(id, meta) {
    const ws = this.workspaces.find(w => w.id === id);
    if (ws) {
      Object.assign(ws, meta);
      this._emit();
    }
  }

  reorder(fromIndex, toIndex) {
    if (fromIndex < 0 || toIndex < 0) return;
    const [item] = this.workspaces.splice(fromIndex, 1);
    this.workspaces.splice(toIndex, 0, item);
    this._emit();
  }

  togglePin(id) {
    const ws = this.workspaces.find(w => w.id === id);
    if (!ws) return;
    ws.pinned = !ws.pinned;
    // Move pinned to top
    if (ws.pinned) {
      const idx = this.workspaces.indexOf(ws);
      this.workspaces.splice(idx, 1);
      const pinnedCount = this.workspaces.filter(w => w.pinned).length;
      this.workspaces.splice(pinnedCount, 0, ws);
    }
    this._emit();
  }

  serialize() {
    return this.workspaces.map(ws => ({
      name: ws.name,
      cwd: ws.cwd,
      pinned: ws.pinned,
      paneCount: ws.panes.length,
    }));
  }
}

window.WorkspaceManager = WorkspaceManager;
