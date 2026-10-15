import {test} from 'node:test';import assert from 'node:assert/strict';import {parseArguments,ArgumentError} from '../dist/args.js';
test('parses repeated options and separator',()=>{const args=parseArguments(['--tag=a','--tag','b','--count','-3','--','-text']);assert.deepEqual(args.namedArgs.tag,['a','b']);assert.equal(args.namedArgs.count,'-3');assert.deepEqual(args.positionalArgs,['-text']);});
test('rejects dangerous options without terminating',()=>{assert.throws(()=>parseArguments(['--__proto__=bad']),ArgumentError);});
