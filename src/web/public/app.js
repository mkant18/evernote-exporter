'use strict';

const $ = (id) => document.getElementById(id);
const state = { key: '', archives: [], archive: null, notes: [], selected: null, queue: [], importing: false, status: null, generation: 0 };
const imageUrls = new Set();
let imageObserver;
let readerAbort = new AbortController();
const dialogOpeners = new WeakMap();
const safeElements = new Set(['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'dl', 'dt', 'dd']);
const previewImages = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function announce(message) { $('announcement').textContent = message; }
function showError(message) { $('app-error').textContent = message; $('app-error').hidden = !message; }
function bytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function plural(count, word) { return `${count} ${word}${count === 1 ? '' : 's'}`; }
function notebookName(archive) { return archive.name || (typeof archive.notebook === 'string' ? archive.notebook : archive.notebook?.name) || 'Untitled notebook'; }
function date(value) {
  if (!value || Number.isNaN(new Date(value).valueOf())) return '';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}
function filename(value, fallback) {
  const cleaned = String(value || '').split(/[\\/]/).at(-1).replace(/[<>:"|?*\x00-\x1f]/g, '_').trim();
  return cleaned || fallback;
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...options.headers, 'X-Archive-Key': state.key }, cache: 'no-store' });
  if (!response.ok) {
    let message = `The request could not be completed (${response.status}).`;
    try { message = (await response.json()).error || message; } catch { /* Preserve the HTTP error if the server returned no JSON. */ }
    if (response.status === 401 || response.status === 403) message = 'The private connection has expired or the code is incorrect. Reopen the launcher’s private link.';
    throw new Error(message);
  }
  return response;
}

function openDialog(id, opener) {
  if ($(id).open) return;
  dialogOpeners.set($(id), opener || document.activeElement);
  $(id).showModal();
}
function setConnected(connected) {
  $('connection').hidden = connected;
  $('import-open').disabled = !connected;
  $('phone-open').disabled = !connected;
  if (!connected) { $('workspace').hidden = true; $('welcome').hidden = true; }
}

async function connect() {
  showError('');
  $('connection-error').textContent = '';
  $('loading').hidden = false;
  setConnected(false);
  if (!state.key) { $('loading').hidden = true; return; }
  try {
    state.status = await (await api('/api/status')).json();
    try { sessionStorage.setItem('evernote-archive-key', state.key); } catch { /* Connection still works when browser storage is disabled. */ }
    setConnected(true);
    if (state.status.maxUploadBytes) $('upload-limit').textContent = `Up to ${bytes(state.status.maxUploadBytes)} per file. Originals preserved.`;
    await loadLibrary();
    renderSharing();
  } catch (error) {
    setConnected(false);
    $('connection-error').textContent = error.message || 'The app is unavailable. Check that it is still running on your computer.';
  } finally { $('loading').hidden = true; }
}

async function loadLibrary(preferredId) {
  const data = await (await api('/api/archives')).json();
  state.archives = data.archives;
  $('welcome').hidden = state.archives.length > 0;
  $('workspace').hidden = state.archives.length === 0;
  renderLibrary();
  if (state.archives.length) {
    const chosen = state.archives.find((archive) => archive.id === preferredId || (!preferredId && archive.id === state.archive?.id)) || state.archives[0];
    await selectArchive(chosen.id);
  }
  if (data.issues?.length) showError(`${plural(data.issues.length, 'stored notebook')} could not be opened. The original files are still kept on this computer. Check the library before relying on this archive.`);
}

function renderLibrary() {
  $('archive-count').textContent = String(state.archives.length);
  $('archive-list').replaceChildren();
  $('notebook-select').replaceChildren();
  for (const archive of state.archives) {
    const button = element('button', undefined, 'archive-button');
    button.type = 'button';
    button.dataset.archive = archive.id;
    button.setAttribute('aria-current', String(state.archive?.id === archive.id));
    const mark = element('span', '▤', 'archive-symbol'); mark.setAttribute('aria-hidden', 'true');
    const label = element('span');
    label.append(element('strong', notebookName(archive)), element('small', `${archive.stack ? `${archive.stack} · ` : ''}${plural(archive.notes, 'note')}`));
    button.append(mark, label);
    button.addEventListener('click', () => selectArchive(archive.id).catch((error) => showError(error.message)));
    $('archive-list').append(button);
    const option = element('option', notebookName(archive)); option.value = archive.id;
    $('notebook-select').append(option);
  }
}

async function selectArchive(id) {
  const generation = ++state.generation;
  $('workspace').setAttribute('aria-busy', 'true');
  showError('');
  try {
    const data = await (await api(`/api/archives/${encodeURIComponent(id)}`)).json();
    if (generation !== state.generation) return;
    state.archive = state.archives.find((archive) => archive.id === id);
    state.notes = data.notes;
    state.manifest = data.manifest;
    state.selected = null;
    $('archive-title').textContent = notebookName(state.archive);
    $('archive-stack').textContent = state.archive.stack || 'YOUR INDEPENDENT COLLECTION';
    $('archive-subtitle').textContent = `${plural(state.notes.length, 'note')} · ${plural(data.manifest.counts.attachments, 'attachment')} · Original export preserved`;
    $('search').value = '';
    $('tag-filter').replaceChildren(element('option', 'All tags'));
    $('tag-filter').firstElementChild.value = '';
    for (const tag of data.manifest.tags) { const option = element('option', tag); option.value = tag; $('tag-filter').append(option); }
    $('notebook-select').value = id;
    for (const button of $('archive-list').children) button.setAttribute('aria-current', String(button.dataset.archive === id));
    renderWarnings(data.manifest.warnings);
    renderNoteList();
    if (state.notes.length && window.matchMedia('(min-width: 901px)').matches) selectNote(state.notes[0].id);
    else renderPlaceholder();
    announce(`${notebookName(state.archive)} opened. ${plural(state.notes.length, 'note')}.`);
  } catch (error) {
    if (generation === state.generation && state.archive) $('notebook-select').value = state.archive.id;
    throw error;
  } finally { if (generation === state.generation) $('workspace').removeAttribute('aria-busy'); }
}

function renderWarnings(warnings) {
  const notebookWarnings = warnings.filter((warning) => !warning.noteId);
  const affectedNotes = new Set(warnings.filter((warning) => warning.noteId).map((warning) => warning.noteId)).size;
  $('warning-summary').textContent = affectedNotes ? `${plural(affectedNotes, 'note')} with details to review · About this archive` : 'About this archive · Export coverage is unverified';
  $('archive-warnings').replaceChildren(...notebookWarnings.map((warning) => element('li', warning.detail)));
}

function filteredNotes() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const tag = $('tag-filter').value;
  return state.notes.filter((note) => (!tag || note.tags.includes(tag)) && (!query || `${note.title}\n${note.content.plainText}\n${note.tags.join(' ')}`.toLocaleLowerCase().includes(query)));
}

