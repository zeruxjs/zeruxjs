const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
writeFileSync(join(__dirname,'../dist/browser/package.json'),'{"type":"module"}\n');
