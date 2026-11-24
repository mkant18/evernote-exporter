'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const Y = require('yjs');
const { exportCache, FORMAT } = require('../src/acquire/cache');
const { exportArchive, verifyArchive } = require('../src');

const noteId = '12345678-1234-1234-1234-123456789abc';
const notebookId = '87654321-1234-1234-1234-123456789abc';
const payload = Buffer.from('attachment bytes\n');
const hash = createHash('md5').update(payload).digest('hex');
const graph = 'cache/conduit-storage/https%3A%2F%2Fwww.evernote.com/UDB-User123+RemoteGraph.sql';
const body = `cache/conduit-fs/https%3A%2F%2Fwww.evernote.com/profile/rte/Note/internal_rteDoc/123/abc/${noteId}.dat`;
const resource = `cache/resource-cache/User123/${noteId}/${hash}`;
const sha = b => createHash('sha256').update(b).digest('hex');

function inventory(root, prefix = 'cache') {
  const result = [];
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const relative = `${prefix}/${name}`;
    const full = path.join(root, relative), stat = fs.lstatSync(full);
    if (stat.isDirectory()) result.push(...inventory(root, relative));
    else result.push({ path: relative, size: stat.size, sha256: sha(fs.readFileSync(full)) });
  }
  return result;
}

function receipt(root) {
  fs.writeFileSync(path.join(root, 'snapshot.json'), JSON.stringify({ format: FORMAT, files: inventory(root) }));
}

function fixture(t, { wal = false, marks = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evernote-cache-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'backup');
  const put = (name, value) => { const full = path.join(input, name); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, value); };
  put(graph, '');
  const db = new DatabaseSync(path.join(input, graph));
  db.exec(`CREATE TABLE Nodes_Note(id TEXT, label TEXT, parent_Notebook_id TEXT, created INTEGER, updated INTEGER, deleted INTEGER, lastViewed INTEGER);
    CREATE TABLE Nodes_Notebook(id TEXT, label TEXT, stack_Stack_id TEXT, lastViewed INTEGER);
    CREATE TABLE Nodes_Tag(id TEXT, label TEXT);
    CREATE TABLE NoteTag(Note_id TEXT, Tag_id TEXT);
    CREATE TABLE Attachment(parent_Note_id TEXT, dataHash TEXT, filename TEXT, mime TEXT, dataSize INTEGER, isActive INTEGER);
    INSERT INTO Nodes_Notebook VALUES('${notebookId}', 'Family / café', 'stack-1', 400);
    INSERT INTO Nodes_Tag VALUES('tag-1', '旅行');
    INSERT INTO NoteTag VALUES('${noteId}', 'tag-1');`);
  if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  db.prepare('INSERT INTO Nodes_Note VALUES(?,?,?,?,?,?,?)').run(noteId, 'Code & café 🧭', notebookId, 1704164645000, 1704164646000, null, 300);
  db.prepare('INSERT INTO Attachment VALUES(?,?,?,?,?,?)').run(noteId, hash, '../../CON.txt', 'text/plain', payload.length, 1);
  const doc = new Y.Doc();
  const en = new Y.XmlElement('en-note'), div = new Y.XmlElement('div'), text = new Y.XmlText();
  text.insert(0, 'if (a < b && c > d) 日本語 🧭', marks ? { bold: true } : undefined);
  div.insert(0, [text]);
  const media = new Y.XmlElement('en-media'); media.setAttribute('hash', hash); media.setAttribute('type', 'text/plain');
  const crypt = new Y.XmlElement('en-crypt'), cryptText = new Y.XmlText(); cryptText.insert(0, 'ciphertext=='); crypt.insert(0, [cryptText]);
  en.insert(0, [div, media, crypt]); doc.get('content', Y.XmlFragment).insert(0, [en]);
  put(body, Y.encodeStateAsUpdate(doc)); doc.destroy(); put(resource, payload);
  put('cache/conduit-storage/local-mutations-retained.bin', 'pending-private-data');
  if (wal) {
    const frozen = path.join(root, 'frozen'); fs.cpSync(input, frozen, { recursive: true });
    db.close(); fs.rmSync(input, { recursive: true }); fs.renameSync(frozen, input);
  } else db.close();
  receipt(input);
  return { root, input, output: path.join(root, 'export'), put };
}

