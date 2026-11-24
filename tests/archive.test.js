'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { exportArchive, verifyArchive } = require('../src');

const cli = path.resolve(__dirname, '../src/cli.js');
const fixture = path.resolve(__dirname, 'fixtures/sample.enex');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const readJson = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
const sample = fs.readFileSync(fixture, 'utf8');

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evernote-exporter-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000 });
}

function changeManifest(directory, mutate) {
  const filename = path.join(directory, 'manifest.json');
  const manifest = readJson(filename);
  mutate(manifest);
  fs.writeFileSync(filename, JSON.stringify(manifest));
}

test('public CLI preserves source, content, organization, metadata and exact attachment bytes', async (t) => {
  const directory = workspace(t);
  const output = path.join(directory, 'archive with spaces');
  const result = run('export', '--input', fixture, '--output', output, '--notebook', 'Trips / 2024', '--stack', 'Family');
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.notes, 2);
  assert.equal(summary.attachments, 2);
  assert.equal(summary.uniqueAssets, 1);
  assert.equal(summary.completeness, 'unverified');
  assert.deepEqual(fs.readFileSync(path.join(output, 'sources/original.enex')), fs.readFileSync(fixture));
  const manifest = readJson(path.join(output, 'manifest.json'));
  const first = readJson(path.join(output, manifest.notes[0].path));
  const second = readJson(path.join(output, manifest.notes[1].path));
  assert.equal(first.title, 'Travel / plans: café 🧭');
  assert.equal(second.title, first.title);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.tags, ['Family', '旅行']);
  assert.deepEqual(first.notebook, { name: 'Trips / 2024', stack: 'Family', provenance: 'user-supplied' });
  assert.equal(first.created, '2024-01-02T03:04:05.000Z');
  assert.equal(second.created, '2024-02-29T00:00:00.000Z');
  assert.deepEqual(first.checkboxes, [{ index: 0, checked: true }, { index: 1, checked: false }]);
  assert.match(first.content.plainText, /\[x\] Book train\n\[ \] Pack\u00a0bags/);
  assert.equal(first.content.document.children[4].attachmentId, first.attachments[0].id);
  assert.equal(first.attachments[0].filename, '../../CON.txt');
  assert.deepEqual(fs.readFileSync(path.join(output, first.attachments[0].path)), Buffer.from('hello\n'));
  assert.equal(first.attachments[0].sha256, sha256('hello\n'));
  assert.equal(first.attachments[0].path, second.attachments[0].path);
  assert.ok(first.sourceMetadata.some((node) => node.name === 'task'));
  assert.ok(first.sourceMetadata.some((node) => node.name === 'note-attributes'));
  assert.ok(first.attachments[0].metadata.some((node) => node.name === 'recognition'));
  assert.ok(first.links.includes('https://example.com/?a=1&b=2'));
  for (const code of ['unresolved-note-link', 'encrypted-content', 'unmapped-metadata', 'unmapped-resource-metadata']) {
    assert.ok(first.warnings.some((warning) => warning.code === code), code);
  }
  // Verification is portable and requires only the output directory.
  const relocated = path.join(directory, 'relocated');
  fs.renameSync(output, relocated);
  const verified = run('verify', '--archive', relocated);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).files, 4);
  assert.equal(fs.existsSync(path.join(directory, 'CON.txt')), false);
});

test('identical exports reproduce every payload hash and keep organization unknown by default', async (t) => {
  const directory = workspace(t);
  const outputs = [path.join(directory, 'a'), path.join(directory, 'b')];
  for (const output of outputs) await exportArchive({ input: fixture, output });
  const a = readJson(path.join(outputs[0], 'manifest.json'));
  const b = readJson(path.join(outputs[1], 'manifest.json'));
  assert.deepEqual(a, b);
  assert.equal(a.organization, null);
  assert.ok(a.warnings.some((w) => w.code === 'notebook-unavailable'));
});

test('existing empty and populated destinations and input files are never overwritten', async (t) => {
  const directory = workspace(t);
  for (const populated of [false, true]) {
    const output = path.join(directory, String(populated));
    fs.mkdirSync(output);
    if (populated) fs.writeFileSync(path.join(output, 'keep.txt'), 'owner data');
    const result = run('export', '--input', fixture, '--output', output);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists/);
    assert.deepEqual(fs.readdirSync(output), populated ? ['keep.txt'] : []);
  }
  const original = fs.readFileSync(fixture);
  assert.equal(run('export', '--input', fixture, '--output', fixture).status, 1);
  assert.deepEqual(fs.readFileSync(fixture), original);
});

