// ---------- tiny helpers ----------

const $content = document.getElementById('content');
const $pageTitle = document.getElementById('pageTitle');
const $topbarActions = document.getElementById('topbarActions');
const $modalBackdrop = document.getElementById('modalBackdrop');
const $modal = document.getElementById('modal');
const $toasts = document.getElementById('toasts');

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': window.NYARR_API_KEY || ''
    },
    ...options
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`);
  return body;
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = message;
  $toasts.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function openModal(html) {
  $modal.innerHTML = html;
  $modalBackdrop.classList.add('open');
}
function closeModal() {
  $modalBackdrop.classList.remove('open');
  $modal.innerHTML = '';
}
$modalBackdrop.addEventListener('click', (e) => { if (e.target === $modalBackdrop) closeModal(); });

// ---------- image lightbox ----------

const $lightbox = document.createElement('div');
$lightbox.className = 'lightbox';
$lightbox.innerHTML = `
  <button class="lightbox-close" title="Close">✕</button>
  <img class="lightbox-img" alt="" />
`;
document.body.appendChild($lightbox);

function openLightbox(postId) {
  const img = $lightbox.querySelector('.lightbox-img');
  img.src = `/library-files/${postId}`;
  $lightbox.classList.add('open');
}
function closeLightbox() {
  $lightbox.querySelector('.lightbox-img').src = '';
  $lightbox.classList.remove('open');
}
$lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
$lightbox.addEventListener('click', (e) => { if (e.target === $lightbox) closeLightbox(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $lightbox.classList.contains('open')) closeLightbox(); });

const SOURCES = [
  { id: 'danbooru', label: 'Danbooru', requiresCredentials: false },
  { id: 'gelbooru', label: 'Gelbooru', requiresCredentials: true },
  { id: 'e621', label: 'e621', requiresCredentials: false },
  { id: 'rule34', label: 'Rule34', requiresCredentials: true },
  { id: 'safebooru', label: 'Safebooru', requiresCredentials: false },
  { id: 'konachan', label: 'Konachan', requiresCredentials: false },
  { id: 'yandere', label: 'Yande.re', requiresCredentials: false },
  { id: 'furbooru', label: 'Furbooru', requiresCredentials: false },
  { id: 'sankaku', label: 'Sankaku Complex', requiresCredentials: true },
  { id: 'realbooru', label: 'Realbooru', requiresCredentials: true },
  { id: 'tbib', label: 'TBIB', requiresCredentials: false },
  { id: 'behoimi', label: 'Behoimi (3dBooru)', requiresCredentials: true }
];

const RATING_FILTERS = [
  { id: 'safe', label: 'Safe only' },
  { id: 'safe_questionable', label: 'Safe + Questionable' },
  { id: 'all', label: 'All ratings' }
];

const STATUS_LABEL = {
  new: 'New', queued: 'Queued', downloading: 'Downloading',
  downloaded: 'Downloaded', failed: 'Failed'
};

// ---------- router ----------

const ROUTES = {
  dashboard: { title: 'Dashboard', render: renderDashboard },
  tagsets: { title: 'Sets', render: renderTagSets },
  artists: { title: 'Artists', render: renderArtists },
  library: { title: 'Library', render: renderLibrary },
  tags: { title: 'Tags', render: renderTags },
  activity: { title: 'Activity', render: renderActivity },
  settings: { title: 'Settings', render: renderSettings }
};

const SETTINGS_CATEGORIES = [
  { id: 'general', label: 'General', desc: 'Instance name and port' },
  { id: 'library', label: 'Library', desc: 'Where downloaded files are saved, and importing an existing folder' },
  { id: 'security', label: 'Security', desc: 'Web UI authentication and the API key' },
  { id: 'indexers', label: 'Indexers', desc: 'Credentials for each booru source' },
  { id: 'backup', label: 'Backup & Restore', desc: 'Export or restore all nyarr data as a single file' }
];

let currentRoute = 'dashboard';
let currentSettingsSub = null;

// Sub-navigation shown when the Tags tab is selected (like Settings categories)
const TAGS_SUB = [
  { id: 'tagsets', label: 'Sets' }
];

function route() {
  const parts = window.location.hash.replace('#/', '').split('/').filter(Boolean);
  const hash = parts[0] || 'dashboard';
  const found = ROUTES[hash] ? hash : 'dashboard';
  currentRoute = found;
  currentSettingsSub = found === 'settings' ? (parts[1] || null) : null;

  document.querySelectorAll('.nav > a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === found);
  });
  renderNavSub();

  const activeCategory = found === 'settings'
    ? SETTINGS_CATEGORIES.find((c) => c.id === currentSettingsSub)
    : (found === 'tagsets' ? TAGS_SUB.find((c) => c.id === 'tagsets') : null);
  $pageTitle.textContent = activeCategory ? activeCategory.label : ROUTES[found].title;
  $topbarActions.innerHTML = '';
  // Logout button (only meaningful when auth is enabled; server ignores it otherwise)
  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'btn';
  logoutBtn.textContent = 'Logout';
  logoutBtn.onclick = async () => {
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/login';
  };
  $topbarActions.appendChild(logoutBtn);
  $content.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  ROUTES[found].render();
}

function renderNavSub() {
  const tagsEl = document.getElementById('navSubTags');
  const settingsEl = document.getElementById('navSubSettings');

  // Tags sub-nav: only shows Sets
  if (currentRoute === 'tags' || currentRoute === 'tagsets') {
    tagsEl.classList.add('open');
    tagsEl.innerHTML = TAGS_SUB.map((c) => `
      <a href="#/${c.id}" class="nav-sub-link${currentRoute === c.id ? ' active' : ''}">${c.label}</a>
    `).join('');
  } else {
    tagsEl.classList.remove('open');
    tagsEl.innerHTML = '';
  }

  // Settings sub-nav: categories
  if (currentRoute === 'settings') {
    settingsEl.classList.add('open');
    settingsEl.innerHTML = SETTINGS_CATEGORIES.map((c) => `
      <a href="#/settings/${c.id}" class="nav-sub-link${currentSettingsSub === c.id ? ' active' : ''}">${c.label}</a>
    `).join('');
  } else {
    settingsEl.classList.remove('open');
    settingsEl.innerHTML = '';
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  if (window.NYARR_INSTANCE_NAME && window.NYARR_INSTANCE_NAME !== 'nyarr') {
    document.title = window.NYARR_INSTANCE_NAME;
  }
  route();
  setInterval(() => {
    // light auto-refresh so queue/activity progress is visible without reload
    if (currentRoute === 'dashboard' || currentRoute === 'activity' || currentRoute === 'library') {
      ROUTES[currentRoute].render();
    }
  }, 12000);
});

// ---------- dashboard ----------

async function renderDashboard() {
  const [stats, activity, recent] = await Promise.all([api('/stats'), api('/activity'), api('/downloads/recent?limit=8')]);
  $content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card accent"><div class="value">${stats.tagSetsEnabled}</div><div class="label">Active tag sets</div></div>
      <div class="stat-card"><div class="value">${stats.totalPosts}</div><div class="label">Indexed posts</div></div>
      <div class="stat-card"><div class="value">${stats.downloaded}</div><div class="label">Downloaded</div></div>
      <div class="stat-card warn"><div class="value">${stats.queued}</div><div class="label">In queue</div></div>
      <div class="stat-card danger"><div class="value">${stats.failed}</div><div class="label">Failed</div></div>
    </div>
    <h2 class="section-title">Latest downloads</h2>
    ${recent.length ? `<div class="recent-downloads">${recent.map(recentDownloadCard).join('')}</div>`
      : emptyState('Nothing downloaded yet', 'Files you download will show up here.', '#/library', 'Go to library')}
    <h2 class="section-title">Recent activity</h2>
    ${activity.length ? `<div class="activity-list">${activity.slice(0, 8).map(activityRow).join('')}</div>`
      : emptyState('No activity yet', 'Create a tag set to start indexing posts.', '#/tagsets', 'Add a tag set')}
  `;
}

