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

const SOURCES = [
  { id: 'danbooru', label: 'Danbooru' },
  { id: 'gelbooru', label: 'Gelbooru' },
  { id: 'e621', label: 'e621' },
  { id: 'rule34', label: 'Rule34' }
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
  tagsets: { title: 'Tag Sets', render: renderTagSets },
  library: { title: 'Library', render: renderLibrary },
  activity: { title: 'Activity', render: renderActivity },
  settings: { title: 'Settings', render: renderSettings }
};

let currentRoute = 'dashboard';

function route() {
  const hash = window.location.hash.replace('#/', '') || 'dashboard';
  const found = ROUTES[hash] ? hash : 'dashboard';
  currentRoute = found;
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === found);
  });
  $pageTitle.textContent = ROUTES[found].title;
  $topbarActions.innerHTML = '';
  $content.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  ROUTES[found].render();
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  if (window.NYARR_INSTANCE_NAME && window.NYARR_INSTANCE_NAME !== 'nyarr') {
    document.title = window.NYARR_INSTANCE_NAME;
    document.getElementById('brandWord').textContent = window.NYARR_INSTANCE_NAME;
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
  const [stats, activity] = await Promise.all([api('/stats'), api('/activity')]);
  $content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card accent"><div class="value">${stats.tagSetsEnabled}</div><div class="label">Active tag sets</div></div>
      <div class="stat-card"><div class="value">${stats.totalPosts}</div><div class="label">Indexed posts</div></div>
      <div class="stat-card"><div class="value">${stats.downloaded}</div><div class="label">Downloaded</div></div>
      <div class="stat-card warn"><div class="value">${stats.queued}</div><div class="label">In queue</div></div>
      <div class="stat-card danger"><div class="value">${stats.failed}</div><div class="label">Failed</div></div>
    </div>
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

function emptyState(title, body, href, cta) {
  return `<div class="empty">
    <h3>${esc(title)}</h3>
    <p>${esc(body)}</p>
    ${href ? `<a class="btn btn-primary" href="${href}">${esc(cta)}</a>` : ''}
  </div>`;
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
  $content.innerHTML = `<div class="tagset-list">${tagSets.map(tagSetCard).join('')}</div>`;

  tagSets.forEach((t) => {
    document.getElementById(`ts-toggle-${t.id}`)?.addEventListener('click', () => toggleTagSet(t));
    document.getElementById(`ts-search-${t.id}`)?.addEventListener('click', (e) => searchNow(t, e.target));
    document.getElementById(`ts-edit-${t.id}`)?.addEventListener('click', () => openTagSetModal(t));
    document.getElementById(`ts-delete-${t.id}`)?.addEventListener('click', () => deleteTagSet(t));
  });
}

function tagSetCard(t) {
  const tagList = t.tags.split(' ').filter(Boolean).slice(0, 8);
  const sourceLabel = SOURCES.find((s) => s.id === t.source)?.label || t.source;
  return `
  <div class="tagset-card ${t.enabled ? '' : 'disabled'}">
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

// ---------- library ----------

const libraryState = { status: '', source: '', q: '', page: 1, pageSize: 40 };

async function renderLibrary() {
  const params = new URLSearchParams();
  if (libraryState.status) params.set('status', libraryState.status);
  if (libraryState.source) params.set('source', libraryState.source);
  if (libraryState.q) params.set('q', libraryState.q);
  params.set('page', libraryState.page);
  params.set('pageSize', libraryState.pageSize);

  const data = await api(`/library?${params.toString()}`);

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
    </div>
    ${data.items.length ? `<div class="library-grid">${data.items.map(postCard).join('')}</div>`
      : emptyState('No posts match these filters', 'Run a tag set search, or loosen your filters above.', '#/tagsets', 'Go to tag sets')}
    ${data.total > libraryState.pageSize ? paginationHtml(data) : ''}
  `;

  document.getElementById('libSearch').addEventListener('change', (e) => { libraryState.q = e.target.value; libraryState.page = 1; renderLibrary(); });
  document.getElementById('libSource').addEventListener('change', (e) => { libraryState.source = e.target.value; libraryState.page = 1; renderLibrary(); });
  document.getElementById('libStatus').addEventListener('change', (e) => { libraryState.status = e.target.value; libraryState.page = 1; renderLibrary(); });

  data.items.forEach((p) => {
    document.getElementById(`post-dl-${p.id}`)?.addEventListener('click', (e) => downloadPost(p, e.target));
    document.getElementById(`post-del-${p.id}`)?.addEventListener('click', () => deletePost(p));
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
      <span class="status-chip">${STATUS_LABEL[p.status] || p.status}</span>
    </div>
    <div class="post-body">
      <div class="post-source"><span class="rating-dot rating-${p.rating}"></span>${esc(p.source)} · ${esc(p.sourcePostId)}</div>
      <div class="post-actions">
        ${p.status === 'downloaded'
          ? `<a class="btn btn-sm" href="/library-files/${p.id}" target="_blank">Open</a>`
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

// ---------- activity ----------

async function renderActivity() {
  const activity = await api('/activity');
  $content.innerHTML = activity.length
    ? `<div class="activity-list">${activity.map(activityRow).join('')}</div>`
    : emptyState('No activity yet', 'Actions like new posts, downloads, and errors will show up here.', null, null);
}

// ---------- settings ----------

let settingsTab = 'general';

async function renderSettings() {
  $content.innerHTML = `
    <div class="settings-tabs">
      <button class="settings-tab ${settingsTab === 'general' ? 'active' : ''}" data-tab="general">General</button>
      <button class="settings-tab ${settingsTab === 'indexers' ? 'active' : ''}" data-tab="indexers">Indexers</button>
    </div>
    <div id="settingsTabBody"><div class="empty"><span class="spinner"></span></div></div>
  `;
  document.querySelectorAll('.settings-tab').forEach((btn) => {
    btn.addEventListener('click', () => { settingsTab = btn.dataset.tab; renderSettings(); });
  });
  if (settingsTab === 'general') await renderGeneralSettings();
  else await renderIndexerSettings();
}

// ---- Indexers tab (per-booru credentials) ----

async function renderIndexerSettings() {
  const body = document.getElementById('settingsTabBody');
  const settings = await api('/settings');
  body.innerHTML = `<div class="settings-grid">${SOURCES.map((s) => indexerCard(s, settings[s.id] || {})).join('')}</div>`;

  SOURCES.forEach((s) => {
    const form = document.getElementById(`settings-form-${s.id}`);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      try {
        await api(`/settings/${s.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast(`${s.label} credentials saved`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    document.getElementById(`test-${s.id}`).addEventListener('click', async () => {
      const resultEl = document.getElementById(`test-result-${s.id}`);
      resultEl.textContent = 'Testing…';
      resultEl.className = 'test-result';
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      try {
        await api(`/settings/${s.id}`, { method: 'PUT', body: JSON.stringify(payload) });
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

function indexerCard(source, creds) {
  const fieldsBySource = {
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
    ]
  };
  const fields = fieldsBySource[source.id] || [];
  return `
  <div class="settings-card">
    <h3>${source.label}</h3>
    <p class="hint">Base URL: <span class="mono">${esc(creds.baseUrl || '')}</span></p>
    <form id="settings-form-${source.id}">
      <input type="hidden" name="baseUrl" value="${esc(creds.baseUrl || '')}" />
      ${fields.map((f) => `
        <div class="form-row">
          <label>${f.label}</label>
          <input name="${f.name}" value="${esc(creds[f.name] || '')}" autocomplete="off" />
        </div>
      `).join('')}
      <div class="settings-card-footer">
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
        <button type="button" class="btn btn-sm" id="test-${source.id}">Test connection</button>
        <span class="test-result" id="test-result-${source.id}"></span>
      </div>
    </form>
  </div>`;
}

// ---- General tab ----

async function renderGeneralSettings() {
  const body = document.getElementById('settingsTabBody');
  const g = await api('/general');

  body.innerHTML = `
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
        <h3>Authentication</h3>
        <p class="hint">Off by default. Enable to require a login for the web UI (uses your browser's built-in login prompt).</p>
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

      <div class="settings-card">
        <h3>Backup &amp; restore</h3>
        <p class="hint">Download everything (tag sets, settings, library records) as a single JSON file, or restore from one.</p>
        <div class="action-row">
          <button class="btn btn-sm" id="downloadBackup">Download backup</button>
          <input type="file" id="restoreFileInput" accept="application/json" style="display:none" />
          <button class="btn btn-sm" id="restoreBackupBtn">Restore from file…</button>
        </div>
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