function renderNoteList() {
  const notes = filteredNotes();
  $('note-list').replaceChildren();
  $('results-count').textContent = notes.length === state.notes.length ? plural(notes.length, 'note') : `${notes.length} of ${plural(state.notes.length, 'note')}`;
  $('no-results').hidden = notes.length !== 0;
  for (const note of notes) {
    const button = element('button', undefined, 'note-button'); button.type = 'button'; button.dataset.note = note.id;
    button.setAttribute('aria-current', String(state.selected?.id === note.id));
    button.append(element('strong', note.title || 'Untitled note'), element('span', note.content.plainText.slice(0, 230) || 'No text preview', 'excerpt'));
    const changed = date(note.updated || note.created);
    if (changed) button.append(element('span', changed, 'note-date'));
    button.addEventListener('click', () => selectNote(note.id, true));
    $('note-list').append(button);
  }
  if (state.selected && !notes.some((note) => note.id === state.selected.id)) { state.selected = null; renderPlaceholder(); }
}

function resetReader() {
  readerAbort.abort(); readerAbort = new AbortController();
  imageObserver?.disconnect();
  for (const url of imageUrls) URL.revokeObjectURL(url);
  imageUrls.clear();
  $('reader').replaceChildren();
}

function renderPlaceholder() {
  resetReader();
  $('reading-layout').classList.remove('has-selection');
  const placeholder = element('div', undefined, 'reader-placeholder');
  const symbol = element('span', '↳'); symbol.setAttribute('aria-hidden', 'true');
  placeholder.append(symbol, element('h2', state.notes.length ? 'A little space to read.' : 'An empty notebook.'), element('p', state.notes.length ? 'Select a note from your notebook.' : 'The supplied export contains no notes.'));
  $('reader').append(placeholder);
}