function activityRow(a) {
  return `<div class="activity-row ${a.level}">
    <span class="dot"></span>
    <span class="msg">${esc(a.message)}</span>
    <span class="time">${timeAgo(a.at)}</span>
  </div>`;
}

function recentDownloadCard(p) {
  const name = p.filePath.split(/[\\/]/).pop();
  const tags = p.tags.map((t) => `<span class="tag-pill">${esc(t)}</span>`).join('');
  return `<a class="download-card" href="/library-files/${p.id}" target="_blank" rel="noopener">
    <span class="download-ext">${esc((p.ext || 'img').toUpperCase())}</span>
    <span class="download-info">
      <span class="download-name">${esc(name)}</span>
      <span class="download-meta">${esc(p.source)} · ${timeAgo(p.downloadedAt)}</span>
      ${tags ? `<span class="tag-pills">${tags}</span>` : ''}
    </span>
  </a>`;
}

function emptyState(title, body, href, cta) {
  return `<div class="empty">
    <h3>${esc(title)}</h3>
    <p>${esc(body)}</p>
    ${href ? `<a class="btn btn-primary" href="${href}">${esc(cta)}</a>` : ''}
  </div>`;
}

// ---------- batch selection ----------

// Selected ids per route, so switching pages doesn't lose your picks.
const batchSelection = { tagsets: new Set(), artists: new Set(), library: new Set() };

function batchToolbarHtml(route, actions) {
  return `
    <div class="batch-bar" id="batchBar-${route}" style="display:none">
      <span class="batch-count" id="batchCount-${route}"></span>
      ${actions.map((a) => `<button class="btn btn-sm" data-batch="${a.id}">${esc(a.label)}</button>`).join('')}
      <button class="btn btn-sm" data-batch="clear">Clear selection</button>
    </div>`;
}

function updateBatchBar(route, actions) {
  const bar = document.getElementById(`batchBar-${route}`);
  if (!bar) return;
  const count = batchSelection[route].size;
  bar.style.display = count ? '' : 'none';
  document.getElementById(`batchCount-${route}`).textContent = `${count} selected`;
  bar.querySelectorAll('[data-batch]').forEach((btn) => {
    btn.onclick = () => {
      const action = btn.dataset.batch;
      if (action === 'clear') {
        batchSelection[route].clear();
        refreshRoute();
        return;
      }
      const def = actions.find((a) => a.id === action);
      if (def) def.run([...batchSelection[route]]);
    };
  });
}

function selectionCheckbox(route, id) {
  const checked = batchSelection[route].has(id) ? 'checked' : '';
  return `<input type="checkbox" class="batch-check" data-route="${route}" data-id="${id}" ${checked} title="Select" />`;
}

function bindSelectionChecks(route, rerender) {
  document.querySelectorAll(`.batch-check[data-route="${route}"]`).forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) batchSelection[route].add(id);
      else batchSelection[route].delete(id);
      updateBatchBar(route, currentBatchActions[route] || []);
    });
  });
  // Select-all toggle in the toolbar
  document.getElementById(`selectAll-${route}`)?.addEventListener('change', (e) => {
    const on = e.target.checked;
    document.querySelectorAll(`.batch-check[data-route="${route}"]`).forEach((cb) => {
      cb.checked = on;
      const id = Number(cb.dataset.id);
      if (on) batchSelection[route].add(id);
      else batchSelection[route].delete(id);
    });
    updateBatchBar(route, currentBatchActions[route] || []);
  });
  void rerender;
}

// Per-route action definitions, set by each render function so the generic
// binding helpers know what the toolbar buttons do.
const currentBatchActions = {};

function refreshRoute() {
  ROUTES[currentRoute].render();
}

// ---------- drag-to-select (rubber band) ----------

// Lets the user drag a rectangle over the library grid to select every post
// card it touches — much faster than ticking checkboxes one by one. Holding
// Shift while dragging ADDS to the existing selection instead of replacing
// it. The overlay div is appended to <body> once and repositioned per drag.
const $rubberBand = document.createElement('div');
$rubberBand.className = 'rubber-band';
$rubberBand.style.display = 'none';
document.body.appendChild($rubberBand);

let dragSelect = null; // active drag state or null

function initDragSelect() {
  const grid = document.querySelector('.library-grid');
  if (!grid) return;

  grid.addEventListener('mousedown', (e) => {
    // Only left button; ignore clicks on interactive elements (checkboxes,
    // buttons, links) so normal per-card actions still work.
    if (e.button !== 0) return;
    if (e.target.closest('input, button, a, select, label')) return;
    e.preventDefault();

    dragSelect = {
      startX: e.clientX,
      startY: e.clientY,
      additive: e.shiftKey,
      // Snapshot the selection at drag start: additive drags build on it,
      // replacing drags clear it first.
      base: new Set(batchSelection.library),
      touched: new Set()
    };
    if (!dragSelect.additive) batchSelection.library.clear();
    syncLibraryChecks();
    moveRubberBand(e.clientX, e.clientY, e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragSelect) return;
    moveRubberBand(dragSelect.startX, dragSelect.startY, e.clientX, e.clientY);
    const rect = $rubberBand.getBoundingClientRect();
    const newlyTouched = new Set();
    grid.querySelectorAll('.post-card').forEach((card) => {
      const cb = card.querySelector('.batch-check');
      if (!cb) return;
      const id = Number(cb.dataset.id);
      const r = card.getBoundingClientRect();
      const overlaps = r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
      if (overlaps) newlyTouched.add(id);
    });
    dragSelect.touched = newlyTouched;
    const next = new Set(dragSelect.base);
    newlyTouched.forEach((id) => next.add(id));
    batchSelection.library = next;
    syncLibraryChecks();
    updateBatchBar('library', currentBatchActions.library || []);
  });

  document.addEventListener('mouseup', () => {
    if (!dragSelect) return;
    dragSelect = null;
    $rubberBand.style.display = 'none';
  });
}

function moveRubberBand(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  $rubberBand.style.display = 'block';
  $rubberBand.style.left = `${left}px`;
  $rubberBand.style.top = `${top}px`;
  $rubberBand.style.width = `${width}px`;
  $rubberBand.style.height = `${height}px`;
}

// Re-sync the visible checkboxes with the selection set without a full
// re-render (a re-render mid-drag would kill the drag).
function syncLibraryChecks() {
  document.querySelectorAll('.batch-check[data-route="library"]').forEach((cb) => {
    cb.checked = batchSelection.library.has(Number(cb.dataset.id));
  });
}

// ---------- tag sets ----------

