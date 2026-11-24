#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { fork } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { parseArgs } = require('node:util');
const { loadArchive, archiveZip, portableHtml } = require('../exporters/downloads');

const MAX_UPLOAD = 512 * 1024 * 1024;
const identifier = /^[a-f0-9-]{36}$/;

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function archiveSummary(directory, id) {
  if (fs.lstatSync(directory).isSymbolicLink() || fs.existsSync(path.join(directory, '.incomplete'))) throw new Error('Archive is incomplete or unsafe');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'evernote-neutral-archive') throw new Error('Unknown archive format');
  return { id, name: manifest.organization?.name || manifest.source.originalFilename.replace(/\.enex$/i, ''),
    notebook: manifest.organization?.name ?? null, stack: manifest.organization?.stack ?? null,
    notes: manifest.counts.notes, attachments: manifest.counts.attachments, warnings: manifest.warnings.length,
    createdAt: fs.statSync(directory).birthtime.toISOString() };
}

function convertInWorker(options, workers) {
  return new Promise((resolve, reject) => {
    const worker = fork(path.join(__dirname, 'import-worker.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true, execArgv: ['--max-old-space-size=1024'] });
    workers.add(worker);
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      workers.delete(worker);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => { worker.kill(); finish(new Error('Import timed out. Split the notebook into smaller ENEX files and try again.')); }, 10 * 60 * 1000);
    worker.on('error', (error) => finish(error));
    worker.on('message', (message) => finish(message.error ? new Error(message.error) : null, message.result));
    worker.on('exit', (code) => finish(new Error(`Import worker stopped (${code ?? 'interrupted'}). Try a smaller ENEX export.`)));
    worker.stderr.resume();
    worker.send(options);
  });
}

async function startServer({ dataDir = path.resolve(__dirname, '../../archives/app'), port = 4318, share = false, key = randomBytes(32).toString('hex') } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0–65535');
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Access key must contain 64 hexadecimal characters');
  dataDir = path.resolve(dataDir);
  const library = path.join(dataDir, 'library');
  const incoming = path.join(dataDir, '.incoming');
  fs.mkdirSync(library, { recursive: true });
  fs.mkdirSync(incoming, { recursive: true });
  for (const directory of [library, incoming]) if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Library directories must not be symlinks');
  const workers = new Set();
  const verified = new Map();
  let importing = false;
  let activePort;
  const lanAddresses = Object.entries(os.networkInterfaces())
    .filter(([name]) => !/vEthernet|virtual|docker|tailscale|loopback|WSL/i.test(name))
    .flatMap(([, entries]) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(entry.address))
    .map((entry) => entry.address);
  const hosts = new Set(['localhost', '127.0.0.1', ...share ? lanAddresses : []]);
  function directoryFor(id) {
    if (!identifier.test(id)) throw new Error('Unknown notebook');
    const directory = path.join(library, id);
    if (!fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Notebook is unavailable');
    return directory;
  }
  function fingerprint(directory) {
    const paths = ['manifest.json', 'sources', 'notes', 'assets'];
    for (const subdir of ['sources', 'notes', 'assets']) {
      if (fs.lstatSync(path.join(directory, subdir)).isSymbolicLink()) throw new Error('Archive symlinks are not allowed');
      for (const name of fs.readdirSync(path.join(directory, subdir)).sort()) paths.push(`${subdir}/${name}`);
    }
    return paths.map((relative) => {
      const stat = fs.lstatSync(path.join(directory, relative));
      if (stat.isSymbolicLink()) throw new Error('Archive symlinks are not allowed');
      return `${relative}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
    }).join('|');
  }
  async function getArchive(directory, fresh = false) {
    if (!fresh && verified.has(directory)) {
      const cached = await verified.get(directory);
      if (!fs.existsSync(path.join(directory, '.incomplete')) && cached.fingerprint === fingerprint(directory)) return cached.archive;
    }
    const before = fingerprint(directory);
    const pending = loadArchive(directory).then((archive) => {
      const after = fingerprint(directory);
      if (before !== after) throw new Error('Notebook files changed during verification. Try again once file copying has finished.');
      return { archive, fingerprint: after };
    });
    verified.set(directory, pending);
    try {
      const result = await pending;
      while (verified.size > 2) verified.delete(verified.keys().next().value);
      return result.archive;
    } catch (error) {
      if (verified.get(directory) === pending) verified.delete(directory);
      throw error;
    }
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host = request.headers.host ?? '';
      if (!hosts.has(host.split(':')[0]) || host.split(':')[1] !== String(activePort)) return json(response, 403, { error: 'Unrecognized app address' });
      if (request.headers.origin && request.headers.origin !== `http://${host}`) return json(response, 403, { error: 'Cross-site requests are not allowed' });
      const url = new URL(request.url, `http://${host}`);
      if (!url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
        const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
        const selected = files[url.pathname];
        if (request.method !== 'GET' || !selected) return json(response, 404, { error: 'Page not found' });
        const filename = path.join(__dirname, 'public', selected[0]);
        if (!fs.existsSync(filename)) return json(response, 503, { error: 'The app interface is not installed' });
        response.writeHead(200, { 'Content-Type': `${selected[1]}; charset=utf-8` });
        return await pipeline(fs.createReadStream(filename), response);
      }
      const supplied = Buffer.from(typeof request.headers['x-archive-key'] === 'string' ? request.headers['x-archive-key'] : '');
      const expected = Buffer.from(key);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(response, 401, { error: 'Open the private link shown by the launcher, or enter its access key.' });
      if (request.method === 'GET' && url.pathname === '/api/status') {
        return json(response, 200, { version: '0.2.1', maxUploadBytes: MAX_UPLOAD, importing,
          sharing: { enabled: share, urls: share ? lanAddresses.map((address) => `http://${address}:${activePort}/#key=${key}`) : [] } });
      }
      if (request.method === 'GET' && url.pathname === '/api/archives') {
        const archives = [];
        const issues = [];
        for (const entry of fs.readdirSync(library, { withFileTypes: true })) {
          if (!identifier.test(entry.name)) continue;
          try { archives.push(archiveSummary(path.join(library, entry.name), entry.name)); }
          catch { issues.push({ id: entry.name, error: 'A stored notebook could not be read. Its files have been retained.' }); }
        }
        archives.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return json(response, 200, { archives, issues });
      }
      if (request.method === 'POST' && url.pathname === '/api/import') {
        if (importing) return json(response, 409, { error: 'Another import is running. Wait for it to finish and try again.' });
        const filename = url.searchParams.get('filename') ?? '';
        const notebook = url.searchParams.get('notebook') || null;
        const stack = url.searchParams.get('stack') || null;
        if (!/\.enex$/i.test(filename) || /[\\/\x00-\x1f]/.test(filename) || filename.length > 200) return json(response, 400, { error: 'Choose an ENEX file with a normal filename.' });
        if (filename.startsWith('.') || /[:*?"<>|]/.test(filename)) return json(response, 400, { error: 'Rename the ENEX file to remove unsupported filename characters.' });
        if (stack && !notebook) return json(response, 400, { error: 'Choose a notebook before assigning a stack.' });
        if ([notebook, stack].some((value) => value !== null && (!value.trim() || value.length > 200 || /[\x00-\x1f]/.test(value)))) return json(response, 400, { error: 'Notebook and stack names must be 1–200 readable characters.' });
        const declared = Number(request.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_UPLOAD) return json(response, 413, { error: 'Use an ENEX export smaller than 512 MiB. Evernote can split exports.' });
        importing = true;
        let job;
        try {
          job = fs.mkdtempSync(path.join(incoming, 'import-'));
          const input = path.join(job, filename);
          let bytes = 0;
          const limiter = new Transform({ transform(chunk, encoding, callback) {
            bytes += chunk.length;
            callback(bytes > MAX_UPLOAD ? new Error('Upload exceeds 512 MiB') : null, chunk);
          } });
          await pipeline(request, limiter, fs.createWriteStream(input, { flags: 'wx' }));
          if (!bytes) throw new Error('The selected ENEX file is empty');
          const converted = path.join(job, 'archive');
          const summary = await convertInWorker({ input, output: converted, notebook, stack }, workers);
          const id = randomUUID();
          fs.renameSync(converted, path.join(library, id));
          return json(response, 201, { id, summary: { notes: summary.notes, attachments: summary.attachments, warnings: summary.warnings, completeness: summary.completeness } });
        } finally {
          importing = false;
          if (job && path.dirname(job) === incoming && path.basename(job).startsWith('import-')) fs.rmSync(job, { recursive: true, force: true });
        }
      }
      const match = /^\/api\/archives\/([a-f0-9-]{36})(?:\/(assets|download)\/([a-z0-9-]+))?$/.exec(url.pathname);
      if (request.method !== 'GET' || !match) return json(response, 404, { error: 'Not found' });
      const [, id, action, value] = match;
      const directory = directoryFor(id);
      if (action === 'assets') {
        if (!/^[a-f0-9]{64}$/.test(value)) return json(response, 404, { error: 'Attachment not found' });
        const archive = await getArchive(directory);
        const attachment = archive.notes.flatMap((note) => note.attachments).find((a) => a.sha256 === value);
        if (!attachment) return json(response, 404, { error: 'Attachment not found' });
        const mime = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.mime) ? attachment.mime : 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': mime, 'Content-Length': attachment.bytes, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename || 'attachment')}` });
        return await pipeline(fs.createReadStream(path.join(directory, attachment.path)), response);
      }
      const archive = await getArchive(directory, action === 'download');
      if (!action) return json(response, 200, archive);
      if (!['markdown', 'portable', 'source', 'archive'].includes(value)) return json(response, 404, { error: 'Unknown download format' });
      const extension = value === 'portable' ? 'html' : value === 'source' ? 'enex' : 'zip';
      const types = { html: 'text/html; charset=utf-8', enex: 'application/octet-stream', zip: 'application/zip' };
      if (value === 'portable') {
        const html = portableHtml(directory, archive);
        response.writeHead(200, { 'Content-Type': types.html, 'Content-Disposition': 'attachment; filename="evernote-reading-copy.html"' });
        return response.end(html);
      }
      response.writeHead(200, { 'Content-Type': types[extension], 'Content-Disposition': `attachment; filename="evernote-${value}.${extension}"` });
      const stream = value === 'source' ? fs.createReadStream(path.join(directory, archive.manifest.source.path)) : archiveZip(directory, archive, value);
      return await pipeline(stream, response);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) json(response, 400, { error: error.code === 'ENOENT' ? 'This notebook or file is unavailable.' : error.message });
      else if (!response.destroyed) response.destroy();
    }
  });
  server.requestTimeout = 15 * 60 * 1000;
  server.headersTimeout = 60000;
  server.on('close', () => { for (const worker of workers) worker.kill(); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, share ? '0.0.0.0' : '127.0.0.1', () => { activePort = server.address().port; resolve(); });
  });
  return { server, port: activePort, key, url: `http://127.0.0.1:${activePort}/#key=${key}`, dataDir,
    phoneUrls: share ? lanAddresses.map((address) => `http://${address}:${activePort}/#key=${key}`) : [] };
}

if (require.main === module) {
  (async () => {
    const { values } = parseArgs({ options: { port: { type: 'string' }, 'data-dir': { type: 'string' }, share: { type: 'boolean' }, 'status-file': { type: 'string' }, help: { type: 'boolean' } }, strict: true });
    if (values.help) { process.stdout.write('Evernote Archive app\nnode src/web/server.js [--port 4318] [--data-dir PATH] [--share]\n--share enables private LAN access for an iPhone on the same trusted Wi-Fi.\n'); return; }
    const app = await startServer({ port: values.port === undefined ? 4318 : Number(values.port), dataDir: values['data-dir'], share: values.share });
    const status = { url: app.url, phoneUrls: app.phoneUrls, dataDir: app.dataDir, pid: process.pid };
    if (values['status-file']) fs.writeFileSync(values['status-file'], JSON.stringify(status, null, 2), { mode: 0o600 });
    process.stdout.write(`Evernote Archive is ready.\n${app.url}\n${app.phoneUrls.length ? `iPhone on the same Wi-Fi:\n${app.phoneUrls.join('\n')}\nKeep this private link to yourself.\n` : ''}Library: ${app.dataDir}\nPress Ctrl+C to stop.\n`);
    process.on('SIGINT', () => { app.server.close(); app.server.closeAllConnections(); });
    process.on('SIGTERM', () => { app.server.close(); app.server.closeAllConnections(); });
  })().catch((error) => { process.stderr.write(`Could not start: ${error.message}\n`); process.exitCode = 1; });
}

module.exports = { startServer, MAX_UPLOAD };
