'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const cli = path.resolve(__dirname, '../src/cli.js');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evernote-conversion-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 60000 });
  assert.ifError(result.error);
  return result;
}

function source(body, resource = '') {
  return `<en-export><note><title>Regression</title><content><![CDATA[<en-note>${body}</en-note>]]></content>${resource}</note></en-export>`;
}

function exportNote(t, xml) {
  const directory = workspace(t);
  const input = path.join(directory, 'input.enex');
  const output = path.join(directory, 'archive');
  fs.writeFileSync(input, xml);
  const result = run('export', '--input', input, '--output', output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(input, 'utf8'), xml);
  const manifest = readJson(path.join(output, 'manifest.json'));
  const note = readJson(path.join(output, manifest.notes[0].path));
  return { output, manifest, note };
}

function checkboxStates(node) {
  if (node.type === 'checkbox') return [node.checked];
  return (node.children ?? []).flatMap(checkboxStates);
}

for (const size of [4 * 1024 * 1024, 8 * 1024 * 1024]) {
  test(`CLI preserves a ${size / 1024 / 1024} MiB attachment byte for byte`, (t) => {
    const bytes = Buffer.alloc(size, 0xab);
    bytes.write('attachment end', size - 14);
    const encoded = bytes.toString('base64');
    const resource = `<resource><data encoding="base64">${encoded}</data><mime>application/octet-stream</mime></resource>`;
    const { output, manifest, note } = exportNote(t, source('<div>Large attachment</div>', resource));
    assert.equal(manifest.counts.attachments, 1);
    assert.equal(note.attachments[0].bytes, size);
    assert.equal(note.attachments[0].sha256, sha256(bytes));
    assert.deepEqual(fs.readFileSync(path.join(output, note.attachments[0].path)), bytes);
    const verified = run('verify', '--archive', output);
    assert.equal(verified.status, 0, verified.stderr);
  });
}

test('CLI rejects late invalid base64 and malformed padding without publishing', (t) => {
  const directory = workspace(t);
  const large = Buffer.alloc(4 * 1024 * 1024, 97).toString('base64');
  for (const [index, encoded] of [large.slice(0, -10) + '%' + large.slice(-9), 'AAA===', 'A=AA', 'AAA', 'Zh=='].entries()) {
    const input = path.join(directory, `${index}.enex`);
    const output = path.join(directory, `archive-${index}`);
    const xml = source('<div>Invalid resource</div>', `<resource><data encoding="base64">${encoded}</data><mime>application/octet-stream</mime></resource>`);
    fs.writeFileSync(input, xml);
    const result = run('export', '--input', input, '--output', output);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /(?:Invalid|Noncanonical) resource base64/);
    assert.doesNotMatch(result.stderr, /call stack/);
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.readFileSync(input, 'utf8'), xml);
  }
  assert.equal(fs.readdirSync(directory).some((name) => name.startsWith('.evernote-export-')), false);
});

test('modern and legacy checklists preserve order, nesting and ordinary lists', (t) => {
  const body = '<ul style="color:blue; --en-todo: true;"><li style="--en-checked:true;"><div>Done parent</div><ul style="--en-todo:true"><li style="--en-checked:false"><div>Nested task</div></li></ul></li><li style="--en-checked:false"><div>Next task</div><ul><li style="--en-checked:true">Ordinary nested item</li></ul></li></ul><div><en-todo checked="true"/>Legacy done</div><div><en-todo/>Legacy open</div><ul style="--en-todo:false"><li style="--en-checked:true">Ordinary item</li></ul>';
  const { note } = exportNote(t, source(body));
  const states = [true, false, false, true, false];
  assert.deepEqual(note.checkboxes, states.map((checked, index) => ({ index, checked })));
  assert.deepEqual(checkboxStates(note.content.document), states);
  assert.equal(note.content.document.children[0].children[0].name, 'li');
  assert.equal(note.content.document.children[0].children[0].attributes.style, '--en-checked:true;');
  assert.deepEqual(note.content.document.children[0].children[0].children[0], { type: 'checkbox', checked: true, attributes: {} });
  assert.match(note.content.plainText, /\[x\] Done parent\n\[ \] Nested task\n\[ \] Next task/);
  assert.match(note.content.plainText, /Ordinary nested item\n\[x\] Legacy done\n\[ \] Legacy open\nOrdinary item/);
  assert.deepEqual(note.warnings, []);
  assert.match(note.content.enml, /--en-checked:true/);
});

test('missing and malformed modern checked states remain unknown with warnings', (t) => {
  const { note } = exportNote(t, source('<ul style="--en-todo:true"><li><div>Missing</div></li><li style="--en-checked:maybe"><div>Invalid</div></li><li style="--en-checked: false !important;"><div>Known</div></li></ul>'));
  assert.deepEqual(note.checkboxes.map((item) => item.checked), [null, null, false]);
  assert.deepEqual(checkboxStates(note.content.document), [null, null, false]);
  assert.equal(note.warnings.filter((warning) => warning.code === 'unknown-checkbox-state').length, 2);
  assert.equal(note.content.plainText, '[?] Missing\n[?] Invalid\n[ ] Known');
});

test('plain text preserves explicit breaks, empty blocks and table cell boundaries', (t) => {
  const body = '<div>First<br/><br/>Third</div><p>Before empty</p><p></p><p>After empty</p><table><tbody><tr><th>Left</th><th>Right</th></tr><tr><td>One</td><td>Two<br/>Three</td></tr></tbody></table><h5>Heading five</h5><h6>Heading six</h6>';
  const { note } = exportNote(t, source(body));
  assert.equal(note.content.plainText, 'First\n\nThird\nBefore empty\n\nAfter empty\nLeft\tRight\nOne\tTwo\nThree\nHeading five\nHeading six');
  assert.match(note.content.enml, /First<br\/><br\/>Third/);
});
