import { readFile, readdir, writeFile } from 'node:fs/promises';
import { allowedPath, validateWrite, type BridgeRequest } from './protocol.js';
const completed = new Map<string, unknown>();
export async function execute(r:BridgeRequest){
  if (!r.id || !r.scope?.userId || !r.scope.deviceId || !r.scope.sessionId || !Array.isArray(r.scope.roots) || r.scope.roots.length===0) throw new Error('BRIDGE_SCOPE_REQUIRED');
  if (completed.has(r.id)) return completed.get(r.id);
  let result: unknown;
  if(r.op==='read'){const p=await allowedPath(r.path,r.scope.roots); result={path:p,content:await readFile(p,'utf8')}}
  else if(r.op==='list'){const p=await allowedPath(r.path,r.scope.roots); result={path:p,entries:await readdir(p)}}
  else {const p=await validateWrite(r); await writeFile(p,r.content!,{encoding:'utf8'}); result={path:p,written:true};}
  completed.set(r.id,result); if(completed.size>1000) completed.delete(completed.keys().next().value!); return result;
}
