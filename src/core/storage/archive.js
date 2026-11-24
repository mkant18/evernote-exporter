'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { readEnex } = require('../../parsers/enex/read');
const { convertNote, digest } = require('../../parsers/enex/convert');
const { children, single, textOf } = require('../../parsers/enex/xml');

async function fileHash(filename, algorithm = 'sha256') {
  const hash = createHash(algorithm);
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function absent(filename) {
  try { fs.lstatSync(filename); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Output already exists: ${filename}`);
}

function writeJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

async function exportArchive({ input, output, notebook = null, stack = null }) {
  if (!input || !output) throw new Error('Input and output paths are required');
  if (stack && !notebook) throw new Error('--stack requires --notebook');
  const sourcePath = path.resolve(input);
  const outputPath = path.resolve(output);
  if (!fs.statSync(sourcePath).isFile()) throw new Error('Input must be an ENEX file');
  absent(outputPath);
  const parent = path.dirname(outputPath);
  // Use an existing parent; never create a chain of directories on a typo.
  const stage = fs.mkdtempSync(path.join(parent, '.evernote-export-'));
  try {
    for (const directory of ['sources', 'notes', 'assets']) fs.mkdirSync(path.join(stage, directory));
    const files = [];
    const sourceFile = 'sources/original.enex';
    fs.copyFileSync(sourcePath, path.join(stage, sourceFile), fs.constants.COPYFILE_EXCL);
    const sourceHash = await fileHash(path.join(stage, sourceFile));
    files.push({ path: sourceFile, bytes: fs.statSync(path.join(stage, sourceFile)).size, sha256: sourceHash });
    const assetPaths = new Set();
    const saveAsset = (bytes, sha256) => {
      const filename = `assets/${sha256}`;
      if (!assetPaths.has(filename)) {
        fs.writeFileSync(path.join(stage, filename), bytes, { flag: 'wx' });
        files.push({ path: filename, bytes: bytes.length, sha256 });
        assetPaths.add(filename);
      }
      return filename;
    };
    const organization = notebook ? { name: notebook, stack, provenance: 'user-supplied' } : null;
    const warnings = [
      { code: 'account-coverage-unknown', detail: 'This archive covers only the supplied ENEX; account inventory and export omissions are not verified' },
      { code: 'source-identities-unavailable', detail: 'Local note IDs identify source file and ordinal; they are not original Evernote IDs' },
      { code: 'tag-hierarchy-unavailable', detail: 'Tag labels are preserved; parent/child tag relationships are not supplied by ENEX' },
    ];
    if (!organization) warnings.push({ code: 'notebook-unavailable', detail: 'No notebook/stack assignment supplied; no hierarchy inferred from filename' });
    else warnings.push({ code: 'organization-user-supplied', detail: 'Notebook/stack assignment is supplied by the user and not verified against Evernote' });
    const notes = [];
    const tags = new Set();
    const metadata = {};
    let attachmentCount = 0;
    for await (const raw of readEnex(path.join(stage, sourceFile), metadata)) {
      const ordinal = notes.length + 1;
      const id = `${sourceHash.slice(0, 16)}-${String(ordinal).padStart(6, '0')}`;
      const note = convertNote(raw, id, organization, saveAsset);
      const filename = `notes/${id}.json`;
      const serialized = Buffer.from(`${JSON.stringify(note, null, 2)}\n`);
      fs.writeFileSync(path.join(stage, filename), serialized, { flag: 'wx' });
      files.push({ path: filename, bytes: serialized.length, sha256: digest(serialized) });
      notes.push({ id, path: filename, sourceOrdinal: ordinal });
      for (const tag of note.tags) tags.add(tag);
      attachmentCount += note.attachments.length;
      warnings.push(...note.warnings);
    }
    const manifest = {
      format: 'evernote-neutral-archive', schemaVersion: 1,
      completeness: 'unverified',
      source: { path: sourceFile, originalFilename: path.basename(sourcePath), sha256: sourceHash, ...metadata },
      organization, tags: [...tags].sort(), notes,
      counts: { notes: notes.length, attachments: attachmentCount, uniqueAssets: assetPaths.size },
      warnings, files,
    };
    writeJson(path.join(stage, 'manifest.json'), manifest);
    await verifyArchive(stage);
    // Exclusive creation prevents even an existing empty destination being replaced.
    fs.mkdirSync(outputPath);
    fs.writeFileSync(path.join(outputPath, '.incomplete'), 'Publication in progress; do not use this archive.\n', { flag: 'wx' });
    for (const item of ['sources', 'notes', 'assets', 'manifest.json']) {
      fs.renameSync(path.join(stage, item), path.join(outputPath, item));
    }
    fs.unlinkSync(path.join(outputPath, '.incomplete'));
    return { output: outputPath, ...manifest.counts, warnings: warnings.length, completeness: manifest.completeness };
  } finally {
    // Only our fresh staging directory is eligible for recursive cleanup.
    if (path.dirname(stage) !== parent || !path.basename(stage).startsWith('.evernote-export-')) {
      throw new Error('Refusing to clean an unexpected staging path');
    }
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function archiveFile(root, relative) {
  if (typeof relative !== 'string' || !/^(?:sources|notes|assets)\/[A-Za-z0-9._-]+$/.test(relative)) {
    throw new Error('Invalid archive payload path');
  }
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Archive symlink rejected: ${relative}`);
  }
  if (!fs.statSync(current).isFile()) throw new Error(`Not an archive file: ${relative}`);
  return current;
}

