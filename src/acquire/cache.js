'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Y = require('yjs');
const { DatabaseSync } = require('node:sqlite');
const { readEnex } = require('../parsers/enex/read');

const FORMAT = 'evernote-windows-snapshot-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MD5 = /^[a-f0-9]{32}$/i;
const MAX_NOTE = 120 * 1024 * 1024;
const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function plainPath(filename) {
  const full = path.resolve(filename);
  let current = full;
  while (true) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('Linked paths are not accepted. Use a separate ordinary backup folder.');
    const parent = path.dirname(current);
    if (current === parent) break;
    current = parent;
  }
  return fs.realpathSync.native(full);
}

function below(root, name) {
  if (typeof name !== 'string' || !name.startsWith('cache/') || name.split('/').some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f]/.test(p))) {
    throw new Error('Invalid backup manifest path.');
  }
  const resolved = path.resolve(root, name);
  if (!resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw new Error('Path leaves backup.');
  return resolved;
}

function walk(directory, prefix = '') {
  const files = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const full = path.join(directory, name), rel = prefix ? `${prefix}/${name}` : name;
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('Linked backup entries are not accepted.');
    if (stat.isDirectory()) files.push(...walk(full, rel));
    else if (stat.isFile()) files.push(rel);
    else throw new Error('Unsupported backup entry.');
  }
  return files;
}

function decodeBody(bytes) {
  if (bytes.length > 64 * 1024 * 1024) throw new Error('Note body exceeds decoder limit; original retained.');
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
    if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Incomplete Yjs update; original retained.');
    if (!doc.share.has('content')) throw new Error('Missing content root.');
    const media = new Map();
    const render = (node, depth = 0) => {
      if (depth > 100) throw new Error('Note nesting exceeds limit.');
      if (node instanceof Y.XmlText) {
        return node.toDelta().map(part => {
          if (typeof part.insert !== 'string' || (part.attributes && Object.keys(part.attributes).length)) {
            throw new Error('Unsupported rich-text delta; original retained.');
          }
          return xml(part.insert);
        }).join('');
      }
      if (!(node instanceof Y.XmlElement) || !/^[A-Za-z][A-Za-z0-9-]*$/.test(node.nodeName)) throw new Error('Unsupported note element.');
      const attrs = node.getAttributes();
      let attributes = '';
      for (const [key, value] of Object.entries(attrs)) {
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Unsupported note attribute.');
        attributes += ` ${key}="${xml(value)}"`;
      }
      if (node.nodeName === 'en-media') {
        if (!MD5.test(attrs.hash || '') || typeof attrs.type !== 'string') throw new Error('Invalid attachment reference.');
        const hash = attrs.hash.toLowerCase();
        if (media.has(hash) && media.get(hash) !== attrs.type) throw new Error('Conflicting attachment MIME types.');
        media.set(hash, attrs.type);
      }
      return `<${node.nodeName}${attributes}>${node.toArray().map(child => render(child, depth + 1)).join('')}</${node.nodeName}>`;
    };
    const roots = doc.get('content', Y.XmlFragment).toArray();
    if (roots.length !== 1 || roots[0].nodeName !== 'en-note') throw new Error('Expected one en-note root.');
    return { enml: render(roots[0]), media };
  } finally { doc.destroy(); }
}

function date(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Invalid note timestamp.');
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function tables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
}

