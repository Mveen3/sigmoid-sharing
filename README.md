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

The mDNS publisher advertises the device as `http://<system-name>.local:8080` (for example, `http://mveen.local:8080` on this device). Direct IP addresses are also printed at startup. Linux mDNS publishing needs Avahi and its Python D-Bus bindings. Set `SHARE_HOSTNAME` to override the system hostname used for the `.local` address.

## Sign in and browse

- Username: `sigmoid` by default. Set `AUTH_USER` before the first startup to choose a different initial name.
- On the first start, the initial password comes from `AUTH_PASS`, or defaults to `patanahi`.
- Change the username or password from the signed-in page. Each change requires the current password and signs out all sessions. User and password settings are stored in `data/security.json`; the password is stored as a salted hash.
- Dot-prefixed files and folders are hidden initially. Turn on **Show hidden files** to view and browse them.
- Use **New Folder**, **Upload Files**, or **Upload Folder** in any open directory. Folder uploads preserve the selected folder and its nested file structure.

The `data/` JSON files contain device-specific or private settings and are excluded from version control. Keep them on the device where the service runs.

## Forgot the username or password?

If you have physical or terminal access to the computer running the server, reset the local login from that computer:

```bash
cd /path/to/your/sigmoid-sharing-clone
./scripts/share.sh stop
unlink data/security.json
./scripts/share.sh start
```

Replace the first line with the directory where you cloned the repository. This resets both credentials and signs out all sessions. Unless `AUTH_USER` or `AUTH_PASS` is configured for the service, sign in with username `sigmoid` and password `patanahi`, then change them from the app. The security file is recreated on startup. Do not delete it if you only want to change one credential; use the signed-in account settings instead.

## systemd service

The management script renders the service template in `deploy/sigmoid-share.service` using the clone's current directory, then installs it when starting, restarting, or enabling the service. This lets the repository be cloned into different directories without editing a machine-specific path:

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
