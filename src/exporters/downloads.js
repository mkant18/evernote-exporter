'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yazl = require('yazl');
const { verifyArchive } = require('../core/storage/archive');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const markdownText = (text) => text.replace(/[\\`*_{}\[\]<>#+!|]/g, '\\$&');
const safeUrl = (value) => {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const htmlElements = new Set(['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'sup', 'sub']);

async function loadArchive(directory) {
  await verifyArchive(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const notes = manifest.notes.map((record) => JSON.parse(fs.readFileSync(path.join(directory, record.path), 'utf8')));
  return { manifest, notes };
}

function assetNames(notes) {
  const names = new Map();
  const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'application/pdf': '.pdf', 'text/plain': '.txt', 'audio/mpeg': '.mp3', 'audio/wav': '.wav' };
  for (const note of notes) for (const attachment of note.attachments) {
    const candidate = path.extname(attachment.filename ?? '').toLowerCase();
    const extension = /^\.[a-z0-9]{1,10}$/.test(candidate) ? candidate : extensions[attachment.mime] ?? '.bin';
    if (!names.has(attachment.sha256)) names.set(attachment.sha256, `assets/${attachment.sha256}${extension}`);
  }
  return names;
}

function renderHtml(node, note, resourceUrl) {
  if (node.type === 'text') return escapeHtml(node.text);
  if (node.type === 'checkbox') return `<span role="img" aria-label="${node.checked === null ? 'Unknown checkbox state' : node.checked ? 'Checked' : 'Unchecked'}">${node.checked === null ? '▨' : node.checked ? '☑' : '☐'}</span> `;
  if (node.type === 'encrypted') return '<span class="notice">[Encrypted content retained in original ENEX]</span>';
  if (node.type === 'attachment') {
    const attachment = note.attachments.find((a) => a.id === node.attachmentId);
    if (!attachment) return '<span class="notice">[Missing attachment]</span>';
    const label = escapeHtml(attachment.filename || 'Attachment');
    const url = escapeHtml(resourceUrl(attachment));
    if (imageTypes.has(attachment.mime)) return `<img src="${url}" alt="${label}" loading="lazy">`;
    return `<a href="${url}" download="${label}">${label}</a>`;
  }
  const content = (node.children ?? []).map((child) => renderHtml(child, note, resourceUrl)).join('');
  if (node.type === 'document') return content;
  if (node.name === 'a') {
    const url = safeUrl(node.attributes.href);
    return url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${content}</a>` : content;
  }
  if (!htmlElements.has(node.name)) return content;
  if (['br', 'hr'].includes(node.name)) return `<${node.name}>`;
  return `<${node.name}>${content}</${node.name}>`;
}

