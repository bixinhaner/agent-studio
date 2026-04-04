import { render, screen, fireEvent } from '@testing-library/react';
import { UsersView } from '../UsersView';
import { fetchAdminUsers } from '../api';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api');

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
    expect(screen.getByPlaceholderText(/搜索/i)).toBeTruthy();
    
    // Wait for user to be loaded
    const userRow = await screen.findByText('John Doe');
    expect(userRow).toBeTruthy();
  });

  it('filters users by text', async () => {
    render(<UsersView />);
    const searchInput = screen.getByPlaceholderText(/搜索/i);
    
    fireEvent.change(searchInput, { target: { value: 'John' } });
    expect(await screen.findByText('John Doe')).toBeTruthy();
  });
});
