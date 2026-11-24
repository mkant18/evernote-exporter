'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { exportArchive } = require('../src');
const { loadArchive, archiveZip, portableHtml, markdownNote, assetNames, renderHtml } = require('../src/exporters/downloads');

const checksum = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const xmlText = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const payload = Buffer.from('Preserved attachment bytes\n<script>not executed</script>\u0000');
const hostileFilename = '../../escape" onclick="evil.html';
const title = '<img src=x onerror="titleAttack()"> [title]';

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evernote-download-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function sample(t, { bytes = payload, repeatedMedia = 1 } = {}) {
  const directory = workspace(t);
  const input = path.join(directory, 'input.enex');
  const output = path.join(directory, 'archive');
  const media = `<en-media hash="${checksum(bytes, 'md5')}" type="text/html"/>`;
  const body = '<en-note><div>&lt;img src=x onerror="textAttack()"&gt;</div><div onclick="elementAttack()" style="background:url(https://remote.invalid/tracker)">Safe text</div><script>scriptText()</script><iframe src="https://remote.invalid/frame"/><img src="https://remote.invalid/image"/><a href="javascript:linkAttack()">Unsafe link</a><a href="https://example.com/?a=1&amp;b=2">Safe link</a><ul style="--en-todo:true"><li style="--en-checked:true"><div>Parent task</div><ul style="--en-todo:true"><li style="--en-checked:false"><div>Nested task</div></li></ul></li></ul><div><en-todo checked="true"/>Legacy done</div><div><en-todo/>Legacy open</div><ol>\n<li>First numbered</li>\n<li>Second numbered</li>\n</ol>' + media.repeat(repeatedMedia) + '</en-note>';
  const source = `<en-export><note><title>${xmlText(title)}</title><content><![CDATA[${body}]]></content><tag>Test &amp; tag</tag><resource><data encoding="base64">${bytes.toString('base64')}</data><mime>text/html</mime><resource-attributes><file-name>${xmlText(hostileFilename)}</file-name></resource-attributes></resource></note></en-export>`;
  fs.writeFileSync(input, source);
  await exportArchive({ input, output, notebook: '<script>notebookAttack()</script>' });
  return { directory, input, output, source: Buffer.from(source), loaded: await loadArchive(output) };
}

