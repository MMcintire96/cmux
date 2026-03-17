# cmux - Electron/Linux port

## Setup

```bash
cd electron
npm install
```

## Development

```bash
cd electron
npm run dev
```

## Build for Linux

```bash
cd electron
npm run build:linux
```

This produces an AppImage and .deb package in `electron/dist/`.

## Architecture

- `electron/src/main.js` - Main process (window, menu, socket API, IPC)
- `electron/src/preload.js` - Context bridge (secure IPC exposure)
- `electron/src/pty-manager.js` - node-pty process management
- `electron/src/index.html` - Main HTML shell
- `electron/src/app.js` - Renderer entry point, ties all managers together
- `electron/src/components/` - UI components
  - `workspace-manager.js` - Workspace/tab state management (replaces TabManager.swift)
  - `pane-manager.js` - Terminal pane + split management (replaces Bonsplit)
  - `notification-manager.js` - Notification system (replaces TerminalNotificationStore.swift)
  - `sidebar.js` - Sidebar rendering + interactions (replaces ContentView.swift sidebar)
  - `settings.js` - Settings panel
  - `find-bar.js` - Terminal search (replaces SurfaceSearchOverlay.swift)
- `electron/src/styles/main.css` - All styles (Catppuccin Mocha theme)

## Socket API

cmux exposes a Unix socket at `/tmp/cmux-<pid>.sock` for CLI automation:

```bash
echo "workspace.new my-project" | socat - UNIX-CONNECT:$(cat /tmp/cmux-socket-path)
echo "notification.send Title Message body" | socat - UNIX-CONNECT:$(cat /tmp/cmux-socket-path)
```
