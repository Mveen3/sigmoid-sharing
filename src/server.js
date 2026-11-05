const cluster = require('cluster');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SHARED_ROOT = path.resolve(process.env.SHARED_ROOT || os.homedir());
const DEFAULT_USERNAME = process.env.AUTH_USER || 'sigmoid';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

function writeJsonFile(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, filePath);
}

function loadDeviceProfile() {
    const profilePath = path.join(DATA_DIR, 'device-profile.json');
    const cpus = os.cpus();
    const detectedProfile = {
        detectedAt: new Date().toISOString(),
        hostname: process.env.SHARE_HOSTNAME || os.hostname(),
        cpuModel: cpus[0]?.model || 'Unknown CPU',
        logicalCpuCount: Math.max(1, cpus.length),
        totalMemoryBytes: os.totalmem()
    };

    try {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        if (profile.hostname === detectedProfile.hostname &&
            profile.cpuModel === detectedProfile.cpuModel &&
            profile.logicalCpuCount === detectedProfile.logicalCpuCount &&
            profile.totalMemoryBytes === detectedProfile.totalMemoryBytes) {
            return profile;
        }
    } catch (err) {
        if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
    }

    writeJsonFile(profilePath, detectedProfile);
    return detectedProfile;
}

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function loadSecuritySettings() {
    const securityPath = path.join(DATA_DIR, 'security.json');
    try {
        const settings = JSON.parse(fs.readFileSync(securityPath, 'utf8'));
        if (settings.passwordSalt && settings.passwordHash && settings.passwordVersion && settings.sessionSecret) {
            if (typeof settings.username !== 'string' || !settings.username.trim()) {
                settings.username = DEFAULT_USERNAME;
                writeJsonFile(securityPath, settings);
            }
            return settings;
        }
    } catch (err) {
        if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
    }

    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const initialPassword = process.env.AUTH_PASS || 'patanahi';
    const settings = {
        username: DEFAULT_USERNAME,
        passwordSalt,
        passwordHash: hashPassword(initialPassword, passwordSalt),
        passwordVersion: crypto.randomUUID(),
        sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
    };
    writeJsonFile(securityPath, settings);
    return settings;
}

const DEVICE_PROFILE = loadDeviceProfile();
const NUM_WORKERS = Math.max(1, DEVICE_PROFILE.logicalCpuCount);
process.env.UV_THREADPOOL_SIZE = String(NUM_WORKERS);
const STREAM_BUFFER_BYTES = Math.max(
    64 * 1024,
    Math.min(8 * 1024 * 1024, Math.floor(DEVICE_PROFILE.totalMemoryBytes / (NUM_WORKERS * 256)))
);
const INITIAL_SECURITY_SETTINGS = loadSecuritySettings();
const SECRET_KEY = process.env.SESSION_SECRET || INITIAL_SECURITY_SETTINGS.sessionSecret;
const SECURITY_FILE = path.join(DATA_DIR, 'security.json');

/* =====================================================================
   MASTER PROCESS (Clustering and mDNS Broadcaster)
   ===================================================================== */
