import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  Map,
  Moon,
  Plus,
  Radio,
  Save,
  Shield,
  Sun,
  Trash2,
  Truck
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type ConfigSection = 'agencies' | 'districts' | 'units' | 'calls' | 'statuses' | 'security';

type ConfigItem = {
  id: string;
  name: string;
  code: string;
  agency: string;
  category: string;
  active: boolean;
};

type SecurityConfig = {
  idleTimeoutMinutes: number;
  requireHttps: boolean;
  requireDbSsl: boolean;
  locationStaleSeconds: number;
  websocketHeartbeatSeconds: number;
};

const storageKey = 'cad_admin_configuration';

const defaultItems: Record<ConfigSection, ConfigItem[]> = {
  agencies: [
    { id: 'agency-police', name: 'Police', code: 'POL', agency: 'CAD', category: 'Public Safety', active: true },
    { id: 'agency-ems', name: 'EMS', code: 'EMS', agency: 'CAD', category: 'Medical', active: true },
    { id: 'agency-fire', name: 'Fire', code: 'FIRE', agency: 'CAD', category: 'Fire', active: true },
    { id: 'agency-tow', name: 'Towing', code: 'TOW', agency: 'CAD', category: 'Service', active: true }
  ],
  districts: [
    { id: 'district-north', name: 'North District', code: 'NORTH', agency: 'Police', category: 'District', active: true },
    { id: 'district-south', name: 'South District', code: 'SOUTH', agency: 'Police', category: 'District', active: true }
  ],
  units: [
    { id: 'unit-patrol', name: 'Patrol Unit', code: 'PATROL', agency: 'Police', category: 'Officer', active: true },
    { id: 'unit-medic', name: 'Medic Unit', code: 'MEDIC', agency: 'EMS', category: 'Ambulance', active: true },
    { id: 'unit-engine', name: 'Engine', code: 'ENG', agency: 'Fire', category: 'Apparatus', active: true },
    { id: 'unit-tow', name: 'Tow Truck', code: 'TOW', agency: 'Towing', category: 'Truck', active: true }
  ],
  calls: [
    { id: 'call-traffic-stop', name: 'Traffic Stop', code: 'TS', agency: 'Police', category: 'Law', active: true },
    { id: 'call-medical', name: 'Medical Emergency', code: 'MED', agency: 'EMS', category: 'Medical', active: true },
    { id: 'call-fire', name: 'Structure Fire', code: 'FIRE', agency: 'Fire', category: 'Fire', active: true },
    { id: 'call-tow', name: 'Tow Request', code: 'TOW', agency: 'Towing', category: 'Service', active: true }
  ],
  statuses: [
    { id: 'status-available', name: 'Available', code: 'AVL', agency: 'All', category: 'Unit', active: true },
    { id: 'status-enroute', name: 'En Route', code: 'ENR', agency: 'All', category: 'Unit', active: true },
    { id: 'status-onscene', name: 'On Scene', code: 'ONS', agency: 'All', category: 'Unit', active: true },
    { id: 'status-clear', name: 'Cleared', code: 'CLR', agency: 'All', category: 'Disposition', active: true }
  ],
  security: []
};

const defaultSecurity: SecurityConfig = {
  idleTimeoutMinutes: 30,
  requireHttps: true,
  requireDbSsl: true,
  locationStaleSeconds: 45,
  websocketHeartbeatSeconds: 20
};

const sections: Array<{ id: ConfigSection; label: string; icon: React.ReactNode }> = [
  { id: 'agencies', label: 'Agencies', icon: <Building2 size={17} /> },
  { id: 'districts', label: 'Districts', icon: <Map size={17} /> },
  { id: 'units', label: 'Units', icon: <Truck size={17} /> },
  { id: 'calls', label: 'Call Types', icon: <ClipboardList size={17} /> },
  { id: 'statuses', label: 'Statuses', icon: <Radio size={17} /> },
  { id: 'security', label: 'Security', icon: <Shield size={17} /> }
];

const createItem = (section: ConfigSection): ConfigItem => ({
  id: `${section}-${Date.now()}`,
  name: '',
  code: '',
  agency: section === 'statuses' ? 'All' : 'Police',
  category: '',
  active: true
});

