'use strict';

const { createHash } = require('node:crypto');
const { parseXml, children, textOf, single } = require('./xml');

const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');

function decodeData(node) {
  if (node.attributes.encoding !== 'base64') throw new Error('Resource data must use base64 encoding');
  const encoded = textOf(node).replace(/[\t\r\n ]/g, '');
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const body = padding ? encoded.slice(0, -padding) : encoded;
  if (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(body)) {
    throw new Error('Invalid resource base64');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error('Noncanonical resource base64');
  return bytes;
}

function timestamp(node, name, warn) {
  const value = textOf(single(node, name));
  if (value === null) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (match) {
    const [, y, m, d, h, min, s] = match;
    const iso = `${y}-${m}-${d}T${h}:${min}:${s}.000Z`;
    const date = new Date(iso);
    if (!Number.isNaN(date.valueOf()) && date.toISOString() === iso) return iso;
  }
  warn('invalid-timestamp', `${name} is retained only in source metadata: ${value}`);
  return null;
}

function convertNote(raw, id, notebook, saveAsset) {
  const warnings = [];
  const warn = (code, detail) => warnings.push({ code, noteId: id, detail });
  const content = textOf(single(raw, 'content', true));
  const title = textOf(single(raw, 'title', true));
  const attachments = children(raw, 'resource').map((resource, index) => {
    const data = single(resource, 'data', true);
    const bytes = decodeData(data);
    const md5 = digest(bytes, 'md5');
    const sha256 = digest(bytes);
    const declaredHash = data.attributes['body-hash'];
    if (declaredHash && declaredHash.toLowerCase() !== md5) throw new Error('Resource body-hash mismatch');
    const attributes = single(resource, 'resource-attributes');
    const filename = attributes ? textOf(single(attributes, 'file-name')) : null;
    const mime = textOf(single(resource, 'mime', true));
    const path = saveAsset(bytes, sha256);
    return {
      id: `${id}-resource-${index + 1}`, filename, mime, bytes: bytes.length, md5, sha256, path,
      metadata: resource.children.filter((child) => typeof child !== 'string' && child.name !== 'data'),
      sourceAttributes: resource.attributes, dataAttributes: data.attributes,
    };
  });
  const body = parseXml(content);
  if (body.name !== 'en-note') throw new Error('Expected en-note content root');
  const checkboxes = [];
  const links = [];
  function styleValue(attributes, property) {
    let value;
    for (const declaration of (attributes.style ?? '').split(';')) {
      const colon = declaration.indexOf(':');
      if (colon !== -1 && declaration.slice(0, colon).trim() === property) {
        value = declaration.slice(colon + 1).replace(/\s*!important\s*$/i, '').trim();
      }
    }
    return value;
  }
  function checkbox(value, attributes, defaultUnchecked) {
    const valid = (value === undefined && defaultUnchecked) || ['true', 'false'].includes(value);
    if (!valid) warn('unknown-checkbox-state', `Unrecognized checked value: ${value ?? '(missing)'}`);
    const checked = valid ? value === 'true' : null;
    checkboxes.push({ index: checkboxes.length, checked });
    return { type: 'checkbox', checked, attributes };
  }
  function convert(node, checklist = false) {
    if (typeof node === 'string') {
      return { type: 'text', text: node };
    }
    const { name, attributes } = node;
    if (name === 'en-todo') {
      return checkbox(attributes.checked, attributes, true);
    }
    if (name === 'en-media') {
      const matches = attachments.filter((a) => a.md5 === attributes.hash?.toLowerCase());
      const attachment = matches.find((a) => a.mime === attributes.type) ?? matches[0];
      if (!attachment) warn('missing-resource', `No attachment for media hash ${attributes.hash ?? '(missing)'}`);
      else if (attachment.mime !== attributes.type) warn('media-type-mismatch', `Media type differs for ${attachment.id}`);
      return { type: 'attachment', attachmentId: attachment?.id ?? null, attributes };
    }
    if (name === 'en-crypt') {
      warn('encrypted-content', 'Ciphertext retained; plaintext requires the owner\'s passphrase and a compatible decryptor');
      return { type: 'encrypted', attributes, ciphertext: textOf(node) };
    }
    if (name === 'a' && attributes.href) {
      links.push(attributes.href);
      if (/^evernote:/i.test(attributes.href)) warn('unresolved-note-link', attributes.href);
    }
    if (name.startsWith('en-') && name !== 'en-note') warn('unsupported-content', `${name} retained as an element`);
    const listMarker = ['ul', 'ol'].includes(name) ? styleValue(attributes, '--en-todo') : undefined;
    const childChecklist = listMarker !== undefined && listMarker !== 'false';
    if (childChecklist && listMarker !== 'true') warn('unknown-checklist-type', `Unrecognized checklist value: ${listMarker}`);
    const normalizedChildren = [];
    if (name === 'li' && checklist) normalizedChildren.push(checkbox(styleValue(attributes, '--en-checked'), {}, false));
    for (const child of node.children) normalizedChildren.push(convert(child, childChecklist));
    const result = {
      type: name === 'en-note' ? 'document' : 'element',
      ...(name === 'en-note' ? {} : { name }), attributes, children: normalizedChildren,
    };
    return result;
  }
  const document = convert(body);
  const blocks = new Set(['div', 'p', 'li', 'tr', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre']);
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  function project(node) {
    if (node.type === 'text') return node.text;
    if (node.type === 'checkbox') return node.checked === null ? '[?] ' : node.checked ? '[x] ' : '[ ] ';
    if (node.type === 'encrypted') return '[Encrypted content]';
    if (node.type === 'attachment') {
      const attachment = attachmentById.get(node.attachmentId);
      return `[Attachment: ${attachment?.filename ?? node.attributes.type ?? 'unknown'}]`;
    }
    if (node.name === 'br') return '\n';
    if (node.name === 'tr') {
      return node.children.filter((child) => child.type !== 'text' || child.text.trim())
        .map((child) => project(child).trim()).join('\t');
    }
    let text = '';
    let afterCheckbox = false;
    for (const child of node.children) {
      const block = child.type === 'element' && blocks.has(child.name);
      const childText = project(child);
      if (block && text && !text.endsWith('\n') && !afterCheckbox) text += '\n';
      text += childText;
      if (block && (!text.endsWith('\n') || childText === '')) text += '\n';
      if (child.type === 'checkbox') afterCheckbox = true;
      else if (childText.trim()) afterCheckbox = false;
    }
    return text;
  }
  const metadata = raw.children.filter((child) => typeof child !== 'string' && !['content', 'resource'].includes(child.name));
  const known = new Set(['title', 'created', 'updated', 'tag', 'note-attributes']);
  for (const item of metadata) {
    if (!known.has(item.name)) warn('unmapped-metadata', `${item.name} preserved in sourceMetadata`);
  }
  for (const attachment of attachments) {
    if (attachment.metadata.some((item) => ['recognition', 'alternate-data'].includes(item.name))) {
      warn('unmapped-resource-metadata', `${attachment.id}: recognition/alternate data retained in metadata`);
    }
  }
  return {
    schemaVersion: 1, id, sourceIdentity: null, title,
    created: timestamp(raw, 'created', warn), updated: timestamp(raw, 'updated', warn),
    tags: children(raw, 'tag').map(textOf), notebook,
    content: { document, plainText: project(document).trim(), enml: content },
    checkboxes, links, attachments, sourceMetadata: metadata,
    sourceAttributes: raw.attributes, warnings,
  };
}

module.exports = { convertNote, digest };