function selectNote(id, focus = false) {
  const note = state.notes.find((item) => item.id === id);
  if (!note) return;
  state.selected = note;
  resetReader();
  $('reading-layout').classList.add('has-selection');
  for (const button of $('note-list').children) button.setAttribute('aria-current', String(button.dataset.note === id));
  const back = element('button', '← Back to notes', 'quiet-button reader-back'); back.type = 'button';
  back.addEventListener('click', () => { state.selected = null; renderPlaceholder(); const previous = [...$('note-list').children].find((button) => button.dataset.note === id); previous?.focus(); });
  const title = element('h2', note.title || 'Untitled note', 'reader-title'); title.tabIndex = -1;
  const meta = element('div', undefined, 'reader-meta');
  if (date(note.created)) meta.append(element('span', `Created ${date(note.created)}`));
  if (date(note.updated)) meta.append(element('span', `Updated ${date(note.updated)}`));
  const tags = element('ul', undefined, 'tag-list'); tags.setAttribute('aria-label', 'Note tags');
  for (const tag of note.tags) tags.append(element('li', tag));
  const body = element('div', undefined, 'note-body');
  const context = { note, archiveId: state.archive.id, signal: readerAbort.signal, nodes: 0, truncated: false };
  body.append(renderNode(note.content.document, context));
  $('reader').append(back, title, meta, tags, body);
  const status = element('p', '', 'reader-status'); status.id = 'reader-status'; status.setAttribute('role', 'status'); $('reader').append(status);
  if (note.warnings.length) {
    const details = element('details', undefined, 'note-warning');
    details.append(element('summary', `${plural(note.warnings.length, 'detail')} to review`), element('ul'));
    details.lastChild.append(...note.warnings.map((warning) => element('li', warning.detail)));
    $('reader').append(details);
  }
  if (note.attachments.length) {
    const section = element('section', undefined, 'attachments-section'); section.append(element('h3', 'Original attachments'));
    const list = element('ul', undefined, 'attachment-list');
    for (const attachment of note.attachments) {
      const row = element('li'); const label = element('div');
      label.append(element('strong', attachment.filename || 'Attachment'), element('small', `${bytes(attachment.bytes)} · ${attachment.mime}`));
      const button = element('button', 'Download', 'quiet-button'); button.type = 'button'; button.setAttribute('aria-label', `Download ${attachment.filename || 'attachment'}`);
      button.addEventListener('click', () => downloadAttachment(attachment, context.archiveId, button)); row.append(label, button); list.append(row);
    }
    section.append(list); $('reader').append(section);
  }
  imageObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { imageObserver.unobserve(entry.target); entry.target.loadAttachment?.(); }
  }, { rootMargin: '200px' }) : null;
  for (const image of body.querySelectorAll('img')) { if (imageObserver) imageObserver.observe(image); else image.loadAttachment?.(); }
  if (focus) { title.focus({ preventScroll: true }); if (window.matchMedia('(max-width: 900px)').matches) $('reader').scrollIntoView({ block: 'start' }); }
}