if (cluster.isPrimary) {
    console.log(`\n======================================================`);
    console.log(`  🚀 SIGMOID SHARING`);
    console.log(`======================================================`);
    console.log(`  Hardware : ${DEVICE_PROFILE.cpuModel} (${DEVICE_PROFILE.logicalCpuCount} logical CPUs, ${(DEVICE_PROFILE.totalMemoryBytes / 1024 ** 3).toFixed(1)} GB RAM)`);
    console.log(`  Shared Dir: ${SHARED_ROOT}`);
    console.log(`  Port     : ${PORT}`);
    console.log(`  Workers  : ${NUM_WORKERS} worker processes`);
    console.log(`------------------------------------------------------`);

    const hostname = DEVICE_PROFILE.hostname.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'sigmoid';
    let mdns = null;
    const mdnsScript = path.join(__dirname, 'mdns_publisher.py');
    if (fs.existsSync(mdnsScript)) {
        mdns = spawn('python3', [mdnsScript, hostname], {
            stdio: ['ignore', 'inherit', 'inherit']
        });
        mdns.on('error', (err) => {
            console.error('[Master] Failed to launch mDNS publisher:', err.message);
        });
        mdns.on('exit', (code) => {
            console.log(`[Master] mDNS publisher exited with code ${code}`);
        });
    }

    const cleanShutdown = () => {
        console.log('\n[Master] Gracefully shutting down Sigmoid Sharing...');
        if (mdns) {
            try { mdns.kill('SIGTERM'); } catch (e) {}
        }
        for (const id in cluster.workers) {
            try { cluster.workers[id].process.kill('SIGTERM'); } catch (e) {}
        }
        process.exit(0);
    };

    process.on('SIGINT', cleanShutdown);
    process.on('SIGTERM', cleanShutdown);
    process.on('SIGHUP', cleanShutdown);
    process.on('exit', () => {
        try { if (mdns) mdns.kill(); } catch (e) {}
    });
    for (let i = 0; i < NUM_WORKERS; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.warn(`[Master] Worker ${worker.process.pid} died (${signal || code}). Spawning replacement...`);
        cluster.fork();
    });

    // Print the hostname URL and current direct IPs for local setup.
    setTimeout(() => {
        const interfaces = os.networkInterfaces();
        const ips = [];

        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    ips.push({ name, ip: iface.address });
                }
            }
        }

        console.log(`\n  🌐 CONNECT FROM ANY DEVICE ON LAN / HOTSPOT:`);
        console.log(`  --------------------------------------------`);
        console.log(`  👉 Hostname URL     : http://${hostname}.local:${PORT}`);
        ips.forEach(i => {
            console.log(`  👉 Direct IP (${i.name.padEnd(7)}): http://${i.ip}:${PORT}`);
        });
        console.log(`======================================================\n`);
    }, 500);

    return;
}

/* =====================================================================
   WORKER PROCESS (Express Application, High-Speed Streaming Engine)
   ===================================================================== */
const express = require('express');
const cookieParser = require('cookie-parser');
const mime = require('mime-types');
const { ZipArchive } = require('archiver');

const app = express();
app.disable('x-powered-by');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SECRET_KEY));

// Helper: Session token creation & verification
function createSessionToken(user) {
    const expires = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
    const payload = JSON.stringify({
        user,
        expires,
        passwordVersion: loadSecuritySettings().passwordVersion
    });
    const hmac = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');
    return `${Buffer.from(payload).toString('base64')}.${hmac}`;
}

function verifySessionToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [b64, signature] = parts;
    const payload = Buffer.from(b64, 'base64').toString('utf8');
    const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');
    if (signature.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return null;
    }
    try {
        const session = JSON.parse(payload);
        const settings = loadSecuritySettings();
        if (Date.now() > session.expires || session.user !== settings.username || session.passwordVersion !== settings.passwordVersion) {
            return null;
        }
        return session.user;
    } catch (err) {
        return null;
    }
}

function verifyPassword(password, settings) {
    if (typeof password !== 'string' || !settings?.passwordSalt || !settings.passwordHash) return false;
    const actual = Buffer.from(hashPassword(password, settings.passwordSalt), 'hex');
    const expected = Buffer.from(settings.passwordHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Authentication Middleware
function authGuard(req, res, next) {
    const sessionToken = req.signedCookies.sigmoid_session || req.cookies.sigmoid_session;
    const user = verifySessionToken(sessionToken);
    if (user) {
        req.user = user;
        return next();
    }

    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized. Please login.' });
    }
    res.redirect('/login.html');
}

// Path validation helper: prevents directory traversal while allowing hidden files.
function resolveSafePath(relPath = '') {
    const absolute = path.resolve(SHARED_ROOT, String(relPath));
    const relative = path.relative(SHARED_ROOT, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Access denied: Path out of bounds');
    }
    if (absolute === SECURITY_FILE || absolute.startsWith(`${SECURITY_FILE}.`)) {
        throw new Error('Access denied: Private authentication settings');
    }
    return absolute;
}

function validateEntryName(name) {
    if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
        throw new Error('Choose a valid name without path separators.');
    }
    return name;
}

// Unprotected static routes
app.use(express.static(path.join(PROJECT_ROOT, 'public'), {
    index: false,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') && path.basename(filePath) === 'index.html') {
            // Index must be guarded
        }
    }
}));