function attributesValid(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string');
}

function metadataValid(nodes, depth = 0) {
  return depth <= 128 && Array.isArray(nodes) && nodes.every((node) =>
    typeof node === 'string' || (node && typeof node.name === 'string' && node.name.length > 0 &&
      attributesValid(node.attributes) && metadataValid(node.children, depth + 1)));
}

function dateValid(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function warningValid(warning) {
  return warning && typeof warning.code === 'string' && warning.code.length > 0 &&
    typeof warning.detail === 'string' && (warning.noteId === undefined || typeof warning.noteId === 'string');
}

async function verifyArchive(directory) {
  const root = path.resolve(directory);
  try {
    fs.lstatSync(path.join(root, '.incomplete'));
    throw new Error('Archive publication is incomplete');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const manifestPath = path.join(root, 'manifest.json');
  if (fs.lstatSync(manifestPath).isSymbolicLink()) throw new Error('Manifest symlink rejected');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || manifest.format !== 'evernote-neutral-archive' || manifest.schemaVersion !== 1 ||
      manifest.completeness !== 'unverified' || !Array.isArray(manifest.files) ||
      !Array.isArray(manifest.notes) || !Array.isArray(manifest.tags) ||
      !Array.isArray(manifest.warnings) || !manifest.warnings.every(warningValid) ||
      (manifest.organization !== null && (!manifest.organization ||
        typeof manifest.organization.name !== 'string' || !manifest.organization.name.trim() ||
        (manifest.organization.stack !== null && typeof manifest.organization.stack !== 'string') ||
        manifest.organization.provenance !== 'user-supplied'))) {
    throw new Error('Unsupported or invalid archive manifest');
  }
  const files = new Map();
  for (const file of manifest.files) {
    if (!file || files.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('Invalid or duplicate file record');
    const filename = archiveFile(root, file.path);
    if (fs.statSync(filename).size !== file.bytes || await fileHash(filename) !== file.sha256) {
      throw new Error(`Integrity check failed: ${file.path}`);
    }
    files.set(file.path, file);
  }
  if (manifest.source?.path !== 'sources/original.enex' ||
      typeof manifest.source.originalFilename !== 'string' || !attributesValid(manifest.source.attributes) ||
      files.get(manifest.source.path)?.sha256 !== manifest.source.sha256) throw new Error('Invalid source reference');
  const referenced = new Set([manifest.source.path]);
  const ids = new Set();
  const tags = new Set();
  const assets = new Set();
  const assetMd5 = new Map();
  const noteWarnings = [];
  let attachmentCount = 0;
  for (const [index, record] of manifest.notes.entries()) {
    const expectedId = `${manifest.source.sha256.slice(0, 16)}-${String(index + 1).padStart(6, '0')}`;
    if (!record || record.id !== expectedId || ids.has(record.id) ||
        record.sourceOrdinal !== index + 1 || record.path !== `notes/${record.id}.json` || !files.has(record.path)) {
      throw new Error('Invalid or duplicate note reference');
    }
    ids.add(record.id);
    referenced.add(record.path);
    const note = JSON.parse(fs.readFileSync(archiveFile(root, record.path), 'utf8'));
    if (!note || note.schemaVersion !== 1 || note.id !== record.id || note.sourceIdentity !== null ||
        typeof note.title !== 'string' || !dateValid(note.created) || !dateValid(note.updated) ||
        !Array.isArray(note.tags) || !note.tags.every((tag) => typeof tag === 'string') ||
        !Array.isArray(note.attachments) || !Array.isArray(note.warnings) ||
        !note.warnings.every((warning) => warningValid(warning) && warning.noteId === note.id) ||
        !Array.isArray(note.checkboxes) || !Array.isArray(note.links) ||
        !note.links.every((link) => typeof link === 'string') ||
        !attributesValid(note.sourceAttributes) || !metadataValid(note.sourceMetadata) ||
        !isDeepStrictEqual(note.notebook, manifest.organization)) throw new Error('Invalid note record');
    noteWarnings.push(...note.warnings);
    const attachments = new Map();
    for (const [attachmentIndex, attachment] of note.attachments.entries()) {
      if (!attachment || attachment.id !== `${note.id}-resource-${attachmentIndex + 1}` ||
          (attachment.filename !== null && typeof attachment.filename !== 'string') ||
          typeof attachment.mime !== 'string' || !/^[a-f0-9]{32}$/.test(attachment.md5) ||
          !attributesValid(attachment.dataAttributes) || !metadataValid(attachment.metadata) ||
          (attachment.sourceAttributes !== undefined && !attributesValid(attachment.sourceAttributes))) {
        throw new Error('Invalid attachment metadata');
      }
      const file = files.get(attachment.path);
      if (attachments.has(attachment.id) || !file || attachment.path !== `assets/${attachment.sha256}` ||
          file.sha256 !== attachment.sha256 || file.bytes !== attachment.bytes) throw new Error('Invalid attachment reference');
      if (!assetMd5.has(attachment.path)) {
        assetMd5.set(attachment.path, await fileHash(archiveFile(root, attachment.path), 'md5'));
      }
      if (assetMd5.get(attachment.path) !== attachment.md5) throw new Error('Attachment MD5 mismatch');
      attachments.set(attachment.id, attachment);
      referenced.add(attachment.path);
      assets.add(attachment.path);
      attachmentCount++;
    }
    const checkboxes = [];
    const links = [];
    function checkBody(node, depth = 0) {
      if (!node || depth > 128 || !['document', 'element', 'text', 'checkbox', 'attachment', 'encrypted'].includes(node.type) ||
          (node.type !== 'text' && !attributesValid(node.attributes))) {
        throw new Error('Invalid content tree');
      }
      if (node.type === 'attachment') {
        const attachment = attachments.get(node.attachmentId);
        const sourceHash = node.attributes.hash?.toLowerCase();
        if (node.attachmentId === null) {
          if ([...attachments.values()].some((item) => item.md5 === sourceHash) ||
              !note.warnings.some((warning) => warning.code === 'missing-resource')) {
            throw new Error('Unexplained missing body attachment');
          }
        } else if (!attachment || sourceHash !== attachment.md5) {
          throw new Error('Invalid body attachment reference');
        } else if (node.attributes.type !== attachment.mime &&
            !note.warnings.some((warning) => warning.code === 'media-type-mismatch')) {
          throw new Error('Unexplained media type mismatch');
        }
      }
      if (node.type === 'text' && typeof node.text !== 'string') throw new Error('Invalid text node');
      if (node.type === 'checkbox') {
        if (node.checked !== null && typeof node.checked !== 'boolean') throw new Error('Invalid checkbox');
        if (node.checked === null && !note.warnings.some((warning) => warning.code === 'unknown-checkbox-state')) {
          throw new Error('Unexplained unknown checkbox');
        }
        checkboxes.push({ index: checkboxes.length, checked: node.checked });
      }
      if (node.type === 'encrypted' && (typeof node.ciphertext !== 'string' ||
          !note.warnings.some((warning) => warning.code === 'encrypted-content'))) throw new Error('Invalid encrypted content');
      if (node.type === 'element') {
        if (typeof node.name !== 'string' || !node.name) throw new Error('Invalid element name');
        if (node.name === 'a' && node.attributes.href) links.push(node.attributes.href);
      }
      if (node.type === 'document' && depth !== 0) throw new Error('Nested document root');
      if (['document', 'element'].includes(node.type)) {
        if (!Array.isArray(node.children)) throw new Error('Invalid content children');
        node.children.forEach((child) => checkBody(child, depth + 1));
      } else if (node.children !== undefined) {
        throw new Error('Content leaf cannot have children');
      }
    }
    if (typeof note.content?.plainText !== 'string' || typeof note.content?.enml !== 'string' ||
        note.content?.document?.type !== 'document') throw new Error('Missing content');
    checkBody(note.content.document);
    if (!isDeepStrictEqual(checkboxes, note.checkboxes) || !isDeepStrictEqual(links, note.links)) {
      throw new Error('Content summary mismatch');
    }
    for (const tag of note.tags) tags.add(tag);
  }
  if (referenced.size !== files.size || [...files.keys()].some((file) => !referenced.has(file)) ||
      manifest.counts?.notes !== ids.size || manifest.counts?.attachments !== attachmentCount ||
      manifest.counts?.uniqueAssets !== assets.size || JSON.stringify([...tags].sort()) !== JSON.stringify(manifest.tags)) {
    throw new Error('Archive inventory mismatch');
  }
  if (!isDeepStrictEqual(manifest.warnings.filter((warning) => warning.noteId !== undefined), noteWarnings)) {
    throw new Error('Note warning inventory mismatch');
  }
  let sourceCount = 0;
  const sourceMetadata = {};
  for await (const raw of readEnex(archiveFile(root, manifest.source.path), sourceMetadata)) {
    const record = manifest.notes[sourceCount++];
    if (!record) throw new Error('Source note inventory mismatch');
    const note = JSON.parse(fs.readFileSync(archiveFile(root, record.path), 'utf8'));
    const metadata = raw.children.filter((child) => typeof child !== 'string' && !['content', 'resource'].includes(child.name));
    const resources = children(raw, 'resource');
    if (note.title !== textOf(single(raw, 'title', true)) ||
        note.content.enml !== textOf(single(raw, 'content', true)) ||
        !isDeepStrictEqual(note.tags, children(raw, 'tag').map(textOf)) ||
        !isDeepStrictEqual(note.sourceAttributes, raw.attributes) ||
        !isDeepStrictEqual(note.sourceMetadata, metadata) || resources.length !== note.attachments.length) {
      throw new Error('Source note reconciliation failed');
    }
    for (const [index, resource] of resources.entries()) {
      const attachment = note.attachments[index];
      const data = single(resource, 'data', true);
      const encoded = textOf(data).replace(/[\t\r\n ]/g, '');
      const bytes = Buffer.from(encoded, 'base64');
      const resourceAttributes = single(resource, 'resource-attributes');
      const filename = resourceAttributes ? textOf(single(resourceAttributes, 'file-name')) : null;
      const metadata = resource.children.filter((child) => typeof child !== 'string' && child.name !== 'data');
      if (data.attributes.encoding !== 'base64' || bytes.toString('base64') !== encoded ||
          digest(bytes) !== attachment.sha256 || filename !== attachment.filename ||
          textOf(single(resource, 'mime', true)) !== attachment.mime ||
          !isDeepStrictEqual(metadata, attachment.metadata) ||
          !isDeepStrictEqual(data.attributes, attachment.dataAttributes) ||
          (attachment.sourceAttributes !== undefined && !isDeepStrictEqual(resource.attributes, attachment.sourceAttributes))) {
        throw new Error('Source resource reconciliation failed');
      }
    }
  }
  if (sourceCount !== manifest.notes.length || !isDeepStrictEqual(sourceMetadata.attributes, manifest.source.attributes)) {
    throw new Error('Source note inventory mismatch');
  }
  return { valid: true, files: files.size, ...manifest.counts, sourceNotesReconciled: true, completeness: manifest.completeness };
}

module.exports = { exportArchive, verifyArchive };
