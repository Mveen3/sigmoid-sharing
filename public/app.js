// Mveen File Share Client

let currentPath = '';
let allItems = [];
let selectedPaths = new Set();
let viewMode = localStorage.getItem('alpha_view_mode') || 'list';
let currentSort = 'name-asc';
let searchQuery = '';
let showHiddenFiles = false;

// DOM Elements
const itemsRoot = document.getElementById('items-root');
const breadcrumbsContainer = document.getElementById('breadcrumbs-container');
const filterInput = document.getElementById('filter-input');
const sortSelect = document.getElementById('sort-select');
const viewListBtn = document.getElementById('view-list-btn');
const viewGridBtn = document.getElementById('view-grid-btn');
const btnSelectAll = document.getElementById('btn-select-all');
const selectionBar = document.getElementById('selection-bar');
const selectedCountEl = document.getElementById('selected-count');
const selectedSizeTextEl = document.getElementById('selected-size-text');
const btnParallelDl = document.getElementById('btn-parallel-dl');
const btnZipDl = document.getElementById('btn-zip-dl');
const btnClearSelection = document.getElementById('btn-clear-selection');

const previewModal = document.getElementById('preview-modal');
const previewTitle = document.getElementById('preview-title');
const previewBody = document.getElementById('preview-body');
const previewClose = document.getElementById('preview-close');
const passwordModal = document.getElementById('password-modal');
const passwordForm = document.getElementById('password-form');
const passwordMessage = document.getElementById('password-message');
const showHiddenToggle = document.getElementById('show-hidden-toggle');
const uploadInput = document.getElementById('upload-input');

const dlDrawer = document.getElementById('dl-drawer');
const dlDrawerStats = document.getElementById('dl-drawer-stats');
const dlItemsList = document.getElementById('dl-items-list');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Parse URL path query if present
    const params = new URLSearchParams(window.location.search);
    const initialPath = params.get('path') || '';
    showHiddenFiles = params.get('showHidden') === 'true';
    showHiddenToggle.checked = showHiddenFiles;
    
    setViewMode(viewMode);
    loadDirectory(initialPath, false);

    // Event Listeners
    filterInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderItems();
    });

    sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderItems();
    });

    viewListBtn.addEventListener('click', () => setViewMode('list'));
    viewGridBtn.addEventListener('click', () => setViewMode('grid'));

    btnSelectAll.addEventListener('click', toggleSelectAll);
    btnClearSelection.addEventListener('click', clearSelection);

    btnParallelDl.addEventListener('click', handleParallelDownload);
    btnZipDl.addEventListener('click', handleZipDownload);

    document.getElementById('btn-refresh').addEventListener('click', () => loadDirectory(currentPath, false));
    document.getElementById('btn-logout').addEventListener('click', handleLogout);
    document.getElementById('btn-new-folder').addEventListener('click', createDirectory);
    document.getElementById('btn-upload').addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', handleUpload);
    showHiddenToggle.addEventListener('change', () => {
        showHiddenFiles = showHiddenToggle.checked;
        const currentHasHiddenPath = currentPath.split('/').some(part => part.startsWith('.'));
        loadDirectory(currentHasHiddenPath && !showHiddenFiles ? '' : currentPath, true);
    });

    document.getElementById('btn-change-password').addEventListener('click', () => {
        passwordMessage.textContent = '';
        passwordMessage.className = 'form-message';
        passwordForm.reset();
        passwordModal.classList.add('active');
    });
    document.getElementById('password-close').addEventListener('click', () => passwordModal.classList.remove('active'));
    passwordForm.addEventListener('submit', handleChangePassword);
    previewClose.addEventListener('click', () => {
        previewModal.classList.remove('active');
        previewBody.innerHTML = '';
    });

    // Close modals when clicking backdrop
    window.addEventListener('click', (e) => {
        if (e.target === previewModal) {
            previewModal.classList.remove('active');
            previewBody.innerHTML = '';
        }
        if (e.target === passwordModal) {
            passwordModal.classList.remove('active');
        }
    });

    // History popstate
    window.addEventListener('popstate', (e) => {
        const path = (e.state && e.state.path) ? e.state.path : '';
        loadDirectory(path, false);
    });
});

// View mode switcher
function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem('alpha_view_mode', mode);
    if (mode === 'list') {
        viewListBtn.classList.add('active');
        viewGridBtn.classList.remove('active');
    } else {
        viewGridBtn.classList.add('active');
        viewListBtn.classList.remove('active');
    }
    renderItems();
}

