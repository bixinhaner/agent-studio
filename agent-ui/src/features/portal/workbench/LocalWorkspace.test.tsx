import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLocalBridgeDevices, localBridgeApi } from '../api';
import { useLocalWorkspace, type LocalSelection } from './LocalWorkspace';
vi.mock('../api', () => ({ fetchLocalBridgeDevices: vi.fn(), localBridgeApi: vi.fn() }));
const folder: LocalSelection = { id:'binding',root_id:'root',path:'/local/folder',label:'目录',device_id:'device',device_name:'电脑',status:'online' };
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState({}, '', '/'); vi.mocked(fetchLocalBridgeDevices).mockResolvedValue([{id:'device',name:'电脑',status:'online',roots:[{id:'root',path:'/local/folder',label:'目录'}]}]); vi.mocked(localBridgeApi).mockResolvedValue({binding:null}); });
describe('local task directory state', () => {
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
  it('offline connection preserves the selected directory', async () => {
    vi.mocked(fetchLocalBridgeDevices).mockResolvedValue([{id:'device',name:'电脑',status:'offline',roots:[]}]);
    vi.mocked(localBridgeApi).mockResolvedValue({binding:{...folder,thread_id:'task',status:'offline'}});
    const {result}=renderHook(()=>useLocalWorkspace('task',true)); await waitFor(()=>expect(result.current.selection?.root_id).toBe('root')); expect(result.current.offline).toBe(true);
  });
});
