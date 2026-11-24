'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;

async function main() {
  const output = path.join(root, 'dist', `Evernote-Archive-${version}-Windows.zip`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (fs.existsSync(output)) throw new Error(`Release already exists: ${output}`);
  const files = [];
  function include(relative) {
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Refusing linked release input: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) include(`${relative}/${name}`);
    } else if (stat.isFile() && !relative.endsWith('/.gitkeep')) files.push({ full, name: relative });
  }
  for (const item of ['src', 'scripts', 'tests', 'Start Evernote Archive.cmd', 'Start on iPhone.cmd', 'Backup Windows Evernote.cmd', 'Export Windows Backup.cmd', 'package.json', 'package-lock.json', 'README.md', 'START HERE.md', 'docs/user-guide.md', 'docs/windows-backup.md', 'docs/source-safety.md', 'docs/archive-format.md']) include(item);
  files.push({ full: path.join(root, 'tests/fixtures/sample.enex'), name: 'examples/sample.enex' });
  const zip = new yazl.ZipFile();
  zip.on('error', (error) => zip.outputStream.destroy(error));
  const receipt = [];
  for (const file of files) {
    const bytes = fs.readFileSync(file.full);
    const hash = createHash('sha256').update(bytes).digest('hex');
    receipt.push(`${hash}  ${file.name}`);
    zip.addBuffer(bytes, file.name);
  }
  zip.addBuffer(Buffer.from(receipt.join('\n') + '\n'), 'CONTENTS.sha256');
  const done = pipeline(zip.outputStream, fs.createWriteStream(output, { flags: 'wx' }));
  zip.end();
  await done;
  const hash = createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(`${output}.sha256`, `${hash}  ${path.basename(output)}\n`, { flag: 'wx' });
  process.stdout.write(`${output}\n${files.length} files; SHA-256 ${hash}\n`);
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
