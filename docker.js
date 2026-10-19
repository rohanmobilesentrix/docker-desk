// Minimal Docker Engine API client over the local Unix socket.
const http = require('http');

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

function request(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, method, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const data = body ? safeJson(body) : null;
        if (res.statusCode >= 400) {
          reject(new Error((data && data.message) || `Docker API ${res.statusCode}`));
        } else {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function listContainers() {
  const raw = await request('GET', '/containers/json?all=true');
  return raw.map((c) => ({
    id: c.Id,
    name: (c.Names[0] || '').replace(/^\//, ''),
    image: c.Image,
    state: c.State,
    status: c.Status,
    created: c.Created,
    project: c.Labels['com.docker.compose.project'] || null,
    service: c.Labels['com.docker.compose.service'] || null,
    ports: [...new Set(
      (c.Ports || [])
        .filter((p) => p.PublicPort)
        .map((p) => `${p.PublicPort}→${p.PrivatePort}`)
    )],
  }));
}

// Same numbers as `docker stats`: memory excludes page cache, CPU is % of one core.
async function containerStats(id) {
  const s = await request('GET', `/containers/${id}/stats?stream=false`);
  const mem = s.memory_stats || {};
  const cache = (mem.stats && (mem.stats.inactive_file ?? mem.stats.total_inactive_file)) || 0;
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = s.cpu_stats.system_cpu_usage - (s.precpu_stats.system_cpu_usage || 0);
  const cpus = s.cpu_stats.online_cpus || 1;
  return {
    memory: Math.max((mem.usage || 0) - cache, 0),
    cpu: sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0,
  };
}

async function allStats(ids) {
  const entries = await Promise.all(
    ids.map((id) => containerStats(id).then((s) => [id, s]).catch(() => null))
  );
  return Object.fromEntries(entries.filter(Boolean));
}

const startContainer =(id) => request('POST', `/containers/${id}/start`);
const stopContainer = (id) => request('POST', `/containers/${id}/stop`);
// Volumes are kept (v=false) so database data survives removal.
const removeContainer = (id) => request('DELETE', `/containers/${id}?force=true&v=false`);
const pruneStopped = () => request('POST', '/containers/prune');

// Like `docker compose down`: remove the project's containers, then its networks.
async function removeProject(project) {
  const filter = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${project}`] }));
  const containers = await request('GET', `/containers/json?all=true&filters=${filter}`);
  await Promise.all(containers.map((c) => removeContainer(c.Id)));
  const networks = await request('GET', `/networks?filters=${filter}`);
  await Promise.all(networks.map((n) => request('DELETE', `/networks/${n.Id}`).catch(() => {})));
  return containers.length;
}

// Streams container events; calls onEvent for each. Returns a function that stops the stream.
function watchEvents(onEvent, onClose) {
  const filter = encodeURIComponent(JSON.stringify({ type: ['container'] }));
  const req = http.request({ socketPath: SOCKET, method: 'GET', path: `/events?filters=${filter}` }, (res) => {
    res.on('data', () => onEvent());
    res.on('end', onClose);
  });
  req.on('error', onClose);
  req.end();
  return () => req.destroy();
}

module.exports = {
  listContainers,
  allStats,
  startContainer,
  stopContainer,
  removeContainer,
  removeProject,
  pruneStopped,
  watchEvents,
};