function renderMarkdown(node, note, names, depth = 0) {
  if (node.type === 'text') return markdownText(node.text);
  if (node.type === 'checkbox') return `${depth === 0 ? '- ' : ''}${node.checked === null ? '[?] ' : node.checked ? '[x] ' : '[ ] '}`;
  if (node.type === 'encrypted') return '**[Encrypted content retained in original ENEX]**';
  if (node.type === 'attachment') {
    const attachment = note.attachments.find((a) => a.id === node.attachmentId);
    if (!attachment) return '**[Missing attachment]**';
    const prefix = imageTypes.has(attachment.mime) ? '!' : '';
    return `${prefix}[${markdownText(attachment.filename || 'Attachment')}](../${names.get(attachment.sha256)})`;
  }
  if (node.type === 'document') return node.children.map((child) => renderMarkdown(child, note, names, depth)).join('');
  if (node.name === 'table') return `\n\n${renderHtml(node, note, (a) => `../${names.get(a.sha256)}`)}\n\n`;
  if (node.name === 'pre') {
    const text = (function collect(part) { return part.type === 'text' ? part.text : (part.children ?? []).map(collect).join(''); })(node);
    let fenceLength = 3;
    for (const [run] of text.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, run.length + 1);
    const fence = '`'.repeat(fenceLength);
    return `\n\n${fence}\n${text}\n${fence}\n\n`;
  }
  if (['ul', 'ol'].includes(node.name)) {
    let itemNumber = 0;
    return '\n' + node.children.map((child) => {
      if (child.type !== 'element' || child.name !== 'li') return renderMarkdown(child, note, names, depth);
      itemNumber++;
      const value = child.children.map((part) => renderMarkdown(part, note, names, depth + 1)).join('').trim();
      return `${'  '.repeat(depth)}${node.name === 'ol' ? `${itemNumber}.` : '-'} ${value}\n`;
    }).join('') + '\n';
  }
  const content = node.children.map((child) => renderMarkdown(child, note, names, depth)).join('');
  if (node.name === 'a') {
    const url = safeUrl(node.attributes.href);
    return url ? `[${content}](<${url.replace(/[<>\s]/g, encodeURIComponent)}>)` : content;
  }
  if (/^h[1-6]$/.test(node.name)) return `\n\n${'#'.repeat(Number(node.name[1]))} ${content}\n\n`;
  if (['strong', 'b'].includes(node.name)) return `**${content}**`;
  if (['em', 'i'].includes(node.name)) return `*${content}*`;
  if (['s', 'del'].includes(node.name)) return `~~${content}~~`;
  if (node.name === 'br') return '  \n';
  if (node.name === 'hr') return '\n\n---\n\n';
  if (node.name === 'blockquote') return '\n\n' + content.trim().split('\n').map((line) => `> ${line}`).join('\n') + '\n\n';
  if (['div', 'p'].includes(node.name)) return `${content}\n\n`;
  return content;
}

function markdownNote(note, names) {
  let content = `# ${markdownText(note.title)}\n\n`;
  if (note.notebook) content += `Notebook: ${markdownText(note.notebook.name)}${note.notebook.stack ? ` / ${markdownText(note.notebook.stack)}` : ''}\n\n`;
  if (note.tags.length) content += `Tags: ${note.tags.map(markdownText).join(', ')}\n\n`;
  if (note.created) content += `Created: ${note.created}\n\n`;
  content += renderMarkdown(note.content.document, note, names).trim();
  if (note.attachments.length) content += '\n\n## Attachments\n\n' + note.attachments.map((a) => `- [${markdownText(a.filename || 'Attachment')}](../${names.get(a.sha256)})`).join('\n');
  if (note.warnings.length) content += '\n\n## Conversion notes\n\n' + note.warnings.map((w) => `- ${markdownText(w.detail)}`).join('\n');
  return `${content}\n`;
}

function archiveZip(directory, { manifest, notes }, format) {
  const zip = new yazl.ZipFile();
  zip.on('error', (error) => zip.outputStream.destroy(error));
  if (format === 'archive') {
    zip.addFile(path.join(directory, 'manifest.json'), 'manifest.json');
    for (const file of manifest.files) zip.addFile(path.join(directory, file.path), file.path);
  } else {
    const names = assetNames(notes);
    for (const note of notes) zip.addBuffer(Buffer.from(markdownNote(note, names)), `notes/${note.id}.md`);
    for (const [hash, filename] of names) zip.addFile(path.join(directory, 'assets', hash), filename);
    zip.addFile(path.join(directory, manifest.source.path), 'original.enex');
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'archive-manifest.json');
    zip.addBuffer(Buffer.from('Open the notes folder in a Markdown reader. Keep assets beside notes. Original ENEX is included for Evernote File > Import. Markdown is a reading projection; styles, encryption and structured Tasks may require the retained original. Review archive-manifest.json warnings.\n'), 'README.txt');
  }
  zip.end();
  return zip.outputStream;
}

