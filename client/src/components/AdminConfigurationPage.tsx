import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ClipboardList,
  Map,
  Moon,
  Plus,
  Radio,
  Shield,
  Sun,
  Trash2,
  Truck,
  UserCog,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authClient } from '../services/authClient';
import {
  AdminConfigSection,
  AdminConfigurationItem,
  IntegrationStatus,
  UnitStatus,
  UpdateUserRequest,
  User,
  UserRole
} from '../types/auth';
import { defaultUnitStatuses, unitStatusesFromConfig } from '../utils/adminConfig';
import { indianaDistricts } from '../utils/indianaDistricts';
import { APP_NAME } from '../constants/branding';

type EditableConfigSection = Exclude<AdminConfigSection, 'security' | 'integrations'>;
type AdminSection = EditableConfigSection | 'users' | 'security' | 'integrations';
type ToastTone = 'success' | 'error';

type ToastNotice = {
  id: string;
  title: string;
  message: string;
  tone: ToastTone;
};

type SecurityConfig = {
  idleTimeoutMinutes: number;
  registrationEnabled: boolean;
  requireHttps: boolean;
  requireDbSsl: boolean;
  locationStaleSeconds: number;
  websocketHeartbeatSeconds: number;
};

const configSections: EditableConfigSection[] = ['agencies', 'districts', 'units', 'calls', 'statuses'];
const defaultSecurity: SecurityConfig = {
  idleTimeoutMinutes: 30,
  registrationEnabled: true,
  requireHttps: true,
  requireDbSsl: true,
  locationStaleSeconds: 45,
  websocketHeartbeatSeconds: 20
};

const sections: Array<{ id: AdminSection; label: string; icon: React.ReactNode }> = [
  { id: 'users', label: 'Users', icon: <UserCog size={17} /> },
  { id: 'agencies', label: 'Agencies', icon: <Building2 size={17} /> },
  { id: 'districts', label: 'Districts', icon: <Map size={17} /> },
  { id: 'units', label: 'Units', icon: <Truck size={17} /> },
  { id: 'calls', label: 'Call Types', icon: <ClipboardList size={17} /> },
  { id: 'statuses', label: 'Statuses', icon: <Radio size={17} /> },
  { id: 'integrations', label: 'Integrations', icon: <Shield size={17} /> },
  { id: 'security', label: 'Security', icon: <Shield size={17} /> }
];

const isConfigSection = (section: AdminSection): section is EditableConfigSection =>
  configSections.includes(section as EditableConfigSection);

const getSecurityNumber = (items: AdminConfigurationItem[], code: string, fallback: number): number => {
  const value = items.find((item) => item.section === 'security' && item.code === code)?.metadata?.value;
  return typeof value === 'number' ? value : fallback;
};

const getSecurityBoolean = (items: AdminConfigurationItem[], code: string, fallback: boolean): boolean => {
  const value = items.find((item) => item.section === 'security' && item.code === code)?.metadata?.value;
  return typeof value === 'boolean' ? value : fallback;
};

const boundaryTextFromMetadata = (metadata: Record<string, unknown>): string => {
  const raw = metadata.boundary || metadata.polygon || metadata.points;
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) return '';
  return raw
    .map((point) => {
      const candidate = point as { lat?: unknown; lon?: unknown; lng?: unknown };
      const lat = Number(candidate.lat);
      const lon = Number(candidate.lon ?? candidate.lng);
      return Number.isFinite(lat) && Number.isFinite(lon) ? `${lat},${lon}` : '';
    })
    .filter(Boolean)
    .join('; ');
};

