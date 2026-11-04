import {build} from 'esbuild';import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('worker',{recursive:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
const result=await build({entryPoints:['src/worker.ts'],bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:'worker/index.js',metafile:true,legalComments:'inline'});
await writeFile('dist/server/index.js',await readFile('worker/index.js'));
const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8'));
if(manifest.d1!=='DB'||manifest.r2!==null)throw new Error('Expected private D1 only');
await writeFile('dist/.openai/hosting.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile('docs/bundle-metafile.json',JSON.stringify(result.metafile,null,2)+'\n');
// User approved a separate owner-private diagnostic deployment; preserve its identity.
console.log('Built private health Dashboard ESM with D1 and read-only MCP.');
