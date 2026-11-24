'use strict';

const { createReadStream } = require('node:fs');
const { xmlParser, element, addText } = require('./xml');

// A whole export is streamed; a single note is held in memory for conversion.
async function* readEnex(filename, metadata) {
  const parser = xmlParser();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const stack = [];
  const ready = [];
  let noteStart = null;
  parser.on('opentag', (tag) => {
    if (stack.length >= 128) throw new Error('XML nesting exceeds 128 levels');
    if (stack.length === 0 && tag.name !== 'en-export') throw new Error('Expected en-export root');
    if (stack.length === 1 && tag.name !== 'note') throw new Error(`Unsupported export element: ${tag.name}`);
    const node = element(tag);
    if (stack.length > 1) stack.at(-1).children.push(node);
    if (stack.length === 0) metadata.attributes = node.attributes;
    if (stack.length === 1) noteStart = parser.position;
    stack.push(node);
  });
  parser.on('closetag', () => {
    const node = stack.pop();
    if (stack.length === 1) {
      if (parser.position - noteStart > 128 * 1024 * 1024) {
        throw new Error('A note exceeds the 128 MiB XML character limit');
      }
      ready.push(node);
      noteStart = null;
    }
  });
  const textHandler = (text) => {
    if (stack.length > 1) addText(stack.at(-1), text);
    else if (text.trim()) throw new Error('Unexpected text outside a note');
  };
  parser.on('text', textHandler);
  parser.on('cdata', textHandler);
  for await (const chunk of createReadStream(filename, { highWaterMark: 64 * 1024 })) {
    parser.write(decoder.decode(chunk, { stream: true }));
    if (noteStart !== null && parser.position - noteStart > 128 * 1024 * 1024) {
      throw new Error('A note exceeds the 128 MiB XML character limit');
    }
    while (ready.length) yield ready.shift();
  }
  parser.write(decoder.decode()).close();
  while (ready.length) yield ready.shift();
}

module.exports = { readEnex };