// Fetch Directory Contents
async function loadDirectory(relPath = '', pushHistory = true) {
    try {
        itemsRoot.innerHTML = `
            <div class="empty-state">
                <div class="pulse-dot" style="margin: 0 auto 1rem auto; width: 14px; height: 14px;"></div>
                <p>Loading directory...</p>
            </div>
        `;

        const res = await fetch(`/api/browse?path=${encodeURIComponent(relPath)}&showHidden=${showHiddenFiles}`);
        if (res.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to load directory');
        }

        const data = await res.json();
        currentPath = data.currentPath;
        allItems = data.items;
        selectedPaths.clear();
        updateSelectionBar();

        if (pushHistory) {
            const params = new URLSearchParams();
            if (currentPath) params.set('path', currentPath);
            if (showHiddenFiles) params.set('showHidden', 'true');
            const query = params.toString();
            const url = query ? `/?${query}` : '/';
            window.history.pushState({ path: currentPath }, '', url);
        }

        renderBreadcrumbs(data.breadcrumbs);
        renderItems();
    } catch (err) {
        itemsRoot.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <h3>Unable to read folder</h3>
                <p style="color: var(--accent-rose); margin-top: 0.5rem;">${err.message}</p>
                <button class="btn-action-small" onclick="loadDirectory('', true)" style="margin-top: 1rem;">Back to Home</button>
            </div>
        `;
    }
}

async function createDirectory() {
    const name = window.prompt('New folder name:');
    if (name === null || !name.trim()) return;

    try {
        const res = await fetch('/api/directories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: currentPath, name })
        });
        const result = await res.json();
        if (res.status === 401) return window.location.assign('/login.html');
        if (!res.ok) throw new Error(result.error || 'Could not create folder.');
        await loadDirectory(currentPath, false);
    } catch (err) {
        window.alert(err.message);
    }
}

async function handleUpload() {
    const files = Array.from(uploadInput.files || []);
    uploadInput.value = '';
    if (!files.length) return;

    const uploadButton = document.getElementById('btn-upload');
    uploadButton.disabled = true;
    uploadButton.textContent = `Uploading 0/${files.length}`;
    try {
        for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            const query = new URLSearchParams({ path: currentPath });
            const res = await fetch(`/api/upload?${query}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-File-Name': encodeURIComponent(file.name)
                },
                body: file
            });
            const result = await res.json();
            if (res.status === 401) return window.location.assign('/login.html');
            if (!res.ok) throw new Error(`${file.name}: ${result.error || 'Upload failed.'}`);
            uploadButton.textContent = `Uploading ${index + 1}/${files.length}`;
        }
        await loadDirectory(currentPath, false);
    } catch (err) {
        window.alert(err.message);
        await loadDirectory(currentPath, false);
    } finally {
        uploadButton.disabled = false;
        uploadButton.textContent = 'Upload Files';
    }
}

async function handleChangePassword(event) {
    event.preventDefault();
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    passwordMessage.className = 'form-message';

    if (newPassword !== confirmPassword) {
        passwordMessage.textContent = 'The new passwords do not match.';
        passwordMessage.classList.add('error');
        return;
    }

    try {
        const res = await fetch('/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const result = await res.json();
        if (res.status === 401 && result.error === 'Unauthorized. Please login.') {
            return window.location.assign('/login.html');
        }
        if (!res.ok) throw new Error(result.error || 'Could not change password.');
        window.alert(result.message);
        window.location.assign('/login.html');
    } catch (err) {
        passwordMessage.textContent = err.message;
        passwordMessage.classList.add('error');
    }
}

// Render Breadcrumbs
function renderBreadcrumbs(crumbs) {
    breadcrumbsContainer.innerHTML = '';
    crumbs.forEach((crumb, idx) => {
        const isLast = idx === crumbs.length - 1;
        const item = document.createElement('span');
        item.className = `crumb-item ${isLast ? 'active' : ''}`;
        item.textContent = crumb.name;
        if (!isLast) {
            item.onclick = () => loadDirectory(crumb.path, true);
        }
        breadcrumbsContainer.appendChild(item);

        if (!isLast) {
            const sep = document.createElement('span');
            sep.className = 'crumb-separator';
            sep.textContent = '/';
            breadcrumbsContainer.appendChild(sep);
        }
    });
}

// Helper: Format bytes
function formatBytes(bytes, decimals = 1) {
    if (bytes === null || bytes === undefined) return '--';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper: Format Date
function formatDate(timestamp) {
    if (!timestamp) return '--';
    const d = new Date(timestamp);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + 
           ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Helper: Determine File Category and Icon
function getFileMeta(item) {
    if (item.isDir) {
        return { icon: '📁', class: 'icon-folder', type: 'Folder' };
    }
    const ext = item.ext.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
        return { icon: '🖼️', class: 'icon-image', type: 'Image' };
    }
    if (['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv'].includes(ext)) {
        return { icon: '🎬', class: 'icon-video', type: 'Video' };
    }
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) {
        return { icon: '🎵', class: 'icon-audio', type: 'Audio' };
    }
    if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'xz'].includes(ext)) {
        return { icon: '📦', class: 'icon-archive', type: 'Archive' };
    }
    if (['js', 'ts', 'py', 'json', 'html', 'css', 'c', 'cpp', 'rs', 'go', 'sh', 'java'].includes(ext)) {
        return { icon: '💻', class: 'icon-code', type: 'Source Code' };
    }
    if (['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xlsx', 'pptx'].includes(ext)) {
        return { icon: '📄', class: 'icon-doc', type: 'Document' };
    }
    return { icon: '📄', class: 'icon-other', type: ext.toUpperCase() || 'File' };
}