export const AdminConfigurationPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('cad_theme') === 'dark' ? 'dark' : 'light'
  );
  const [activeSection, setActiveSection] = useState<AdminSection>('users');
  const [items, setItems] = useState<AdminConfigurationItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [search, setSearch] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [newUser, setNewUser] = useState({
    email: '',
    name: '',
    password: '',
    role: UserRole.OFFICER,
    badge: '',
    unitNumber: '',
    cadUnitNumber: '',
    status: 'Available' as UnitStatus,
    group: '',
    district: ''
  });
  const [security, setSecurity] = useState<SecurityConfig>(defaultSecurity);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const updateTimers = useRef<Record<string, number>>({});
  const unitStatuses = unitStatusesFromConfig(items);

  const addToast = useCallback((title: string, message: string, tone: ToastTone = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [{ id, title, message, tone }, ...current].slice(0, 4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3500);
  }, []);

  const loadAdmin = useCallback(async () => {
    try {
      const [configItems, adminUsers] = await Promise.all([
        authClient.getAdminConfiguration(),
        authClient.getUsers()
      ]);
      setItems(configItems);
      setSecurity({
        idleTimeoutMinutes: getSecurityNumber(configItems, 'IDLE_TIMEOUT_MINUTES', defaultSecurity.idleTimeoutMinutes),
        registrationEnabled: getSecurityBoolean(configItems, 'ALLOW_PUBLIC_REGISTRATION', defaultSecurity.registrationEnabled),
        requireHttps: getSecurityBoolean(configItems, 'REQUIRE_HTTPS', defaultSecurity.requireHttps),
        requireDbSsl: getSecurityBoolean(configItems, 'REQUIRE_DB_SSL', defaultSecurity.requireDbSsl),
        locationStaleSeconds: getSecurityNumber(configItems, 'LOCATION_STALE_SECONDS', defaultSecurity.locationStaleSeconds),
        websocketHeartbeatSeconds: getSecurityNumber(
          configItems,
          'WEBSOCKET_HEARTBEAT_SECONDS',
          defaultSecurity.websocketHeartbeatSeconds
        )
      });
      setUsers(adminUsers);
      setSelectedUserId((current) => current || adminUsers[0]?.id || '');
    } catch {
      addToast('Admin load failed', 'Unable to load admin data from the server.', 'error');
    }
  }, [addToast]);

  useEffect(() => {
    if (hasPermission('manage_system')) {
      loadAdmin();
    }
  }, [hasPermission, loadAdmin]);

  useEffect(() => {
    localStorage.setItem('cad_theme', theme);
  }, [theme]);

  useEffect(() => {
    const timers = updateTimers.current;
    return () => {
      Object.values(timers).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const activeItems = useMemo(
    () => (isConfigSection(activeSection) ? items.filter((item) => item.section === activeSection) : []),
    [activeSection, items]
  );
  const integrationItems = useMemo(
    () => items.filter((item) => item.section === 'integrations'),
    [items]
  );

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

  const scheduleItemUpdate = (itemId: string, update: Partial<AdminConfigurationItem>) => {
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...update } : item)));
    window.clearTimeout(updateTimers.current[itemId]);
    updateTimers.current[itemId] = window.setTimeout(async () => {
      try {
        const item = await authClient.updateAdminConfigurationItem(itemId, update);
        setItems((current) => current.map((currentItem) => (currentItem.id === item.id ? item : currentItem)));
        addToast('Configuration updated', `${item.name} was saved.`);
      } catch {
        addToast('Configuration failed', 'Unable to save that configuration change.', 'error');
        loadAdmin();
      }
    }, 650);
  };

  const addItem = async () => {
    if (!isConfigSection(activeSection)) return;
    try {
      const item = await authClient.createAdminConfigurationItem({
        section: activeSection,
        name: 'New Item',
        code: `NEW-${Date.now().toString().slice(-5)}`,
        agency: activeSection === 'statuses' ? 'All' : 'Police',
        category: '',
        active: true,
        sortOrder: activeItems.length * 10 + 10,
        metadata: {}
      });
      setItems((current) => [item, ...current]);
      addToast('Configuration added', `${item.name} was created.`);
    } catch {
      addToast('Create failed', 'Unable to create configuration item.', 'error');
    }
  };

  const removeItem = async (itemId: string) => {
    const item = items.find((entry) => entry.id === itemId);
    setItems((current) => current.filter((entry) => entry.id !== itemId));
    try {
      await authClient.deleteAdminConfigurationItem(itemId);
      addToast('Configuration removed', `${item?.name || 'Item'} was deleted.`);
    } catch {
      addToast('Delete failed', 'Unable to delete configuration item.', 'error');
      loadAdmin();
    }
  };

  const scheduleUserUpdate = (userId: string, update: UpdateUserRequest) => {
    setUsers((current) => current.map((item) => (item.id === userId ? ({ ...item, ...update } as User) : item)));
    window.clearTimeout(updateTimers.current[`user-${userId}`]);
    updateTimers.current[`user-${userId}`] = window.setTimeout(async () => {
      try {
        const updated = await authClient.updateUser(userId, update);
        setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        addToast('User updated', `${updated.name} was saved.`);
      } catch {
        addToast('User update failed', 'Unable to save user changes.', 'error');
        loadAdmin();
      }
    }, 650);
  };

  const resetUserPassword = async () => {
    if (!selectedUser) return;
    if (resetPassword.length < 12) {
      addToast('Password too short', 'Use at least 14 characters.', 'error');
      return;
    }
    try {
      await authClient.resetUserPassword(selectedUser.id, { newPassword: resetPassword });
      setResetPassword('');
      addToast('Password reset', `${selectedUser.name} will need to sign in again.`);
    } catch {
      addToast('Password reset failed', 'Unable to reset that password.', 'error');
    }
  };

  const createUser = async () => {
    if (!newUser.email.trim() || !newUser.name.trim() || newUser.password.length < 14) {
      addToast('User not created', 'Email, name, and a 12 character password are required.', 'error');
      return;
    }

    try {
      const created = await authClient.createUser({
        email: newUser.email,
        name: newUser.name,
        password: newUser.password,
        role: newUser.role,
        badge: newUser.badge || undefined,
        unitNumber: newUser.unitNumber || undefined,
        cadUnitNumber: newUser.cadUnitNumber || undefined,
        status: newUser.status,
        group: newUser.group || undefined,
        district: newUser.district || undefined
      });
      setUsers((current) => [created, ...current]);
      setSelectedUserId(created.id);
      setCreatingUser(false);
      setNewUser({
        email: '',
        name: '',
        password: '',
        role: UserRole.OFFICER,
        badge: '',
        unitNumber: '',
        cadUnitNumber: '',
        status: 'Available',
        group: '',
        district: ''
      });
      addToast('User created', `${created.name} can now sign in.`);
    } catch {
      addToast('User not created', 'Unable to create that user.', 'error');
    }
  };

  const updateSecurity = async (key: keyof SecurityConfig, code: string, value: number | boolean) => {
    setSecurity((current) => ({ ...current, [key]: value }));
    const item = items.find((entry) => entry.section === 'security' && entry.code === code);
    if (!item) {
      addToast('Security update failed', 'The server did not return that security setting.', 'error');
      return;
    }

    try {
      const updated = await authClient.updateAdminConfigurationItem(item.id, {
        metadata: { ...item.metadata, value }
      });
      setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      addToast('Security updated', `${updated.name} was saved.`);
    } catch {
      addToast('Security update failed', 'Unable to save security configuration.', 'error');
      loadAdmin();
    }
  };

  const updateIntegrationMetadata = async (item: AdminConfigurationItem, metadata: Record<string, unknown>) => {
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, metadata: { ...entry.metadata, ...metadata } } : entry)));
    try {
      const updated = await authClient.updateAdminConfigurationItem(item.id, {
        metadata: { ...item.metadata, ...metadata }
      });
      setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      addToast('Integration updated', `${updated.name} was saved.`);
    } catch {
      addToast('Integration update failed', 'Unable to save integration settings.', 'error');
      loadAdmin();
    }
  };

  const testIntegration = async (code: IntegrationStatus['code']) => {
    try {
      const status = await authClient.testIntegration(code);
      addToast('Integration test', status.message, status.configured ? 'success' : 'error');
    } catch {
      addToast('Integration test failed', 'Unable to test that integration.', 'error');
    }
  };

  if (!hasPermission('manage_system')) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className={`flex min-h-screen flex-col ${theme === 'dark' ? 'dark bg-cad-navy text-slate-100' : 'bg-cad-panel text-cad-ink'}`}>
      <header className="flex min-h-16 items-center justify-between border-b border-cad-accent/30 bg-cad-blue px-4 text-white shadow-shield">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="rounded-md border border-white/15 bg-white/10 p-2 hover:bg-white/20" aria-label="Back to dispatch">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-semibold">{APP_NAME} Admin</h1>
            <p className="text-xs text-slate-300">Users and dispatch configuration</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
          className="rounded-md border border-white/15 bg-white/10 p-2 transition hover:bg-white/20"
          aria-label="Toggle light dark mode"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <main className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-lg border border-cad-blue/20 bg-cad-blue p-2 text-white shadow-shield dark:border-cad-accent/30 dark:bg-cad-blue">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold transition ${
                activeSection === section.id
                  ? 'bg-white text-cad-blue shadow'
                  : 'text-blue-50 hover:bg-white/10'
              }`}
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </aside>

        <section className="rounded-lg border border-cad-line bg-white p-4 shadow-shield dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-cad-line pb-4 dark:border-slate-700">
            <div>
              <h2 className="text-lg font-bold">{sections.find((section) => section.id === activeSection)?.label}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Changes autosave after you edit a field.</p>
            </div>
            {isConfigSection(activeSection) && (
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white hover:bg-cad-secondary"
              >
                <Plus size={16} />
                Add
              </button>
            )}
            {activeSection === 'users' && (
              <button
                type="button"
                onClick={() => {
                  setCreatingUser(true);
                  setSelectedUserId('');
                }}
                className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white hover:bg-cad-secondary"
              >
                <Plus size={16} />
                New User
              </button>
            )}
          </div>

          {activeSection === 'users' && (
            <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
              <aside className="overflow-hidden rounded-lg border border-cad-line dark:border-slate-700">
                <div className="border-b border-cad-line p-3 dark:border-slate-700">
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users" className="w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                </div>
                <div className="max-h-[64vh] overflow-y-auto">
                  {filteredUsers.map((item) => (
                    <button key={item.id} type="button" onClick={() => { setCreatingUser(false); setSelectedUserId(item.id); }} className={`w-full border-b border-slate-100 px-3 py-3 text-left text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${selectedUserId === item.id ? 'bg-blue-50 dark:bg-blue-950/50' : ''}`}>
                      <span className="block truncate font-bold">{item.name}</span>
                      <span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">{item.email}</span>
                      <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{item.role}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="rounded-lg border border-cad-line p-4 dark:border-slate-700">
                {creatingUser ? (
                  <>
                    <div className="mb-4 border-b border-cad-line pb-4 dark:border-slate-700">
                      <h3 className="text-lg font-bold">New User</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Create login and unit metadata.</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <input value={newUser.email} onChange={(event) => setNewUser((value) => ({ ...value, email: event.target.value }))} placeholder="Email" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <input value={newUser.name} onChange={(event) => setNewUser((value) => ({ ...value, name: event.target.value }))} placeholder="Name" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <input type="password" value={newUser.password} onChange={(event) => setNewUser((value) => ({ ...value, password: event.target.value }))} placeholder="Temporary password" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <select value={newUser.role} onChange={(event) => setNewUser((value) => ({ ...value, role: event.target.value as UserRole }))} className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                        {Object.values(UserRole).map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                      <input value={newUser.badge} onChange={(event) => setNewUser((value) => ({ ...value, badge: event.target.value }))} placeholder="Badge" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <input value={newUser.unitNumber} onChange={(event) => setNewUser((value) => ({ ...value, unitNumber: event.target.value }))} placeholder="Unit number" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <input value={newUser.cadUnitNumber} onChange={(event) => setNewUser((value) => ({ ...value, cadUnitNumber: event.target.value }))} placeholder="CAD unit number" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <select value={newUser.status} onChange={(event) => setNewUser((value) => ({ ...value, status: event.target.value as UnitStatus }))} className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                        {Array.from(new Set([...unitStatuses, ...defaultUnitStatuses])).map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <input value={newUser.group} onChange={(event) => setNewUser((value) => ({ ...value, group: event.target.value }))} placeholder="Group" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <DistrictSelect value={newUser.district} onChange={(district) => setNewUser((value) => ({ ...value, district }))} />
                    </div>
                    <div className="mt-5 flex justify-end gap-2">
                      <button type="button" onClick={() => setCreatingUser(false)} className="rounded-md border border-cad-line px-4 py-2 text-sm font-semibold dark:border-slate-700">Cancel</button>
                      <button type="button" onClick={createUser} className="rounded-md bg-cad-blue px-4 py-2 text-sm font-semibold text-white">Create User</button>
                    </div>
                  </>
                ) : selectedUser ? (
                  <>
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-cad-line pb-4 dark:border-slate-700">
                      <div>
                        <h3 className="text-lg font-bold">{selectedUser.name}</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{selectedUser.email}</p>
                      </div>
                      <label className="inline-flex items-center gap-2 rounded-full border border-cad-line px-3 py-1.5 text-sm font-semibold dark:border-slate-700">
                        <input type="checkbox" checked={selectedUser.active} onChange={(event) => scheduleUserUpdate(selectedUser.id, { active: event.target.checked })} />
                        Active
                      </label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <input value={selectedUser.name} onChange={(event) => scheduleUserUpdate(selectedUser.id, { name: event.target.value })} placeholder="Name" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <select value={selectedUser.role} onChange={(event) => scheduleUserUpdate(selectedUser.id, { role: event.target.value as UserRole })} className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                        {Object.values(UserRole).map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                      <input value={selectedUser.badge || ''} onChange={(event) => scheduleUserUpdate(selectedUser.id, { badge: event.target.value })} placeholder="Badge" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <input value={selectedUser.unitNumber || ''} onChange={(event) => scheduleUserUpdate(selectedUser.id, { unitNumber: event.target.value })} placeholder="Unit number" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <input value={selectedUser.cadUnitNumber || ''} onChange={(event) => scheduleUserUpdate(selectedUser.id, { cadUnitNumber: event.target.value })} placeholder="CAD unit number" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <select value={selectedUser.status || 'Available'} onChange={(event) => scheduleUserUpdate(selectedUser.id, { status: event.target.value as UnitStatus })} className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                        {Array.from(new Set([...unitStatuses, ...defaultUnitStatuses])).map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <input value={selectedUser.group || ''} onChange={(event) => scheduleUserUpdate(selectedUser.id, { group: event.target.value })} placeholder="Group" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <DistrictSelect value={selectedUser.district || ''} onChange={(district) => scheduleUserUpdate(selectedUser.id, { district })} />
                    </div>
                    <div className="mt-5 rounded-md border border-cad-line p-4 dark:border-slate-700">
                      <h3 className="flex items-center gap-2 text-sm font-bold"><Shield size={16} /> Reset Password</h3>
                      <div className="mt-3 flex max-w-xl gap-2">
                        <input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="New password" className="min-w-0 flex-1 rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                        <button type="button" onClick={resetUserPassword} className="rounded-md border border-cad-line px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:text-slate-200">Reset</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-96 items-center justify-center text-sm text-slate-600 dark:text-slate-300">
                    <UserCog size={18} className="mr-2" />
                    Select a user to manage.
                  </div>
                )}
              </div>
            </div>
          )}

          {isConfigSection(activeSection) && (
            <div className="overflow-hidden rounded-lg border border-cad-line dark:border-slate-700">
              <div className="hidden grid-cols-[1.2fr_0.7fr_0.8fr_0.8fr_100px_52px] gap-2 border-b border-cad-line bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 md:grid">
                <span>Name</span>
                <span>Code</span>
                <span>Agency</span>
                <span>Category</span>
                <span>Active</span>
                <span />
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {activeItems.map((item) => (
                  <div key={item.id} className="grid gap-2 p-3 md:grid-cols-[1.2fr_0.7fr_0.8fr_0.8fr_100px_52px]">
                    <input value={item.name} onChange={(event) => scheduleItemUpdate(item.id, { name: event.target.value })} placeholder="Name" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                    <input value={item.code} onChange={(event) => scheduleItemUpdate(item.id, { code: event.target.value.toUpperCase() })} placeholder="Code" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                    <input value={item.agency} onChange={(event) => scheduleItemUpdate(item.id, { agency: event.target.value })} placeholder="Agency" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                    <input value={item.category} onChange={(event) => scheduleItemUpdate(item.id, { category: event.target.value })} placeholder="Category" className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                    <label className="flex items-center gap-2 rounded-md border border-cad-line px-3 py-2 text-sm font-semibold dark:border-slate-700">
                      <input type="checkbox" checked={item.active} onChange={(event) => scheduleItemUpdate(item.id, { active: event.target.checked })} />
                      Active
                    </label>
                    <button type="button" onClick={() => removeItem(item.id)} className="inline-flex h-10 items-center justify-center rounded-md border border-cad-line text-slate-500 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:hover:bg-red-950/40 dark:hover:text-red-200" aria-label={`Remove ${item.name || item.code || 'configuration item'}`}>
                      <Trash2 size={16} />
                    </button>
                    {activeSection === 'districts' && (
                      <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 md:col-span-6">
                        Boundary
                        <textarea
                          value={boundaryTextFromMetadata(item.metadata)}
                          onChange={(event) =>
                            scheduleItemUpdate(item.id, {
                              metadata: { ...item.metadata, boundary: event.target.value }
                            })
                          }
                          placeholder="39.9000,-86.2600; 39.9000,-86.0500; 39.7900,-86.0500"
                          className="min-h-20 rounded-md border border-cad-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'integrations' && (
            <div className="grid gap-4">
              {integrationItems.map((item) => {
                const endpoint = typeof item.metadata.endpoint === 'string' ? item.metadata.endpoint : '';
                const apiKey = typeof item.metadata.apiKey === 'string' ? item.metadata.apiKey : '';
                const timeoutMs = Number(item.metadata.timeoutMs || 12000);
                const requireReason = typeof item.metadata.requireReason === 'boolean' ? item.metadata.requireReason : true;
                const enabled = typeof item.metadata.enabled === 'boolean' ? item.metadata.enabled : item.active;
                return (
                  <section key={item.id} className="rounded-lg border border-cad-line p-4 dark:border-slate-700">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cad-line pb-3 dark:border-slate-700">
                      <div>
                        <h3 className="text-base font-black">{item.name}</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{item.category}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => testIntegration(item.code as IntegrationStatus['code'])}
                          className="rounded-md border border-cad-line px-3 py-2 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                          Test
                        </button>
                        <label className="inline-flex items-center gap-2 rounded-md border border-cad-line px-3 py-2 text-sm font-bold dark:border-slate-700">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) => updateIntegrationMetadata(item, { enabled: event.target.checked })}
                          />
                          Enabled
                        </label>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_1fr_10rem]">
                      <label className="grid gap-1 text-sm font-bold text-slate-700 dark:text-slate-300">
                        Endpoint
                        <input
                          value={endpoint}
                          onChange={(event) => updateIntegrationMetadata(item, { endpoint: event.target.value })}
                          placeholder={item.code === 'COURTS' ? 'https://public.courts.in.gov/' : 'Approved endpoint URL'}
                          className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                      </label>
                      {item.code !== 'COURTS' && (
                        <label className="grid gap-1 text-sm font-bold text-slate-700 dark:text-slate-300">
                          API Key
                          <input
                            type="password"
                            value={apiKey}
                            onChange={(event) => updateIntegrationMetadata(item, { apiKey: event.target.value })}
                            placeholder="Approved credential"
                            className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          />
                        </label>
                      )}
                      <label className="grid gap-1 text-sm font-bold text-slate-700 dark:text-slate-300">
                        Timeout MS
                        <input
                          type="number"
                          min={1000}
                          value={timeoutMs}
                          onChange={(event) => updateIntegrationMetadata(item, { timeoutMs: Number(event.target.value) })}
                          className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                      </label>
                      {item.code === 'COURTS' && (
                        <label className="grid gap-1 text-sm font-bold text-slate-700 dark:text-slate-300 lg:col-span-2">
                          MyCase Endpoint
                          <input
                            value={typeof item.metadata.myCaseEndpoint === 'string' ? item.metadata.myCaseEndpoint : ''}
                            onChange={(event) => updateIntegrationMetadata(item, { myCaseEndpoint: event.target.value })}
                            placeholder="https://public.courts.in.gov/mycase/"
                            className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          />
                        </label>
                      )}
                      <label className="inline-flex items-center gap-2 rounded-md border border-cad-line px-3 py-2 text-sm font-bold dark:border-slate-700">
                        <input
                          type="checkbox"
                          checked={requireReason}
                          onChange={(event) => updateIntegrationMetadata(item, { requireReason: event.target.checked })}
                        />
                        Require reason
                      </label>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {activeSection === 'security' && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <NumberSetting label="Idle timeout minutes" value={security.idleTimeoutMinutes} min={1} onChange={(value) => updateSecurity('idleTimeoutMinutes', 'IDLE_TIMEOUT_MINUTES', value)} />
              <NumberSetting label="Location stale seconds" value={security.locationStaleSeconds} min={10} onChange={(value) => updateSecurity('locationStaleSeconds', 'LOCATION_STALE_SECONDS', value)} />
              <NumberSetting label="Websocket heartbeat seconds" value={security.websocketHeartbeatSeconds} min={5} onChange={(value) => updateSecurity('websocketHeartbeatSeconds', 'WEBSOCKET_HEARTBEAT_SECONDS', value)} />
              <ToggleSetting label="Allow public registration" checked={security.registrationEnabled} onChange={(value) => updateSecurity('registrationEnabled', 'ALLOW_PUBLIC_REGISTRATION', value)} />
              <ToggleSetting label="Require HTTPS" checked={security.requireHttps} onChange={(value) => updateSecurity('requireHttps', 'REQUIRE_HTTPS', value)} />
              <ToggleSetting label="Require DB SSL" checked={security.requireDbSsl} onChange={(value) => updateSecurity('requireDbSsl', 'REQUIRE_DB_SSL', value)} />
            </div>
          )}
        </section>
      </main>

      <div className="fixed right-4 top-20 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} className={`flex items-start gap-3 rounded-lg border bg-white p-3 shadow-xl dark:bg-slate-900 ${toast.tone === 'success' ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800'}`}>
            <CheckCircle2 size={18} className={toast.tone === 'success' ? 'mt-0.5 text-emerald-600' : 'mt-0.5 text-red-600'} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{toast.title}</p>
              <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">{toast.message}</p>
            </div>
            <button type="button" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} className="text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Dismiss notification">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const NumberSetting: React.FC<{ label: string; value: number; min: number; onChange: (value: number) => void }> = ({
  label,
  value,
  min,
  onChange
}) => (
  <label className="grid gap-1 text-sm font-semibold">
    {label}
    <input
      type="number"
      min={min}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="rounded-md border border-cad-line bg-white px-3 py-2 font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
    />
  </label>
);

const ToggleSetting: React.FC<{ label: string; checked: boolean; onChange: (value: boolean) => void }> = ({
  label,
  checked,
  onChange
}) => (
  <label className="flex items-center justify-between rounded-md border border-cad-line px-3 py-2 text-sm font-semibold dark:border-slate-700">
    {label}
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
  </label>
);

const DistrictSelect: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const isKnownDistrict = !value || indianaDistricts.some((district) => district.label === value);
  return (
    <select
      value={isKnownDistrict ? value : '__custom__'}
      onChange={(event) => onChange(event.target.value === '__custom__' ? value : event.target.value)}
      className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
    >
      <option value="">Unassigned District</option>
      {!isKnownDistrict && <option value="__custom__">{value}</option>}
      {indianaDistricts.map((district) => (
        <option key={district.number} value={district.label}>
          {district.label}
        </option>
      ))}
    </select>
  );
};
