// Notification Manager - equivalent to TerminalNotificationStore

class NotificationManager {
  constructor() {
    this.notifications = [];
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

  add(notification) {
    const entry = {
      id: this.nextId++,
      title: notification.title || 'Notification',
      body: notification.body || '',
      workspaceId: notification.workspaceId || null,
      workspaceName: notification.workspaceName || '',
      timestamp: Date.now(),
      read: false,
    };
    this.notifications.unshift(entry);

    // Send system notification
    window.cmux.showNotification({
      title: entry.title,
      body: entry.body,
    });

    this._emit();
    return entry;
  }

  markRead(id) {
    const notif = this.notifications.find(n => n.id === id);
    if (notif) {
      notif.read = true;
      this._emit();
    }
  }

  markAllRead() {
    for (const n of this.notifications) {
      n.read = true;
    }
    this._emit();
  }

  remove(id) {
    this.notifications = this.notifications.filter(n => n.id !== id);
    this._emit();
  }

  clear() {
    this.notifications = [];
    this._emit();
  }

  getUnreadCount() {
    return this.notifications.filter(n => !n.read).length;
  }

  getForWorkspace(workspaceId) {
    return this.notifications.filter(n => n.workspaceId === workspaceId);
  }
}

window.NotificationManager = NotificationManager;
