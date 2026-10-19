const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');
const sortEl = document.getElementById('sort');
const toastEl = document.getElementById('toast');
const $ = (id) => document.getElementById(id);

const STATS_INTERVAL = 3000;
const GB = 1024 ** 3;

let containers = [];
let stats = {}; // container id -> { memory, cpu }
let system = null; // host memory from /proc/meminfo
let filter = 'all';
const busy = new Set(); // container ids / project names with an action in flight
const collapsed = new Set(readStored('collapsed', []));

async function load() {
  try {
    containers = await window.docker.list();
    render();
  } catch (err) {
    listEl.innerHTML = '';
    listEl.append(el('div', 'empty error', `Cannot reach Docker: ${err.message}`));
  }
}

// Stats take ~1-2s per call, so poll on a loop instead of a fixed interval to avoid overlap.
async function pollStats() {
  try {
    const ids = containers.filter((c) => c.state === 'running').map((c) => c.id);
    const res = await window.docker.stats(ids);
    stats = res.containers;
    system = res.system;
    render();
  } catch {
    // keep showing the last numbers
  }
  setTimeout(pollStats, STATS_INTERVAL);
}

function matches(c) {
  if (filter === 'running' && c.state !== 'running') return false;
  if (filter === 'stopped' && c.state === 'running') return false;
  const q = searchEl.value.trim().toLowerCase();
  if (!q) return true;
  return [c.name, c.image, c.project || ''].some((s) => s.toLowerCase().includes(q));
}

const memOf = (c) => (c.state === 'running' && stats[c.id] ? stats[c.id].memory : 0);
const cpuOf = (c) => (c.state === 'running' && stats[c.id] ? stats[c.id].cpu : 0);

function compare(a, b) {
  const runDiff = (b.state === 'running') - (a.state === 'running');
  if (runDiff) return runDiff;
  if (sortEl.value === 'memory') return memOf(b) - memOf(a) || a.name.localeCompare(b.name);
  if (sortEl.value === 'cpu') return cpuOf(b) - cpuOf(a) || a.name.localeCompare(b.name);
  return a.name.localeCompare(b.name);
}

function render() {
  renderSummary();

  const groups = new Map();
  for (const c of containers.filter(matches)) {
    const key = c.project || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  listEl.innerHTML = '';
  if (!groups.size) {
    listEl.append(el('div', 'empty', containers.length ? 'No containers match.' : 'No containers.'));
    return;
  }

  // Heaviest project first when sorting by usage; standalone containers always last.
  const total = (items, fn) => items.reduce((sum, c) => sum + fn(c), 0);
  const keys = [...groups.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    if (sortEl.value === 'memory') return total(groups.get(b), memOf) - total(groups.get(a), memOf);
    if (sortEl.value === 'cpu') return total(groups.get(b), cpuOf) - total(groups.get(a), cpuOf);
    return a.localeCompare(b);
  });
  for (const key of keys) listEl.append(renderGroup(key, groups.get(key)));
}

function renderSummary() {
  const running = containers.filter((c) => c.state === 'running');
  const ctrMem = running.reduce((sum, c) => sum + memOf(c), 0);
  const ctrCpu = running.reduce((sum, c) => sum + cpuOf(c), 0);

  $('ctr-count').textContent = `${running.length} running`;
  $('ctr-count-foot').textContent = `${containers.length - running.length} stopped · ${containers.length} total`;

  if (!system) return;
  const sysPct = system.used / system.total;
  $('sys-mem').textContent = `${fmtBytes(system.used)} / ${fmtBytes(system.total)}`;
  setMeter('sys-mem-bar', sysPct);
  $('sys-swap').textContent = system.swapTotal
    ? `Swap ${fmtBytes(system.swapUsed)} / ${fmtBytes(system.swapTotal)}`
    : 'No swap';
  $('sys-swap').classList.toggle('warn', system.swapTotal && system.swapUsed / system.swapTotal > 0.8);

  $('ctr-mem').textContent = fmtBytes(ctrMem);
  setMeter('ctr-mem-bar', ctrMem / system.total);
  $('ctr-mem-foot').textContent = `${pct(ctrMem / system.total)} of system RAM`;

  const cpuCapacity = system.cpus * 100;
  $('ctr-cpu').textContent = `${ctrCpu.toFixed(0)}%`;
  setMeter('ctr-cpu-bar', ctrCpu / cpuCapacity);
  $('ctr-cpu-foot').textContent = `${pct(ctrCpu / cpuCapacity)} of ${system.cpus} cores`;
}

