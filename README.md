# Sigmoid Sharing

A local network file browser for sharing and downloading files across Wi-Fi or a hotspot.

## Project layout

- `src/server.js` — Express server, authentication, directory browsing, uploads, and downloads.
- `src/mdns_publisher.py` — advertises the system hostname on the local network.
- `public/` — browser interface.
- `scripts/` — service management and optional port 80 redirect scripts.
- `deploy/` — systemd user service definition.
- `data/` — device hardware profile and private authentication settings, created at startup.

## Run

```bash
npm install
npm start
```

On its first start, the server records the CPU model, logical CPU count, hostname, and total physical RAM in `data/device-profile.json`. It uses the detected logical CPUs for the worker pool and sizes file stream buffers using the recorded total RAM. The RAM value is the machine's capacity, not currently free memory.

The mDNS publisher advertises the device as `http://<system-name>.local:8080` (for example, `http://mveen.local:8080`). Direct IP addresses are also printed at startup. Linux mDNS publishing needs Avahi and its Python D-Bus bindings.

## Sign in and browse

- Username: `mveen` by default. Set `AUTH_USER` before startup to use another name.
- On the first start, the initial password comes from `AUTH_PASS`, or defaults to `patanahi`.
- Change the password from the signed-in page using **Change Password**. The new salted password hash is stored in `data/security.json`; the old password no longer works after restart.
- Dot-prefixed files and folders are hidden initially. Turn on **Show hidden files** to view and browse them.
- Use **New Folder**, **Upload Files**, or **Upload Folder** in any open directory. Folder uploads preserve the selected folder and its nested file structure.

The `data/` JSON files contain device-specific or private settings and are excluded from version control. Keep them on the device where the service runs.

## systemd service

The management script installs the service definition from `deploy/alpha-share.service` when starting, restarting, or enabling it:

```bash
./scripts/share.sh start
./scripts/share.sh status
./scripts/share.sh logs
./scripts/share.sh restart
./scripts/share.sh stop
./scripts/share.sh enable
```

To open the same hostname URL without `:8080`, optionally run:

```bash
sudo ./scripts/enable-port-80.sh
```
