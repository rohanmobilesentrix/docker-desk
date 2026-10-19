<p align="center"><img src="icon.png" width="96" alt=""></p>

# Docker Desk

A small desktop app for Ubuntu to see what your Docker containers are doing and clean them up.

- Live **RAM and CPU** per container (same numbers as `docker stats`), plus system memory and swap
- Containers grouped by Docker Compose project, heaviest first
- **Start / Stop / Remove** a container, **Stop all / Remove** a whole project (like `docker compose down`), or **Remove all stopped**
- Every removal asks for confirmation. Volumes are never removed, so database data is kept.

## Install on Ubuntu (.deb)

Requirements: Ubuntu 22.04 or newer (64-bit), with Docker installed.

1. Get `docker-desk_<version>_amd64.deb` from the [Releases page](https://github.com/rohanmobilesentrix/docker-desk/releases), or from whoever shared it with you.

2. Install it (run this in the folder where the file is):

   ```bash
   sudo apt install ./docker-desk_1.0.0_amd64.deb
   ```

   Use `./` in front of the file name, otherwise `apt` searches online instead of installing the local file.

3. Make sure your user can talk to Docker without `sudo`. Skip this if `docker ps` already works for you.

   ```bash
   sudo usermod -aG docker $USER
   ```

   Then **log out and log back in** (or restart) for this to take effect.

4. Open **Docker Desk** from the app menu, or run `docker-desk` in a terminal.

### Update

Install the newer `.deb` the same way. It replaces the old version.

### Uninstall

```bash
sudo apt remove docker-desk
```

### Troubleshooting

| Problem | Fix |
|---|---|
| App shows "Cannot reach Docker: permission denied" | Step 3 above, then log out and in |
| App shows "Cannot reach Docker: connect ENOENT" | Docker isn't running: `sudo systemctl start docker` |
| App doesn't open at all | Run `docker-desk` in a terminal to see the error. If it mentions `chrome-sandbox`, run `sudo chmod 4755 "/opt/Docker Desk/chrome-sandbox"` |

## Development

```bash
npm install
npm start
```

On Ubuntu 23.10+ Electron's sandbox helper needs root ownership and the setuid bit after every `npm install` (run `chown` first, since it clears the setuid bit):

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

### Build the .deb

```bash
npm run dist   # → dist/docker-desk_<version>_amd64.deb
```

Bump `version` in `package.json` before building a new release.