function renderGroup(project, items) {
  const key = project || '__standalone';
  const isCollapsed = collapsed.has(key);
  const running = items.filter((c) => c.state === 'running');
  const groupMem = running.reduce((sum, c) => sum + memOf(c), 0);

  const section = el('section', `group${isCollapsed ? ' collapsed' : ''}`);
  const head = el('div', 'group-head');

  const toggle = el('button', 'group-toggle');
  toggle.append(el('span', 'chevron', '▾'), el('span', 'group-name', project || 'Standalone containers'));
  toggle.onclick = () => {
    isCollapsed ? collapsed.delete(key) : collapsed.add(key);
    writeStored('collapsed', [...collapsed]);
    render();
  };

  head.append(
    toggle,
    el('span', 'pill', `${running.length}/${items.length} running`),
    groupMem ? el('span', `pill mem ${memLevel(groupMem)}`, fmtBytes(groupMem)) : el('span'),
    el('span', 'spacer')
  );

  if (project) {
    const isBusy = busy.has(project);
    if (running.length) {
      const stopAll = el('button', 'ghost small', 'Stop all');
      stopAll.disabled = isBusy;
      stopAll.onclick = () =>
        act(project, () => Promise.all(running.map((c) => window.docker.stop(c.id))), () => `Stopped ${project}`);
      head.append(stopAll);
    } else {
      const startAll = el('button', 'ghost small', 'Start all');
      startAll.disabled = isBusy;
      startAll.onclick = () =>
        act(project, () => Promise.all(items.map((c) => window.docker.start(c.id))), () => `Started ${project}`);
      head.append(startAll);
    }
    const remove = el('button', 'danger small', isBusy ? 'Working…' : 'Remove project');
    remove.disabled = isBusy;
    remove.onclick = () =>
      act(project, () => window.docker.removeProject(project), (n) => n !== false && `Removed ${n} containers from ${project}`);
    head.append(remove);
  }
  section.append(head);

  if (!isCollapsed) {
    const body = el('div', 'group-body');
    for (const c of items.sort(compare)) body.append(renderRow(c));
    section.append(body);
  }
  return section;
}

function renderRow(c) {
  const isRunning = c.state === 'running';
  const isBusy = busy.has(c.id);
  const s = isRunning ? stats[c.id] : null;
  const row = el('div', `row${isRunning ? '' : ' stopped'}`);

  const info = el('div', 'info');
  const nameLine = el('div', 'name-line');
  nameLine.append(el('span', `dot ${isRunning ? 'on' : 'off'}`), el('span', 'name', c.name));
  nameLine.title = c.name;
  info.append(nameLine, el('div', 'image', c.image));

  const mem = el('div', 'metric');
  if (s) {
    mem.append(el('span', `metric-value ${memLevel(s.memory)}`, fmtBytes(s.memory)));
    const bar = el('div', 'meter thin');
    const fill = el('div', memLevel(s.memory));
    fill.style.width = `${Math.min((s.memory / (system ? system.total : GB * 32)) * 100, 100)}%`;
    bar.append(fill);
    mem.append(bar);
  } else {
    mem.append(el('span', 'muted', isRunning ? '…' : '—'));
  }

  const cpu = el('div', 'metric');
  if (s) {
    cpu.append(el('span', `metric-value ${s.cpu > 200 ? 'high' : s.cpu > 80 ? 'mid' : ''}`, `${s.cpu.toFixed(1)}%`));
  } else {
    cpu.append(el('span', 'muted', isRunning ? '…' : '—'));
  }

  const status = el('div', 'status', c.status);

  const ports = el('div', 'ports');
  for (const p of c.ports) ports.append(el('span', 'port', p));

  const actions = el('div', 'actions');
  const toggle = el('button', 'ghost small', isRunning ? 'Stop' : 'Start');
  toggle.disabled = isBusy;
  toggle.onclick = () => act(c.id, () => (isRunning ? window.docker.stop(c.id) : window.docker.start(c.id)));
  const remove = el('button', 'danger small icon', isBusy ? '…' : 'Remove');
  remove.disabled = isBusy;
  remove.onclick = () => act(c.id, () => window.docker.remove(c.id, c.name), (ok) => ok && `Removed ${c.name}`);
  actions.append(toggle, remove);

  row.append(info, mem, cpu, status, ports, actions);
  return row;
}

async function act(key, fn, message) {
  busy.add(key);
  render();
  try {
    const result = await fn();
    const text = message && message(result);
    if (text) toast(text);
  } catch (err) {
    toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
  } finally {
    busy.delete(key);
    await load();
  }
}

// Absolute thresholds: what matters on a dev machine is GBs, not % of a cgroup limit.
function memLevel(bytes) {
  if (bytes >= 4 * GB) return 'high';
  if (bytes >= 1 * GB) return 'mid';
  return 'low';
}

function setMeter(id, ratio) {
  const fill = $(id);
  fill.style.width = `${Math.min(ratio * 100, 100)}%`;
  fill.classList.toggle('high', ratio > 0.85);
  fill.classList.toggle('mid', ratio > 0.65 && ratio <= 0.85);
}

function fmtBytes(bytes) {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

const pct = (ratio) => `${(ratio * 100).toFixed(0)}%`;

function toast(text, isError = false) {
  toastEl.textContent = text;
  toastEl.className = `toast${isError ? ' error' : ''}`;
  toastEl.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (toastEl.hidden = true), 3500);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not critical
  }
}

$('tabs').addEventListener('click', (e) => {
  if (!e.target.dataset.filter) return;
  filter = e.target.dataset.filter;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b === e.target));
  render();
});
searchEl.addEventListener('input', render);
sortEl.value = readStored('sort', 'memory');
sortEl.addEventListener('change', () => {
  writeStored('sort', sortEl.value);
  render();
});
$('refresh').onclick = load;
$('prune').onclick = () =>
  act('prune', () => window.docker.prune(), (n) => n !== null && `Removed ${n} stopped containers`);

window.docker.onChange(load);
load().then(pollStats);
