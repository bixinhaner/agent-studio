import { expect, it } from 'vitest';
import { CodexRunProjection } from './codex-execution-service.js';

it('persists one local file result card across reconnect without storing file contents', () => {
  const run=new CodexRunProjection();
  const event={type:'item.completed',raw:{item:{id:'write-1',type:'mcp_tool_call',server:'local_computer',tool:'local_write',arguments:{path:'result.txt',content:'private body'},result:{content:[{type:'text',text:JSON.stringify({ok:true,path:'/local/result.txt',content:'private body'})}]}}}};
  run.push(event);run.push(event);
  const parts=run.finalize().contentParts.filter(part=>part.type==='tool-call');
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatchObject({toolCallId:'write-1',toolName:'local_computer.local_write',result:{ok:true,path:'/local/result.txt'}});
  expect(JSON.stringify(parts)).not.toContain('private body');
  run.reset();expect(run.finalize().contentParts).toEqual([]);
});

it('persists failed local calls as incomplete outcomes', () => {
  const run=new CodexRunProjection();
  run.push({type:'item.completed',raw:{item:{id:'read-1',type:'mcp_tool_call',server:'local_computer',tool:'local_read',error:{message:'LOCAL_COMPUTER_OFFLINE'}}}});
  expect(run.finalize().contentParts.find(part=>part.type==='tool-call')).toMatchObject({isError:true,result:{ok:false,error:'LOCAL_COMPUTER_OFFLINE'}});
});