// Login Page
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'public', 'login.html'));
});

// Brute-force protection: Rate limit login attempts per IP
const failedLoginAttempts = new Map();

// Auth API: Login
app.post('/api/login', (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = failedLoginAttempts.get(clientIp) || { count: 0, lockUntil: 0 };

    if (now < record.lockUntil) {
        const remainingMins = Math.ceil((record.lockUntil - now) / 60000);
        return res.status(429).json({
            success: false,
            error: `Too many failed attempts. Locked out for ${remainingMins} min(s).`
        });
    }

    const { username, password } = req.body;
    const settings = loadSecuritySettings();
    if (username === settings.username && verifyPassword(password, settings)) {
        failedLoginAttempts.delete(clientIp);
        const token = createSessionToken(username);
        res.cookie('sigmoid_session', token, {
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000,
            sameSite: 'lax',
            path: '/'
        });
        return res.json({ success: true, message: 'Login successful' });
    }

    record.count += 1;
    if (record.count >= 5) {
        record.lockUntil = now + (10 * 60 * 1000); // 10 minutes lockout
        failedLoginAttempts.set(clientIp, record);
        return res.status(429).json({
            success: false,
            error: 'Too many failed login attempts. Access temporarily locked for 10 minutes.'
        });
    }

    failedLoginAttempts.set(clientIp, record);
    return res.status(401).json({ success: false, error: 'Invalid username or password' });
});

// Auth API: Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('sigmoid_session', { path: '/' });
    res.json({ success: true });
});

app.post('/api/change-password', authGuard, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const currentSettings = loadSecuritySettings();

    if (!verifyPassword(currentPassword, currentSettings)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }
    if (newPassword === currentPassword) {
        return res.status(400).json({ error: 'Choose a password different from the current password.' });
    }

    const passwordSalt = crypto.randomBytes(16).toString('hex');
    writeJsonFile(SECURITY_FILE, {
        ...currentSettings,
        passwordSalt,
        passwordHash: hashPassword(newPassword, passwordSalt),
        passwordVersion: crypto.randomUUID()
    });
    res.clearCookie('sigmoid_session', { path: '/' });
    return res.json({ success: true, message: 'Password changed. Please sign in again.' });
});

app.post('/api/change-username', authGuard, (req, res) => {
    const { currentPassword, newUsername } = req.body || {};
    const currentSettings = loadSecuritySettings();
    const normalizedUsername = typeof newUsername === 'string' ? newUsername.trim() : '';

    if (!verifyPassword(currentPassword, currentSettings)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(normalizedUsername)) {
        return res.status(400).json({ error: 'Username must be 3–32 characters and use only letters, numbers, dots, underscores, or hyphens.' });
    }
    if (normalizedUsername === currentSettings.username) {
        return res.status(400).json({ error: 'Choose a username different from the current username.' });
    }

    writeJsonFile(SECURITY_FILE, {
        ...currentSettings,
        username: normalizedUsername,
        passwordVersion: crypto.randomUUID()
    });
    res.clearCookie('sigmoid_session', { path: '/' });
    return res.json({ success: true, message: 'Username changed. Please sign in with your new username.' });
});

// Protected main route
app.get('/', authGuard, (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'public', 'index.html'));
});

