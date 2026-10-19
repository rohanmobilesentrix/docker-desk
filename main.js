const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const docker = require('./docker');

const ID_RE = /^[a-f0-9]{12,64}$/;
const PROJECT_RE = /^[a-z0-9][a-z0-9_-]*$/;

let win;
let stopWatching = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 860,
    minHeight: 520,
    title: 'Docker Desk',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => (win = null));
  startWatching();
}

// Push a refresh to the window whenever Docker reports a container event (debounced).
function startWatching() {
  let timer;
  stopWatching = docker.watchEvents(
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => win && win.webContents.send('containers-changed'), 300);
    },
    () => setTimeout(() => win && startWatching(), 3000) // reconnect if Docker restarts
  );
}

async function confirm(message, detail) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Cancel', 'Remove'],
    defaultId: 0,
    cancelId: 0,
    message,
    detail,
  });
  return response === 1;
}

function checkId(id) {
  if (!ID_RE.test(id)) throw new Error('Invalid container id');
}

ipcMain.handle('list', () => docker.listContainers());

ipcMain.handle('stats', async (_e, ids) => ({
  containers: await docker.allStats(ids.filter((id) => ID_RE.test(id))),
  system: systemMemory(),
}));

// MemAvailable is what the system can actually still use (free + reclaimable cache).
function systemMemory() {
  const info = Object.fromEntries(
    fs.readFileSync('/proc/meminfo', 'utf8').trim().split('\n').map((line) => {
      const [key, value] = line.split(':');
      return [key, parseInt(value, 10) * 1024];
    })
  );
  return {
    total: info.MemTotal,
    used: info.MemTotal - info.MemAvailable,
    swapTotal: info.SwapTotal,
    swapUsed: info.SwapTotal - info.SwapFree,
    cpus: os.cpus().length,
  };
}

ipcMain.handle('start', (_e, id) => {
  checkId(id);
  return docker.startContainer(id);
});

ipcMain.handle('stop', (_e, id) => {
  checkId(id);
  return docker.stopContainer(id);
});

ipcMain.handle('remove', async (_e, id, name) => {
  checkId(id);
  if (!(await confirm(`Remove container "${name}"?`, 'Running containers are stopped first. Volumes are kept.'))) {
    return false;
  }
  await docker.removeContainer(id);
  return true;
});

ipcMain.handle('remove-project', async (_e, project) => {
  if (!PROJECT_RE.test(project)) throw new Error('Invalid project name');
  if (!(await confirm(`Remove all containers in "${project}"?`, 'Same as "docker compose down": containers and networks are removed, volumes are kept.'))) {
    return false;
  }
  return docker.removeProject(project);
});

ipcMain.handle('prune', async () => {
  if (!(await confirm('Remove all stopped containers?', 'Running containers are not touched. Volumes are kept.'))) {
    return null;
  }
  const res = await docker.pruneStopped();
  return (res.ContainersDeleted || []).length;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (stopWatching) stopWatching();
  app.quit();
});
