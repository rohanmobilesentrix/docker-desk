#!/bin/bash
# Ubuntu 23.10+ restricts unprivileged user namespaces through AppArmor, so Electron
# needs the SUID sandbox helper. electron-builder's default script only sets the bit
# when namespaces are unavailable to root, which leaves it unset on those systems.
chmod 4755 '/opt/Docker Desk/chrome-sandbox' || true

ln -sf '/opt/Docker Desk/docker-desk' '/usr/bin/docker-desk'

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
