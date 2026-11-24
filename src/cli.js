#!/usr/bin/env node
'use strict';

const { parseArgs } = require('node:util');
const { exportArchive, verifyArchive } = require('./index');

const help = `Evernote Exporter — offline ENEX archive tool

Export:
  node src/cli.js export --input <notes.enex> --output <new-directory>
    [--notebook <name>] [--stack <name>]

Verify:
  node src/cli.js verify --archive <directory>

Offline Windows cache backup (Node.js 22.13+):
  node src/cli.js export-cache --input <snapshot-folder> --output <new-directory>
  Exit 2: local notes exported, full account completeness unverified.
  Exit 1: missing/unsupported/invalid content. Keep the original backup.

The output's parent must exist; existing output directories are never overwritten.
Notebook and stack assignments apply to every note in this ENEX.
Exit 0: command succeeded. Exit 1: failed. Success does not establish account completeness.
`;

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      input: { type: 'string' }, output: { type: 'string' }, notebook: { type: 'string' },
      stack: { type: 'string' }, archive: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    }, allowPositionals: true, strict: true,
  });
  if (values.help || (!positionals.length && !Object.keys(values).length)) {
    process.stdout.write(help);
    return;
  }
  if (positionals.length !== 1 || !['export', 'verify', 'export-cache'].includes(positionals[0])) {
    throw new Error('Expected export or verify. Use --help for usage.');
  }
  const command = positionals[0];
  const allowed = command === 'export' ? ['input', 'output', 'notebook', 'stack'] : command === 'export-cache' ? ['input', 'output'] : ['archive'];
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.includes(key)) throw new Error(`--${key} is not valid for ${command}`);
    if (!value.trim()) throw new Error(`--${key} cannot be empty`);
  }
  if (command === 'verify' && !values.archive) throw new Error('--archive is required');
  if (command === 'export-cache') {
    const result = await require('./acquire/cache').exportCache(values);
    // Counts only: note IDs, paths and account metadata stay in the private report.
    process.stdout.write(JSON.stringify({ status: result.status, notesInDatabase: result.notesInDatabase, notesExported: result.notesExported, attachmentsExported: result.attachmentsExported, issues: result.issues.length, accountCoverage: result.accountCoverage }, null, 2) + '\n');
    process.exitCode = result.status === 'copied-graph-notes-exported' ? 2 : 1;
    return;
  }
  const result = command === 'export' ? await exportArchive(values) : await verifyArchive(values.archive);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