function renderNode(node, context) {
  context.nodes++;
  if (context.nodes > 30000) {
    if (context.truncated) return document.createDocumentFragment();
    context.truncated = true;
    return element('p', 'This note is too long to preview fully here. The complete content remains in your archive and original export.', 'notice');
  }
  if (node.type === 'text') return document.createTextNode(node.text);
  if (node.type === 'checkbox') {
    const label = node.checked === null ? 'Unknown checkbox state' : node.checked ? 'Checked' : 'Unchecked';
    const checkbox = element('span', node.checked === null ? '?' : node.checked ? '✓' : '', `note-checkbox${node.checked === null ? ' unknown' : node.checked ? '' : ' unchecked'}`);
    checkbox.setAttribute('role', 'img'); checkbox.setAttribute('aria-label', label); return checkbox;
  }
  if (node.type === 'encrypted') {
    const box = element('div', undefined, 'encrypted-placeholder');
    box.append(element('strong', 'Encrypted content preserved'), element('span', 'This reader cannot decrypt it. Keep the original export. Do not open the source note under the no-changes requirement.'));
    return box;
  }
  if (node.type === 'attachment') {
    const attachment = context.note.attachments.find((item) => item.id === node.attachmentId);
    if (!attachment) return element('span', '[Attachment missing from the supplied export]', 'muted');
    if (previewImages.has(attachment.mime) && attachment.bytes <= 20 * 1024 * 1024) {
      const image = element('img', undefined, 'embedded-image'); image.alt = attachment.filename || node.attributes?.alt || 'Note image'; image.loading = 'lazy';
      image.loadAttachment = async () => {
        try {
          const response = await api(`/api/archives/${encodeURIComponent(context.archiveId)}/assets/${attachment.sha256}`, { signal: context.signal });
          const blob = await response.blob();
          if (context.signal.aborted) return;
          const url = URL.createObjectURL(new Blob([blob], { type: attachment.mime })); imageUrls.add(url); image.src = url;
        } catch (error) { if (error.name !== 'AbortError') image.replaceWith(element('span', `Image unavailable: ${attachment.filename || 'attachment'}`, 'muted')); }
      };
      return image;
    }
    const button = element('button', `↓ ${attachment.filename || 'Download attachment'}`, 'attachment-inline'); button.type = 'button';
    button.addEventListener('click', () => downloadAttachment(attachment, context.archiveId, button)); return button;
  }
  let container;
  if (node.type === 'document') container = document.createDocumentFragment();
  else if (node.name === 'a') {
    container = element('span');
    container.title = `Link kept inactive to avoid contacting the source: ${node.attributes?.href || ''}`;
  } else if (node.name === 'img') return element('span', '[Remote image not downloaded]', 'muted');
  else container = element(safeElements.has(node.name) ? node.name : 'span');
  for (const child of node.children || []) container.append(renderNode(child, context));
  if (node.name === 'table') { const wrapper = element('div', undefined, 'table-scroll'); wrapper.append(container); return wrapper; }
  return container;
}

async function saveBlob(response, suggestedFilename) {
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  let name = suggestedFilename;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const quoted = /filename="([^"]+)"/i.exec(disposition);
  try { if (utf8) name = decodeURIComponent(utf8[1]); else if (quoted) name = quoted[1]; } catch { /* Keep a safe fallback filename. */ }
  const url = URL.createObjectURL(blob); const anchor = element('a'); anchor.href = url; anchor.download = filename(name, suggestedFilename);
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function downloadAttachment(attachment, archiveId, button) {
  button.disabled = true;
  try {
    await saveBlob(await api(`/api/archives/${encodeURIComponent(archiveId)}/assets/${attachment.sha256}`), attachment.filename || 'attachment');
    announce(`Download prepared: ${attachment.filename || 'attachment'}.`);
  } catch (error) { const status = $('reader-status'); if (status) status.textContent = error.message; else showError(error.message); }
  finally { button.disabled = false; }
}

function addFiles(files) {
  if (state.importing) return;
  const rejected = [];
  for (const file of files) {
    if (!/\.enex$/i.test(file.name)) { rejected.push(`${file.name}: choose an ENEX file.`); continue; }
    if (state.status?.maxUploadBytes && file.size > state.status.maxUploadBytes) { rejected.push(`${file.name}: this file exceeds the ${bytes(state.status.maxUploadBytes)} upload limit.`); continue; }
    if (!state.queue.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) state.queue.push({ file, notebook: file.name.replace(/\.enex$/i, ''), done: false, error: '' });
  }
  $('import-error').textContent = rejected.join('\n');
  renderQueue();
}

