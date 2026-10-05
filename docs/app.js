'use strict';

// ---------- Encrypted vault (localStorage, AES-GCM, key from PBKDF2) ----------

const VAULT_KEY = 'redditPoster.vault';
const HISTORY_KEY = 'redditPoster.history';
const PBKDF2_ITERATIONS = 600000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

let cryptoKey = null;   // derived key, memory only
let vaultSalt = null;
let accounts = [];      // decrypted accounts, memory only
const tokens = {};      // account id -> {token, expires}, memory only

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function saveVault() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey,
    enc.encode(JSON.stringify({ accounts })));
  if (!storageSet(VAULT_KEY, JSON.stringify({ v: 1, salt: b64(vaultSalt), iv: b64(iv), data: b64(data) }))) {
    throw new Error('Could not save to browser storage (private window?)');
  }
}

async function createVault(passphrase) {
  vaultSalt = crypto.getRandomValues(new Uint8Array(16));
  cryptoKey = await deriveKey(passphrase, vaultSalt);
  accounts = [];
  await saveVault();
}

async function openVault(passphrase) {
  const stored = JSON.parse(storageGet(VAULT_KEY));
  const salt = unb64(stored.salt);
  const key = await deriveKey(passphrase, salt);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(stored.iv) }, key, unb64(stored.data));
  } catch {
    throw new Error('Wrong master password');
  }
  vaultSalt = salt;
  cryptoKey = key;
  accounts = JSON.parse(dec.decode(plain)).accounts || [];
}

function lock() {
  cryptoKey = null;
  vaultSalt = null;
  accounts = [];
  for (const k of Object.keys(tokens)) delete tokens[k];
  flairsFor = '';
  showUnlock();
}

// ---------- Reddit API ----------

async function getToken(acct) {
  const cached = tokens[acct.id];
  if (cached && cached.expires > Date.now() + 60000) return cached.token;

  let res;
  try {
    res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(acct.client_id + ':' + acct.client_secret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'password', username: acct.username, password: acct.password }),
    });
  } catch {
    throw new Error('Could not reach Reddit (network error, or the request was blocked by the browser)');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Reddit rejected the app client ID / secret');
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') throw new Error('Wrong username or password (or the account has 2FA on)');
    throw new Error('Login failed: ' + (data.error || 'HTTP ' + res.status));
  }
  tokens[acct.id] = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function api(acct, method, path, params) {
  const token = await getToken(acct);
  const url = 'https://oauth.reddit.com' + path + (method === 'GET' && params ? '?' + new URLSearchParams(params) : '');
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + token },
      body: method === 'POST' ? new URLSearchParams(params) : undefined,
    });
  } catch {
    throw new Error('Could not reach Reddit (network error, or the request was blocked by the browser)');
  }
  if (res.status === 401) delete tokens[acct.id];
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && (data.message || data.reason || data.error);
    throw new Error('Reddit returned HTTP ' + res.status + (msg ? ': ' + msg : ''));
  }
  return data;
}

// ---------- UI helpers ----------