async function exportCache({ input, output }) {
  if (!input || !output) throw new Error('Both --input backup folder and --output new folder are required.');
  const source = plainPath(input);
  const requested = path.resolve(output);
  const destination = path.join(plainPath(path.dirname(requested)), path.basename(requested));
  if (destination.toLowerCase().startsWith(source.toLowerCase() + path.sep) || source.toLowerCase().startsWith(destination.toLowerCase() + path.sep) || destination.toLowerCase() === source.toLowerCase()) {
    throw new Error('Output must be separate from the backup.');
  }
  if (fs.existsSync(destination)) throw new Error('Output already exists; choose a new folder.');
  const receiptPath = plainPath(path.join(source, 'snapshot.json'));
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.format !== FORMAT || !Array.isArray(receipt.files) || !receipt.files.length) throw new Error('Use a verified Windows snapshot backup with snapshot.json.');
  const names = new Set();
  for (const entry of receipt.files) {
    const filename = plainPath(below(source, entry.path));
    if (names.has(entry.path.toLowerCase()) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid or duplicated snapshot entry.');
    names.add(entry.path.toLowerCase());
    if (!fs.statSync(filename).isFile()) throw new Error('Snapshot entry is not a file.');
  }
  const listed = walk(plainPath(path.join(source, 'cache')), 'cache');
  if (listed.length !== names.size || listed.some(n => !names.has(n.toLowerCase()))) throw new Error('Snapshot inventory does not match the backup files.');
  fs.mkdirSync(destination);
  const raw = path.join(destination, 'original-backup');
  fs.mkdirSync(raw);
  fs.copyFileSync(receiptPath, path.join(raw, 'snapshot.json'), fs.constants.COPYFILE_EXCL);
  // Copy and hash streams, not buffers: backups can be much larger than RAM.
  const { pipeline } = require('node:stream/promises');
  const { Transform } = require('node:stream');
  for (const entry of receipt.files) {
    const target = below(raw, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const hash = crypto.createHash('sha256');
    let size = 0;
    await pipeline(fs.createReadStream(below(source, entry.path)), new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); size += chunk.length; callback(null, chunk); } }), fs.createWriteStream(target, { flags: 'wx' }));
    if (size !== entry.size || hash.digest('hex') !== entry.sha256) throw new Error('Backup checksum mismatch. Output is incomplete; retain the input and try a new output folder.');
  }
  const report = {
    format: 'evernote-cache-export-v1', sourcePreservation: 'verified-backup-bytes-copied; no Evernote client or API used',
    accountCoverage: 'unverified', status: 'incomplete', notesInDatabase: 0, notesExported: 0,
    attachmentsExported: 0, notebooks: [], files: [], noteIndex: [], issues: [],
    limitations: ['Cloud-only notes/resources cannot be detected or downloaded by this tool.', 'Pending local mutations are retained in original-backup, not replayed.', 'History, sharing permissions, Tasks, reminders, OCR, tag/stack hierarchy and other app state remain in original-backup; ENEX is not a full account reconstruction.'],
  };
  const issue = message => report.issues.push(message);
  let db;
  try {
    const graphFiles = listed.filter(n => /\/UDB-User\d+\+RemoteGraph\.sql$/i.test(n));
    if (graphFiles.length !== 1) throw new Error('Expected exactly one account graph. Multiple accounts or an unsupported cache need separate inspection.');
    const graph = graphFiles[0];
    const userId = graph.match(/UDB-User(\d+)\+/i)[1];
    const servicePrefix = path.posix.dirname(graph).replace('cache/conduit-storage/', 'cache/conduit-fs/') + '/';
    const bodyFiles = listed.filter(n => n.startsWith(servicePrefix) && /\/rte\/Note\/internal_rteDoc\/.+\.dat$/i.test(n));
    const profiles = new Set(bodyFiles.map(n => n.split('/rte/Note/internal_rteDoc/')[0]));
    if (profiles.size > 1) throw new Error('Multiple body profiles cannot be safely matched to the account.');
    const bodies = new Map();
    for (const name of bodyFiles) {
      const id = path.posix.basename(name, '.dat').toLowerCase();
      if (!UUID.test(id) || bodies.has(id)) throw new Error('Ambiguous or invalid body identifier.');
      bodies.set(id, name);
    }
    const working = path.join(destination, 'working-database');
    fs.mkdirSync(working);
    const database = path.join(working, 'graph.sql');
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const entry = listed.find(n => n === graph + suffix);
      if (entry) fs.copyFileSync(below(raw, entry), database + suffix, fs.constants.COPYFILE_EXCL);
    }
    // Recovery may write here. Only this disposable database is ever opened by SQLite.
    db = new DatabaseSync(database, { allowExtension: false, enableDoubleQuotedStringLiterals: false });
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
    const integrity = db.prepare('PRAGMA quick_check').all();
    if (integrity.some(row => Object.values(row)[0] !== 'ok')) throw new Error('Copied database integrity check failed.');
    const available = tables(db);
    const schema = {
      Nodes_Note: ['id', 'label', 'created', 'updated', 'deleted', 'parent_Notebook_id'],
      Nodes_Notebook: ['id', 'label'], Nodes_Tag: ['id', 'label'], NoteTag: ['Note_id', 'Tag_id'],
      Attachment: ['parent_Note_id', 'dataHash', 'filename', 'mime', 'dataSize', 'isActive'],
    };
    for (const [name, required] of Object.entries(schema)) {
      if (!available.has(name)) throw new Error(`Unsupported cache schema: missing ${name}. Original backup retained.`);
      const columns = new Set(db.prepare(`PRAGMA table_info("${name}")`).all().map(r => r.name));
      if (required.some(column => !columns.has(column))) throw new Error(`Unsupported cache schema: columns changed in ${name}. Original backup retained.`);
    }
    const notes = db.prepare('SELECT * FROM Nodes_Note ORDER BY id').all();
    report.notesInDatabase = notes.length;
    const notebooks = db.prepare('SELECT * FROM Nodes_Notebook').all();
    for (const rows of [notes, notebooks]) {
      const ids = new Set();
      for (const row of rows) {
        if (!UUID.test(row.id) || ids.has(row.id.toLowerCase()) || typeof row.label !== 'string') throw new Error('Invalid or duplicated source identity/title.');
        ids.add(row.id.toLowerCase());
      }
    }
    const noteIds = new Set(notes.map(n => n.id));
    const bodyIds = new Set(notes.map(n => n.id.toLowerCase()));
    if ([...bodies.keys()].some(id => !bodyIds.has(id))) issue({ reason: 'Backup contains body files absent from the copied graph. They remain in original-backup for reconciliation.' });
    report.notebooks = notebooks.map(n => ({ id: n.id, name: n.label, stackId: n.stack_Stack_id ?? null, noteCount: notes.filter(r => r.parent_Notebook_id === n.id).length }));
    const tagRows = db.prepare('SELECT id,label FROM Nodes_Tag').all();
    const tagIds = new Set();
    for (const tag of tagRows) {
      if (typeof tag.id !== 'string' || !tag.id || tagIds.has(tag.id.toLowerCase()) || typeof tag.label !== 'string' || !tag.label) throw new Error('Invalid or duplicated tag identity/label.');
      tagIds.add(tag.id.toLowerCase());
    }
    const tags = new Map(tagRows.map(r => [r.id, r.label]));
    const noteTags = new Map();
    for (const r of db.prepare('SELECT Note_id,Tag_id FROM NoteTag').all()) {
      if (!tags.has(r.Tag_id)) throw new Error('Dangling tag reference.');
      if (!noteIds.has(r.Note_id)) throw new Error('Tag mapping refers to an absent note.');
      if (!noteTags.has(r.Note_id)) noteTags.set(r.Note_id, []);
      noteTags.get(r.Note_id).push(tags.get(r.Tag_id));
    }
    const resources = db.prepare('SELECT * FROM Attachment').all();
    if (resources.some(r => !noteIds.has(r.parent_Note_id))) issue({ reason: 'Attachment records refer to notes absent from the copied graph; retained in original-backup.' });
    const accountResources = listed.filter(n => n.startsWith(`cache/resource-cache/User${userId}/`) && MD5.test(path.posix.basename(n)));
    const resourcesByHash = new Map();
    for (const filename of accountResources) {
      const hash = path.posix.basename(filename).toLowerCase();
      if (!resourcesByHash.has(hash)) resourcesByHash.set(hash, []);
      resourcesByHash.get(hash).push(filename);
    }
    const enexDir = path.join(destination, 'enex');
    fs.mkdirSync(enexDir);
    const groups = new Map();
    for (const note of notes) {
      try {
        if (!UUID.test(note.id) || typeof note.label !== 'string') throw new Error('Invalid note identity/title.');
        const notebook = notebooks.find(n => n.id === note.parent_Notebook_id);
        if (!notebook || !UUID.test(notebook.id) || typeof notebook.label !== 'string') throw new Error('Unknown notebook.');
        const bodyFile = bodies.get(note.id.toLowerCase());
        if (!bodyFile) throw new Error('Note body is absent from this backup.');
        const bodyPath = below(raw, bodyFile);
        if (fs.statSync(bodyPath).size > 64 * 1024 * 1024) throw new Error('Note body exceeds decoder limit; original retained.');
        const { enml, media } = decodeBody(fs.readFileSync(bodyPath));
        let text = `<note><title>${xml(note.label)}</title><content><![CDATA[${enml.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></content>`;
        for (const key of ['created', 'updated']) if (note[key] != null) text += `<${key}>${date(note[key])}</${key}>`;
        for (const tag of noteTags.get(note.id) || []) text += `<tag>${xml(tag)}</tag>`;
        let attrs = '';
        for (const [column, tag] of [['editor_author', 'author'], ['source', 'source'], ['source_URL', 'source-url'], ['source_application', 'source-application']]) {
          if (note[column] != null) attrs += `<${tag}>${xml(note[column])}</${tag}>`;
        }
        if (attrs) text += `<note-attributes>${attrs}</note-attributes>`;
        const attached = resources.filter(r => r.parent_Note_id === note.id && r.isActive !== 0);
        const byHash = new Map();
        for (const r of attached) {
          if (!MD5.test(r.dataHash || '') || typeof r.mime !== 'string' || !Number.isSafeInteger(r.dataSize) || r.dataSize < 0) throw new Error('Unsupported attachment metadata.');
          const hash = r.dataHash.toLowerCase();
          if (byHash.has(hash) && (byHash.get(hash).mime !== r.mime || byHash.get(hash).filename !== r.filename || byHash.get(hash).dataSize !== r.dataSize)) throw new Error('Conflicting repeated attachment metadata; original retained.');
          byHash.set(hash, r);
        }
        for (const [hash, mime] of media) {
          if (!byHash.has(hash)) throw new Error('Body attachment has no matching active database record.');
          if (byHash.get(hash).mime !== mime) throw new Error('Body/database attachment type mismatch.');
        }
        let attachmentCount = 0;
        for (const [hash, metadata] of byHash) {
          const candidates = resourcesByHash.get(hash) || [];
          if (!candidates.length) throw new Error('Attachment bytes are absent from this backup.');
          if (metadata.dataSize > 64 * 1024 * 1024) throw new Error('Attachment exceeds conversion limit; original retained.');
          let bytes;
          for (const candidate of candidates) {
            const full = below(raw, candidate);
            if (fs.statSync(full).size !== metadata.dataSize) continue;
            const possible = fs.readFileSync(full);
            if (crypto.createHash('md5').update(possible).digest('hex') === hash) { bytes = possible; break; }
          }
          if (!bytes) throw new Error('Attachment size/hash check failed.');
          text += `<resource><data encoding="base64">${bytes.toString('base64')}</data><mime>${xml(metadata.mime)}</mime><resource-attributes><file-name>${xml(metadata.filename || hash)}</file-name></resource-attributes></resource>`;
          attachmentCount++;
          if (Buffer.byteLength(text) > MAX_NOTE) throw new Error('Note exceeds conversion size limit; original retained.');
        }
        text += '</note>\n';
        if (Buffer.byteLength(text) > MAX_NOTE) throw new Error('Note exceeds conversion size limit.');
        const key = `${notebook.id.toLowerCase()}-${note.deleted == null ? 'notes' : 'trash'}`;
        let group = groups.get(key);
        if (!group || group.size + Buffer.byteLength(text) > 256 * 1024 * 1024) {
          const part = group ? group.part + 1 : 1;
          const label = notebook.label.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 50).replace(/[ .]+$/, '') || 'Notebook';
          const filename = `${key}-${part}-${label}.enex`;
          fs.writeFileSync(path.join(enexDir, filename), '<?xml version="1.0" encoding="UTF-8"?><en-export export-date="' + date(Date.now()) + '" application="Evernote Archive offline cache conversion" version="0.3.0">\n', { flag: 'wx' });
          group = { part, size: 0, file: filename, notebook: notebook.label, notebookId: notebook.id, trash: note.deleted != null, notes: 0 };
          groups.set(key, group);
          report.files.push(group);
        }
        fs.appendFileSync(path.join(enexDir, group.file), text);
        group.size += Buffer.byteLength(text); group.notes++;
        report.noteIndex.push({ id: note.id, notebookId: notebook.id, file: group.file, position: group.notes, created: note.created, updated: note.updated, deleted: note.deleted, bodySha256: sha(fs.readFileSync(bodyPath)), attachmentHashes: [...byHash.keys()] });
        report.notesExported++; report.attachmentsExported += attachmentCount;
      } catch (error) { issue({ noteId: note.id, reason: error.message }); }
    }
    for (const file of report.files) {
      const filename = path.join(enexDir, file.file);
      fs.appendFileSync(filename, '</en-export>\n');
      let count = 0;
      for await (const note of readEnex(filename, {})) count++;
      if (count !== file.notes) throw new Error('Generated ENEX note count mismatch.');
    }
    report.status = report.issues.length || report.notesExported !== report.notesInDatabase ? 'incomplete' : 'copied-graph-notes-exported';
  } catch (error) { issue({ reason: error.message }); }
  finally { if (db) db.close(); }
  fs.writeFileSync(path.join(destination, 'export-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'READ ME.txt'), `Status: ${report.status}\r\nNotes exported: ${report.notesExported} / ${report.notesInDatabase} in the copied database.\r\nAccount completeness: NOT VERIFIED.\r\nKeep original-backup and export-report.json private. Import ENEX files into the archive or a separate destination app, never into the source Evernote account.\r\nIf anything is missing, do not open or sync Evernote to fill the gaps under the no-changes requirement. A second Windows backup may contain additional material. Do not overwrite or merge backups automatically.\r\n`, { flag: 'wx' });
  return report;
}

module.exports = { exportCache, decodeBody, FORMAT, sha };
