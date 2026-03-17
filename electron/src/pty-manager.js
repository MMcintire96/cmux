const { ipcMain } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');

let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('Failed to load node-pty:', e.message);
}

const processes = new Map();
let nextId = 1;

function getDefaultShell() {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}

function getCwd(pid) {
  if (process.platform === 'linux') {
    try {
      return fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }
  return null;
}

function getGitBranch(cwd) {
  try {
    const headPath = path.join(cwd, '.git', 'HEAD');
    if (!fs.existsSync(headPath)) {
      // Check for worktrees or parent .git
      const gitFile = path.join(cwd, '.git');
      const stat = fs.statSync(gitFile);
      if (stat.isFile()) {
        const content = fs.readFileSync(gitFile, 'utf8').trim();
        const match = content.match(/^gitdir:\s*(.+)/);
        if (match) {
          const gitDir = path.resolve(cwd, match[1]);
          const worktreeHead = path.join(gitDir, 'HEAD');
          if (fs.existsSync(worktreeHead)) {
            const ref = fs.readFileSync(worktreeHead, 'utf8').trim();
            const branchMatch = ref.match(/^ref:\s*refs\/heads\/(.+)/);
            return branchMatch ? branchMatch[1] : ref.slice(0, 8);
          }
        }
      }
      return null;
    }
    const ref = fs.readFileSync(headPath, 'utf8').trim();
    const branchMatch = ref.match(/^ref:\s*refs\/heads\/(.+)/);
    return branchMatch ? branchMatch[1] : ref.slice(0, 8);
  } catch {
    return null;
  }
}

function setupPtyHandlers(mainWindow) {
  if (!pty) {
    ipcMain.handle('pty-spawn', () => ({ error: 'node-pty not available' }));
    return;
  }

  ipcMain.handle('pty-spawn', (_, opts = {}) => {
    const id = nextId++;
    const shell = opts.shell || getDefaultShell();
    const cwd = opts.cwd || os.homedir();
    const cols = opts.cols || 80;
    const rows = opts.rows || 24;

    const env = { ...process.env };
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    env.TERM_PROGRAM = 'cmux';
    if (opts.env) Object.assign(env, opts.env);

    try {
      const proc = pty.spawn(shell, opts.args || [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env,
      });

      proc.onData((data) => {
        mainWindow?.webContents.send('pty-data', id, data);
      });

      proc.onExit(({ exitCode }) => {
        processes.delete(id);
        mainWindow?.webContents.send('pty-exit', id, exitCode);
      });

      processes.set(id, proc);
      return { id, pid: proc.pid };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.on('pty-write', (_, id, data) => {
    const proc = processes.get(id);
    if (proc) proc.write(data);
  });

  ipcMain.on('pty-resize', (_, id, cols, rows) => {
    const proc = processes.get(id);
    if (proc) {
      try { proc.resize(cols, rows); } catch {}
    }
  });

  ipcMain.on('pty-kill', (_, id) => {
    const proc = processes.get(id);
    if (proc) {
      proc.kill();
      processes.delete(id);
    }
  });

  ipcMain.handle('pty-get-cwd', (_, id) => {
    const proc = processes.get(id);
    if (!proc) return null;
    const cwd = getCwd(proc.pid);
    const branch = cwd ? getGitBranch(cwd) : null;
    return { cwd, branch };
  });
}

function killAll() {
  for (const [id, proc] of processes) {
    try { proc.kill(); } catch {}
  }
  processes.clear();
}

module.exports = { setupPtyHandlers, killAll, getCwd, getGitBranch };