function renderQueue() {
  $('import-queue').replaceChildren();
  for (const [index, item] of state.queue.entries()) {
    const row = element('li', undefined, 'queue-item');
    const header = element('div', undefined, 'queue-heading'); const description = element('div');
    description.append(element('div', item.file.name, 'queue-filename'), element('div', bytes(item.file.size), 'queue-size'));
    const remove = element('button', '×', 'icon-button'); remove.type = 'button'; remove.disabled = state.importing; remove.setAttribute('aria-label', `Remove ${item.file.name}`);
    remove.addEventListener('click', () => { state.queue.splice(index, 1); renderQueue(); }); header.append(description, remove);
    const label = element('label', 'Notebook name'); const input = element('input'); input.id = `notebook-name-${index}`; label.htmlFor = input.id;
    input.value = item.notebook; input.required = true; input.maxLength = 200; input.disabled = state.importing || item.done;
    input.addEventListener('input', () => { item.notebook = input.value; input.setCustomValidity(''); input.removeAttribute('aria-invalid'); });
    row.append(header, label, input);
    if (item.done) row.append(element('p', '✓ Added to your archive', 'queue-state'));
    if (item.error) { const error = element('p', item.error, 'queue-state error'); error.id = `queue-error-${index}`; error.setAttribute('role', 'alert'); input.setAttribute('aria-describedby', error.id); row.append(error); }
    $('import-queue').append(row);
  }
  $('stack-field').hidden = !state.queue.length;
  $('import-submit').disabled = state.importing || !state.queue.some((item) => !item.done);
  $('import-submit').textContent = state.queue.some((item) => item.error) ? 'Retry remaining files' : 'Add to archive';
}

async function importFiles(event) {
  event.preventDefault();
  if (state.importing || !state.queue.some((item) => !item.done)) return;
  for (const [index, item] of state.queue.entries()) {
    if (!item.done && !item.notebook.trim()) { const input = $(`notebook-name-${index}`); input.setCustomValidity('Enter a notebook name.'); input.setAttribute('aria-invalid', 'true'); input.reportValidity(); return; }
  }
  state.importing = true; $('import-error').textContent = ''; $('import-progress').hidden = false; $('import-form').setAttribute('aria-busy', 'true');
  for (const id of ['choose-files', 'import-close', 'import-cancel', 'import-stack']) $(id).disabled = true;
  const pending = state.queue.filter((item) => !item.done); $('progress-bar').max = pending.length; $('progress-bar').value = 0;
  let lastArchive;
  for (const [index, item] of pending.entries()) {
    item.error = ''; renderQueue();
    $('import-status').textContent = `Adding ${index + 1} of ${pending.length}: ${item.file.name}. Large exports can take a little while.`;
    try {
      const query = new URLSearchParams({ filename: item.file.name, notebook: item.notebook.trim() });
      const stack = $('import-stack').value.trim(); if (stack) query.set('stack', stack);
      const response = await api(`/api/import?${query}`, { method: 'POST', body: item.file, headers: { 'Content-Type': 'application/octet-stream' } });
      const result = await response.json(); lastArchive = result.id; item.done = true;
    } catch (error) { item.error = error.message || 'Import failed. Your original file has not been changed.'; }
    $('progress-bar').value = index + 1;
  }
  state.importing = false; $('import-form').removeAttribute('aria-busy');
  for (const id of ['choose-files', 'import-close', 'import-cancel', 'import-stack']) $(id).disabled = false;
  renderQueue();
  const failed = pending.filter((item) => !item.done).length;
  $('import-status').textContent = failed ? `${pending.length - failed} added. ${plural(failed, 'file')} could not be imported; details are shown above.` : `${plural(pending.length, 'notebook')} added. Your originals are preserved.`;
  if (lastArchive) {
    try { await loadLibrary(lastArchive); } catch (error) { showError(`Import finished, but the library could not refresh. ${error.message}`); }
  }
  if (!failed) {
    $('import-dialog').close(); state.queue = []; renderQueue(); $('files').value = ''; $('import-progress').hidden = true; $('import-stack').value = '';
    announce(`${plural(pending.length, 'notebook')} added to your archive.`);
  }
}

