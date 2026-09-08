import { realpath, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
export type BridgeScope={userId:string;deviceId:string;roots:string[];sessionId:string};
export type BridgeRequest={id:string;scope:BridgeScope;op:'read'|'list'|'write';path:string;content?:string;expectedMtimeMs?:number};
export type BridgeResult={requestId:string;ok:true;result:unknown}|{requestId:string;ok:false;error:string};
export function request(op:BridgeRequest['op'], scope:BridgeScope, path:string, content?:string):BridgeRequest{return {id:randomUUID(),scope,op,path,content};}
export async function allowedPath(input:string, roots:string[]):Promise<string>{const p=resolve(input); let canonical:string; try { canonical=await realpath(p); } catch { throw new Error('BRIDGE_PATH_DENIED'); } for(const root of roots){let r:string; try { r=await realpath(root); } catch { continue; } const rel=relative(r,canonical); if(rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!rel.startsWith('/'))) return canonical;} throw new Error('BRIDGE_PATH_DENIED');}
export async function validateWrite(r:BridgeRequest):Promise<string>{if(r.op!=='write') throw new Error('BRIDGE_INVALID_OPERATION'); const p=await allowedPath(r.path,r.scope.roots); if(r.expectedMtimeMs!==undefined){const s=await stat(p); if(s.mtimeMs!==r.expectedMtimeMs) throw new Error('BRIDGE_CONFLICT');} if(typeof r.content!=='string'||Buffer.byteLength(r.content)>10*1024*1024) throw new Error('BRIDGE_PAYLOAD_INVALID'); return p;}
