'use strict';

// Drafts live in localStorage. Nothing is sent anywhere: the "Open" buttons are plain
// links to Reddit's own submit page with the title/body filled in via query params.

const DRAFTS_KEY = 'redditDrafts.drafts';

const $ = id => document.getElementById(id);
const cleanSub = s => s.trim().replace(/^\/?r\//i, '').replace(/\/+$/, '');
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

let drafts = load();
let kind = 'text';
let filter = 'todo';

function load() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY)) || []; } catch { return []; }
}

function save() {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    return true;
  } catch {
    setStatus('Could not save (browser storage is blocked, e.g. private window)', 'err');
    return false;
  }
}

function setStatus(text, cls) {
  const el = $('form-status');
  el.className = 'status ' + (cls || '');
  el.textContent = text;
}

// ---------- Reddit submit links ----------

function oldRedditUrl(d) {
  const p = new URLSearchParams({ title: d.title });
  if (d.kind === 'link') p.set('url', d.url);
  else { p.set('selftext', 'true'); p.set('text', d.body); }
  return `https://old.reddit.com/r/${encodeURIComponent(d.subreddit)}/submit?${p}`;
}

function newRedditUrl(d) {
  const p = new URLSearchParams({ title: d.title });
  if (d.kind === 'link') { p.set('type', 'LINK'); p.set('url', d.url); }
  else { p.set('type', 'TEXT'); p.set('text', d.body); }
  return `https://www.reddit.com/r/${encodeURIComponent(d.subreddit)}/submit?${p}`;
}

// ---------- Form ----------

function setKind(k) {
  kind = k;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.kind === k));
  document.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== k));
}
document.querySelectorAll('#tabs button').forEach(btn => btn.addEventListener('click', () => setKind(btn.dataset.kind)));

function readForm() {
  const subreddit = cleanSub($('subreddit').value);
  const title = $('title').value.trim();
  const url = $('url').value.trim();
  if (!subreddit) throw new Error('Enter a subreddit');
  if (!title) throw new Error('Enter a title');
  if (kind === 'link' && !/^https?:\/\//i.test(url)) throw new Error('Enter a full URL starting with https://');
  return {
    subreddit, title, kind,
    account: $('account').value.trim(),
    body: kind === 'text' ? $('body').value : '',
    url: kind === 'link' ? url : '',
  };
}

function resetForm() {
  $('draft-form').reset();
  $('edit-id').value = '';
  $('form-title').textContent = 'New draft';
  $('save-btn').textContent = 'Save draft';
  $('cancel-edit').classList.add('hidden');
  setKind('text');
}

// Saves the form; returns the saved draft or null on validation failure.
function saveForm() {
  let fields;
  try {
    fields = readForm();
  } catch (err) {
    setStatus(err.message, 'err');
    return null;
  }
  const id = $('edit-id').value;
  let draft;
  if (id) {
    draft = Object.assign(drafts.find(d => d.id === id), fields, { updated: Date.now() });
  } else {
    draft = { id: newId(), created: Date.now(), posted: false, ...fields };
    drafts.unshift(draft);
  }
  if (!save()) return null;
  resetForm();
  setStatus(id ? 'Draft updated' : 'Draft saved', 'ok');
  showFilter('todo');
  return draft;
}

$('draft-form').addEventListener('submit', e => {
  e.preventDefault();
  saveForm();
});

$('open-btn').addEventListener('click', () => {
  const draft = saveForm();
  if (draft) window.open(oldRedditUrl(draft), '_blank', 'noopener,noreferrer');
});

$('cancel-edit').addEventListener('click', () => { resetForm(); setStatus(''); });

function startEdit(d) {
  $('edit-id').value = d.id;
  $('subreddit').value = d.subreddit;
  $('account').value = d.account || '';
  $('title').value = d.title;
  $('body').value = d.body || '';
  $('url').value = d.url || '';
  setKind(d.kind);
  $('form-title').textContent = 'Edit draft';
  $('save-btn').textContent = 'Save changes';
  $('cancel-edit').classList.remove('hidden');
  setStatus('');
  $('draft-form').scrollIntoView({ behavior: 'smooth' });
  $('title').focus({ preventScroll: true });
}

// ---------- Draft list ----------

function showFilter(f) {
  filter = f;
  document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
  render();
}
document.querySelectorAll('#filters button').forEach(btn => btn.addEventListener('click', () => showFilter(btn.dataset.filter)));

function button(text, onClick, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small' + (primary ? '' : ' secondary');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function link(text, href, primary) {
  const a = document.createElement('a');
  a.className = 'btn small' + (primary ? '' : ' secondary');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  return a;
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = old; }, 1200);
  } catch {
    prompt('Copy this:', text);
  }
}

function update(d, changes) {
  Object.assign(d, changes);
  save();
  render();
}

function render() {
  const list = $('drafts');
  list.replaceChildren();
  const shown = drafts.filter(d => (filter === 'posted') === !!d.posted);

  for (const d of shown) {
    const li = document.createElement('li');

    const title = document.createElement('div');
    title.className = 'draft-title';
    title.textContent = d.title;

    const meta = document.createElement('div');
    meta.className = 'draft-meta';
    const bits = ['r/' + d.subreddit, d.kind === 'link' ? 'link' : 'text'];
    if (d.account) bits.push('as ' + d.account);
    if (d.posted) bits.push('posted ' + new Date(d.posted).toLocaleDateString());
    meta.textContent = bits.join(' · ');

    const actions = document.createElement('div');
    actions.className = 'draft-actions';
    actions.append(
      link('Open', oldRedditUrl(d), !d.posted),
      link('New Reddit', newRedditUrl(d)),
    );
    const copyTitle = button('Copy title', () => copy(d.title, copyTitle));
    const copyBody = button(d.kind === 'link' ? 'Copy URL' : 'Copy body',
      () => copy(d.kind === 'link' ? d.url : d.body, copyBody));
    actions.append(
      copyTitle, copyBody,
      button('Edit', () => startEdit(d)),
      d.posted
        ? button('Move back', () => update(d, { posted: false }))
        : button('Mark posted', () => update(d, { posted: Date.now() })),
      button('Delete', () => {
        if (!confirm(`Delete "${d.title}"?`)) return;
        drafts = drafts.filter(x => x !== d);
        save();
        render();
      }),
    );

    li.append(title, meta, actions);
    list.append(li);
  }
  $('empty').classList.toggle('hidden', shown.length > 0);

  // Suggest previously used account names in the "Post as" field.
  const names = [...new Set(drafts.map(d => d.account).filter(Boolean))];
  $('account-list').replaceChildren(...names.map(n => new Option(n)));
}

render();
