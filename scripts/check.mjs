import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve('extension');
const manifest = JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
if(manifest.manifest_version!==3) throw new Error('Expected Manifest V3');
const files = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(item=>item.js)];
for (const file of files) await fs.access(path.join(root,file));
async function walk(directory) {
  for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const file = path.join(directory,entry.name);
    if(entry.isDirectory()) await walk(file);
    else if(file.endsWith('.js')) { const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'}); if(result.status)throw new Error(result.stderr); }
  }
}
await walk(root);
if (manifest.permissions.some(value=>['cookies','webRequest','tabs'].includes(value))) throw new Error('Unexpected broad permission');
if (manifest.host_permissions.some(value=>value.includes('*://*')||value.includes('https://*'))) throw new Error('Unexpected all-site host permission');
console.log('Manifest, packaged paths, JavaScript syntax and permission boundaries passed.');
