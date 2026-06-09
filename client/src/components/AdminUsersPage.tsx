import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Moon, RefreshCw, Save, Shield, Sun, UserCog } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authClient } from '../services/authClient';
import { UnitStatus, User, UserRole } from '../types/auth';
import { APP_NAME } from '../constants/branding';

const unitStatuses: UnitStatus[] = ['Available', 'Dispatched', 'En Route', 'On Scene', 'Transporting', 'Traffic Stop'];

export const AdminUsersPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('cad_theme') === 'dark' ? 'dark' : 'light'
  );
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [form, setForm] = useState({
    name: '',
    role: UserRole.VIEWER,
    badge: '',
    unitNumber: '',
    cadUnitNumber: '',
    status: 'Available' as UnitStatus,
    group: '',
    district: '',
    active: true
  });

  const loadUsers = useCallback(async () => {
    try {
      const response = await authClient.getUsers();
      setUsers(response);
      setSelectedUserId((current) => current || response[0]?.id || '');
      setMessage('');
    } catch {
      setMessage('Unable to load users.');
    }
  }, []);

  useEffect(() => {
    if (hasPermission('manage_users')) {
      loadUsers();
    }
  }, [hasPermission, loadUsers]);

  useEffect(() => {
    localStorage.setItem('cad_theme', theme);
  }, [theme]);

  const selectedUser = users.find((item) => item.id === selectedUserId) || null;
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((item) =>
      [item.name, item.email, item.role, item.badge, item.unitNumber, item.cadUnitNumber, item.group, item.district]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [search, users]);

  useEffect(() => {
    if (!selectedUser) return;
    setForm({
      name: selectedUser.name,
      role: selectedUser.role,
      badge: selectedUser.badge || '',
      unitNumber: selectedUser.unitNumber || '',
      cadUnitNumber: selectedUser.cadUnitNumber || '',
      status: selectedUser.status || 'Available',
      group: selectedUser.group || '',
      district: selectedUser.district || '',
      active: selectedUser.active
    });
    setResetPassword('');
  }, [selectedUser]);

  const saveUser = async () => {
    if (!selectedUser) return;
    try {
      const updated = await authClient.updateUser(selectedUser.id, {
        name: form.name,
        role: form.role,
        badge: form.badge || null,
        unitNumber: form.unitNumber || null,
        cadUnitNumber: form.cadUnitNumber || null,
        status: form.status || null,
        group: form.group || null,
        district: form.district || null,
        active: form.active
      });
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMessage('User updated.');
    } catch {
      setMessage('Unable to update user.');
    }
  };

  const resetUserPassword = async () => {
    if (!selectedUser) return;
    if (resetPassword.length < 12) {
      setMessage('Password must be at least 12 characters.');
      return;
    }
    try {
      await authClient.resetUserPassword(selectedUser.id, { newPassword: resetPassword });
      setResetPassword('');
      setMessage('Password reset. Existing sessions were revoked.');
    } catch {
      setMessage('Unable to reset password.');
    }
  };

  if (!hasPermission('manage_users')) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className={`flex min-h-screen flex-col ${theme === 'dark' ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-100 text-cad-ink'}`}>
      <header className="flex min-h-16 items-center justify-between border-b border-slate-800 bg-cad-navy px-4 text-white">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="rounded-md border border-white/15 bg-white/10 p-2 hover:bg-white/20" aria-label="Back to dispatch">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-semibold">{APP_NAME} Users</h1>
            <p className="text-xs text-slate-300">Admin controls for access and unit metadata</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
            className="rounded-md border border-white/15 bg-white/10 p-2 transition hover:bg-white/20"
            aria-label="Toggle light dark mode"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button type="button" onClick={loadUsers} className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20">
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[320px_1fr]">
        <aside className="flex min-h-[70vh] flex-col overflow-hidden rounded-lg border border-cad-line bg-white shadow-control dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-cad-line p-3 dark:border-slate-700">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users" className="w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredUsers.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedUserId(item.id)} className={`w-full border-b border-slate-100 px-3 py-3 text-left text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${selectedUserId === item.id ? 'bg-blue-50 dark:bg-blue-950/50' : ''}`}>
                <span className="block truncate font-bold">{item.name}</span>
                <span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">{item.email}</span>
                <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{item.role}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="rounded-lg border border-cad-line bg-white p-4 shadow-control dark:border-slate-700 dark:bg-slate-900">
          {selectedUser ? (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-cad-line pb-4 dark:border-slate-700">
                <div>
                  <h2 className="text-lg font-bold">{selectedUser.name}</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{selectedUser.email}</p>
                </div>
                <label className="inline-flex items-center gap-2 rounded-full border border-cad-line px-3 py-1.5 text-sm font-semibold dark:border-slate-700">
                  <input type="checkbox" checked={form.active} onChange={(event) => setForm((value) => ({ ...value, active: event.target.checked }))} />
                  Active
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} placeholder="Name" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <select value={form.role} onChange={(event) => setForm((value) => ({ ...value, role: event.target.value as UserRole }))} className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                  {Object.values(UserRole).map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <input value={form.badge} onChange={(event) => setForm((value) => ({ ...value, badge: event.target.value }))} placeholder="Badge" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <input value={form.unitNumber} onChange={(event) => setForm((value) => ({ ...value, unitNumber: event.target.value }))} placeholder="Unit number" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <input value={form.cadUnitNumber} onChange={(event) => setForm((value) => ({ ...value, cadUnitNumber: event.target.value }))} placeholder="CAD unit number" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <select value={form.status} onChange={(event) => setForm((value) => ({ ...value, status: event.target.value as UnitStatus }))} className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                  {unitStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <input value={form.group} onChange={(event) => setForm((value) => ({ ...value, group: event.target.value }))} placeholder="Group" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <input value={form.district} onChange={(event) => setForm((value) => ({ ...value, district: event.target.value }))} placeholder="District" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </div>

              <div className="mt-5 rounded-md border border-cad-line p-4 dark:border-slate-700">
                <h3 className="flex items-center gap-2 text-sm font-bold"><Shield size={16} /> Reset Password</h3>
                <div className="mt-3 flex max-w-xl gap-2">
                  <input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="New password" className="min-w-0 flex-1 rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  <button type="button" onClick={resetUserPassword} className="rounded-md border border-cad-line px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:text-slate-200">Reset</button>
                </div>
              </div>

              {message && <p className="mt-4 text-sm font-semibold text-slate-600 dark:text-slate-300">{message}</p>}
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={saveUser} className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-4 py-2 text-sm font-semibold text-white">
                  <Save size={16} />
                  Save User
                </button>
              </div>
            </>
          ) : (
            <div className="flex min-h-96 items-center justify-center text-sm text-slate-600 dark:text-slate-300">
              <UserCog size={18} className="mr-2" />
              Select a user to manage.
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
