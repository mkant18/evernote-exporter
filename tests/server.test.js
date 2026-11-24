'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { startServer } = require('../src/web/server');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/sample.enex'));
const evidence = path.resolve(__dirname, '../.evidence');

async function setup(t) {
  fs.mkdirSync(evidence, { recursive: true });
  const directory = fs.mkdtempSync(path.join(evidence, 'server-test-'));
  const context = { directory, app: await startServer({ dataDir: directory, port: 0 }) };
  context.close = async () => {
    if (!context.app.server.listening) return;
    const closed = new Promise((resolve) => context.app.server.close(resolve));
    context.app.server.closeAllConnections();
    await closed;
  };
  t.after(async () => {
    await context.close();
    if (path.dirname(directory) !== evidence || !path.basename(directory).startsWith('server-test-')) throw new Error('Unexpected test cleanup path');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  context.request = async (route, { method = 'GET', body, headers = {}, authenticated = true } = {}) => {
    const response = await fetch(`http://127.0.0.1:${context.app.port}${route}`, {
      method, body, headers: { ...(authenticated ? { 'x-archive-key': context.app.key } : {}), ...headers },
      signal: AbortSignal.timeout(15000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, bytes,
      json: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : null };
  };
  context.import = (body = fixture, parameters = {}) => context.request(`/api/import?${new URLSearchParams({ filename: 'Synthetic.enex', ...parameters })}`, { method: 'POST', body });
  return context;
}

function rawRequest(app, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: app.port, path: route,
      headers: { 'x-archive-key': app.key, ...headers } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('HTTP test timeout')));
    request.end();
  });
}

test('HTTP import exposes the saved library, readable notes and exact original/attachment downloads', async (t) => {
  const context = await setup(t);
  const empty = await context.request('/api/archives');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json, { archives: [], issues: [] });
  const uploaded = await context.import(fixture, { notebook: 'Trips', stack: 'Family' });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.json));
  assert.equal(uploaded.json.summary.notes, 2);
  assert.equal(uploaded.json.summary.completeness, 'unverified');
  const { id } = uploaded.json;
  const library = await context.request('/api/archives');
  assert.equal(library.json.archives.length, 1);
  assert.equal(library.json.archives[0].id, id);
  assert.equal(library.json.archives[0].notebook, 'Trips');
  assert.equal(library.json.archives[0].stack, 'Family');
  const content = await context.request(`/api/archives/${id}`);
  assert.equal(content.status, 200);
  assert.equal(content.json.notes.length, 2);
  assert.equal(content.json.notes[0].title, 'Travel / plans: café 🧭');
  assert.deepEqual(content.json.notes[0].checkboxes.map((checkbox) => checkbox.checked), [true, false]);
  const original = await context.request(`/api/archives/${id}/download/source`);
  assert.equal(original.status, 200);
  assert.deepEqual(original.bytes, fixture);
  assert.deepEqual(fs.readFileSync(path.join(context.directory, 'library', id, 'sources/original.enex')), fixture);
  const attachment = content.json.notes[0].attachments[0];
  const downloaded = await context.request(`/api/archives/${id}/assets/${attachment.sha256}`);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.bytes, Buffer.from('hello\n'));
  assert.equal(downloaded.headers.get('content-type'), 'application/octet-stream');
  assert.match(downloaded.headers.get('content-disposition'), /^attachment;/);
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(downloaded.headers.get('cache-control'), 'no-store');
  assert.deepEqual(fs.readdirSync(path.join(context.directory, '.incoming')), []);
});

