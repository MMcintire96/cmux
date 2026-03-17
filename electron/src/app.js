// Main application - ties all managers together

(async function() {
  // Initialize managers
  const workspaceManager = new WorkspaceManager();
  const paneManager = new PaneManager();
  const notificationManager = new NotificationManager();
  const sidebar = new Sidebar(workspaceManager, notificationManager);
  const findBar = new FindBar(paneManager);
  const settingsPanel = new SettingsPanel();

  const paneContainer = document.getElementById('pane-container');
  const notificationsPanel = document.getElementById('notifications-panel');
  const notificationsList = document.getElementById('notifications-list');

  // Track panes per workspace
  const workspacePanes = new Map(); // workspaceId -> { container, paneIds }
  let switchingWorkspace = false;

  // PTY data handler
  window.pty.onData((ptyId, data) => {
    for (const [, pane] of paneManager.panes) {
      if (pane.ptyId === ptyId) {
        window.terminalApi.write(pane.termId, data);

        // Check for notification triggers (bell character, OSC sequences)
        if (data.includes('\x07') || data.includes('\x1b]777;notify;')) {
          const ws = workspaceManager.getActive();
          const paneWs = findWorkspaceForPane(pane.id);
          if (paneWs && paneWs.id !== workspaceManager.activeWorkspaceId) {
            paneWs.hasNotification = true;
            notificationManager.add({
              title: paneWs.name,
              body: 'Terminal requires attention',
              workspaceId: paneWs.id,
              workspaceName: paneWs.name,
            });
            workspaceManager._emit();
          }
        }
        break;
      }
    }
  });

  // PTY exit handler
  window.pty.onExit((ptyId, code) => {
    for (const [id, pane] of paneManager.panes) {
      if (pane.ptyId === ptyId) {
        const remaining = paneManager.closePane(id);
        const wsId = findWorkspaceIdForPane(id);
        if (wsId) {
          const wsData = workspacePanes.get(wsId);
          if (wsData) {
            wsData.paneIds.delete(id);
            if (wsData.paneIds.size === 0) {
              workspaceManager.removeWorkspace(wsId);
              workspacePanes.delete(wsId);
              // Auto-create if no workspaces left
              if (workspaceManager.workspaces.length === 0) {
                createNewWorkspace();
              }
            }
          }
        }
        break;
      }
    }
  });

  function findWorkspaceForPane(paneId) {
    for (const [wsId, data] of workspacePanes) {
      if (data.paneIds.has(paneId)) {
        return workspaceManager.workspaces.find(w => w.id === wsId);
      }
    }
    return null;
  }

  function findWorkspaceIdForPane(paneId) {
    for (const [wsId, data] of workspacePanes) {
      if (data.paneIds.has(paneId)) return wsId;
    }
    return null;
  }

  async function createNewWorkspace(opts = {}) {
    const placement = await window.cmux.storeGet('newWorkspacePlacement') || 'afterCurrent';
    const ws = workspaceManager.createWorkspace({ placement, ...opts });

    // Create container for this workspace's panes
    const container = document.createElement('div');
    container.className = 'workspace-pane-root';
    container.id = `workspace-panes-${ws.id}`;
    container.style.display = 'flex';
    container.style.flex = '1';
    container.style.overflow = 'hidden';

    workspacePanes.set(ws.id, { container, paneIds: new Set() });

    // Show it
    showWorkspace(ws.id);

    // Create initial pane
    const fontSize = await window.cmux.storeGet('fontSize') || 14;
    const fontFamily = await window.cmux.storeGet('fontFamily') || "'JetBrains Mono', 'Fira Code', monospace";
    const pane = await paneManager.createPane(container, { fontSize, fontFamily, cwd: opts.cwd });
    if (pane) {
      workspacePanes.get(ws.id).paneIds.add(pane.id);
      pane.workspaceId = ws.id;
    }

    // Update workspace cwd from pane
    paneManager.onChange(() => {
      const activePanes = workspacePanes.get(ws.id);
      if (!activePanes) return;
      for (const paneId of activePanes.paneIds) {
        const p = paneManager.panes.get(paneId);
        if (p) {
          ws.cwd = p.cwd;
          ws.branch = p.branch;
        }
      }
    });

    return ws;
  }

  function showWorkspace(wsId) {
    // Hide all workspace containers
    for (const [id, data] of workspacePanes) {
      if (data.container.parentElement) {
        data.container.remove();
      }
    }

    // Show the selected one
    const wsData = workspacePanes.get(wsId);
    if (wsData) {
      paneContainer.appendChild(wsData.container);

      // Refit all panes in this workspace
      requestAnimationFrame(() => {
        for (const paneId of wsData.paneIds) {
          const pane = paneManager.panes.get(paneId);
          if (pane) {
            try { pane.fitAddon.fit(); } catch {}
            try { window.pty.resize(pane.ptyId, pane.term.cols, pane.term.rows); } catch {}
          }
        }
        // Focus the first pane
        const firstPaneId = [...wsData.paneIds][0];
        if (firstPaneId) paneManager.focusPane(firstPaneId);
      });
    }
  }

  // Workspace selection handler
  workspaceManager.onChange(() => {
    sidebar.render();
    if (!switchingWorkspace && workspaceManager.activeWorkspaceId) {
      showWorkspace(workspaceManager.activeWorkspaceId);
    }
  });

  // Sidebar callbacks
  sidebar.onCloseWorkspace = (wsId) => {
    const wsData = workspacePanes.get(wsId);
    if (wsData) {
      for (const paneId of [...wsData.paneIds]) {
        paneManager.closePane(paneId);
      }
      wsData.container.remove();
      workspacePanes.delete(wsId);
    }
    workspaceManager.removeWorkspace(wsId);
    if (workspaceManager.workspaces.length === 0) {
      createNewWorkspace();
    }
  };

  sidebar.onSplitRight = (wsId) => {
    const wsData = workspacePanes.get(wsId);
    if (!wsData) return;
    const focusedPane = paneManager.getFocusedPane();
    if (focusedPane && wsData.paneIds.has(focusedPane.id)) {
      paneManager.splitPane(focusedPane.id, 'vertical');
      // Track new pane
      for (const [id] of paneManager.panes) {
        if (!wsData.paneIds.has(id)) {
          wsData.paneIds.add(id);
          paneManager.panes.get(id).workspaceId = wsId;
        }
      }
    }
  };

  sidebar.onSplitDown = (wsId) => {
    const wsData = workspacePanes.get(wsId);
    if (!wsData) return;
    const focusedPane = paneManager.getFocusedPane();
    if (focusedPane && wsData.paneIds.has(focusedPane.id)) {
      paneManager.splitPane(focusedPane.id, 'horizontal');
      for (const [id] of paneManager.panes) {
        if (!wsData.paneIds.has(id)) {
          wsData.paneIds.add(id);
          paneManager.panes.get(id).workspaceId = wsId;
        }
      }
    }
  };

  // Window controls
  document.getElementById('btn-minimize').addEventListener('click', () => window.cmux.windowMinimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.cmux.windowMaximize());
  document.getElementById('btn-close').addEventListener('click', () => window.cmux.windowClose());

  // New workspace button
  document.getElementById('btn-new-workspace').addEventListener('click', () => createNewWorkspace());

  // Notifications
  document.getElementById('btn-notifications').addEventListener('click', toggleNotifications);
  document.getElementById('btn-close-notifications').addEventListener('click', () => {
    notificationsPanel.classList.add('hidden');
  });

  function toggleNotifications() {
    const isHidden = notificationsPanel.classList.contains('hidden');
    notificationsPanel.classList.toggle('hidden');
    if (isHidden) renderNotifications();
  }

  function renderNotifications() {
    const notifs = notificationManager.notifications;
    if (notifs.length === 0) {
      notificationsList.innerHTML = '<div class="notifications-empty">No notifications</div>';
      return;
    }

    notificationsList.innerHTML = '';
    for (const notif of notifs) {
      const el = document.createElement('div');
      el.className = `notification-item ${notif.read ? '' : 'unread'}`;

      const timeAgo = formatTimeAgo(notif.timestamp);
      el.innerHTML = `
        <div class="notification-title">${escapeHtml(notif.title)}</div>
        <div class="notification-body">${escapeHtml(notif.body)}</div>
        ${notif.workspaceName ? `<div class="notification-workspace">${escapeHtml(notif.workspaceName)}</div>` : ''}
        <div class="notification-time">${timeAgo}</div>
      `;

      el.addEventListener('click', () => {
        notificationManager.markRead(notif.id);
        if (notif.workspaceId) {
          workspaceManager.selectWorkspace(notif.workspaceId);
        }
        renderNotifications();
      });

      notificationsList.appendChild(el);
    }
  }

  notificationManager.onChange(() => {
    if (!notificationsPanel.classList.contains('hidden')) {
      renderNotifications();
    }
  });

  // IPC event handlers from main process
  window.cmux.on('new-workspace', () => createNewWorkspace());
  window.cmux.on('close-workspace', () => {
    const wsId = workspaceManager.activeWorkspaceId;
    if (wsId) sidebar.onCloseWorkspace(wsId);
  });
  window.cmux.on('toggle-sidebar', () => sidebar.toggle());
  window.cmux.on('show-notifications', toggleNotifications);
  window.cmux.on('next-workspace', () => workspaceManager.selectNext());
  window.cmux.on('prev-workspace', () => workspaceManager.selectPrev());
  window.cmux.on('toggle-find', () => findBar.toggle());
  window.cmux.on('open-settings', () => settingsPanel.toggle());

  window.cmux.on('split-right', () => {
    const activeWs = workspaceManager.activeWorkspaceId;
    if (activeWs) sidebar.onSplitRight(activeWs);
  });

  window.cmux.on('split-down', () => {
    const activeWs = workspaceManager.activeWorkspaceId;
    if (activeWs) sidebar.onSplitDown(activeWs);
  });

  // Socket command handler
  window.cmux.on('socket-command', (cmd) => {
    switch (cmd.cmd) {
      case 'workspace.new':
        createNewWorkspace({ name: cmd.args[0] });
        break;
      case 'workspace.select':
        const wsIdx = parseInt(cmd.args[0]);
        if (!isNaN(wsIdx) && workspaceManager.workspaces[wsIdx]) {
          workspaceManager.selectWorkspace(workspaceManager.workspaces[wsIdx].id);
        }
        break;
      case 'notification.send':
        notificationManager.add({
          title: cmd.args[0] || 'Notification',
          body: cmd.args.slice(1).join(' '),
        });
        break;
    }
  });

  // Utility functions
  function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Create initial workspace
  await createNewWorkspace();

  // Focus terminal on window focus
  window.addEventListener('focus', () => {
    const pane = paneManager.getFocusedPane();
    if (pane) pane.term.focus();
  });
})();
