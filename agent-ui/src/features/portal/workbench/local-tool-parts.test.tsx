import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { upsertLocalToolParts } from './local-tool-parts';
import { LocalToolCard } from './LocalToolCard';
import { LocalWorkspaceContext } from './LocalWorkspace';
import { localBridgeApi } from '../api';
vi.mock('../api', () => ({ localBridgeApi: vi.fn(), fetchLocalBridgeDevices: vi.fn() }));
afterEach(cleanup);

it('keeps one visible result card through start, completion and late replay, and opens the actual local file', async () => {
  const content: any[] = [];
  const started = { type:'tool-call',toolCallId:'write-1',toolName:'local_computer.local_write',args:{path:'result.txt'} };
  upsertLocalToolParts(content,[started]);
  upsertLocalToolParts(content,[{...started,result:{content:[{type:'text',text:JSON.stringify({ok:true,path:'/local/result.txt'})}]}}]);
  upsertLocalToolParts(content,[started]);
  expect(content).toHaveLength(1);
  vi.mocked(localBridgeApi).mockResolvedValue({ok:true});
  render(<LocalWorkspaceContext.Provider value={{selection:{thread_id:'task',device_name:'测试电脑'},offline:false} as any}><LocalToolCard {...content[0]} /></LocalWorkspaceContext.Provider>);
  expect(screen.getByText('已在测试电脑上保存文件')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'在电脑上打开'}));
  await waitFor(()=>expect(localBridgeApi).toHaveBeenCalledWith('/api/local-bridge/threads/task/open',{method:'POST',json:{path:'/local/result.txt'}}));
});

it('does not turn ordinary cloud tools into local cards', () => {
  const content:any[]=[];
  expect(upsertLocalToolParts(content,[{type:'tool-call',toolCallId:'web',toolName:'web.search'}])).toBe(false);
  expect(content).toEqual([]);
});

it('renders a cancelled call without a result instead of crashing', () => {
  render(<LocalToolCard toolName="local_computer.local_exec" status={{type:'incomplete'}} />);
  expect(screen.getByRole('status').textContent).toContain('电脑操作未完成');
});

it('copies headless Linux result paths without requesting a desktop open', async () => {
  vi.mocked(localBridgeApi).mockClear();
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  render(<LocalWorkspaceContext.Provider value={{selection:{thread_id:'task',device_id:'linux',device_name:'Linux'},devices:[{id:'linux',platform:'linux-cli'}],offline:true} as any}><LocalToolCard toolName="local_computer.local_write" result={{ok:true,path:'/work/result.txt'}} /></LocalWorkspaceContext.Provider>);
  fireEvent.click(screen.getByRole('button',{name:'复制路径'}));
  await waitFor(() => expect(copy).toHaveBeenCalledWith('/work/result.txt'));
  expect(localBridgeApi).not.toHaveBeenCalled();
});