test('public backup CLI retains source bytes/view fields, recovers WAL, exports attachments and feeds existing archive', async t => {
  const f = fixture(t, { wal: true });
  const before = inventory(f.input);
  assert.ok(before.some(e => e.path.endsWith('-wal')));
  const run = spawnSync(process.execPath, [path.resolve(__dirname, '../src/cli.js'), 'export-cache', '--input', f.input, '--output', f.output], { encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 2, run.stderr);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.notesExported, 1); assert.equal(summary.accountCoverage, 'unverified');
  assert.deepEqual(inventory(f.input), before);
  assert.deepEqual(inventory(path.join(f.output, 'original-backup')), before);
  const report = JSON.parse(fs.readFileSync(path.join(f.output, 'export-report.json')));
  assert.equal(report.status, 'copied-graph-notes-exported'); assert.equal(report.attachmentsExported, 1);
  const enex = path.join(f.output, 'enex', report.files[0].file);
  const archive = path.join(f.root, 'readable');
  await exportArchive({ input: enex, output: archive, notebook: report.files[0].notebook });
  const valid = await verifyArchive(archive); assert.equal(valid.valid, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'manifest.json')));
  const note = JSON.parse(fs.readFileSync(path.join(archive, manifest.notes[0].path)));
  assert.match(note.content.plainText, /if \(a < b && c > d\) 日本語 🧭/);
  assert.deepEqual(note.tags, ['旅行']);
  assert.equal(note.title, 'Code & café 🧭');
  assert.equal(note.created, '2024-01-02T03:04:05.000Z');
  assert.deepEqual(fs.readFileSync(path.join(archive, note.attachments[0].path)), payload);
  assert.match(fs.readFileSync(enex, 'utf8'), /ciphertext==/);
  const preserved = new DatabaseSync(path.join(f.output, 'working-database/graph.sql'), { readOnly: true });
  assert.equal(preserved.prepare('SELECT lastViewed FROM Nodes_Note').get().lastViewed, 300);
  assert.equal(preserved.prepare('SELECT lastViewed FROM Nodes_Notebook').get().lastViewed, 400);
  preserved.close();
});

test('missing and corrupt attachments, missing body and unsupported marks are incomplete, never empty-note success', async t => {
  for (const kind of ['missing-resource', 'bad-resource', 'missing-body', 'marks']) {
    const f = fixture(t, { marks: kind === 'marks' });
    if (kind === 'missing-resource') fs.unlinkSync(path.join(f.input, resource));
    if (kind === 'bad-resource') f.put(resource, Buffer.alloc(payload.length));
    if (kind === 'missing-body') fs.unlinkSync(path.join(f.input, body));
    receipt(f.input);
    const result = await exportCache(f);
    assert.equal(result.status, 'incomplete', kind); assert.equal(result.notesExported, 0, kind);
    assert.ok(result.issues.length, kind);
  }
});

test('backup tampering, traversal and output overlap are refused', async t => {
  const f = fixture(t);
  await assert.rejects(exportCache({ input: f.input, output: path.join(f.input, 'export') }), /separate/);
  await assert.rejects(exportCache({ input: f.input, output: f.input }), /separate/);
  f.put(resource, 'tampered');
  await assert.rejects(exportCache(f), /checksum/);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.input, 'snapshot.json')));
  manifest.files[0].path = 'cache/../outside';
  fs.writeFileSync(path.join(f.input, 'snapshot.json'), JSON.stringify(manifest));
  await assert.rejects(exportCache({ input: f.input, output: path.join(f.root, 'another') }), /manifest path/);
});

