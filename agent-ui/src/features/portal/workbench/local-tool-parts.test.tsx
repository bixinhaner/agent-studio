import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { upsertLocalToolParts } from './local-tool-parts';
import { LocalToolCard } from './LocalToolCard';
import { LocalWorkspaceContext } from './LocalWorkspace';
import { localBridgeApi } from '../api';
import { PortalI18nProvider } from '../i18n';
vi.mock('../api', () => ({ localBridgeApi: vi.fn(), fetchLocalBridgeDevices: vi.fn() }));
afterEach(cleanup);
beforeEach(() => { window.localStorage.clear(); vi.clearAllMocks(); });

it('keeps one visible result card through start, completion and late replay, and opens the actual local file', async () => {
  const content: any[] = [];
  const started = { type:'tool-call',toolCallId:'write-1',toolName:'local_computer.local_write',args:{path:'result.txt'} };
  upsertLocalToolParts(content,[started]);
  upsertLocalToolParts(content,[{...started,result:{content:[{type:'text',text:JSON.stringify({ok:true,path:'/local/result.txt'})}]}}]);
  upsertLocalToolParts(content,[started]);
  expect(content).toHaveLength(1);
  vi.mocked(localBridgeApi).mockResolvedValue({ok:true});
  render(<LocalWorkspaceContext.Provider value={{selection:{thread_id:'task',device_name:'测试电脑'},offline:false} as any}><LocalToolCard {...content[0]} /></LocalWorkspaceContext.Provider>);
  expect(screen.getByText('Completed on 测试电脑: Save file')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Open on Computer'}));
  await waitFor(()=>expect(localBridgeApi).toHaveBeenCalledWith('/api/local-bridge/threads/task/open',{method:'POST',json:{path:'/local/result.txt'}}));
});

it('does not turn ordinary cloud tools into local cards', () => {
  const content:any[]=[];
  expect(upsertLocalToolParts(content,[{type:'tool-call',toolCallId:'web',toolName:'web.search'}])).toBe(false);
  expect(content).toEqual([]);
});

it('renders a cancelled call without a result instead of crashing', () => {
  render(<LocalToolCard toolName="local_computer.local_exec" status={{type:'incomplete'}} />);
  expect(screen.getByRole('status').textContent).toContain('The computer operation did not finish');
});

it('copies headless Linux result paths without requesting a desktop open', async () => {
  vi.mocked(localBridgeApi).mockClear();
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  render(<LocalWorkspaceContext.Provider value={{selection:{thread_id:'task',device_id:'linux',device_name:'Linux'},devices:[{id:'linux',platform:'linux-cli'}],offline:true} as any}><LocalToolCard toolName="local_computer.local_write" result={{ok:true,path:'/work/result.txt'}} /></LocalWorkspaceContext.Provider>);
  fireEvent.click(screen.getByRole('button',{name:'Copy Path'}));
  await waitFor(() => expect(copy).toHaveBeenCalledWith('/work/result.txt'));
  await screen.findByRole('button', { name: 'Copied' });
  expect(localBridgeApi).not.toHaveBeenCalled();
});

it.each(['en', 'zh-CN'] as const)('localizes the status and pending open feedback in %s', async locale => {
  vi.mocked(localBridgeApi).mockResolvedValue({ ok: false, pending: true });
  render(<PortalI18nProvider defaultLocale={locale} languageSwitcherEnabled={false}><LocalWorkspaceContext.Provider value={{selection:{thread_id:'task',device_name:'Laptop'},offline:false} as any}><LocalToolCard toolName="local_computer.local_write" status={{type:'complete'}} result={{ok:true,path:'/work/result.txt'}} /></LocalWorkspaceContext.Provider></PortalI18nProvider>);
  const en = locale === 'en';
  expect(screen.getByText(en ? 'Completed on Laptop: Save file' : '已在Laptop上保存文件')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: en ? 'Open on Computer' : '在电脑上打开' }));
  expect((await screen.findByRole('status')).textContent).toBe(en ? 'Your computer has not returned a result. Reconnect to check it.' : '电脑尚未返回结果，恢复连接后查看。');
});
