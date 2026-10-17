'use strict';

/**
 * Find structural delimiters while respecting strings, escapes and comments.
 * @param {string} text Media/import parameters; no global state is accessed.
 * @param {number} start First UTF-16 offset to inspect.
 * @param {number} end Exclusive final offset.
 * @param {(character: string, index: number) => boolean} visit Delimiter visitor.
 * @returns {number} First accepted delimiter offset, or end.
 */
function delimiter(text, start, end, visit) {
  let quote = '', comment = false, braces = 0, depth = 0;
  for (let i = start; i < end; i++) {
    const character = text[i], next = text[i + 1];
    if (comment) {
      if (character === '*' && next === '/') { comment = false; i++; }
      continue;
    }
    if (character === '\\') { i++; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '/' && next === '*') { comment = true; i++; continue; }
    if (character === '{') { braces++; continue; }
    if (character === '}') { braces = Math.max(0, braces - 1); continue; }
    if (braces) continue;
    if (depth === 0 && visit(character, i)) return i;
    if (character === '(') depth++;
    else if (character === ')') depth = Math.max(0, depth - 1);
  }
  return end;
}

/**
 * Parse the media/import fragments consumed by Stylelint SCSS's spacing rules.
 * @param {string} input Original at-rule parameters; no globals are read.
 * @returns {{walk: (callback: (node: {type: string, value: string, sourceIndex: number}) => unknown) => object}} Traversable semantic fragments.
 */
function parse(input) {
  if (typeof input !== 'string') throw new TypeError('Media parameters must be a string');
  const nodes = [];
  const add = (type, start, end) => {
    while (start < end && /\s/.test(input[start])) start++;
    while (end > start && /\s/.test(input[end - 1])) end--;
    if (start < end) nodes.push({ type, value: input.slice(start, end), sourceIndex: start });
  };
  let cursor = 0;
  while (cursor < input.length) {
    const open = delimiter(input, cursor, input.length, character => character === '(');
    if (open === input.length) { add('keyword', cursor, open); break; }
    // A URL's entire argument is SassScript only in the cases selected by the rule.
    const prefix = input.slice(cursor, open);
    const url = /\burl$/i.exec(prefix);
    const close = delimiter(input, open + 1, input.length, character => character === ')');
    if (url) {
      add('keyword', cursor, cursor + url.index);
      add('url', open + 1, close);
    } else {
      add('keyword', cursor, open);
      const colon = delimiter(input, open + 1, close, character => character === ':');
      add('media-feature', open + 1, colon);
      if (colon < close) add('value', colon + 1, close);
    }
    cursor = close < input.length ? close + 1 : close;
  }
  const result = {
    walk(callback) {
      for (const node of nodes) if (callback(node) === false) break;
      return result;
    }
  };
  return result;
}

module.exports = parse;
