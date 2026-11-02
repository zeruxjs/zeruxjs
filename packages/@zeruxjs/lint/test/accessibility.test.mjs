import test from 'node:test';import assert from 'node:assert/strict';
import { Linter } from 'eslint';import {createPackageConfig} from '@zeruxjs/lint/presets';
const config=createPackageConfig({environment:'browser'});
const check=source=>new Linter().verify(source,config,{filename:'component.tsx'}).filter(item=>item.ruleId?.startsWith('zerux/a11y-'));
test('label contracts target known helper/dialog roles and leave native text/custom components alone',()=>{
 for(const source of [`import{applyLabelledComponentProps as apply}from'@zeruxjs/accessibility';apply(node,{});`, `const x=<div role="dialog"/>;`, `const x=<section role="alertdialog" aria-label=" "/>;`])assert.ok(check(source).some(item=>item.ruleId==='zerux/a11y-required-label'));
 for(const source of [`const x=<button>Save</button>;`,`const x=<label>Name<input/></label>;`,`const x=<CustomDialog/>;`,`const x=<div role="dialog" aria-labelledby={title}/>;`,`const x=<div {...props} role="dialog"/>;`,`function applyLabelledComponentProps(){};applyLabelledComponentProps(node,{});`,`const x=<div role="dialog" title="Notice"/>;`])assert.deepEqual(check(source),[],source);
});
test('ARIA checks prove malformed relationships/duplicate static IDs, without guessing external target existence',()=>{
 for(const source of [`const x=<div aria-controls=""/>;`,`const x=<div id="self" aria-activedescendant="self"/>;`,`const x=<div><span id="dup"/><span id="dup"/></div>;`,`const x=<button tabIndex={2}>Save</button>;`])assert.ok(check(source).some(item=>item.ruleId==='zerux/a11y-relationships'),source);
 for(const source of [`const x=<div aria-labelledby="external-title"/>;`,`const x=<div><span id="a"/>{condition&&<span id="a"/>}</div>;`,`const x=<button tabIndex={-1}>Save</button>;`,`const a=<div id="same"/>;const b=<div id="same"/>;`])assert.deepEqual(check(source),[],source);
 const source='const x=<div role="dialog"/>;';const fixed=new Linter().verifyAndFix(source,config,{filename:'component.tsx'});assert.equal(fixed.output,source);
});