async function download(format, button) {
  if (!state.archive) return;
  const archiveId = state.archive.id;
  const notebook = notebookName(state.archive);
  $('download-error').textContent = ''; $('download-status').textContent = 'Preparing your download…';
  for (const option of document.querySelectorAll('[data-format]')) option.disabled = true;
  try {
    const extensions = { markdown: '.zip', portable: '.html', source: '.enex', archive: '.zip' };
    await saveBlob(await api(`/api/archives/${encodeURIComponent(archiveId)}/download/${format}`), `${filename(notebook, 'notebook')}${extensions[format]}`);
    $('download-status').textContent = 'Your download is ready. Check your browser’s downloads or Files app.';
  } catch (error) { $('download-status').textContent = ''; $('download-error').textContent = error.message; }
  finally { for (const option of document.querySelectorAll('[data-format]')) option.disabled = false; button.focus(); }
}

function renderSharing() {
  const sharing = state.status?.sharing;
  $('share-links').replaceChildren();
  $('sharing-help').hidden = !!(sharing?.enabled && sharing.urls?.length);
  if (!sharing?.enabled) return;
  for (const [index, url] of (sharing.urls || []).entries()) {
    const box = element('div', undefined, 'share-link'); const label = element('label', index ? `Private link ${index + 1}` : 'Private link for Safari');
    const input = element('input'); input.type = 'text'; input.readOnly = true; input.value = url; input.id = `share-url-${index}`; label.htmlFor = input.id;
    input.addEventListener('focus', () => input.select());
    const button = element('button', 'Copy private link', 'outline-button'); button.type = 'button';
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); $('phone-status').textContent = 'Private link copied. Send it to your iPhone and open it in Safari.'; }
      catch { input.focus(); input.select(); $('phone-status').textContent = 'Select and copy this link, then open it in Safari on your iPhone.'; }
    });
    box.append(label, input, button); $('share-links').append(box);
  }
}

for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => {
  const opener = dialogOpeners.get(dialog);
  const target = opener?.isConnected && opener.getClientRects().length && !opener.disabled ? opener : $('import-open');
  target.focus({ preventScroll: true });
});
for (const id of ['import-open', 'welcome-import']) $(id).addEventListener('click', (event) => openDialog('import-dialog', event.currentTarget));
for (const id of ['import-close', 'import-cancel']) $(id).addEventListener('click', () => $('import-dialog').close());
$('import-dialog').addEventListener('cancel', (event) => { if (state.importing) event.preventDefault(); });
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
$('phone-open').addEventListener('click', (event) => openDialog('phone-dialog', event.currentTarget));
$('download-open').addEventListener('click', (event) => { $('download-error').textContent = ''; $('download-status').textContent = ''; openDialog('download-dialog', event.currentTarget); });
for (const button of document.querySelectorAll('[data-format]')) button.addEventListener('click', () => download(button.dataset.format, button));
$('choose-files').addEventListener('click', () => $('files').click());
$('files').addEventListener('change', () => { addFiles($('files').files); $('files').value = ''; });
$('import-form').addEventListener('submit', importFiles);
$('search').addEventListener('input', renderNoteList);
$('tag-filter').addEventListener('change', renderNoteList);
$('clear-filters').addEventListener('click', () => { $('search').value = ''; $('tag-filter').value = ''; renderNoteList(); $('search').focus(); });
$('notebook-select').addEventListener('change', () => selectArchive($('notebook-select').value).catch((error) => showError(error.message)));
for (const eventName of ['dragenter', 'dragover']) $('drop-zone').addEventListener(eventName, (event) => { event.preventDefault(); if (!state.importing) $('drop-zone').classList.add('drag-over'); });
for (const eventName of ['dragleave', 'drop']) $('drop-zone').addEventListener(eventName, (event) => { event.preventDefault(); $('drop-zone').classList.remove('drag-over'); });
$('drop-zone').addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
$('connection-form').addEventListener('submit', (event) => { event.preventDefault(); state.key = $('connection-key').value.trim(); connect(); });
try {
  const fragment = new URLSearchParams(location.hash.slice(1));
  state.key = fragment.get('key') || sessionStorage.getItem('evernote-archive-key') || '';
  if (fragment.has('key')) history.replaceState(null, '', location.pathname + location.search);
} catch { state.key = ''; }
connect();
