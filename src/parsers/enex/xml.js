'use strict';

const { SaxesParser } = require('saxes');
const { decodeHTMLStrict } = require('entities');

function xmlParser() {
  const parser = new SaxesParser();
  parser.on('doctype', (value) => {
    if (value.includes('[')) throw new Error('DTD internal subsets are not supported');
  });
  parser.on('xmldecl', ({ encoding }) => {
    if (encoding && !/^utf-8$/i.test(encoding)) {
      throw new Error('Only UTF-8 XML is supported');
    }
  });
  return parser;
}

function element(tag) {
  return { name: tag.name, attributes: { ...tag.attributes }, children: [] };
}

function addText(node, text) {
  const last = node.children.length - 1;
  if (typeof node.children[last] === 'string') node.children[last] += text;
  else node.children.push(text);
}

function parseXml(text) {
  const parser = xmlParser();
  // Resolve known named ENML characters locally, without loading a DTD. Let
  // the XML parser decide where references apply (never rewrite CDATA).
  for (const [reference, name] of text.matchAll(/&([A-Za-z][A-Za-z0-9]+);/g)) {
    const value = decodeHTMLStrict(reference);
    if (value !== reference) parser.ENTITIES[name] = value;
  }
  const stack = [];
  let root;
  parser.on('opentag', (tag) => {
    if (stack.length >= 128) throw new Error('XML nesting exceeds 128 levels');
    const node = element(tag);
    if (stack.length) stack.at(-1).children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on('closetag', () => stack.pop());
  const textHandler = (value) => {
    if (stack.length) addText(stack.at(-1), value);
  };
  parser.on('text', textHandler);
  parser.on('cdata', textHandler);
  parser.write(text).close();
  return root;
}

function children(node, name) {
  return node.children.filter((child) => typeof child !== 'string' && child.name === name);
}

function textOf(node) {
  if (!node) return null;
  return node.children.map((child) => typeof child === 'string' ? child : textOf(child)).join('');
}

function single(node, name, required = false) {
  const matches = children(node, name);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    throw new Error(`Expected ${required ? 'one' : 'at most one'} ${name} in ${node.name}`);
  }
  return matches[0];
}

module.exports = { xmlParser, element, addText, parseXml, children, textOf, single };