export const AdminConfigurationPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('cad_theme') === 'dark' ? 'dark' : 'light'
  );
  const [activeSection, setActiveSection] = useState<ConfigSection>('agencies');
  const [items, setItems] = useState<Record<ConfigSection, ConfigItem[]>>(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return defaultItems;
    try {
      return { ...defaultItems, ...JSON.parse(saved).items };
    } catch {
      return defaultItems;
    }
  });
  const [security, setSecurity] = useState<SecurityConfig>(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return defaultSecurity;
    try {
      return { ...defaultSecurity, ...JSON.parse(saved).security };
    } catch {
      return defaultSecurity;
    }
  });
  const [message, setMessage] = useState('');

  useEffect(() => {
    localStorage.setItem('cad_theme', theme);
  }, [theme]);

  const activeItems = useMemo(() => items[activeSection] || [], [activeSection, items]);

  const saveConfiguration = () => {
    localStorage.setItem(storageKey, JSON.stringify({ items, security }));
    setMessage('Configuration saved on this workstation.');
  };

  const updateItem = (id: string, update: Partial<ConfigItem>) => {
    setItems((current) => ({
      ...current,
      [activeSection]: current[activeSection].map((item) => (item.id === id ? { ...item, ...update } : item))
    }));
  };

  const addItem = () => {
    setItems((current) => ({
      ...current,
      [activeSection]: [createItem(activeSection), ...current[activeSection]]
    }));
  };

  const removeItem = (id: string) => {
    setItems((current) => ({
      ...current,
      [activeSection]: current[activeSection].filter((item) => item.id !== id)
    }));
  };

  if (!hasPermission('manage_system')) {
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
            <h1 className="text-xl font-semibold">Admin Configuration</h1>
            <p className="text-xs text-slate-300">CAD setup for Police, EMS, Fire, and Towing</p>
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
          <button
            type="button"
            onClick={saveConfiguration}
            className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Save size={16} />
            Save
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-lg border border-cad-line bg-white p-2 shadow-control dark:border-slate-700 dark:bg-slate-900">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold transition ${
                activeSection === section.id
                  ? 'bg-blue-50 text-cad-blue dark:bg-blue-950/60 dark:text-blue-200'
                  : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </aside>

        <section className="rounded-lg border border-cad-line bg-white p-4 shadow-control dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-cad-line pb-4 dark:border-slate-700">
            <div>
              <h2 className="text-lg font-bold">{sections.find((section) => section.id === activeSection)?.label}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {activeSection === 'security'
                  ? 'Operational guardrails for sessions, transport, and live tracking.'
                  : 'Codes here become the controlled values dispatchers and officers use.'}
              </p>
            </div>
            {activeSection !== 'security' && (
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-2 rounded-md border border-cad-line px-3 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <Plus size={16} />
                Add
              </button>
            )}
          </div>

          {activeSection === 'security' ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <label className="grid gap-1 text-sm font-semibold">
                Idle timeout minutes
                <input
                  type="number"
                  min={5}
                  value={security.idleTimeoutMinutes}
                  onChange={(event) => setSecurity((value) => ({ ...value, idleTimeoutMinutes: Number(event.target.value) }))}
                  className="rounded-md border border-cad-line bg-white px-3 py-2 font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Location stale seconds
                <input
                  type="number"
                  min={10}
                  value={security.locationStaleSeconds}
                  onChange={(event) => setSecurity((value) => ({ ...value, locationStaleSeconds: Number(event.target.value) }))}
                  className="rounded-md border border-cad-line bg-white px-3 py-2 font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Websocket heartbeat seconds
                <input
                  type="number"
                  min={5}
                  value={security.websocketHeartbeatSeconds}
                  onChange={(event) => setSecurity((value) => ({ ...value, websocketHeartbeatSeconds: Number(event.target.value) }))}
                  className="rounded-md border border-cad-line bg-white px-3 py-2 font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </label>
              <label className="flex items-center justify-between rounded-md border border-cad-line px-3 py-2 text-sm font-semibold dark:border-slate-700">
                Require HTTPS
                <input
                  type="checkbox"
                  checked={security.requireHttps}
                  onChange={(event) => setSecurity((value) => ({ ...value, requireHttps: event.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between rounded-md border border-cad-line px-3 py-2 text-sm font-semibold dark:border-slate-700">
                Require DB SSL
                <input
                  type="checkbox"
                  checked={security.requireDbSsl}
                  onChange={(event) => setSecurity((value) => ({ ...value, requireDbSsl: event.target.checked }))}
                />
              </label>
            </div>
          ) : (
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
                    <input
                      value={item.name}
                      onChange={(event) => updateItem(item.id, { name: event.target.value })}
                      placeholder="Name"
                      className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <input
                      value={item.code}
                      onChange={(event) => updateItem(item.id, { code: event.target.value.toUpperCase() })}
                      placeholder="Code"
                      className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <input
                      value={item.agency}
                      onChange={(event) => updateItem(item.id, { agency: event.target.value })}
                      placeholder="Agency"
                      className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <input
                      value={item.category}
                      onChange={(event) => updateItem(item.id, { category: event.target.value })}
                      placeholder="Category"
                      className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <label className="flex items-center gap-2 rounded-md border border-cad-line px-3 py-2 text-sm font-semibold dark:border-slate-700">
                      <input
                        type="checkbox"
                        checked={item.active}
                        onChange={(event) => updateItem(item.id, { active: event.target.checked })}
                      />
                      Active
                    </label>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="inline-flex h-10 items-center justify-center rounded-md border border-cad-line text-slate-500 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:hover:bg-red-950/40 dark:hover:text-red-200"
                      aria-label={`Remove ${item.name || item.code || 'configuration item'}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {message && <p className="mt-4 text-sm font-semibold text-slate-600 dark:text-slate-300">{message}</p>}
        </section>
      </main>
    </div>
  );
};
