import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchIndex, parseSearchQuery, highlightMatches } from '../dist/index.js';
test('modular search defensively clones documents and supports query helpers',()=>{
 const index=createSearchIndex();const doc={id:'a',text:'Vue and React', nested:{score:1}};
 index.add(doc);doc.nested.score=10;assert.equal(index.get('a').nested.score,1);
 index.get('a').nested.score=100;assert.equal(index.get('a').nested.score,1);
 const result=index.search('Vue');result[0].document.nested.score=200;assert.equal(index.get('a').nested.score,1);
 assert.deepEqual(parseSearchQuery('React react Vue',['vue']),['react']);
 assert.equal(highlightMatches('<React>', ['React']),'&lt;<mark>React</mark>&gt;');
});
