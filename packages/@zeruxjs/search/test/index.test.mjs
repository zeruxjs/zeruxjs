import test from 'node:test';
import assert from 'node:assert/strict';
import {SearchIndex, tokenize} from '../dist/index.js';
test('index, rank, update, remove and restore', () => {
  const index = new SearchIndex({ fields: ['text', 'title'], weights: {title:4}, stopWords:['the'] });
  index.addMany([{id:'a',title:'Alpha',text:'the green apple'}, {id:'b',title:'Beta',text:'green pear'}]);
  assert.deepEqual(tokenize('Café 123'),['café','123']);
  assert.equal(index.search('green').length,2);
  assert.deepEqual(index.search('green apple',{mode:'all'}).map(x=>x.document.id),['a']);
  assert.deepEqual(index.search('alph',{prefix:true}).map(x=>x.document.id),['a']);
  assert.ok(index.suggest('gre').includes('green'));
  const snapshot=index.snapshot();index.clear();index.load(snapshot);
  assert.equal(index.size,2);
  index.update({id:'a',title:'Alpha',text:'blue sky'});
  assert.equal(index.search('apple').length,0);
  assert.equal(index.remove('b'),true);
  assert.equal(index.search('pear').length,0);
});
test('pagination and invalid state', () => {
 const index = new SearchIndex();
 assert.throws(()=>index.search('test',{limit:-1}), /non-negative/);
 assert.throws(()=>index.load({version:2,documents:[]}),/Unsupported/);
});