test('ambiguous accounts and body profiles are refused', async t => {
  for (const kind of ['graph', 'body']) {
    const f = fixture(t);
    if (kind === 'graph') f.put(graph.replace('User123', 'User456'), fs.readFileSync(path.join(f.input, graph)));
    else f.put(body.replace('/profile/', '/another-profile/'), fs.readFileSync(path.join(f.input, body)));
    receipt(f.input);
    const result = await exportCache(f);
    assert.equal(result.status, 'incomplete'); assert.equal(result.notesExported, 0);
    assert.match(result.issues[0].reason, /exactly one|Multiple body/);
  }
});

test('existing destination and directory junction inputs do not overwrite or traverse owner data', async t => {
  const f = fixture(t);
  fs.mkdirSync(f.output); fs.writeFileSync(path.join(f.output, 'keep'), 'owner');
  await assert.rejects(exportCache(f), /already exists/);
  assert.equal(fs.readFileSync(path.join(f.output, 'keep'), 'utf8'), 'owner');
  const link = path.join(f.root, 'linked-backup');
  fs.symlinkSync(f.input, link, 'junction');
  await assert.rejects(exportCache({ input: link, output: path.join(f.root, 'new') }), /Linked/);
});

test('unsupported newer schema is retained and reported rather than guessed', async t => {
  const f = fixture(t);
  const db = new DatabaseSync(path.join(f.input, graph)); db.exec('ALTER TABLE Nodes_Note RENAME TO NewNoteFormat;'); db.close(); receipt(f.input);
  const result = await exportCache(f);
  assert.equal(result.status, 'incomplete'); assert.match(result.issues[0].reason, /Unsupported cache schema/);
  assert.deepEqual(inventory(path.join(f.output, 'original-backup')), inventory(f.input));
});

test('schema column changes and duplicate note identities are rejected', async t => {
  for (const sql of ['ALTER TABLE Attachment RENAME COLUMN dataHash TO changed_hash', 'INSERT INTO Nodes_Note SELECT * FROM Nodes_Note', "INSERT INTO Nodes_Tag VALUES('tag-1', 'replacement')", 'UPDATE Nodes_Tag SET label=NULL']) {
    const f = fixture(t);
    const db = new DatabaseSync(path.join(f.input, graph)); db.exec(sql); db.close(); receipt(f.input);
    const result = await exportCache(f);
    assert.equal(result.status, 'incomplete'); assert.equal(result.notesExported, 0);
    assert.match(result.issues[0].reason, /columns changed|duplicated/);
  }
});

test('Windows snapshot copying preserves all bytes and refuses junctions', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t), target = path.join(f.root, 'copied');
  const helper = path.resolve(__dirname, '../scripts/Copy-EvernoteSnapshot.ps1');
  const quote = s => "'" + s.replaceAll("'", "''") + "'";
  const command = output => `$ErrorActionPreference='Stop'; . ${quote(helper)}; $entries=[Collections.Generic.List[object]]::new(); Copy-VerifiedTree ${quote(path.join(f.input, 'cache'))} ${quote(output)} 'cache' $entries; $entries.ToArray() | ConvertTo-Json -Depth 5`;
  const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command(target)], { encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr);
  const entries = JSON.parse(run.stdout).sort((a,b) => a.path.localeCompare(b.path));
  const original = inventory(f.input).sort((a,b) => a.path.localeCompare(b.path));
  assert.deepEqual(entries, original);
  for (const entry of entries) assert.equal(sha(fs.readFileSync(path.join(target, entry.path.slice(6)))), entry.sha256);
  fs.symlinkSync(target, path.join(f.input, 'cache', 'linked'), 'junction');
  const refused = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command(path.join(f.root, 'refused'))], { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(refused.status, 0); assert.match(refused.stderr, /linked item/);
});

test('Windows export launcher reaches copied-backup conversion', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const launcher = path.resolve(__dirname, '../scripts/Export-EvernoteBackup.ps1');
  const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-InputBackup', f.input, '-OutputFolder', f.output], { encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 2, run.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(f.output, 'export-report.json')));
  assert.equal(report.notesExported, 1); assert.equal(report.status, 'copied-graph-notes-exported');
});