function portableHtml(directory, { manifest, notes }) {
  let embeddedBytes = 0;
  function count(node, attachments) {
    if (node.type === 'attachment') {
      const attachment = attachments.get(node.attachmentId);
      if (attachment) embeddedBytes += 4 * Math.ceil(attachment.bytes / 3) + 64;
    }
    for (const child of node.children ?? []) count(child, attachments);
  }
  for (const note of notes) {
    count(note.content.document, new Map(note.attachments.map((a) => [a.id, a])));
    for (const attachment of note.attachments) embeddedBytes += 4 * Math.ceil(attachment.bytes / 3) + 64;
    embeddedBytes += Buffer.byteLength(JSON.stringify(note.content.document)) * 6;
  }
  if (embeddedBytes > 32 * 1024 * 1024) throw new Error('This notebook is too large for a single reading file. Download the archive ZIP or use the app reader instead.');
  const data = new Map();
  const resourceUrl = (attachment) => {
    if (!data.has(attachment.sha256)) data.set(attachment.sha256, fs.readFileSync(path.join(directory, attachment.path)).toString('base64'));
    const mime = imageTypes.has(attachment.mime) ? attachment.mime : 'application/octet-stream';
    return `data:${mime};base64,${data.get(attachment.sha256)}`;
  };
  const name = manifest.organization?.name || manifest.source.originalFilename;
  const navigation = notes.map((note) => `<li><a href="#${note.id}">${escapeHtml(note.title)}</a></li>`).join('');
  const pages = notes.map((note) => `<article id="${note.id}"><h2>${escapeHtml(note.title)}</h2><p class="meta">${note.tags.map(escapeHtml).join(' · ')}</p><div class="body">${renderHtml(note.content.document, note, resourceUrl)}</div>${note.attachments.length ? '<h3>Attachments</h3><ul>' + note.attachments.map((a) => `<li><a href="${escapeHtml(resourceUrl(a))}" download="${escapeHtml(a.filename || 'attachment')}">${escapeHtml(a.filename || 'Attachment')}</a></li>`).join('') + '</ul>' : ''}${note.warnings.length ? '<details><summary>Conversion notes</summary><ul>' + note.warnings.map((w) => `<li>${escapeHtml(w.detail)}</li>`).join('') + '</ul></details>' : ''}<a class="top" href="#top">Back to contents</a></article>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(name)} — reading copy</title><style>body{font:17px/1.65 system-ui,sans-serif;color:#23372f;background:#f8f7f2;max-width:850px;margin:auto;padding:24px}h1,h2{line-height:1.2;overflow-wrap:anywhere}a{color:#216749}article{margin:40px 0;padding:28px;background:white;border:1px solid #dce3dc;border-radius:14px;scroll-margin:20px}.meta,.notice,footer{color:#657368}img{max-width:100%;height:auto}pre{overflow:auto;background:#f3f5f0;padding:16px}table{display:block;overflow:auto;border-collapse:collapse}td,th{border:1px solid #bccabf;padding:8px}blockquote{border-left:3px solid #90ae98;margin-left:0;padding-left:20px}.top{display:block;margin-top:25px}li{overflow-wrap:anywhere}@media(max-width:500px){body{padding:16px}article{padding:18px}}</style></head><body id="top"><header><p>EVERNOTE ARCHIVE · READING COPY</p><h1>${escapeHtml(name)}</h1><p>${notes.length} notes. This copy can be read without the app. Keep the original archive for restoration; encrypted and unsupported content may require Evernote.</p></header><nav aria-label="Contents"><ol>${navigation}</ol></nav>${pages}<footer>Account completeness is unverified. Original organization is ${manifest.organization ? 'user-supplied' : 'unknown'}. This reading copy does not execute original note scripts or load remote images.</footer></body></html>`;
  if (Buffer.byteLength(html) > 32 * 1024 * 1024) throw new Error("This reading file exceeds 32 MiB. Use the archive ZIP or app reader instead.");
  return html;
}

module.exports = { loadArchive, archiveZip, portableHtml, markdownNote, assetNames, renderHtml };