const invalidInputs = {
  'malformed closing XML': sample.replace('</en-export>', '</wrong>'),
  'wrong root': '<not-an-export/>',
  'unknown root field': '<en-export><notebook/></en-export>',
  'invalid base64': sample.replace('aGVsbG8K', '%%%'),
  'noncanonical base64': sample.replace('aGVsbG8K', 'Zh=='),
  'wrong attachment checksum': sample.replace('encoding="base64"', 'encoding="base64" body-hash="00000000000000000000000000000000"'),
  'external entity': '<!DOCTYPE en-export [<!ENTITY read SYSTEM "file:///private">]><en-export>&read;</en-export>',
  'invalid inner ENML': sample.replace('</en-note>', '</wrong>'),
  'duplicate title': sample.replace('<title>', '<title>extra</title><title>'),
  'unsupported encoding': sample.replace('encoding="UTF-8"', 'encoding="UTF-16"'),
  'too deeply nested': `<en-export><note><title>x</title><content><![CDATA[<en-note>${'<div>'.repeat(130)}x${'</div>'.repeat(130)}</en-note>]]></content></note></en-export>`,
};

for (const [name, source] of Object.entries(invalidInputs)) {
  test(`rejects ${name} without publishing or modifying source`, async (t) => {
    const directory = workspace(t);
    const input = path.join(directory, 'bad.enex');
    const output = path.join(directory, 'archive');
    fs.writeFileSync(input, source);
    const result = run('export', '--input', input, '--output', output);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Error:/);
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.readFileSync(input, 'utf8'), source);
    assert.deepEqual(fs.readdirSync(directory), ['bad.enex']);
  });
}

test('invalid UTF-8 fails instead of silently substituting replacement characters', async (t) => {
  const directory = workspace(t);
  const input = path.join(directory, 'bad.enex');
  fs.writeFileSync(input, Buffer.concat([Buffer.from('<en-export>'), Buffer.from([0xff]), Buffer.from('</en-export>')]));
  await assert.rejects(exportArchive({ input, output: path.join(directory, 'archive') }), /encoded data/);
});

test('missing attachments and invalid dates are explicit warnings, with raw content retained', async (t) => {
  const directory = workspace(t);
  const input = path.join(directory, 'warning.enex');
  const output = path.join(directory, 'archive');
  fs.writeFileSync(input, sample.replace('20240102T030405Z', '20240230T030405Z').replaceAll('b1946ac92492d2347c6235b4d2611184', '00000000000000000000000000000000'));
  await exportArchive({ input, output });
  const manifest = readJson(path.join(output, 'manifest.json'));
  const note = readJson(path.join(output, manifest.notes[0].path));
  assert.equal(note.created, null);
  assert.ok(note.warnings.some((w) => w.code === 'invalid-timestamp'));
  assert.ok(note.warnings.some((w) => w.code === 'missing-resource'));
  assert.equal(note.content.document.children[4].attachmentId, null);
});

test('verification catches changed and missing payload bytes', async (t) => {
  const directory = workspace(t);
  const output = path.join(directory, 'archive');
  await exportArchive({ input: fixture, output });
  const manifest = readJson(path.join(output, 'manifest.json'));
  const asset = manifest.files.find((file) => file.path.startsWith('assets/'));
  fs.writeFileSync(path.join(output, asset.path), 'HELLO\n');
  const result = run('verify', '--archive', output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Integrity check failed/);
  fs.unlinkSync(path.join(output, asset.path));
  await assert.rejects(verifyArchive(output), /ENOENT/);
});