async function renderTagSets() {
  $topbarActions.innerHTML = `<button class="btn btn-primary" id="addTagSetBtn">+ Add tag set</button>`;
  document.getElementById('addTagSetBtn').onclick = () => openTagSetModal();

  const tagSets = await api('/tagsets');
  if (!tagSets.length) {
    $content.innerHTML = emptyState('No tag sets yet', 'A tag set watches a booru for posts matching your tags and pulls them in automatically.', null, null);
    return;
  }

  currentBatchActions.tagsets = [
    { id: 'enable', label: 'Enable', run: (ids) => batchTagSets('enable', ids) },
    { id: 'disable', label: 'Disable', run: (ids) => batchTagSets('disable', ids) },
    { id: 'search', label: 'Search now', run: (ids) => batchTagSets('search', ids) },
    { id: 'delete', label: 'Delete', run: (ids) => batchTagSets('delete', ids) }
  ];

  $content.innerHTML = `
    <div class="batch-toolbar">
      <label class="select-all-label"><input type="checkbox" id="selectAll-tagsets" /> Select all</label>
    </div>
    ${batchToolbarHtml('tagsets', currentBatchActions.tagsets)}
    <div class="tagset-list">${tagSets.map(tagSetCard).join('')}</div>`;

  updateBatchBar('tagsets', currentBatchActions.tagsets);
  bindSelectionChecks('tagsets');

  tagSets.forEach((t) => {
    document.getElementById(`ts-toggle-${t.id}`)?.addEventListener('click', () => toggleTagSet(t));
    document.getElementById(`ts-search-${t.id}`)?.addEventListener('click', (e) => searchNow(t, e.target));
    document.getElementById(`ts-edit-${t.id}`)?.addEventListener('click', () => openTagSetModal(t));
    document.getElementById(`ts-delete-${t.id}`)?.addEventListener('click', () => deleteTagSet(t));
  });
}