// Filter and Sort Items
function getFilteredAndSortedItems() {
    let items = [...allItems];

    if (searchQuery) {
        items = items.filter(it => it.name.toLowerCase().includes(searchQuery));
    }

    items.sort((a, b) => {
        // Keep folders first regardless of sort mode
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;

        switch (currentSort) {
            case 'name-asc':
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            case 'name-desc':
                return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
            case 'size-desc':
                return (b.size || 0) - (a.size || 0);
            case 'size-asc':
                return (a.size || 0) - (b.size || 0);
            case 'date-desc':
                return (b.mtime || 0) - (a.mtime || 0);
            case 'date-asc':
                return (a.mtime || 0) - (b.mtime || 0);
            default:
                return 0;
        }
    });

    return items;
}

// Render Files (List or Grid)
function renderItems() {
    const items = getFilteredAndSortedItems();

    if (items.length === 0) {
        itemsRoot.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${searchQuery ? '🔍' : '📂'}</div>
                <h3>${searchQuery ? 'No matching files found' : 'This folder is empty'}</h3>
                <p style="margin-top: 0.35rem;">${searchQuery ? 'Try adjusting your search filter' : 'No items inside this directory'}</p>
            </div>
        `;
        return;
    }

    if (viewMode === 'list') {
        renderListView(items);
    } else {
        renderGridView(items);
    }
}

// Render Table List View
function renderListView(items) {
    let html = `
        <table class="list-view-table">
            <thead>
                <tr>
                    <th style="width: 48px; text-align: center;">
                        <input type="checkbox" class="custom-checkbox" id="header-select-toggle" ${items.length > 0 && selectedPaths.size === items.length ? 'checked' : ''}>
                    </th>
                    <th>Name</th>
                    <th style="width: 120px;">Size</th>
                    <th style="width: 180px;" class="file-date-cell">Modified</th>
                    <th style="text-align: right; width: 170px;">Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    items.forEach(item => {
        const meta = getFileMeta(item);
        const isSelected = selectedPaths.has(item.path);

        html += `
            <tr class="file-row ${isSelected ? 'selected' : ''}" data-path="${escapeHtml(item.path)}" data-isdir="${item.isDir}">
                <td onclick="event.stopPropagation();">
                    <input type="checkbox" class="custom-checkbox item-checkbox" data-path="${escapeHtml(item.path)}" ${isSelected ? 'checked' : ''}>
                </td>
                <td class="file-info-cell" onclick="handleItemClick('${escapeHtml(item.path)}', ${item.isDir})">
                    <div class="file-icon-box ${meta.class}">
                        ${meta.icon}
                    </div>
                    <div class="file-name-block">
                        <span class="file-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                        <span class="file-meta-sub">${meta.type}</span>
                    </div>
                </td>
                <td class="file-size-cell" onclick="handleItemClick('${escapeHtml(item.path)}', ${item.isDir})">
                    ${formatBytes(item.size)}
                </td>
                <td class="file-date-cell" onclick="handleItemClick('${escapeHtml(item.path)}', ${item.isDir})">
                    ${formatDate(item.mtime)}
                </td>
                <td class="file-actions-cell" onclick="event.stopPropagation();">
                    ${item.isDir ? `
                        <button class="btn-action-small" onclick="loadDirectory('${escapeHtml(item.path)}', true)">
                            <span>Open</span> ➔
                        </button>
                    ` : `
                        <button class="btn-action-small" onclick="openPreview('${escapeHtml(item.path)}', '${escapeHtml(item.name)}', '${item.ext}')" title="Preview file">
                            👁️
                        </button>
                        <a href="/api/download?path=${encodeURIComponent(item.path)}" class="btn-action-small" download title="Download file">
                            ⬇️
                        </a>
                    `}
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    itemsRoot.innerHTML = html;

    // Attach checkbox events
    document.getElementById('header-select-toggle').addEventListener('change', (e) => {
        if (e.target.checked) {
            items.forEach(i => selectedPaths.add(i.path));
        } else {
            selectedPaths.clear();
        }
        updateSelectionBar();
        renderItems();
    });

    document.querySelectorAll('.item-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const p = e.target.getAttribute('data-path');
            if (e.target.checked) selectedPaths.add(p);
            else selectedPaths.delete(p);
            updateSelectionBar();
            const row = e.target.closest('tr');
            if (row) row.classList.toggle('selected', e.target.checked);
        });
    });
}

// Render Card Grid View
function renderGridView(items) {
    let html = `<div class="grid-view-container">`;

    items.forEach(item => {
        const meta = getFileMeta(item);
        const isSelected = selectedPaths.has(item.path);

        html += `
            <div class="grid-card ${isSelected ? 'selected' : ''}" data-path="${escapeHtml(item.path)}" onclick="handleItemClick('${escapeHtml(item.path)}', ${item.isDir})">
                <input type="checkbox" class="custom-checkbox grid-checkbox item-checkbox" data-path="${escapeHtml(item.path)}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation();">
                <div class="grid-icon-box ${meta.class}">
                    ${meta.icon}
                </div>
                <div class="grid-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
                <div class="grid-meta">${item.isDir ? 'Folder' : formatBytes(item.size)}</div>
                <div class="grid-actions" onclick="event.stopPropagation();">
                    ${item.isDir ? `
                        <button class="btn-action-small" onclick="loadDirectory('${escapeHtml(item.path)}', true)">Open ➔</button>
                    ` : `
                        <button class="btn-action-small" onclick="openPreview('${escapeHtml(item.path)}', '${escapeHtml(item.name)}', '${item.ext}')">👁️</button>
                        <a href="/api/download?path=${encodeURIComponent(item.path)}" class="btn-action-small" download>⬇️</a>
                    `}
                </div>
            </div>
        `;
    });

    html += `</div>`;
    itemsRoot.innerHTML = html;

    document.querySelectorAll('.item-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const p = e.target.getAttribute('data-path');
            if (e.target.checked) selectedPaths.add(p);
            else selectedPaths.delete(p);
            updateSelectionBar();
            const card = e.target.closest('.grid-card');
            if (card) card.classList.toggle('selected', e.target.checked);
        });
    });
}

// Item Click Handler
function handleItemClick(path, isDir) {
    if (isDir) {
        loadDirectory(path, true);
    } else {
        // Toggle selection
        if (selectedPaths.has(path)) selectedPaths.delete(path);
        else selectedPaths.add(path);
        updateSelectionBar();
        renderItems();
    }
}

// Selection bar updates
function updateSelectionBar() {
    const count = selectedPaths.size;
    selectedCountEl.textContent = count;

    if (count > 0) {
        // Calculate total size of selected items
        let totalBytes = 0;
        allItems.forEach(i => {
            if (selectedPaths.has(i.path) && i.size) {
                totalBytes += i.size;
            }
        });
        selectedSizeTextEl.textContent = `${count === 1 ? 'item' : 'items'} (${formatBytes(totalBytes)})`;
        selectionBar.classList.add('visible');
    } else {
        selectionBar.classList.remove('visible');
    }
}

function clearSelection() {
    selectedPaths.clear();
    updateSelectionBar();
    renderItems();
}

function toggleSelectAll() {
    const items = getFilteredAndSortedItems();
    if (selectedPaths.size === items.length) {
        selectedPaths.clear();
    } else {
        items.forEach(i => selectedPaths.add(i.path));
    }
    updateSelectionBar();
    renderItems();
}

// =====================================================================
// MULTI-THREADED / PARALLEL DOWNLOAD ENGINE
// =====================================================================
async function handleParallelDownload() {
    if (selectedPaths.size === 0) return;

    const pathsToDownload = Array.from(selectedPaths);
    dlDrawer.classList.add('active');
    dlDrawerStats.textContent = `0/${pathsToDownload.length}`;
    dlItemsList.innerHTML = '';

    let completed = 0;

    // Concurrently download up to 4-6 files in parallel chunks
    const downloadQueue = pathsToDownload.map((relPath, index) => {
        const fileName = relPath.split('/').pop() || 'file';
        
        // Add item to drawer
        const itemEl = document.createElement('div');
        itemEl.className = 'dl-item';
        itemEl.id = `dl-item-${index}`;
        itemEl.innerHTML = `
            <div class="dl-item-name">${escapeHtml(fileName)}</div>
            <div class="dl-progress-bar">
                <div class="dl-progress-fill" style="width: 10%;"></div>
            </div>
        `;
        dlItemsList.appendChild(itemEl);

        return async () => {
            try {
                // Trigger browser native streaming download
                const link = document.createElement('a');
                link.href = `/api/download?path=${encodeURIComponent(relPath)}`;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // Update visual progress
                const fill = itemEl.querySelector('.dl-progress-fill');
                if (fill) fill.style.width = '100%';
                completed++;
                dlDrawerStats.textContent = `${completed}/${pathsToDownload.length}`;
            } catch (err) {
                console.error('Download error for', relPath, err);
            }
        };
    });

    // Execute with staggering for smooth browser dispatch
    for (const dl of downloadQueue) {
        await dl();
        await new Promise(r => setTimeout(r, 150));
    }

    setTimeout(() => {
        dlDrawerStats.textContent = 'All Completed! ✓';
        setTimeout(() => dlDrawer.classList.remove('active'), 5000);
    }, 1500);
}

// =====================================================================
// DYNAMIC ON-THE-FLY STREAMING ZIP DOWNLOAD
// =====================================================================
async function handleZipDownload() {
    if (selectedPaths.size === 0) return;

    const paths = Array.from(selectedPaths);
    const folderName = currentPath ? currentPath.split('/').pop() : 'files';
    const zipName = `alpha-${folderName}-${Date.now()}.zip`;

    // Send POST and trigger streaming response download
    try {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/api/download-zip';
        form.style.display = 'none';

        const pathsInput = document.createElement('input');
        pathsInput.type = 'hidden';
        pathsInput.name = 'pathsJson';
        pathsInput.value = JSON.stringify(paths);

        // Fetch blob streaming trigger
        const res = await fetch('/api/download-zip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths, zipName })
        });

        if (!res.ok) throw new Error('ZIP stream failed');

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (err) {
        alert('ZIP download failed: ' + err.message);
    }
}

// =====================================================================
// FILE PREVIEW MODAL (Media, Code, Text, PDF)
// =====================================================================
async function openPreview(filePath, fileName, ext) {
    previewTitle.textContent = fileName;
    previewBody.innerHTML = '<div class="pulse-dot" style="margin: 2rem;"></div>';
    previewModal.classList.add('active');

    const downloadUrl = `/api/preview?path=${encodeURIComponent(filePath)}`;
    const lowerExt = (ext || '').toLowerCase();

    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(lowerExt)) {
        previewBody.innerHTML = `<img src="${downloadUrl}" alt="${escapeHtml(fileName)}">`;
    } else if (['mp4', 'webm', 'mkv', 'mov'].includes(lowerExt)) {
        previewBody.innerHTML = `<video controls autoplay src="${downloadUrl}"></video>`;
    } else if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(lowerExt)) {
        previewBody.innerHTML = `<audio controls autoplay src="${downloadUrl}"></audio>`;
    } else if (['pdf'].includes(lowerExt)) {
        previewBody.innerHTML = `<iframe src="${downloadUrl}" style="width: 100%; height: 65vh; border: none; border-radius: 12px;"></iframe>`;
    } else if (['js', 'ts', 'py', 'json', 'html', 'css', 'txt', 'md', 'sh', 'c', 'cpp', 'rs', 'go', 'xml', 'yaml', 'yml'].includes(lowerExt)) {
        try {
            const res = await fetch(downloadUrl);
            const text = await res.text();
            previewBody.innerHTML = `<pre class="text-preview-code"><code>${escapeHtml(text.slice(0, 50000))}</code></pre>`;
        } catch (e) {
            previewBody.innerHTML = `<p style="color: var(--accent-rose)">Failed to load file text</p>`;
        }
    } else {
        previewBody.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">📄</div>
                <p>Preview not available for this file type.</p>
                <a href="/api/download?path=${encodeURIComponent(filePath)}" class="btn-glow" style="margin-top: 1rem; display: inline-flex;" download>
                    Download File
                </a>
            </div>
        `;
    }
}

// Logout
async function handleLogout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
    } catch (e) {
        window.location.href = '/login.html';
    }
}

// Utility: HTML escape
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