test('HTTP API rejects absent/wrong credentials, cross-site origins and foreign Host headers', async (t) => {
  const context = await setup(t);
  for (const headers of [{}, { 'x-archive-key': 'wrong' }, { 'x-archive-key': '0'.repeat(64) }]) {
    assert.equal((await context.request('/api/archives', { authenticated: false, headers })).status, 401);
  }
  assert.equal((await context.request('/api/archives', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await context.request('/api/archives', { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await context.request('/api/archives', { headers: { Origin: `http://127.0.0.1:${context.app.port}` } })).status, 200);
  assert.equal((await rawRequest(context.app, '/api/archives', { Host: `evil.example:${context.app.port}` })).status, 403);
  const status = await context.request('/api/status');
  assert.equal(status.json.sharing.enabled, false);
  assert.deepEqual(status.json.sharing.urls, []);
});

test('invalid or empty uploads fail without publishing a notebook and allow a subsequent valid import', async (t) => {
  const context = await setup(t);
  for (const bytes of [Buffer.alloc(0), Buffer.from('<en-export><broken></en-export>'), Buffer.from('not XML')]) {
    const result = await context.import(bytes);
    assert.equal(result.status, 400);
    assert.equal(typeof result.json.error, 'string');
    assert.deepEqual((await context.request('/api/archives')).json.archives, []);
    assert.equal((await context.request('/api/status')).json.importing, false);
    assert.deepEqual(fs.readdirSync(path.join(context.directory, '.incoming')), []);
  }
  assert.equal((await context.import()).status, 201);
});

test('upload filenames and organization fields cannot escape staging or silently change meaning', async (t) => {
  const context = await setup(t);
  for (const parameters of [
    { filename: '../escape.enex' }, { filename: '..\\escape.enex' }, { filename: '.hidden.enex' },
    { filename: 'bad:name.enex' }, { filename: 'bad\u0000name.enex' }, { filename: 'file.txt' },
    { stack: 'Family' }, { notebook: ' ' }, { notebook: 'x'.repeat(201) }, { notebook: 'Trips', stack: '\n' },
  ]) assert.equal((await context.import(fixture, parameters)).status, 400, JSON.stringify(parameters));
  assert.deepEqual((await context.request('/api/archives')).json.archives, []);
  assert.deepEqual(fs.readdirSync(path.join(context.directory, '.incoming')), []);
});

test('unknown notebooks, formats and encoded traversal paths do not expose filesystem content', async (t) => {
  const context = await setup(t);
  const uploaded = await context.import();
  assert.equal(uploaded.status, 201);
  const { id } = uploaded.json;
  const marker = 'private review marker';
  fs.writeFileSync(path.join(context.directory, 'secret.txt'), marker);
  for (const route of [
    '/api/archives/../../secret.txt', `/api/archives/${id}/assets/%2e%2e%2fsecret.txt`,
    `/api/archives/${id}/download/%2e%2e%2fsecret.txt`, `/api/archives/${id}/download/unknown`,
    `/api/archives/${id}/assets/${'0'.repeat(64)}`, '/%2e%2e/secret.txt',
  ]) {
    const result = await rawRequest(context.app, route);
    assert.ok(result.status >= 400, route);
    assert.equal(result.body.includes(marker), false, route);
  }
  assert.equal((await context.request(`/api/archives/${'0'.repeat(36)}`)).status, 400);
});

test('library remains usable after restarting the app and the old private key is invalid', async (t) => {
  const context = await setup(t);
  const uploaded = await context.import(fixture, { notebook: 'Persistent notebook' });
  assert.equal(uploaded.status, 201);
  const priorKey = context.app.key;
  await context.close();
  context.app = await startServer({ dataDir: context.directory, port: 0 });
  assert.notEqual(context.app.key, priorKey);
  assert.equal((await context.request('/api/archives', { headers: { 'x-archive-key': priorKey } })).status, 401);
  const library = await context.request('/api/archives');
  assert.equal(library.json.archives[0].id, uploaded.json.id);
  const original = await context.request(`/api/archives/${uploaded.json.id}/download/source`);
  assert.deepEqual(original.bytes, fixture);
});

test('HTML and SVG attachments are downloadable bytes rather than active same-origin documents', async (t) => {
  const context = await setup(t);
  const bytes = Buffer.from('<script>alert("not executed")</script>');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  for (const mime of ['text/html', 'image/svg+xml']) {
    const source = `<en-export><note><title>Active attachment</title><content><![CDATA[<en-note>Attachment</en-note>]]></content><resource><data encoding="base64">${bytes.toString('base64')}</data><mime>${mime}</mime><resource-attributes><file-name>../../evil.html</file-name></resource-attributes></resource></note></en-export>`;
    const uploaded = await context.import(Buffer.from(source));
    assert.equal(uploaded.status, 201);
    const result = await context.request(`/api/archives/${uploaded.json.id}/assets/${sha256}`);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('content-type'), 'application/octet-stream');
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    assert.match(result.headers.get('content-disposition'), /^attachment;/);
    assert.deepEqual(result.bytes, bytes);
  }
});

test('a concurrent upload receives a recoverable conflict while the original upload completes', async (t) => {
  const context = await setup(t);
  let request;
  const first = new Promise((resolve, reject) => {
    request = http.request({ hostname: '127.0.0.1', port: context.app.port,
      path: '/api/import?filename=First.enex', method: 'POST',
      headers: { 'x-archive-key': context.app.key, 'Content-Length': fixture.length } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Concurrent upload test timed out')));
    request.flushHeaders();
  });
  first.catch(() => {});
  t.after(() => request.destroy());
  for (let attempt = 0; ; attempt++) {
    if ((await context.request('/api/status')).json.importing) break;
    assert.ok(attempt < 50, 'First upload should acquire the import slot');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const second = await context.import();
  assert.equal(second.status, 409);
  request.end(fixture);
  assert.equal((await first).status, 201);
  assert.equal((await context.request('/api/archives')).json.archives.length, 1);
  assert.equal((await context.import()).status, 201);
  assert.equal((await context.request('/api/archives')).json.archives.length, 2);
});

test('a staging-directory failure releases the import slot for recovery', async (t) => {
  const context = await setup(t);
  const incoming = path.join(context.directory, '.incoming');
  fs.rmdirSync(incoming);
  const failed = await context.import();
  assert.equal(failed.status, 400);
  fs.mkdirSync(incoming);
  assert.equal((await context.request('/api/status')).json.importing, false, 'Failed staging must release the import slot');
  assert.equal((await context.import()).status, 201);
});

test('cached notes and asset requests reject changed attachment bytes', async (t) => {
  const context = await setup(t);
  const uploaded = await context.import();
  assert.equal(uploaded.status, 201);
  const route = `/api/archives/${uploaded.json.id}`;
  const first = await context.request(route);
  assert.equal(first.status, 200);
  assert.equal((await context.request(route)).status, 200);
  const attachment = first.json.notes[0].attachments[0];
  const assetRoute = `${route}/assets/${attachment.sha256}`;
  assert.deepEqual((await context.request(assetRoute)).bytes, Buffer.from('hello\n'));
  const filename = path.join(context.directory, 'library', uploaded.json.id, attachment.path);
  fs.writeFileSync(filename, 'HELLO\n');
  const rejectedAsset = await context.request(assetRoute);
  assert.equal(rejectedAsset.status, 400);
  assert.match(rejectedAsset.json.error, /Integrity check failed/);
  assert.equal((await context.request(route)).status, 400);
  assert.equal((await context.request(`${route}/download/source`)).status, 400);
});

test('a publication marker added after caching prevents content and download responses', async (t) => {
  const context = await setup(t);
  const uploaded = await context.import();
  assert.equal(uploaded.status, 201);
  const route = `/api/archives/${uploaded.json.id}`;
  const first = await context.request(route);
  assert.equal(first.status, 200);
  assert.equal((await context.request(route)).status, 200);
  fs.writeFileSync(path.join(context.directory, 'library', uploaded.json.id, '.incomplete'), 'incomplete publication');
  for (const requestPath of [route, `${route}/assets/${first.json.notes[0].attachments[0].sha256}`, `${route}/download/source`]) {
    const result = await context.request(requestPath);
    assert.equal(result.status, 400);
    assert.match(result.json.error, /incomplete/i);
  }
});

test('a directory junction introduced after caching cannot bypass payload checks', async (t) => {
  const context = await setup(t);
  const uploaded = await context.import();
  assert.equal(uploaded.status, 201);
  const route = `/api/archives/${uploaded.json.id}`;
  const first = await context.request(route);
  assert.equal(first.status, 200);
  assert.equal((await context.request(route)).status, 200);
  const assetDirectory = path.join(context.directory, 'library', uploaded.json.id, 'assets');
  const outside = path.join(context.directory, 'outside-assets');
  fs.renameSync(assetDirectory, outside);
  fs.symlinkSync(outside, assetDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await context.request(`${route}/assets/${first.json.notes[0].attachments[0].sha256}`);
  assert.equal(result.status, 400);
  assert.match(result.json.error, /symlink/i);
  assert.equal((await context.request(route)).status, 400);
});