async function batchTagSets(action, ids) {
  if (action === 'delete' && !confirm(`Delete ${ids.length} tag set(s)? Already-downloaded files are kept.`)) return;
  try {
    const result = await api('/tagsets/batch', { method: 'POST', body: JSON.stringify({ action, ids }) });
    if (action === 'search') toast(`Batch search started for ${result.started} tag set(s) — results land in the activity feed`);
    else toast(`Batch ${action}: ${result.affected ?? result.deleted ?? ids.length} tag set(s)`);
    batchSelection.tagsets.clear();
    renderTagSets();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function tagSetCard(t) {
  const tagList = t.tags.split(' ').filter(Boolean).slice(0, 8);
  const sourceLabel = SOURCES.find((s) => s.id === t.source)?.label || t.source;
  return `
  <div class="tagset-card ${t.enabled ? '' : 'disabled'}">
    ${selectionCheckbox('tagsets', t.id)}
    <div class="switch ${t.enabled ? 'on' : ''}" id="ts-toggle-${t.id}" title="Enable/disable"></div>
    <div class="tagset-main">
      <div class="tagset-name-row">
        <span class="tagset-name">${esc(t.name)}</span>
        <span class="source-badge">${esc(sourceLabel)}</span>
      </div>
      <div class="tag-pills">${tagList.map((tag) => `<span class="tag-pill">${esc(tag)}</span>`).join('')}</div>
      <div class="tagset-meta">
        <span>${t.postCount} indexed · ${t.downloadedCount} downloaded</span>
        <span>Every ${t.intervalMinutes}m</span>
        <span>${t.maxPages === 0 ? 'All pages' : t.maxPages != null ? `Max ${t.maxPages} page${t.maxPages > 1 ? 's' : ''}/check` : 'Auto backfill'}</span>
        <span>Checked ${timeAgo(t.lastChecked)}</span>
        ${t.autoDownload ? '<span>Auto-download on</span>' : ''}
        ${t.lastError ? `<span style="color:var(--danger)">Error: ${esc(t.lastError)}</span>` : ''}
      </div>
    </div>
    <div class="tagset-actions">
      <button class="btn btn-sm" id="ts-search-${t.id}">Search now</button>
      <button class="btn btn-sm btn-icon" id="ts-edit-${t.id}" title="Edit">✎</button>
      <button class="btn btn-sm btn-icon btn-danger" id="ts-delete-${t.id}" title="Delete">🗑</button>
    </div>
  </div>`;
}

function tagSetFormHtml(t) {
  const isEdit = Boolean(t);
  return `
    <h2>${isEdit ? 'Edit tag set' : 'Add tag set'}</h2>
    <form id="tagSetForm">
      <div class="form-row">
        <label>Name</label>
        <input name="name" required placeholder="e.g. Blue-eyed cats" value="${esc(t?.name || '')}" />
      </div>
      <div class="form-row">
        <label>Source</label>
        <select name="source" ${isEdit ? 'disabled' : ''}>
          ${SOURCES.map((s) => `<option value="${s.id}" ${t?.source === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Tags (space-separated, booru syntax)</label>
        <input name="tags" required placeholder="cat blue_eyes -monochrome" value="${esc(t?.tags || '')}" />
      </div>
      <div class="form-row">
        <label>Rating filter</label>
        <select name="ratingFilter">
          ${RATING_FILTERS.map((r) => `<option value="${r.id}" ${(t?.ratingFilter || 'safe_questionable') === r.id ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Minimum score</label>
        <input name="minScore" type="number" min="0" value="${t?.minScore ?? 0}" />
      </div>
      <div class="form-row">
        <label>Check interval (minutes)</label>
        <input name="intervalMinutes" type="number" min="5" value="${t?.intervalMinutes ?? 60}" />
      </div>
      <div class="form-row">
        <label>Max pages per check (100 posts/page)</label>
        <select name="maxPages">
          <option value="" ${t?.maxPages == null ? 'selected' : ''}>Auto — backfill everything, then catch up</option>
          <option value="0" ${t?.maxPages === 0 ? 'selected' : ''}>Unlimited (walk all pages every check)</option>
          ${[1, 3, 5, 10, 25, 50].map((n) => `<option value="${n}" ${t?.maxPages === n ? 'selected' : ''}>${n} page${n > 1 ? 's' : ''} (${n * 100} posts)</option>`).join('')}
        </select>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="autoDownload" name="autoDownload" ${t?.autoDownload ? 'checked' : ''} />
        <label for="autoDownload">Automatically download new matches</label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="cancelModalBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Create tag set'}</button>
      </div>
    </form>
  `;
}

function openTagSetModal(t) {
  openModal(tagSetFormHtml(t));
  document.getElementById('cancelModalBtn').onclick = closeModal;
  document.getElementById('tagSetForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get('name').trim(),
      source: fd.get('source'),
      tags: fd.get('tags').trim(),
      ratingFilter: fd.get('ratingFilter'),
      minScore: Number(fd.get('minScore')) || 0,
      intervalMinutes: Number(fd.get('intervalMinutes')) || 60,
      maxPages: fd.get('maxPages') === '' ? null : Number(fd.get('maxPages')),
      autoDownload: fd.get('autoDownload') === 'on'
    };
    try {
      if (t) await api(`/tagsets/${t.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/tagsets', { method: 'POST', body: JSON.stringify(payload) });
      closeModal();
      toast(t ? 'Tag set updated' : 'Tag set created');
      renderTagSets();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function toggleTagSet(t) {
  try {
    await api(`/tagsets/${t.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !t.enabled }) });
    renderTagSets();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function searchNow(t, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const result = await api(`/tagsets/${t.id}/search-now`, { method: 'POST' });
    toast(`"${t.name}": found ${result.inserted} new post(s)`);
    renderTagSets();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Search now';
  }
}

async function deleteTagSet(t) {
  if (!confirm(`Delete "${t.name}"? Already-downloaded files are kept.`)) return;
  try {
    await api(`/tagsets/${t.id}`, { method: 'DELETE' });
    toast('Tag set deleted');
    renderTagSets();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- artists (all-indexer watches) ----------

async function renderArtists() {
  $topbarActions.innerHTML = `<button class="btn btn-primary" id="addArtistBtn">+ Add artist</button>`;
  document.getElementById('addArtistBtn').onclick = () => openArtistModal();

  const artists = await api('/artists');
  if (!artists.length) {
    $content.innerHTML = emptyState(
      'No artists yet',
      'An artist watch searches the artist tag on every indexer at once and pulls in everything it finds — no need to pick a single source.',
      null, null);
    return;
  }

  currentBatchActions.artists = [
    { id: 'enable', label: 'Enable', run: (ids) => batchArtists('enable', ids) },
    { id: 'disable', label: 'Disable', run: (ids) => batchArtists('disable', ids) },
    { id: 'search', label: 'Search now', run: (ids) => batchArtists('search', ids) },
    { id: 'delete', label: 'Delete', run: (ids) => batchArtists('delete', ids) }
  ];

  $content.innerHTML = `
    <div class="batch-toolbar">
      <label class="select-all-label"><input type="checkbox" id="selectAll-artists" /> Select all</label>
    </div>
    ${batchToolbarHtml('artists', currentBatchActions.artists)}
    <div class="tagset-list">${artists.map(artistCard).join('')}</div>`;

  updateBatchBar('artists', currentBatchActions.artists);
  bindSelectionChecks('artists');

  artists.forEach((a) => {
    document.getElementById(`ar-toggle-${a.id}`)?.addEventListener('click', () => toggleArtist(a));
    document.getElementById(`ar-search-${a.id}`)?.addEventListener('click', (e) => searchNowArtist(a, e.target));
    document.getElementById(`ar-view-${a.id}`)?.addEventListener('click', () => viewArtistLibrary(a));
    document.getElementById(`ar-edit-${a.id}`)?.addEventListener('click', () => openArtistModal(a));
    document.getElementById(`ar-delete-${a.id}`)?.addEventListener('click', () => deleteArtist(a));
  });
}

async function batchArtists(action, ids) {
  if (action === 'delete' && !confirm(`Delete ${ids.length} artist watch(es)? Already-downloaded files are kept.`)) return;
  try {
    const result = await api('/artists/batch', { method: 'POST', body: JSON.stringify({ action, ids }) });
    if (action === 'search') toast(`Batch search started for ${result.started} artist watch(es) — results land in the activity feed`);
    else toast(`Batch ${action}: ${result.affected ?? result.deleted ?? ids.length} artist watch(es)`);
    batchSelection.artists.clear();
    renderArtists();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function artistCard(a) {
  return `
  <div class="tagset-card ${a.enabled ? '' : 'disabled'}">
    ${selectionCheckbox('artists', a.id)}
    <div class="switch ${a.enabled ? 'on' : ''}" id="ar-toggle-${a.id}" title="Enable/disable"></div>
    <div class="tagset-main">
      <div class="tagset-name-row">
        <span class="tagset-name">${esc(a.name)}</span>
        <span class="source-badge">Configured indexers</span>
      </div>
      <div class="tag-pills"><span class="tag-pill">${esc(a.artistTag)}</span>${a.alsoSearchNameAsTag ? `<span class="tag-pill">+ "${esc(a.name)}" as tag</span>` : ''}</div>
      <div class="tagset-meta">
        <span>${a.postCount} indexed · ${a.downloadedCount} downloaded</span>
        <span>Every ${a.intervalMinutes}m</span>
        <span>${a.maxPages === 0 ? 'All pages' : a.maxPages != null ? `Max ${a.maxPages} page${a.maxPages > 1 ? 's' : ''}/check` : 'Auto backfill'}</span>
        <span>Checked ${timeAgo(a.lastChecked)}</span>
        ${a.autoDownload ? '<span>Auto-download on</span>' : ''}
        ${a.lastError ? `<span style="color:var(--danger)">Error: ${esc(a.lastError)}</span>` : ''}
      </div>
    </div>
    <div class="tagset-actions">
      <button class="btn btn-sm" id="ar-search-${a.id}">Search now</button>
      <button class="btn btn-sm" id="ar-view-${a.id}">View posts</button>
      <button class="btn btn-sm btn-icon" id="ar-edit-${a.id}" title="Edit">✎</button>
      <button class="btn btn-sm btn-icon btn-danger" id="ar-delete-${a.id}" title="Delete">🗑</button>
    </div>
  </div>`;
}

function artistFormHtml(a) {
  const isEdit = Boolean(a);
  return `
    <h2>${isEdit ? 'Edit artist' : 'Add artist'}</h2>
    <p style="margin:-6px 0 14px;color:var(--text-dim);font-size:13px;">
      Artist watches search <strong>every indexer at once</strong> — the same artwork reposted on
      multiple boorus is deduplicated by hash, so you get one library entry per image.
    </p>
    <form id="artistForm">
      <div class="form-row">
        <label>Display name</label>
        <input name="name" required placeholder="e.g. WLOP" value="${esc(a?.name || '')}" />
      </div>
      <div class="form-row">
        <label>Artist tag (booru syntax)</label>
        <input name="artistTag" required placeholder="e.g. wlop" value="${esc(a?.artistTag || '')}" />
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="alsoSearchNameAsTag" name="alsoSearchNameAsTag" ${a?.alsoSearchNameAsTag ? 'checked' : ''} />
        <label for="alsoSearchNameAsTag">Also search the display name as a regular tag</label>
      </div>
      <p class="hint" style="margin:-4px 0 14px">Some boorus don't file everything under the artist tag but credit the artist as a plain tag — enable this to search both.</p>
      <div class="form-row">
        <label>Rating filter</label>
        <select name="ratingFilter">
          ${RATING_FILTERS.map((r) => `<option value="${r.id}" ${(a?.ratingFilter || 'safe_questionable') === r.id ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Minimum score</label>
        <input name="minScore" type="number" min="0" value="${a?.minScore ?? 0}" />
      </div>
      <div class="form-row">
        <label>Check interval (minutes)</label>
        <input name="intervalMinutes" type="number" min="5" value="${a?.intervalMinutes ?? 60}" />
      </div>
      <div class="form-row">
        <label>Max pages per check per indexer (100 posts/page)</label>
        <select name="maxPages">
          <option value="" ${a?.maxPages == null ? 'selected' : ''}>Auto — backfill everything, then catch up</option>
          <option value="0" ${a?.maxPages === 0 ? 'selected' : ''}>Unlimited (walk all pages every check)</option>
          ${[1, 3, 5, 10, 25, 50].map((n) => `<option value="${n}" ${a?.maxPages === n ? 'selected' : ''}>${n} page${n > 1 ? 's' : ''} (${n * 100} posts)</option>`).join('')}
        </select>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="artistAutoDownload" name="autoDownload" ${a?.autoDownload ? 'checked' : ''} />
        <label for="artistAutoDownload">Automatically download new matches</label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="cancelModalBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Create artist watch'}</button>
      </div>
    </form>
  `;
}

function openArtistModal(a) {
  openModal(artistFormHtml(a));
  document.getElementById('cancelModalBtn').onclick = closeModal;
  document.getElementById('artistForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get('name').trim(),
      artistTag: fd.get('artistTag').trim(),
      alsoSearchNameAsTag: fd.get('alsoSearchNameAsTag') === 'on',
      ratingFilter: fd.get('ratingFilter'),
      minScore: Number(fd.get('minScore')) || 0,
      intervalMinutes: Number(fd.get('intervalMinutes')) || 60,
      maxPages: fd.get('maxPages') === '' ? null : Number(fd.get('maxPages')),
      autoDownload: fd.get('autoDownload') === 'on'
    };
    try {
      if (a) await api(`/artists/${a.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/artists', { method: 'POST', body: JSON.stringify(payload) });
      closeModal();
      toast(a ? 'Artist updated' : 'Artist watch created');
      renderArtists();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function toggleArtist(a) {
  try {
    await api(`/artists/${a.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !a.enabled }) });
    renderArtists();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function searchNowArtist(a, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const result = await api(`/artists/${a.id}/search-now`, { method: 'POST' });
    const errNote = result.errors && result.errors.length ? ` (${result.errors.length} source(s) errored)` : '';
    toast(`"${a.name}": found ${result.inserted} new post(s)${errNote}`);
    renderArtists();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Search now';
  }
}

function viewArtistLibrary(a) {
  libraryState.artistId = a.id;
  libraryState.page = 1;
  window.location.hash = '#/library';
  renderLibrary();
}

async function deleteArtist(a) {
  if (!confirm(`Delete "${a.name}"? Already-downloaded files are kept.`)) return;
  try {
    await api(`/artists/${a.id}`, { method: 'DELETE' });
    toast('Artist watch deleted');
    renderArtists();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- library ----------

const libraryState = { status: '', source: '', q: '', page: 1, pageSize: 40, artistId: null };

// Guards for renderLibrary: prevents overlapping renders (slow /library
// requests piling up every 12s tick) and avoids re-rendering the filter bar
// out from under the user while they're typing or using a dropdown — which
// otherwise destroys the focused element mid-interaction and makes the
// filter controls appear frozen.
let libraryRenderInFlight = false;
function libraryFilterInUse() {
  const el = document.activeElement;
  return Boolean(el && el.closest && el.closest('.filter-bar'));
}

async function renderLibrary() {
  if (libraryRenderInFlight || libraryFilterInUse()) return;
  libraryRenderInFlight = true;
  try {
    await renderLibraryInner();
  } finally {
    libraryRenderInFlight = false;
  }
}

async function renderLibraryInner() {
  const params = new URLSearchParams();
  if (libraryState.status) params.set('status', libraryState.status);
  if (libraryState.source) params.set('source', libraryState.source);
  if (libraryState.q) params.set('q', libraryState.q);
  if (libraryState.artistId) params.set('artistId', libraryState.artistId);
  params.set('page', libraryState.page);
  params.set('pageSize', libraryState.pageSize);

  const data = await api(`/library?${params.toString()}`);
  const artistFilterName = libraryState.artistId
    ? (await api('/artists')).find((a) => a.id === libraryState.artistId)?.name
    : null;

  currentBatchActions.library = [
    { id: 'download', label: 'Download selected', run: (ids) => batchPosts('download', ids) },
    { id: 'delete', label: 'Delete selected', run: (ids) => batchPosts('delete', ids) }
  ];

  $content.innerHTML = `
    <div class="filter-bar">
      <input type="text" id="libSearch" placeholder="Filter by tag..." value="${esc(libraryState.q)}" />
      <select id="libSource">
        <option value="">All sources</option>
        ${SOURCES.map((s) => `<option value="${s.id}" ${libraryState.source === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
        <option value="manual" ${libraryState.source === 'manual' ? 'selected' : ''}>Manual import</option>
      </select>
      <select id="libStatus">
        <option value="">All statuses</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${libraryState.status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      ${libraryState.artistId ? `<span class="tag-pill artist-filter-pill">Artist: ${esc(artistFilterName || libraryState.artistId)}
        <button class="pill-x" id="clearArtistFilter" title="Clear artist filter">✕</button></span>` : ''}
      <label class="select-all-label"><input type="checkbox" id="selectAll-library" /> Select all</label>
    </div>
    ${batchToolbarHtml('library', currentBatchActions.library)}
    ${data.items.length ? `<div class="library-grid">${data.items.map(postCard).join('')}</div>`
      : emptyState('No posts match these filters', 'Run a tag set search, or loosen your filters above.', '#/tagsets', 'Go to tag sets')}
    ${data.total > libraryState.pageSize ? paginationHtml(data) : ''}
  `;

  document.getElementById('libSearch').addEventListener('change', (e) => { libraryState.q = e.target.value; libraryState.page = 1; renderLibrary(); });
  document.getElementById('libSource').addEventListener('change', (e) => { libraryState.source = e.target.value; libraryState.page = 1; renderLibrary(); });
  document.getElementById('libStatus').addEventListener('change', (e) => { libraryState.status = e.target.value; libraryState.page = 1; renderLibrary(); });
  document.getElementById('clearArtistFilter')?.addEventListener('click', () => { libraryState.artistId = null; libraryState.page = 1; renderLibrary(); });

  updateBatchBar('library', currentBatchActions.library);
  bindSelectionChecks('library');
  initDragSelect();

  data.items.forEach((p) => {
    document.getElementById(`post-dl-${p.id}`)?.addEventListener('click', (e) => downloadPost(p, e.target));
    document.getElementById(`post-del-${p.id}`)?.addEventListener('click', () => deletePost(p));
  });
  document.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openLightbox(Number(el.dataset.open)));
  });
  document.querySelectorAll('[data-page]').forEach((el) => {
    el.addEventListener('click', () => { libraryState.page = Number(el.dataset.page); renderLibrary(); });
  });
}

function postCard(p) {
  const thumb = p.previewUrl ? `style="background-image:url('${esc(p.previewUrl)}')"` : '';
  return `
  <div class="post-card">
    <div class="post-thumb" ${thumb}>
      ${selectionCheckbox('library', p.id)}
      <span class="status-chip">${STATUS_LABEL[p.status] || p.status}</span>
    </div>
    <div class="post-body">
      <div class="post-source"><span class="rating-dot rating-${p.rating}"></span>${esc(p.source)} · ${esc(p.sourcePostId)}</div>
      <div class="post-actions">
        ${p.status === 'downloaded'
      ? `<button class="btn btn-sm" data-open="${p.id}">Open</button>`
      : `<button class="btn btn-sm" id="post-dl-${p.id}" ${p.status === 'downloading' || p.status === 'queued' ? 'disabled' : ''}>${p.status === 'downloading' ? 'Downloading…' : p.status === 'queued' ? 'Queued…' : 'Download'}</button>`}
        <button class="btn btn-sm btn-icon btn-danger" id="post-del-${p.id}" title="Remove">🗑</button>
      </div>
    </div>
  </div>`;
}

function paginationHtml(data) {
  const totalPages = Math.ceil(data.total / data.pageSize);
  let buttons = '';
  for (let i = 1; i <= totalPages; i++) {
    buttons += `<button class="btn btn-sm" data-page="${i}" ${i === data.page ? 'disabled' : ''}>${i}</button>`;
  }
  return `<div style="display:flex;gap:6px;margin-top:18px;flex-wrap:wrap;">${buttons}</div>`;
}

async function downloadPost(p, btn) {
  btn.disabled = true;
  btn.textContent = 'Queued…';
  try {
    await api(`/library/${p.id}/download`, { method: 'POST' });
    setTimeout(renderLibrary, 800);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deletePost(p) {
  if (!confirm('Remove this post from the library? The downloaded file (if any) will be deleted too.')) return;
  try {
    await api(`/library/${p.id}`, { method: 'DELETE' });
    renderLibrary();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function batchPosts(action, ids) {
  if (action === 'delete' && !confirm(`Remove ${ids.length} post(s) from the library? Downloaded files will be deleted too.`)) return;
  try {
    const result = await api('/library/batch', { method: 'POST', body: JSON.stringify({ action, ids }) });
    if (action === 'download') {
      toast(`Queued ${result.queued} download(s)${result.skipped ? `, skipped ${result.skipped} (already downloaded/queued or no file URL)` : ''}`);
      setTimeout(renderLibrary, 800);
    } else {
      toast(`Removed ${result.deleted} post(s)`);
      batchSelection.library.clear();
      renderLibrary();
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- tags (poster wall) ----------

// Remembers the last organize result so the summary banner survives the
// auto-refresh re-render (which fires every 12s on this route).
let lastOrganizeResult = null;

async function renderTags() {
  const data = await api('/library/tags');

  $content.innerHTML = `
    <div class="filter-bar">
      <input type="text" id="tagSearch" placeholder="Filter by tag name..." />
      <select id="tagSort">
        <option value="count">Most posts</option>
        <option value="name">Name (A-Z)</option>
      </select>
      <button class="btn" id="organizeBtn" title="Create a by-tag/&lt;tag&gt;/ folder structure inside the library root (hardlinks where possible, copies otherwise)">Organize folders</button>
    </div>
    ${lastOrganizeResult ? `<div class="organize-banner ${lastOrganizeResult.failed ? 'warn' : 'ok'}">
        ${esc(lastOrganizeResult.summary)}
        <button class="btn btn-sm" id="organizeDismiss">✕</button>
      </div>` : ''}
    ${data.groups.length ? `<div class="tag-wall" id="tagWall">
        ${data.groups.map((g) => tagPoster(g)).join('')}
      </div>`
      : emptyState('No tagged downloads yet', 'Downloaded posts with tags will be grouped here — one poster per tag.', '#/tagsets', 'Go to tag sets')}
  `;

  const wall = document.getElementById('tagWall');
  const search = document.getElementById('tagSearch');
  const sortSel = document.getElementById('tagSort');

  function applyFilter() {
    const needle = (search.value || '').toLowerCase();
    const sort = sortSel.value;
    const cards = [...wall.children];
    cards.sort((a, b) => sort === 'name'
      ? a.dataset.tag.localeCompare(b.dataset.tag)
      : (Number(b.dataset.count) - Number(a.dataset.count)) || a.dataset.tag.localeCompare(b.dataset.tag));
    cards.forEach((c) => {
      const match = !needle || c.dataset.tag.toLowerCase().includes(needle);
      c.style.display = match ? '' : 'none';
      wall.appendChild(c);
    });
  }
  search.addEventListener('input', applyFilter);
  sortSel.addEventListener('change', applyFilter);

  document.getElementById('organizeBtn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Organizing…';
    try {
      lastOrganizeResult = await api('/library/organize', { method: 'POST' });
      toast(lastOrganizeResult.summary, lastOrganizeResult.failed ? 'error' : 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
    renderTags();
  });
  document.getElementById('organizeDismiss')?.addEventListener('click', () => { lastOrganizeResult = null; renderTags(); });

  // Clicking a poster jumps into the library pre-filtered to that tag.
  wall.querySelectorAll('.tag-poster').forEach((el) => {
    el.addEventListener('click', () => {
      libraryState.q = el.dataset.tag;
      libraryState.page = 1;
      window.location.hash = '#/library';
      renderLibrary();
    });
  });
}

function tagPoster(g) {
  const thumb = g.sampleUrl ? `style="background-image:url('${esc(g.sampleUrl)}')"` : '';
  return `
  <div class="tag-poster" data-tag="${esc(g.tag)}" data-count="${g.count}" title="${esc(g.tag)} — ${g.count} post(s), click to view in library">
    <div class="tag-poster-thumb" ${thumb}></div>
    <div class="tag-poster-overlay">
      <span class="tag-poster-name">${esc(g.tag)}</span>
      <span class="tag-poster-count">${g.count}</span>
    </div>
  </div>`;
}

// ---------- activity ----------

async function renderActivity() {
  const activity = await api('/activity');
  $content.innerHTML = activity.length
    ? `<div class="activity-list">${activity.map(activityRow).join('')}</div>`
    : emptyState('No activity yet', 'Actions like new posts, downloads, and errors will show up here.', null, null);
}

// ---------- settings ----------

async function renderSettings() {
  if (!currentSettingsSub) {
    $content.innerHTML = `
      <div class="settings-landing">
        ${SETTINGS_CATEGORIES.map((c) => `
          <a class="settings-landing-item" href="#/settings/${c.id}">
            <h3>${c.label}</h3>
            <p>${c.desc}</p>
          </a>
        `).join('')}
      </div>
    `;
    return;
  }
  if (currentSettingsSub === 'indexers') return renderIndexerSettings();
  if (currentSettingsSub === 'general') return renderGeneralCategory();
  if (currentSettingsSub === 'library') return renderLibraryCategory();
  if (currentSettingsSub === 'security') return renderSecurityCategory();
  if (currentSettingsSub === 'backup') return renderBackupCategory();
  window.location.hash = '#/settings';
}

// ---- Indexers category (per-booru credentials) ----

async function renderIndexerSettings() {
  const settings = await api('/settings');
  const configured = SOURCES.filter((s) => hasCredentials(settings[s.id] || {}));

  $content.innerHTML = `
    <div class="indexers-page">
      <div class="indexers-toolbar">
        <button class="btn btn-primary" id="addIndexerBtn">+ Add Indexer</button>
        <span class="hint">${configured.length} of ${SOURCES.length} indexers configured</span>
      </div>
      <div class="settings-grid">
        ${configured.length
      ? configured.map((s) => indexerCard(s, settings[s.id] || {})).join('')
      : `<div class="settings-card"><p class="hint" style="margin:0">No indexers configured yet. Click <strong>Add Indexer</strong> to pick a booru and enter its credentials.</p></div>`}
      </div>
    </div>`;

  document.getElementById('addIndexerBtn').onclick = () => openAddIndexerModal(settings);

  configured.forEach((s) => {
    document.getElementById(`edit-${s.id}`).onclick = () => openIndexerFormModal(s, settings[s.id] || {}, () => renderIndexerSettings());
    document.getElementById(`test-${s.id}`).addEventListener('click', async () => {
      const resultEl = document.getElementById(`test-result-${s.id}`);
      resultEl.textContent = 'Testing…';
      resultEl.className = 'test-result';
      try {
        const result = await api(`/settings/${s.id}/test`, { method: 'POST' });
        if (result.authenticated === true) {
          resultEl.textContent = 'Credentials verified';
          resultEl.className = 'test-result ok';
        } else if (result.authenticated === false) {
          resultEl.textContent = 'Reachable (no credentials set)';
          resultEl.className = 'test-result';
        } else {
          resultEl.textContent = result.note || 'Reachable — credentials not verifiable';
          resultEl.className = 'test-result';
        }
      } catch (err) {
        resultEl.textContent = err.message;
        resultEl.className = 'test-result fail';
      }
    });
  });
}

// Fields that ship pre-filled by default (baseUrl, and the default user agents
// on e621/furbooru) don't count as "configured" — only real credentials do.
function hasCredentials(creds) {
  return Object.keys(creds).some((k) => k !== 'baseUrl' && k !== 'userAgent' && creds[k]);
}

function openAddIndexerModal(settings) {
  openModal(`
    <h2>Add Indexer</h2>
    <div class="form-row">
      <input type="text" id="indexerSearch" placeholder="Search indexers" autocomplete="off" />
    </div>
    <p class="hint" style="margin:0 0 10px">nyarr supports the booru sources below. Select an indexer to add its API credentials.</p>
    <div class="indexer-list" id="indexerList">
      ${SOURCES.map((s) => {
    const c = settings[s.id] || {};
    const configured = hasCredentials(c);
    return `<div class="indexer-list-item ${configured ? 'configured' : ''}" data-id="${s.id}">
          <span class="indexer-name">${s.label}</span>
          <span class="indexer-item-meta">
            ${s.requiresCredentials ? '<span class="tag tag-warn">API key required</span>' : '<span class="tag tag-ok">No key needed</span>'}
            ${configured ? '<span class="tag tag-ok">Configured</span>' : ''}
          </span>
        </div>`;
  }).join('')}
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" id="cancelModalBtn">Close</button>
    </div>
  `);
  document.getElementById('cancelModalBtn').onclick = closeModal;

  const list = document.getElementById('indexerList');
  document.getElementById('indexerSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    list.querySelectorAll('.indexer-list-item').forEach((el) => {
      el.style.display = el.querySelector('.indexer-name').textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  list.querySelectorAll('.indexer-list-item').forEach((el) => {
    el.onclick = () => {
      const source = SOURCES.find((s) => s.id === el.dataset.id);
      openIndexerFormModal(source, settings[source.id] || {}, () => renderIndexerSettings());
    };
  });
}

function openIndexerFormModal(source, creds, onSaved) {
  const fields = INDEXER_FIELDS[source.id] || [];
  openModal(`
    <h2>${source.label}</h2>
    <p class="hint">Base URL: <span class="mono">${esc(creds.baseUrl || '')}</span></p>
    ${source.requiresCredentials
      ? `<p class="inline-note warn">${source.label} requires API credentials — searches will fail without them.</p>`
      : `<p class="inline-note">Credentials are optional for ${source.label} — anonymous search works, keys may unlock higher rate limits.</p>`}
    <form id="indexer-form">
      <input type="hidden" name="baseUrl" value="${esc(creds.baseUrl || '')}" />
      ${fields.map((f) => `
        <div class="form-row">
          <label>${f.label}</label>
          <input name="${f.name}" value="${esc(creds[f.name] || '')}" autocomplete="off" />
        </div>
      `).join('')}
      <div class="modal-actions">
        <span class="test-result" id="test-result-modal"></span>
        <button type="button" class="btn" id="testModalBtn">Test connection</button>
        <button type="button" class="btn" id="cancelModalBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);
  document.getElementById('cancelModalBtn').onclick = closeModal;

  const form = document.getElementById('indexer-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      await api(`/settings/${source.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast(`${source.label} credentials saved`);
      closeModal();
      onSaved && onSaved();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  document.getElementById('testModalBtn').addEventListener('click', async () => {
    const resultEl = document.getElementById('test-result-modal');
    resultEl.textContent = 'Testing…';
    resultEl.className = 'test-result';
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      await api(`/settings/${source.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      const result = await api(`/settings/${source.id}/test`, { method: 'POST' });
      if (result.authenticated === true) {
        resultEl.textContent = 'Credentials verified';
        resultEl.className = 'test-result ok';
      } else if (result.authenticated === false) {
        resultEl.textContent = 'Reachable (no credentials set)';
        resultEl.className = 'test-result';
      } else {
        resultEl.textContent = result.note || 'Reachable — credentials not verifiable';
        resultEl.className = 'test-result';
      }
    } catch (err) {
      resultEl.textContent = err.message;
      resultEl.className = 'test-result fail';
    }
  });
}

const INDEXER_FIELDS = {
  danbooru: [
    { name: 'username', label: 'Username' },
    { name: 'apiKey', label: 'API key' }
  ],
  gelbooru: [
    { name: 'userId', label: 'User ID' },
    { name: 'apiKey', label: 'API key' }
  ],
  e621: [
    { name: 'username', label: 'Username' },
    { name: 'apiKey', label: 'API key' },
    { name: 'userAgent', label: 'User agent (required by e621)' }
  ],
  rule34: [
    { name: 'userId', label: 'User ID' },
    { name: 'apiKey', label: 'API key' }
  ],
  safebooru: [
    { name: 'userId', label: 'User ID' },
    { name: 'apiKey', label: 'API key' }
  ],
  konachan: [
    { name: 'username', label: 'Username' },
    { name: 'apiKey', label: 'API key' }
  ],
  yandere: [
    { name: 'username', label: 'Username' },
    { name: 'apiKey', label: 'API key' }
  ],
  furbooru: [
    { name: 'username', label: 'Username' },
    { name: 'apiKey', label: 'API key' },
    { name: 'userAgent', label: 'User agent' }
  ],
  sankaku: [
    { name: 'userId', label: 'User ID' },
    { name: 'apiKey', label: 'API key' }
  ],
  realbooru: [
    { name: 'userId', label: 'User ID' },
    { name: 'apiKey', label: 'API key' }
  ],
  tbib: [
    { name: 'userId', label: 'User ID' },
    { name: 'apiKey', label: 'API key' }
  ],
  behoimi: [
    { name: 'userId', label: 'User ID' },
    { name: 'apiKey', label: 'API key' }
  ]
};

function indexerCard(source, creds) {
  const fields = INDEXER_FIELDS[source.id] || [];
  const filled = fields.filter((f) => creds[f.name]).length;
  return `
  <div class="settings-card">
    <h3>${source.label}</h3>
    <p class="hint">Base URL: <span class="mono">${esc(creds.baseUrl || '')}</span> · ${filled}/${fields.length} fields set</p>
    <div class="settings-card-footer">
      <button type="button" class="btn btn-primary btn-sm" id="edit-${source.id}">Edit credentials</button>
      <button type="button" class="btn btn-sm" id="test-${source.id}">Test connection</button>
      <span class="test-result" id="test-result-${source.id}"></span>
    </div>
  </div>`;
}

// ---- General category ----

async function renderGeneralCategory() {
  const g = await api('/general');
  $content.innerHTML = `
    <div class="settings-grid">
      <div class="settings-card">
        <h3>Instance</h3>
        <p class="hint">Cosmetic — shown as the page title and sidebar wordmark.</p>
        <form id="form-instance">
          <div class="form-row">
            <label>Instance name</label>
            <input name="instanceName" value="${esc(g.instanceName)}" />
          </div>
          <div class="form-row">
            <label>Port</label>
            <input name="port" type="number" min="1" max="65535" value="${g.port}" />
          </div>
          <p class="inline-note warn">Changing the port needs an app restart to take effect.</p>
          <div class="settings-card-footer">
            <button type="submit" class="btn btn-primary btn-sm">Save</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('form-instance').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/general', { method: 'PUT', body: JSON.stringify({ instanceName: fd.get('instanceName'), port: fd.get('port') }) });
      toast('Instance settings saved');
      if (fd.get('instanceName') !== window.NYARR_INSTANCE_NAME) {
        window.NYARR_INSTANCE_NAME = fd.get('instanceName');
        document.title = fd.get('instanceName');
        document.getElementById('brandWord').textContent = fd.get('instanceName');
      }
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---- Library category ----

async function renderLibraryCategory() {
  const g = await api('/general');
  $content.innerHTML = `
    <div class="settings-grid">

      <div class="settings-card">
        <h3>Library location</h3>
        <p class="hint">Where downloaded files are written. Point this anywhere on disk — a different drive, a NAS mount, wherever you keep your library.</p>
        <form id="form-library">
          <div class="form-row">
            <label>Library root folder</label>
            <div class="input-with-btn">
              <input name="libraryRoot" id="libraryRootInput" value="${esc(g.libraryRoot)}" />
              <button type="button" class="btn btn-sm" id="browseLibraryRoot">Browse…</button>
            </div>
          </div>
          <div class="settings-card-footer">
            <button type="submit" class="btn btn-primary btn-sm">Save</button>
          </div>
        </form>
        <p class="inline-note">To relocate nyarr's own database (tag sets, settings, activity log) rather than just the downloaded files, set the <span class="mono">NYARR_DATA_DIR</span> environment variable before starting the app — see the README.</p>
      </div>

      <div class="settings-card">
        <h3>Library import</h3>
        <p class="hint">Already have a folder of booru images? Point nyarr at it to register them in the library without re-downloading. Files elsewhere on disk are referenced in place; files already inside the library root are adopted the same as a normal download.</p>
        <div class="form-row">
          <label>Folder to scan</label>
          <div class="input-with-btn">
            <input id="importPathInput" placeholder="/path/to/existing/images" />
            <button type="button" class="btn btn-sm" id="browseImportPath">Browse…</button>
          </div>
        </div>
        <div class="settings-card-footer">
          <button type="button" class="btn btn-primary btn-sm" id="runImportBtn">Scan &amp; import</button>
        </div>
        <div class="import-result" id="importResult"></div>
      </div>

    </div>
  `;

  document.getElementById('form-library').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/general', { method: 'PUT', body: JSON.stringify({ libraryRoot: fd.get('libraryRoot') }) });
      toast('Library root saved');
    } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('browseLibraryRoot').addEventListener('click', () => {
    openFolderBrowser(document.getElementById('libraryRootInput').value, (chosen) => {
      document.getElementById('libraryRootInput').value = chosen;
    });
  });

  document.getElementById('browseImportPath').addEventListener('click', () => {
    openFolderBrowser(document.getElementById('importPathInput').value || g.libraryRoot, (chosen) => {
      document.getElementById('importPathInput').value = chosen;
    });
  });
  document.getElementById('runImportBtn').addEventListener('click', async () => {
    const importPath = document.getElementById('importPathInput').value.trim();
    const resultEl = document.getElementById('importResult');
    if (!importPath) { toast('Enter a folder to scan first', 'error'); return; }
    resultEl.innerHTML = '<span class="spinner"></span> Scanning…';
    try {
      const result = await api('/library/import', { method: 'POST', body: JSON.stringify({ path: importPath }) });
      resultEl.textContent = `Scanned ${result.scanned} file(s): imported ${result.imported}, skipped ${result.skipped} (already in library).`;
      if (result.imported > 0) toast(`Imported ${result.imported} file(s)`);
    } catch (err) {
      resultEl.textContent = '';
      toast(err.message, 'error');
    }
  });
}

// ---- Security category ----

async function renderSecurityCategory() {
  const g = await api('/general');
  $content.innerHTML = `
    <div class="settings-grid">

      <div class="settings-card">
        <h3>Authentication</h3>
        <p class="hint">Off by default. Enable to require a login for the web UI (a login page with a session cookie; API clients can use Basic auth or the API key).</p>
        <form id="form-auth">
          <div class="form-row">
            <label>Method</label>
            <select name="authMethod" id="authMethodSelect">
              <option value="none" ${g.authMethod === 'none' ? 'selected' : ''}>None</option>
              <option value="basic" ${g.authMethod === 'basic' ? 'selected' : ''}>Basic (username + password)</option>
            </select>
          </div>
          <div id="authFields" style="${g.authMethod === 'basic' ? '' : 'display:none'}">
            <div class="form-row">
              <label>Username</label>
              <input name="username" value="${esc(g.username || '')}" autocomplete="off" />
            </div>
            <div class="form-row">
              <label>${g.authMethod === 'basic' && g.username ? 'New password (leave blank to keep current)' : 'Password'}</label>
              <input name="password" type="password" autocomplete="new-password" />
            </div>
          </div>
          <div class="settings-card-footer">
            <button type="submit" class="btn btn-primary btn-sm">Save</button>
          </div>
        </form>
      </div>

      <div class="settings-card">
        <h3>API key</h3>
        <p class="hint">Required on every API request (the web UI sends it automatically). Regenerate it if you think it's been exposed.</p>
        <div class="form-row">
          <label>Key</label>
          <div class="input-with-btn">
            <input id="apiKeyDisplay" value="${esc(g.apiKey)}" readonly />
            <button type="button" class="btn btn-sm" id="copyApiKey">Copy</button>
          </div>
        </div>
        <div class="settings-card-footer">
          <button type="button" class="btn btn-sm btn-danger" id="regenApiKey">Regenerate</button>
        </div>
      </div>

    </div>
  `;

  const authSelect = document.getElementById('authMethodSelect');
  authSelect.addEventListener('change', () => {
    document.getElementById('authFields').style.display = authSelect.value === 'basic' ? '' : 'none';
  });
  document.getElementById('form-auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = { authMethod: fd.get('authMethod') };
    if (fd.get('authMethod') === 'basic') {
      payload.username = fd.get('username');
      if (fd.get('password')) payload.password = fd.get('password');
    }
    try {
      await api('/general', { method: 'PUT', body: JSON.stringify(payload) });
      toast('Authentication settings saved. You may be prompted to log in on the next request.');
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('copyApiKey').addEventListener('click', () => {
    navigator.clipboard?.writeText(document.getElementById('apiKeyDisplay').value);
    toast('API key copied');
  });
  document.getElementById('regenApiKey').addEventListener('click', async () => {
    if (!confirm('Regenerate the API key? Any external tool using the current key will stop working until updated.')) return;
    try {
      const result = await api('/general/regenerate-api-key', { method: 'POST' });
      window.NYARR_API_KEY = result.apiKey;
      document.getElementById('apiKeyDisplay').value = result.apiKey;
      toast('API key regenerated');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---- Backup & restore category ----

async function renderBackupCategory() {
  $content.innerHTML = `
    <div class="settings-grid">
      <div class="settings-card">
        <h3>Backup &amp; restore</h3>
        <p class="hint">Download everything (tag sets, settings, library records) as a single JSON file, or restore from one.</p>
        <div class="action-row">
          <button class="btn btn-sm" id="downloadBackup">Download backup</button>
          <input type="file" id="restoreFileInput" accept="application/json" style="display:none" />
          <button class="btn btn-sm" id="restoreBackupBtn">Restore from file…</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('downloadBackup').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/system/backup', { headers: { 'X-Api-Key': window.NYARR_API_KEY || '' } });
      if (!res.ok) throw new Error('Backup request failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nyarr-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('restoreBackupBtn').addEventListener('click', () => {
    document.getElementById('restoreFileInput').click();
  });
  document.getElementById('restoreFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('This replaces ALL current data (tag sets, library, settings) with the contents of this file. Continue?')) {
      e.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await api('/system/restore', { method: 'POST', body: JSON.stringify(parsed) });
      toast('Restored — reloading…');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast(`Restore failed: ${err.message}`, 'error');
    }
    e.target.value = '';
  });
}

// ---- Folder browser modal (used by library root + import path fields) ----

async function openFolderBrowser(startPath, onChoose) {
  openModal('<h2>Choose a folder</h2><div class="empty"><span class="spinner"></span></div>');
  await navigateFolderBrowser(startPath, onChoose);
}

async function navigateFolderBrowser(targetPath, onChoose) {
  let data;
  try {
    data = await api(`/system/browse?path=${encodeURIComponent(targetPath || '')}`);
  } catch (err) {
    $modal.innerHTML = `<h2>Choose a folder</h2><p class="test-result fail">${esc(err.message)}</p><div class="modal-actions"><button class="btn" id="folderCancel">Close</button></div>`;
    document.getElementById('folderCancel').onclick = closeModal;
    return;
  }
  $modal.innerHTML = `
    <h2>Choose a folder</h2>
    <div class="folder-path">${esc(data.path)}</div>
    <div class="folder-list">
      ${data.parent ? `<div class="folder-item" id="folderUp"><span class="icon">↩</span>..</div>` : ''}
      ${data.directories.length
      ? data.directories.map((d) => `<div class="folder-item" data-name="${esc(d)}"><span class="icon">📁</span>${esc(d)}</div>`).join('')
      : '<div class="folder-item muted" style="cursor:default">No subfolders here</div>'}
    </div>
    <div class="modal-actions">
      <button class="btn" id="folderCancel">Cancel</button>
      <button class="btn btn-primary" id="folderChoose">Use this folder</button>
    </div>
  `;
  if (data.parent) {
    document.getElementById('folderUp').addEventListener('click', () => navigateFolderBrowser(data.parent, onChoose));
  }
  document.querySelectorAll('.folder-item[data-name]').forEach((el) => {
    el.addEventListener('click', () => {
      const next = data.path.endsWith('/') ? `${data.path}${el.dataset.name}` : `${data.path}/${el.dataset.name}`;
      navigateFolderBrowser(next, onChoose);
    });
  });
  document.getElementById('folderCancel').onclick = closeModal;
  document.getElementById('folderChoose').onclick = () => {
    onChoose(data.path);
    closeModal();
  };
}

