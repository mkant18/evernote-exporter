'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { exportArchive, verifyArchive } = require('../src');

const fixture = path.join(__dirname, 'fixtures/sample.enex');
const readJson = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));

async function archive(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evernote-verification-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'archive');
  await exportArchive({ input: fixture, output });
  return output;
}

function changeNote(output, mutate, ordinal = 0) {
  const manifestPath = path.join(output, 'manifest.json');
  const manifest = readJson(manifestPath);
  const record = manifest.notes[ordinal];
  const filename = path.join(output, record.path);
  const note = readJson(filename);
  mutate(note);
  const bytes = Buffer.from(JSON.stringify(note));
  fs.writeFileSync(filename, bytes);
  Object.assign(manifest.files.find((file) => file.path === record.path), {
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}

const structuralMutations = {
  'missing encrypted ciphertext': (note) => { delete note.content.document.children.find((node) => node.type === 'encrypted').ciphertext; },
  'invalid checkbox summary': (note) => { note.checkboxes[0].checked = 'yes'; },
  'checkbox summary contradicts tree': (note) => { note.checkboxes[0].checked = false; },
  'attachment MD5 contradicts stored bytes': (note) => { note.attachments[0].md5 = '0'.repeat(32); },
  'media hash contradicts referenced asset': (note) => { note.content.document.children.find((node) => node.type === 'attachment').attributes.hash = '0'.repeat(32); },
  'missing element attributes': (note) => { delete note.content.document.children[0].attributes; },
  'missing element name': (note) => { delete note.content.document.children[0].name; },
  'link summary contradicts tree': (note) => { note.links = []; },
  'invalid note metadata': (note) => { note.sourceMetadata = ['allowed text', { name: 'bad', attributes: {}, children: 42 }]; },
  'invalid source attributes': (note) => { note.sourceAttributes = { invalid: 42 }; },
  'invalid normalized date': (note) => { note.created = '2024-02-30T03:04:05.000Z'; },
  'missing attachment filename': (note) => { delete note.attachments[0].filename; },
};

for (const [name, mutation] of Object.entries(structuralMutations)) {
  test(`verify rejects ${name} even after checksums are recomputed`, async (t) => {
    const output = await archive(t);
    changeNote(output, mutation);
    await assert.rejects(verifyArchive(output));
  });
}

test('verify reconciles retained source and reports a scoped result', async (t) => {
  const output = await archive(t);
  const result = await verifyArchive(output);
  assert.equal(result.sourceNotesReconciled, true);
  assert.equal(result.completeness, 'unverified');
  assert.equal(result.notes, 2);
});

test('CLI rejects an internally consistent empty inventory when the original contains notes', async (t) => {
  const output = await archive(t);
  const manifestPath = path.join(output, 'manifest.json');
  const manifest = readJson(manifestPath);
  manifest.notes = [];
  manifest.files = manifest.files.filter((file) => file.path.startsWith('sources/'));
  manifest.tags = [];
  manifest.counts = { notes: 0, attachments: 0, uniqueAssets: 0 };
  manifest.warnings = manifest.warnings.filter((warning) => warning.noteId === undefined);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = spawnSync(process.execPath, [path.join(__dirname, '../src/cli.js'), 'verify', '--archive', output], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source note inventory mismatch/);
});

test('verify rejects a changed note source order even when IDs and summary counts remain valid', async (t) => {
  const output = await archive(t);
  const manifest = readJson(path.join(output, 'manifest.json'));
  const other = readJson(path.join(output, manifest.notes[1].path));
  changeNote(output, (note) => { note.content.enml = other.content.enml; });
  await assert.rejects(verifyArchive(output), /Source note reconciliation failed/);
});

test('verify reconciles retained source metadata instead of accepting rehashed edits', async (t) => {
  const output = await archive(t);
  changeNote(output, (note) => { note.sourceMetadata.find((node) => node.name === 'title').children = ['changed metadata title']; });
  await assert.rejects(verifyArchive(output), /Source note reconciliation failed/);
});

test('verify rejects renamed resources when metadata no longer matches the original export', async (t) => {
  const output = await archive(t);
  changeNote(output, (note) => { note.attachments[0].filename = 'different.pdf'; });
  await assert.rejects(verifyArchive(output), /Source resource reconciliation failed/);
});

test('verify requires note warnings to agree with the manifest', async (t) => {
  const output = await archive(t);
  const manifestPath = path.join(output, 'manifest.json');
  const manifest = readJson(manifestPath);
  manifest.warnings = manifest.warnings.filter((warning) => warning.noteId === undefined);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  await assert.rejects(verifyArchive(output), /Note warning inventory mismatch/);
});
