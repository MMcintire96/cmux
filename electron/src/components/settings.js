// Settings panel

class SettingsPanel {
  constructor() {
    this.panelEl = document.getElementById('settings-panel');
    this.contentEl = document.getElementById('settings-content');
    this.visible = false;

    document.getElementById('btn-close-settings').addEventListener('click', () => this.hide());
    document.getElementById('btn-settings').addEventListener('click', () => this.toggle());
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  show() {
    this.visible = true;
    this.panelEl.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.visible = false;
    this.panelEl.classList.add('hidden');
  }

  async render() {
    const fontSize = await window.cmux.storeGet('fontSize') || 14;
    const fontFamily = await window.cmux.storeGet('fontFamily') || 'monospace';
    const theme = await window.cmux.storeGet('theme') || 'system';
    const placement = await window.cmux.storeGet('newWorkspacePlacement') || 'afterCurrent';

    this.contentEl.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Appearance</div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Theme</div>
          </div>
          <select class="settings-select" data-setting="theme">
            <option value="system" ${theme === 'system' ? 'selected' : ''}>System</option>
            <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option>
            <option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option>
          </select>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Font Size</div>
          </div>
          <input type="number" class="settings-input" data-setting="fontSize"
            value="${fontSize}" min="8" max="32" style="width: 80px;">
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Font Family</div>
          </div>
          <input type="text" class="settings-input" data-setting="fontFamily"
            value="${fontFamily}">
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Workspaces</div>

        <div class="settings-row">
          <div>
            <div class="settings-label">New Workspace Position</div>
            <div class="settings-description">Where to insert new workspaces</div>
          </div>
          <select class="settings-select" data-setting="newWorkspacePlacement">
            <option value="top" ${placement === 'top' ? 'selected' : ''}>Top</option>
            <option value="afterCurrent" ${placement === 'afterCurrent' ? 'selected' : ''}>After Current</option>
            <option value="end" ${placement === 'end' ? 'selected' : ''}>End</option>
          </select>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Keyboard Shortcuts</div>
        <div style="color: var(--text-muted); font-size: 12px; line-height: 1.6;">
          <div><kbd>Ctrl+T</kbd> New Workspace</div>
          <div><kbd>Ctrl+W</kbd> Close Workspace</div>
          <div><kbd>Ctrl+B</kbd> Toggle Sidebar</div>
          <div><kbd>Ctrl+D</kbd> Split Right</div>
          <div><kbd>Ctrl+Shift+D</kbd> Split Down</div>
          <div><kbd>Ctrl+Shift+]</kbd> Next Workspace</div>
          <div><kbd>Ctrl+Shift+[</kbd> Previous Workspace</div>
          <div><kbd>Ctrl+Shift+A</kbd> Notifications</div>
          <div><kbd>Ctrl+F</kbd> Find</div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">About</div>
        <div style="color: var(--text-muted); font-size: 12px; line-height: 1.8;">
          <div>cmux - Terminal for AI coding agents</div>
          <div>Electron/Linux port</div>
          <div>License: AGPL-3.0</div>
        </div>
      </div>
    `;

    // Wire up settings changes
    this.contentEl.querySelectorAll('[data-setting]').forEach(el => {
      const handler = () => {
        const key = el.dataset.setting;
        let value = el.value;
        if (el.type === 'number') value = parseInt(value);
        window.cmux.storeSet(key, value);
      };
      el.addEventListener('change', handler);
      if (el.type === 'number' || el.type === 'text') {
        el.addEventListener('input', handler);
      }
    });
  }
}

window.SettingsPanel = SettingsPanel;
