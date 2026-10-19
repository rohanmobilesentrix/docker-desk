# Docker Desk

Small Electron app for Ubuntu to view, start/stop and remove Docker containers.

- Containers grouped by Docker Compose project, with All / Running / Stopped filters and search
- Remove one container, a whole compose project (like `docker compose down`), or all stopped containers
- Updates live from Docker events
- Volumes are never removed, so database data is kept

## Run

    npm install
    npm start

Your user needs to be in the `docker` group.

## Build a .deb / AppImage

    npm run dist   # output in dist/