function readZipIndependently(filename) {
  const script = 'import sys, zipfile, json, base64\nwith zipfile.ZipFile(sys.argv[1]) as z:\n print(json.dumps({"bad_crc": z.testzip(), "names": z.namelist(), "files": {n:base64.b64encode(z.read(n)).decode("ascii") for n in z.namelist()}}))';
  const result = spawnSync('python', ['-c', script, filename], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const zip = JSON.parse(result.stdout);
  assert.equal(zip.bad_crc, null);
  assert.equal(new Set(zip.names).size, zip.names.length);
  for (const name of zip.names) {
    assert.ok(!name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'), name);
    zip.files[name] = Buffer.from(zip.files[name], 'base64');
  }
  return zip;
}

function htmlTags(html) {
  const script = 'import sys, json\nfrom html.parser import HTMLParser\nclass Tags(HTMLParser):\n def __init__(self):\n  super().__init__(); self.tags=[]\n def handle_starttag(self, tag, attrs):\n  self.tags.append({"name":tag,"attributes":dict(attrs)})\np=Tags(); p.feed(sys.stdin.read()); print(json.dumps(p.tags))';
  const result = spawnSync('python', ['-c', script], { input: html, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('reading HTML escapes hostile text and strips active tags, attributes and URLs', async (t) => {
  const { output, loaded } = await sample(t);
  const note = loaded.notes[0];
  const body = renderHtml(note.content.document, note, () => 'safe-attachment');
  assert.doesNotMatch(body, /<(?:script|iframe|img)\b/i);
  for (const tag of htmlTags(body)) {
    for (const [name, value] of Object.entries(tag.attributes)) {
      assert.ok(!name.startsWith('on') && name !== 'style', `${tag.name} has active ${name}`);
      if (['href', 'src'].includes(name)) assert.doesNotMatch(value, /^(?:javascript:)|remote\.invalid/i);
    }
  }
  assert.match(body, /&lt;img src=x onerror=&quot;textAttack\(\)&quot;&gt;/);
  assert.match(body, /Unsafe link/);
  assert.match(body, /Link kept inactive: https:\/\/example\.com\/\?a=1&amp;b=2/);
  assert.doesNotMatch(body, /href="(?:https?:|evernote:|mailto:)/i);
  assert.match(body, /aria-label="Checked"/);
  assert.match(body, /aria-label="Unchecked"/);
  const html = portableHtml(output, loaded);
  assert.match(html, /name="viewport"/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /<script\b|<iframe\b|href="javascript:|src="https?:/i);
  assert.match(html, /&lt;script&gt;notebookAttack\(\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;titleAttack\(\)&quot;&gt;/);
  assert.match(html, /download="\.\.\/\.\.\/escape&quot; onclick=&quot;evil\.html"/);
});

test('Markdown retains legacy and nested checklist semantics and ordered list numbering', async (t) => {
  const { loaded } = await sample(t);
  const markdown = markdownNote(loaded.notes[0], assetNames(loaded.notes));
  assert.match(markdown, /^- \[x\] Parent task$/m);
  assert.match(markdown, /^  - \[ \] Nested task$/m);
  assert.match(markdown, /^- \[x\] Legacy done$/m);
  assert.match(markdown, /^- \[ \] Legacy open$/m);
  assert.match(markdown, /^1\. First numbered$/m);
  assert.match(markdown, /^2\. Second numbered$/m);
  assert.doesNotMatch(markdown, /\]\(<?javascript:/i);
  assert.match(markdown, /\\<img src=x/);
});

test('reading HTML leaves every source link inactive, including Evernote and redirects', () => {
  const urls = ['https://www.evernote.com/shard/s1/note/id', 'evernote:///view/1/note/id', 'https://example.com/redirect', 'mailto:person@example.com', 'javascript:alert(1)'];
  for (const href of urls) {
    const node = { type: 'element', name: 'a', attributes: { href }, children: [{ type: 'text', text: 'Original link' }] };
    const html = renderHtml(node, { attachments: [] }, () => { throw new Error('Unexpected attachment'); });
    const tags = htmlTags(html);
    assert.equal(tags.length, 1);
    assert.equal(tags[0].name, 'span');
    assert.equal(tags[0].attributes.title, `Link kept inactive: ${href}`);
    assert.equal(tags[0].attributes.href, undefined);
    assert.ok(html.endsWith('Original link</span>'));
  }
});

test('archive ZIP independently extracts every original payload and exact source bytes', async (t) => {
  const { directory, output, source, loaded } = await sample(t);
  const zipPath = path.join(directory, 'archive.zip');
  await pipeline(archiveZip(output, loaded, 'archive'), fs.createWriteStream(zipPath));
  const zip = readZipIndependently(zipPath);
  assert.deepEqual(zip.names.sort(), ['manifest.json', ...loaded.manifest.files.map((file) => file.path)].sort());
  assert.deepEqual(zip.files['sources/original.enex'], source);
  const extractedManifest = JSON.parse(zip.files['manifest.json'].toString('utf8'));
  assert.deepEqual(extractedManifest, loaded.manifest);
  for (const file of loaded.manifest.files) {
    assert.equal(zip.files[file.path].length, file.bytes);
    assert.equal(checksum(zip.files[file.path]), file.sha256);
    assert.deepEqual(zip.files[file.path], fs.readFileSync(path.join(output, file.path)));
  }
});

test('Markdown ZIP uses safe attachment paths, exact bytes and a retained original ENEX', async (t) => {
  const { directory, output, source, loaded } = await sample(t);
  const zipPath = path.join(directory, 'markdown.zip');
  await pipeline(archiveZip(output, loaded, 'markdown'), fs.createWriteStream(zipPath));
  const zip = readZipIndependently(zipPath);
  const asset = `assets/${checksum(payload)}.html`;
  assert.ok(zip.names.includes(asset));
  assert.deepEqual(zip.files[asset], payload);
  assert.deepEqual(zip.files['original.enex'], source);
  assert.deepEqual(JSON.parse(zip.files['archive-manifest.json'].toString('utf8')), loaded.manifest);
  const markdownPath = `notes/${loaded.notes[0].id}.md`;
  assert.ok(zip.names.includes(markdownPath));
  assert.ok(zip.files[markdownPath].toString('utf8').includes(`(../${asset})`));
  assert.match(zip.files['README.txt'].toString('utf8'), /reading projection/i);
});

test('portable HTML embeds exact attachment bytes using a non-executable download MIME', async (t) => {
  const { output, loaded } = await sample(t);
  const html = portableHtml(output, loaded);
  const dataUrls = [...html.matchAll(/href="data:([^;]+);base64,([A-Za-z0-9+/=]+)"/g)];
  assert.ok(dataUrls.length >= 1);
  for (const [, mime, encoded] of dataUrls) {
    assert.equal(mime, 'application/octet-stream');
    assert.deepEqual(Buffer.from(encoded, 'base64'), payload);
  }
  assert.doesNotMatch(html, /data:text\/html|data:application\/javascript/);
  assert.match(html, /This copy can be read without the app/);
});

test('portable reading limit rejects oversized attachments before trying to read them', async (t) => {
  const { output, loaded } = await sample(t);
  const oversized = structuredClone(loaded);
  oversized.notes[0].attachments[0].bytes = 33 * 1024 * 1024;
  oversized.notes[0].attachments[0].path = 'assets/not-present';
  assert.throws(() => portableHtml(output, oversized), /too large/i);
});

test('portable reading limit also bounds repeated references to the same embedded asset', async (t) => {
  const { output, loaded } = await sample(t, { bytes: Buffer.alloc(1024 * 1024, 65), repeatedMedia: 25 });
  let html;
  try {
    html = portableHtml(output, loaded);
  } catch (error) {
    assert.match(error.message, /too large/i);
    return;
  }
  assert.ok(Buffer.byteLength(html) <= 32 * 1024 * 1024, 'Single reading file exceeds 32 MiB after repeated base64 embedding');
});

test('Markdown code fences handle many short backtick runs without exhausting call arguments', async (t) => {
  const { loaded } = await sample(t);
  const note = structuredClone(loaded.notes[0]);
  const text = '`x'.repeat(150000);
  note.content.document = { type: 'document', attributes: {}, children: [
    { type: 'element', name: 'pre', attributes: {}, children: [{ type: 'text', text }] },
  ] };
  const markdown = markdownNote(note, assetNames(loaded.notes));
  assert.ok(markdown.includes(`\n\n\`\`\`\n${text}\n\`\`\`\n`));
});