test('verification rejects traversal and duplicate records before reading foreign files', async (t) => {
  const directory = workspace(t);
  for (const mutation of ['traversal', 'duplicate', 'missing note', 'wrong counts', 'incomplete']) {
    const output = path.join(directory, mutation);
    await exportArchive({ input: fixture, output });
    changeManifest(output, (manifest) => {
      if (mutation === 'traversal') manifest.files[0].path = '../foreign.txt';
      if (mutation === 'duplicate') manifest.files.push(manifest.files[0]);
      if (mutation === 'missing note') manifest.notes.pop();
      if (mutation === 'wrong counts') manifest.counts.attachments++;
    });
    if (mutation === 'incomplete') fs.writeFileSync(path.join(output, '.incomplete'), 'interrupted');
    await assert.rejects(verifyArchive(output));
  }
});

test('empty exports remain valid but explicitly unverified', async (t) => {
  const directory = workspace(t);
  const input = path.join(directory, 'empty.enex');
  const output = path.join(directory, 'archive');
  fs.writeFileSync(input, '<en-export/>');
  const result = await exportArchive({ input, output });
  assert.equal(result.notes, 0);
  assert.equal((await verifyArchive(output)).completeness, 'unverified');
});

test('CLI validates commands and options', () => {
  assert.equal(run('--help').status, 0);
  for (const args of [
    ['unknown'], ['verify'], ['export'], ['export', '--unexpected'],
    ['export', '--stack', 'x', '--input', fixture, '--output', 'unused'],
    ['verify', '--archive', 'x', '--input', fixture], ['export', '--notebook', ' '],
  ]) assert.equal(run(...args).status, 1, args.join(' '));
});

test('streaming preserves Unicode and large attachments across input chunk boundaries', async (t) => {
  const directory = workspace(t);
  const input = path.join(directory, 'large.enex');
  const output = path.join(directory, 'archive');
  const text = 'café 🧭 旅行\n'.repeat(10000);
  const bytes = Buffer.from(text);
  const md5 = createHash('md5').update(bytes).digest('hex');
  fs.writeFileSync(input, `<en-export><note><title>Large</title><content><![CDATA[<en-note><pre>${text}</pre><en-media hash="${md5}" type="text/plain"/></en-note>]]></content><resource><data encoding="base64">${bytes.toString('base64')}</data><mime>text/plain</mime></resource></note></en-export>`);
  await exportArchive({ input, output });
  const manifest = readJson(path.join(output, 'manifest.json'));
  const note = readJson(path.join(output, manifest.notes[0].path));
  assert.equal(note.content.document.children[0].children[0].text, text);
  assert.deepEqual(fs.readFileSync(path.join(output, note.attachments[0].path)), bytes);
  const broken = path.join(directory, 'broken.enex');
  fs.writeFileSync(broken, fs.readFileSync(input, 'utf8').replace('</en-export>', '<bad></en-export>'));
  await assert.rejects(exportArchive({ input: broken, output: path.join(directory, 'broken-archive') }));
  assert.equal(fs.existsSync(path.join(directory, 'broken-archive')), false);
  assert.equal(fs.readdirSync(directory).some((file) => file.startsWith('.evernote-export-')), false);
});

test('named ENML entities resolve only outside CDATA and invalid checkbox states stay unknown', async (t) => {
  const directory = workspace(t);
  const input = path.join(directory, 'entities.enex');
  const output = path.join(directory, 'archive');
  const inner = '<en-note><div>&nbsp;&mdash;&copy;</div><pre><![CDATA[&nbsp;]]></pre><en-todo checked="maybe"/></en-note>';
  const escaped = inner.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  fs.writeFileSync(input, `<en-export><note><title>Entities</title><content>${escaped}</content></note></en-export>`);
  await exportArchive({ input, output });
  const manifest = readJson(path.join(output, 'manifest.json'));
  const note = readJson(path.join(output, manifest.notes[0].path));
  assert.equal(note.content.document.children[0].children[0].text, '\u00a0—©');
  assert.equal(note.content.document.children[1].children[0].text, '&nbsp;');
  assert.equal(note.checkboxes[0].checked, null);
  assert.ok(note.warnings.some((w) => w.code === 'unknown-checkbox-state'));
});

test('verification rejects directory junctions or symlinks escaping the archive', async (t) => {
  const directory = workspace(t);
  const output = path.join(directory, 'archive');
  await exportArchive({ input: fixture, output });
  const external = path.join(directory, 'external-assets');
  fs.renameSync(path.join(output, 'assets'), external);
  fs.symlinkSync(external, path.join(output, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyArchive(output), /symlink rejected/);
});