const $ = id => document.getElementById(id);
const cleanSub = s => s.trim().replace(/^\/?r\//i, '');
const newId = () => b64(crypto.getRandomValues(new Uint8Array(9)));

function setStatus(el, text, cls, link) {
  el.className = 'status ' + (cls || '');
  el.textContent = text;
  if (link) {
    el.append(' ');
    const a = document.createElement('a');
    a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = link;
    el.append(a);
  }
}

function currentAccount() {
  return accounts.find(a => a.id === $('account').value);
}

// ---------- Unlock view ----------

function showUnlock() {
  const exists = !!storageGet(VAULT_KEY);
  $('app-view').classList.add('hidden');
  $('lock-btn').classList.add('hidden');
  $('unlock-view').classList.remove('hidden');
  $('unlock-title').textContent = exists ? 'Unlock' : 'Set a master password';
  $('unlock-help').textContent = exists
    ? 'Enter your master password to decrypt your saved accounts.'
    : 'Your Reddit accounts will be encrypted with this password and stored only in this browser. ' +
      'There is no way to recover it if you forget it.';
  $('unlock-btn').textContent = exists ? 'Unlock' : 'Create';
  $('confirm-wrap').classList.toggle('hidden', exists);
  $('reset-btn').classList.toggle('hidden', !exists);
  $('passphrase').autocomplete = exists ? 'current-password' : 'new-password';
  $('passphrase').value = '';
  $('passphrase2').value = '';
  setStatus($('unlock-status'), '');
  $('passphrase').focus();
}

$('unlock-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pass = $('passphrase').value;
  const exists = !!storageGet(VAULT_KEY);
  const btn = $('unlock-btn');
  try {
    if (!exists) {
      if (pass.length < 8) throw new Error('Use at least 8 characters');
      if (pass !== $('passphrase2').value) throw new Error('Passwords do not match');
    }
    btn.disabled = true;
    setStatus($('unlock-status'), exists ? 'Unlocking…' : 'Creating…');
    exists ? await openVault(pass) : await createVault(pass);
    showApp();
  } catch (err) {
    setStatus($('unlock-status'), err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

$('reset-btn').addEventListener('click', () => {
  if (!confirm('Delete all saved accounts from this browser? This cannot be undone.')) return;
  try { localStorage.removeItem(VAULT_KEY); } catch { /* ignore */ }
  showUnlock();
});

$('lock-btn').addEventListener('click', lock);

// ---------- Main view ----------

function showApp() {
  $('unlock-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  $('lock-btn').classList.remove('hidden');
  renderAccounts();
  renderHistory();
  resetIdle();
}

function renderAccounts() {
  const sel = $('account');
  const prev = sel.value;
  sel.replaceChildren();
  const list = $('account-list');
  list.replaceChildren();

  for (const a of accounts) {
    sel.append(new Option(`${a.label} (u/${a.username})`, a.id));

    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${a.label} — u/${a.username}`;
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'btn secondary small'; edit.textContent = 'Edit';
    edit.addEventListener('click', () => startEdit(a));
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn secondary small'; del.textContent = 'Remove';
    del.addEventListener('click', () => removeAccount(a));
    li.append(name, edit, del);
    list.append(li);
  }
  if (accounts.some(a => a.id === prev)) sel.value = prev;

  const none = accounts.length === 0;
  $('no-accounts').classList.toggle('hidden', !none);
  $('post-form').classList.toggle('hidden', none);
  if (none) $('add-details').open = true;
}

async function persist(message) {
  try {
    await saveVault();
    renderAccounts();
    setStatus($('account-status'), message, 'ok');
  } catch (err) {
    setStatus($('account-status'), err.message, 'err');
  }
}

function startEdit(a) {
  $('edit-id').value = a.id;
  $('a-label').value = a.label;
  $('a-username').value = a.username;
  $('a-password').value = a.password;
  $('a-client-id').value = a.client_id;
  $('a-client-secret').value = a.client_secret;
  $('add-summary').textContent = 'Edit account';
  $('save-account').textContent = 'Save changes';
  $('cancel-edit').classList.remove('hidden');
  $('add-details').open = true;
  $('a-label').focus();
}

function resetAccountForm() {
  $('account-form').reset();
  $('edit-id').value = '';
  $('add-summary').textContent = 'Add account';
  $('save-account').textContent = 'Save account';
  $('cancel-edit').classList.add('hidden');
}

$('cancel-edit').addEventListener('click', resetAccountForm);

$('account-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('edit-id').value;
  const entry = {
    id: id || newId(),
    label: $('a-label').value.trim(),
    username: $('a-username').value.trim().replace(/^\/?u\//i, ''),
    password: $('a-password').value,
    client_id: $('a-client-id').value.trim(),
    client_secret: $('a-client-secret').value.trim(),
  };
  if (id) {
    accounts = accounts.map(a => (a.id === id ? entry : a));
    delete tokens[id];
  } else {
    accounts.push(entry);
  }
  resetAccountForm();
  await persist(id ? `Updated ${entry.label}` : `Added ${entry.label}`);
});

async function removeAccount(a) {
  if (!confirm(`Remove ${a.label} (u/${a.username})?`)) return;
  accounts = accounts.filter(x => x.id !== a.id);
  delete tokens[a.id];
  await persist(`Removed ${a.label}`);
}

$('import-btn').addEventListener('click', async () => {
  let list;
  try {
    const parsed = JSON.parse($('import-json').value);
    list = Array.isArray(parsed) ? parsed : parsed.accounts;
    if (!Array.isArray(list)) throw new Error();
  } catch {
    setStatus($('account-status'), 'That is not valid JSON in the expected format', 'err');
    return;
  }
  const required = ['username', 'password', 'client_id', 'client_secret'];
  for (const item of list) {
    const missing = required.filter(k => !item[k]);
    if (missing.length) {
      setStatus($('account-status'), `Entry ${item.label || item.username || '?'} is missing: ${missing.join(', ')}`, 'err');
      return;
    }
  }
  for (const item of list) {
    const label = String(item.label || item.username);
    const entry = {
      id: newId(), label, username: String(item.username), password: String(item.password),
      client_id: String(item.client_id), client_secret: String(item.client_secret),
    };
    const existing = accounts.findIndex(a => a.label === label);
    if (existing >= 0) {
      delete tokens[accounts[existing].id];
      entry.id = accounts[existing].id;
      accounts[existing] = entry;
    } else {
      accounts.push(entry);
    }
  }
  $('import-json').value = '';
  await persist(`Imported ${list.length} account${list.length === 1 ? '' : 's'}`);
});

// ---------- Posting ----------

let kind = 'self';
document.querySelectorAll('#tabs button').forEach(btn => btn.addEventListener('click', () => {
  kind = btn.dataset.kind;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== kind));
}));

$('check-btn').addEventListener('click', async () => {
  const acct = currentAccount();
  const status = $('post-status');
  setStatus(status, 'Checking login…');
  try {
    delete tokens[acct.id];
    const me = await api(acct, 'GET', '/api/v1/me');
    setStatus(status, `Logged in as u/${me.name} (${me.link_karma + me.comment_karma} karma)`, 'ok');
  } catch (err) {
    setStatus(status, err.message, 'err');
  }
});

let flairsFor = '';
async function loadFlairs() {
  const sel = $('flair');
  const sub = cleanSub($('subreddit').value);
  const acct = currentAccount();
  const key = acct ? acct.id + '|' + sub.toLowerCase() : '';
  if (key === flairsFor) return;
  flairsFor = key;
  sel.replaceChildren(new Option('(none)', ''));
  if (!sub || !acct) return;
  try {
    const flairs = await api(acct, 'GET', `/r/${encodeURIComponent(sub)}/api/link_flair_v2`);
    if (flairsFor !== key) return;
    for (const f of flairs || []) sel.append(new Option(f.text || '(blank)', f.id));
  } catch {
    // Many subs don't allow user flair; leave as (none).
  }
}
$('subreddit').addEventListener('change', loadFlairs);
$('account').addEventListener('change', loadFlairs);

$('post-form').addEventListener('submit', async e => {
  e.preventDefault();
  const acct = currentAccount();
  const status = $('post-status');
  const sub = cleanSub($('subreddit').value);
  const title = $('title').value.trim();
  if (kind === 'link' && !$('url').value.trim()) {
    setStatus(status, 'URL is required for link posts', 'err');
    return;
  }

  const params = {
    api_type: 'json', sr: sub, kind, title,
    nsfw: $('nsfw').checked, spoiler: $('spoiler').checked, sendreplies: $('sendreplies').checked,
  };
  if (kind === 'self') params.text = $('body').value;
  else params.url = $('url').value.trim();
  if ($('flair').value) params.flair_id = $('flair').value;

  const btn = $('submit-btn');
  btn.disabled = true;
  setStatus(status, 'Posting…');
  try {
    const res = await api(acct, 'POST', '/api/submit', params);
    const errors = res && res.json && res.json.errors;
    if (errors && errors.length) throw new Error(errors.map(x => x.slice(0, 2).join(': ')).join('; '));
    const link = res.json.data && res.json.data.url;
    addHistory({ time: new Date().toISOString(), account: acct.label, subreddit: sub, title, url: link });
    setStatus(status, 'Posted:', 'ok', link);
    $('title').value = ''; $('body').value = ''; $('url').value = '';
  } catch (err) {
    setStatus(status, err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

// ---------- History (titles/links only, no secrets) ----------

function loadHistory() {
  try { return JSON.parse(storageGet(HISTORY_KEY)) || []; } catch { return []; }
}

function addHistory(entry) {
  storageSet(HISTORY_KEY, JSON.stringify([entry, ...loadHistory()].slice(0, 100)));
  renderHistory();
}

function renderHistory() {
  const history = loadHistory();
  const tbody = document.querySelector('#history-table tbody');
  tbody.replaceChildren();
  for (const h of history.slice(0, 25)) {
    const tr = document.createElement('tr');
    const cells = [new Date(h.time).toLocaleString(), h.account, 'r/' + h.subreddit];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    const td = document.createElement('td');
    if (h.url && /^https:\/\//.test(h.url)) {
      const a = document.createElement('a');
      a.href = h.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = h.title;
      td.append(a);
    } else {
      td.textContent = h.title;
    }
    tr.append(td);
    tbody.append(tr);
  }
  $('history-table').classList.toggle('hidden', history.length === 0);
  $('no-history').classList.toggle('hidden', history.length > 0);
}

// Lock after 15 minutes without interaction.
let idleTimer;
function resetIdle() {
  clearTimeout(idleTimer);
  if (cryptoKey) idleTimer = setTimeout(lock, 15 * 60 * 1000);
}
['click', 'keydown'].forEach(ev => document.addEventListener(ev, resetIdle));

showUnlock();