// File Explorer API: Browse directory contents
app.get('/api/browse', authGuard, async (req, res) => {
    try {
        const relPath = req.query.path || '';
        const showHidden = req.query.showHidden === 'true';
        const pathParts = String(relPath).split(/[/\\]/).filter(Boolean);
        if (!showHidden && pathParts.some(part => part.startsWith('.'))) {
            return res.status(404).json({ error: 'Directory not found' });
        }
        const absPath = resolveSafePath(relPath);

        const stats = await fs.promises.stat(absPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Target path is not a directory' });
        }

        const entries = await fs.promises.readdir(absPath, { withFileTypes: true });
        const items = [];

        for (const entry of entries) {
            if (!showHidden && entry.name.startsWith('.')) continue;
            if (entry.isSymbolicLink()) continue;

            const itemAbs = path.join(absPath, entry.name);
            if (itemAbs === SECURITY_FILE || itemAbs.startsWith(`${SECURITY_FILE}.`)) continue;
            const itemRel = path.relative(SHARED_ROOT, itemAbs);

            try {
                const itemStat = await fs.promises.stat(itemAbs);
                const isDir = entry.isDirectory();
                const ext = isDir ? '' : path.extname(entry.name).toLowerCase().slice(1);
                const mimeType = isDir ? 'folder' : (mime.lookup(entry.name) || 'application/octet-stream');

                items.push({
                    name: entry.name,
                    path: itemRel,
                    isDir,
                    size: isDir ? null : itemStat.size,
                    mtime: itemStat.mtimeMs,
                    ext,
                    mimeType
                });
            } catch (err) {
                // Ignore permission or unreadable file errors
            }
        }

        // Sort: directories first, then alphabetically
        items.sort((a, b) => {
            if (a.isDir && !b.isDir) return -1;
            if (!a.isDir && b.isDir) return 1;
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        // Compute breadcrumbs
        const parts = relPath.split(/[/\\]/).filter(Boolean);
        const breadcrumbs = [{ name: 'Home', path: '' }];
        let cur = '';
        for (const p of parts) {
            cur = cur ? `${cur}/${p}` : p;
            breadcrumbs.push({ name: p, path: cur });
        }

        res.json({
            currentPath: relPath,
            breadcrumbs,
            items
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/directories', authGuard, async (req, res) => {
    try {
        const parentPath = req.body?.path || '';
        const name = validateEntryName(req.body?.name);
        const allowExisting = req.body?.allowExisting === true;
        const parentAbs = resolveSafePath(parentPath);
        const parentStat = await fs.promises.stat(parentAbs);
        if (!parentStat.isDirectory()) return res.status(400).json({ error: 'Target path is not a directory.' });

        const directoryPath = path.join(parentAbs, name);
        try {
            await fs.promises.mkdir(directoryPath);
        } catch (err) {
            if (err.code !== 'EEXIST' || !allowExisting) throw err;
            const existingStat = await fs.promises.stat(directoryPath);
            if (!existingStat.isDirectory()) throw err;
            return res.json({ success: true, exists: true });
        }
        return res.status(201).json({ success: true });
    } catch (err) {
        if (err.code === 'EEXIST') return res.status(409).json({ error: 'An item with that name already exists.' });
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Target directory was not found.' });
        return res.status(400).json({ error: err.message });
    }
});

app.post('/api/upload', authGuard, async (req, res) => {
    let destinationPath;
    let fileHandle;
    try {
        const parentPath = req.query.path || '';
        const encodedName = req.get('x-file-name');
        if (!encodedName) return res.status(400).json({ error: 'File name is required.' });

        let decodedName;
        try {
            decodedName = decodeURIComponent(encodedName);
        } catch (err) {
            return res.status(400).json({ error: 'File name is invalid.' });
        }
        const fileName = validateEntryName(decodedName);
        const parentAbs = resolveSafePath(parentPath);
        const parentStat = await fs.promises.stat(parentAbs);
        if (!parentStat.isDirectory()) return res.status(400).json({ error: 'Target path is not a directory.' });

        destinationPath = path.join(parentAbs, fileName);
        fileHandle = await fs.promises.open(destinationPath, 'wx', 0o644);
        const fileStream = fileHandle.createWriteStream();
        fileHandle = null;
        await pipeline(req, fileStream);
        return res.status(201).json({ success: true, name: fileName });
    } catch (err) {
        if (fileHandle) await fileHandle.close().catch(() => {});
        if (destinationPath && err.code !== 'EEXIST') await fs.promises.unlink(destinationPath).catch(() => {});
        if (err.code === 'EEXIST') return res.status(409).json({ error: 'An item with that name already exists.' });
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Target directory was not found.' });
        if (!res.headersSent) return res.status(400).json({ error: `Upload failed: ${err.message}` });
        return res.end();
    }
});

// High-speed Single File Download with HTTP 206 Partial Content (Range Support)
app.get('/api/download', authGuard, async (req, res) => {
    try {
        const relPath = req.query.path;
        if (!relPath) return res.status(400).send('File path required');

        const absPath = resolveSafePath(relPath);
        const stats = await fs.promises.stat(absPath);

        if (stats.isDirectory()) {
            return res.status(400).send('Cannot download directory directly with single-file download. Use ZIP download.');
        }

        const fileName = path.basename(absPath);
        const fileSize = stats.size;
        const contentType = mime.lookup(fileName) || 'application/octet-stream';
        const encodedFileName = encodeURIComponent(fileName).replace(/['()]/g, escape);

        // Check for Range request header (Used by multi-thread download managers and resume)
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (start >= fileSize || end >= fileSize || start > end) {
                res.status(416).set({
                    'Content-Range': `bytes */${fileSize}`
                }).end();
                return;
            }

            const chunksize = (end - start) + 1;
            const fileStream = fs.createReadStream(absPath, {
                start,
                end,
                highWaterMark: STREAM_BUFFER_BYTES
            });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"; filename*=UTF-8''${encodedFileName}`
            });

            fileStream.pipe(res);
        } else {
            // Full file transfer
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Accept-Ranges': 'bytes',
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"; filename*=UTF-8''${encodedFileName}`
            });

            const fileStream = fs.createReadStream(absPath, {
                highWaterMark: STREAM_BUFFER_BYTES
            });
            fileStream.pipe(res);
        }
    } catch (err) {
        console.error('Download error:', err);
        res.status(500).send(`Download failed: ${err.message}`);
    }
});

// Inline File Preview API (Media, Text, PDF)
app.get('/api/preview', authGuard, async (req, res) => {
    try {
        const relPath = req.query.path;
        if (!relPath) return res.status(400).send('Path required');

        const absPath = resolveSafePath(relPath);
        const stats = await fs.promises.stat(absPath);
        if (stats.isDirectory()) return res.status(400).send('Is directory');

        const fileName = path.basename(absPath);
        const mimeType = mime.lookup(fileName) || 'application/octet-stream';
        const fileSize = stats.size;

        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (start >= fileSize || end >= fileSize || start > end) {
                return res.status(416).set({ 'Content-Range': `bytes */${fileSize}` }).end();
            }

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': mimeType,
                'Content-Disposition': `inline; filename="${fileName}"`
            });

            fs.createReadStream(absPath, { start, end, highWaterMark: STREAM_BUFFER_BYTES }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Accept-Ranges': 'bytes',
                'Content-Type': mimeType,
                'Content-Disposition': `inline; filename="${fileName}"`
            });
            fs.createReadStream(absPath, { highWaterMark: STREAM_BUFFER_BYTES }).pipe(res);
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Dynamic On-The-Fly Streaming ZIP for Multi-File Downloads
app.post('/api/download-zip', authGuard, async (req, res) => {
    try {
        const { paths, zipName } = req.body;
        if (!paths || !Array.isArray(paths) || paths.length === 0) {
            return res.status(400).json({ error: 'No files selected for ZIP download' });
        }

        const outName = zipName || `download-${Date.now()}.zip`;
        const encodedOutName = encodeURIComponent(outName).replace(/['()]/g, escape);

        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${outName}"; filename*=UTF-8''${encodedOutName}`,
            'Transfer-Encoding': 'chunked'
        });

        // Use fast zlib compression (store or fast deflate level 1 for maximum streaming speed)
        const archive = new ZipArchive({
            zlib: { level: 1 } // Level 1 maximizes CPU speed while still compressing
        });

        archive.on('error', (err) => {
            console.error('Archive error:', err);
            if (!res.headersSent) {
                res.status(500).send({ error: err.message });
            }
        });

        // Pipe directly to HTTP response stream without saving to temporary files
        archive.pipe(res);

        for (const itemRel of paths) {
            try {
                const itemAbs = resolveSafePath(itemRel);
                const stat = await fs.promises.stat(itemAbs);
                const itemName = path.basename(itemAbs);

                if (stat.isDirectory()) {
                    archive.directory(itemAbs, itemName);
                } else {
                    archive.file(itemAbs, { name: itemName });
                }
            } catch (e) {
                console.warn(`Skipping missing/unreadable file in zip: ${itemRel}`);
            }
        }

        await archive.finalize();
    } catch (err) {
        console.error('ZIP creation error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

// Catch-all
app.use((req, res) => {
    res.status(404).send('Not Found');
});

// Start worker HTTP server
app.listen(PORT, HOST, () => {
    // Worker is listening
});
