import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: vi.fn()
}));

import { api } from '../../lib/api';
import {
  createIntegrationInstance,
  fetchIntegrationBindings,
  fetchIntegrationDetail,
  fetchIntegrationInstances,
  fetchIntegrationPolicies,
  putIntegrationBindings,
  putIntegrationPolicies,
  updateIntegrationInstance,
  validateIntegrationInstance
} from './api';

const mockedApi = vi.mocked(api);

describe('integration center api helpers', () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it('calls the expected integration center endpoints', async () => {
    mockedApi
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ instance: { id: 'int-1' } })
      .mockResolvedValueOnce({ instance: { id: 'int-1' } })
      .mockResolvedValueOnce({ instance: { id: 'int-1' } })
      .mockResolvedValueOnce({ validation: { id: 'validation-1' } })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });

    await fetchIntegrationInstances('zendesk');
    await createIntegrationInstance({ type: 'zendesk', slug: 'zd-main', name: 'Zendesk Main' });
    await fetchIntegrationDetail('int-1');
    await updateIntegrationInstance('int-1', { name: 'Zendesk Main Updated' });
    await validateIntegrationInstance('int-1');
    await fetchIntegrationBindings('int-1');
    await putIntegrationBindings('int-1', [{ targetType: 'workspace', targetId: 'workspace-1', bindingType: 'fallback' }]);
    await fetchIntegrationPolicies('int-1');
    await putIntegrationPolicies('int-1', [{ subjectType: 'role', subjectId: 'admin', effect: 'allow' }]);

    expect(mockedApi).toHaveBeenNthCalledWith(1, '/api/admin/integrations?type=zendesk');
    expect(mockedApi).toHaveBeenNthCalledWith(2, '/api/admin/integrations', expect.objectContaining({ method: 'POST' }));
    expect(mockedApi).toHaveBeenNthCalledWith(3, '/api/admin/integrations/int-1');
    expect(mockedApi).toHaveBeenNthCalledWith(4, '/api/admin/integrations/int-1', expect.objectContaining({ method: 'PATCH' }));
    expect(mockedApi).toHaveBeenNthCalledWith(5, '/api/admin/integrations/int-1/validate', expect.objectContaining({ method: 'POST' }));
    expect(mockedApi).toHaveBeenNthCalledWith(6, '/api/admin/integrations/int-1/bindings');
    expect(mockedApi).toHaveBeenNthCalledWith(7, '/api/admin/integrations/int-1/bindings', expect.objectContaining({ method: 'PUT' }));
    expect(mockedApi).toHaveBeenNthCalledWith(8, '/api/admin/integrations/int-1/policies');
    expect(mockedApi).toHaveBeenNthCalledWith(9, '/api/admin/integrations/int-1/policies', expect.objectContaining({ method: 'PUT' }));
  });
});
