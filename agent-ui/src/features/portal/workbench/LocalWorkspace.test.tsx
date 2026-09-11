import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLocalBridgeDevices, localBridgeApi, revokeLocalBridgeDevice } from '../api';
import { PortalI18nProvider } from '../i18n';
import { LocalWorkspaceContext, LocalWorkspaceDialogs, useLocalWorkspace, type LocalSelection } from './LocalWorkspace';
vi.mock('../api', () => ({ fetchLocalBridgeDevices: vi.fn(), localBridgeApi: vi.fn(), revokeLocalBridgeDevice: vi.fn() }));
const folder: LocalSelection = { id:'binding',root_id:'root',path:'/local/folder',label:'目录',device_id:'device',device_name:'电脑',status:'online' };
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState({}, '', '/'); vi.mocked(fetchLocalBridgeDevices).mockResolvedValue([{id:'device',name:'电脑',status:'online',roots:[{id:'root',path:'/local/folder',label:'目录'}]}]); vi.mocked(localBridgeApi).mockResolvedValue({binding:null}); });
describe('local task directory state', () => {
  it('Linux mode generates a command and automatically selects the completed connection folder', async () => {
    let completed = false;
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    vi.mocked(localBridgeApi).mockImplementation(async (url, init) => {
      if (url === '/api/local-bridge/connections') return { id: 'linux-connection', code: 'ABCDEF1234', launch_url: 'agent-studio://connect?code=ABCDEF1234' } as any;
      if (url.endsWith('/connections/linux-connection')) return { status: completed ? 'completed' : 'pending', selection: completed ? folder : null } as any;
      return { binding: init?.method === 'PUT' ? folder : null } as any;
    });
    function View() { const local = useLocalWorkspace('task', true); return <LocalWorkspaceContext.Provider value={{ ...local, showEntry: true, running: false }}><button onClick={local.begin}>连接测试</button><span data-testid="selected">{local.selection?.root_id}</span><LocalWorkspaceDialogs /></LocalWorkspaceContext.Provider>; }
    render(<PortalI18nProvider defaultLocale="zh-CN" languageSwitcherEnabled={false}><View /></PortalI18nProvider>); fireEvent.click(screen.getByText('连接测试'));
    fireEvent.click(screen.getByRole('button', { name: 'Linux 命令行' }));
    await screen.findByLabelText('Linux 连接命令');
    fireEvent.click(screen.getByRole('button', { name: '复制连接命令' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(expect.stringContaining('bash -s -- --code ABCDEF1234')));
    expect(window.location.protocol).not.toBe('agent-studio:');
    completed = true;
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('root'), { timeout: 4000 });
    expect(localBridgeApi).toHaveBeenCalledWith('/api/local-bridge/threads/task/binding', { method: 'PUT', json: { root_id: 'root' } });
  });
  it('selects a draft without an API task mutation and loads each existing task separately', async () => {
    const {result,rerender}=renderHook(({id})=>useLocalWorkspace(id,true),{initialProps:{id:''}});
    await act(async()=>{await result.current.select(folder);});
    expect(result.current.selectionRef.current?.root_id).toBe('root'); expect(localBridgeApi).not.toHaveBeenCalled();
    rerender({id:'task-2'}); await waitFor(()=>expect(result.current.busy).toBe(false));
    expect(localBridgeApi).toHaveBeenCalledWith('/api/local-bridge/threads/task-2/binding'); expect(result.current.selection).toBeNull();
  });
  it('a delayed selection response cannot change the next task', async () => {
    let resolveMutation: (value: any)=>void = ()=>{};
    vi.mocked(localBridgeApi).mockImplementation(async (_url, init) => init?.method==='PUT' ? new Promise(resolve=>{resolveMutation=resolve;}) : {binding:null} as any);
    const {result,rerender}=renderHook(({id})=>useLocalWorkspace(id,true),{initialProps:{id:'old'}});
    await waitFor(()=>expect(result.current.busy).toBe(false));
    let pending: Promise<void>; act(()=>{pending=result.current.select(folder);});
    rerender({id:'next'}); await waitFor(()=>expect(result.current.busy).toBe(false));
    await act(async()=>{resolveMutation({binding:{...folder,thread_id:'old'}});await pending;}); expect(result.current.selection).toBeNull();
  });
  it('failed binding lookup blocks sending until it can be retried', async () => {
    vi.mocked(localBridgeApi).mockRejectedValueOnce(new Error('network'));
    const {result}=renderHook(()=>useLocalWorkspace('task',true));
    await waitFor(()=>expect(result.current.bindingLoadFailed).toBe(true)); act(()=>result.current.reloadBinding());
    await waitFor(()=>expect(result.current.busy).toBe(false)); expect(result.current.bindingLoadFailed).toBe(false);
  });
  it('a delayed binding lookup does not overwrite a completed folder selection', async () => {
    let resolveLookup: (value: any) => void = () => {};
    vi.mocked(localBridgeApi).mockImplementation(async (_url, init) => init?.method === 'PUT' ? { binding: folder } as any : new Promise(resolve => { resolveLookup = resolve; }));
    const { result } = renderHook(() => useLocalWorkspace('task', true));
    await act(async () => { await result.current.select(folder); });
    await act(async () => { resolveLookup({ binding: null }); });
    expect(result.current.selection?.root_id).toBe('root');
  });
  it('offline connection preserves the selected directory', async () => {
    vi.mocked(fetchLocalBridgeDevices).mockResolvedValue([{id:'device',name:'电脑',status:'offline',roots:[]}]);
    vi.mocked(localBridgeApi).mockResolvedValue({binding:{...folder,thread_id:'task',status:'offline'}});
    const {result}=renderHook(()=>useLocalWorkspace('task',true)); await waitFor(()=>expect(result.current.selection?.root_id).toBe('root')); expect(result.current.offline).toBe(true);
  });
  it('removing the current computer blocks local work without silently selecting cloud, including after stale refreshes', async () => {
    const { result } = renderHook(() => useLocalWorkspace('', true));
    await act(async () => { await result.current.select(folder); });
    await act(async () => { await result.current.removeDevice('device'); });
    expect(revokeLocalBridgeDevice).toHaveBeenCalledWith('device');
    expect(result.current.selection?.root_id).toBe('root');
    expect(result.current.offline).toBe(true);
    expect(result.current.removedSelection).toBe(true);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.devices).toEqual([]);
    expect(result.current.offline).toBe(true);
    await act(async () => { await result.current.select(null); });
    expect(result.current.removedSelection).toBe(false);
    expect(result.current.selection).toBeNull();
  });
});
