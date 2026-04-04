import { render, screen, fireEvent } from '@testing-library/react';
import { UsersView } from '../UsersView';
import { fetchAdminUsers } from '../api';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

vi.mock('../api');

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe('UsersView', () => {
  beforeEach(() => {
    (fetchAdminUsers as any).mockResolvedValue({
      users: [
        {
          id: '1',
          synced: { displayName: 'John Doe', email: 'john@example.com', dingtalkUserId: '', departmentIds: [] },
          local: { role: 'employee', manualDisabled: false, adminNote: null },
          effective: { status: 'active', lastSyncedAt: new Date().toISOString() },
          assignedRoles: []
        }
      ]
    });
  });

  it('renders the users list', async () => {
    render(<UsersView />);
    expect(screen.getAllByPlaceholderText(/搜索/i).length).toBeGreaterThan(0);
    
    // Wait for user to be loaded
    const userRow = await screen.findByText('John Doe');
    expect(userRow).toBeTruthy();
  });

  it('filters users by text', async () => {
    render(<UsersView />);
    const searchInputs = screen.getAllByPlaceholderText(/搜索/i);
    const searchInput = searchInputs[0];
    
    fireEvent.change(searchInput, { target: { value: 'John' } });
    expect(await screen.findByText('John Doe')).toBeTruthy();
  });
});
