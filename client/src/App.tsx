import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  Command,
  LayoutDashboard,
  LockKeyhole,
  MessageCircle,
  Plus,
  Radio,
  Search,
  Settings,
  Shield,
  UserCog,
  X
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UserRole } from './types/auth';
import { SessionLockGuard } from './components/common/SessionLockGuard';
import { APP_NAME } from './constants/branding';

type QuickAccessTarget =
  | 'messages'
  | 'calls'
  | 'new-call'
  | 'units'
  | 'inquiries'
  | 'protective-orders'
  | 'settings'
  | 'status';

interface QuickAccessItem {
  id: string;
  label: string;
  detail: string;
  keywords: string[];
  icon: React.ElementType;
  action: () => void;
}

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
};

const dispatchQuickAccessTarget = (target: QuickAccessTarget) => {
  window.dispatchEvent(new CustomEvent('cad:quick-access-open', { detail: { target } }));
};

const LoginPage = React.lazy(() => import('./components/LoginPage').then((module) => ({ default: module.LoginPage })));
const Dashboard = React.lazy(() => import('./components/Dashboard').then((module) => ({ default: module.Dashboard })));
const AdminConfigurationPage = React.lazy(() =>
  import('./components/AdminConfigurationPage').then((module) => ({ default: module.AdminConfigurationPage }))
);
const OfficerDashboard = React.lazy(() =>
  import('./components/OfficerDashboard').then((module) => ({ default: module.OfficerDashboard }))
);

const AppLoading: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center bg-cad-panel text-sm font-medium text-slate-600 dark:bg-gray-950 dark:text-gray-300">
    Loading {APP_NAME}...
  </div>
);

const GlobalQuickAccessPalette: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const closePalette = useCallback(() => setOpen(false), []);
  const openPalette = useCallback(() => {
    if (!isAuthenticated) return;
    setOpen(true);
  }, [isAuthenticated]);

  const runDashboardCommand = useCallback((route: '/dashboard' | '/officer', target: QuickAccessTarget) => {
    navigate(route);
    window.setTimeout(() => dispatchQuickAccessTarget(target), 80);
  }, [navigate]);

  const runRoleCommand = useCallback((target: QuickAccessTarget) => {
    runDashboardCommand(user?.role === UserRole.OFFICER ? '/officer' : '/dashboard', target);
  }, [runDashboardCommand, user?.role]);

  const runAndClose = useCallback((action: () => void) => {
    action();
    closePalette();
  }, [closePalette]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openPalette();
      }
    };

    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [openPalette]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedIndex(0);
      return;
    }

    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const items = useMemo<QuickAccessItem[]>(() => {
    if (!isAuthenticated || !user) return [];

    const roleHome = user.role === UserRole.OFFICER ? '/officer' : '/dashboard';
    const baseItems: QuickAccessItem[] = [
      {
        id: 'home',
        label: user.role === UserRole.OFFICER ? 'Officer Side' : 'Dispatch Side',
        detail: 'Return to your main CAD workspace.',
        keywords: ['home', 'dashboard', 'workspace'],
        icon: LayoutDashboard,
        action: () => navigate(roleHome)
      },
      {
        id: 'messages',
        label: 'Messages',
        detail: 'Open CAD messages.',
        keywords: ['chat', 'inbox', 'conversation'],
        icon: MessageCircle,
        action: () => runRoleCommand('messages')
      },
      {
        id: 'calls',
        label: user.role === UserRole.OFFICER ? 'My Calls' : 'Calls',
        detail: 'Open active call management.',
        keywords: ['case', 'assignment', 'pending', 'closed'],
        icon: ClipboardList,
        action: () => runRoleCommand('calls')
      },
      {
        id: 'inquiries',
        label: 'CJIS Inquiries',
        detail: 'Open 10-27, 10-28, VIN, plate, and name inquiries.',
        keywords: ['cjis', '10-27', '10-28', 'plate', 'vin', 'name'],
        icon: Search,
        action: () => runRoleCommand('inquiries')
      },
      {
        id: 'protective-orders',
        label: 'Protective Orders',
        detail: 'Open protective order lookup.',
        keywords: ['protect', 'court', 'orders'],
        icon: Shield,
        action: () => runRoleCommand('protective-orders')
      },
      {
        id: 'account-settings',
        label: 'Account Settings',
        detail: 'Change password, 2FA, preferences, and sounds.',
        keywords: ['profile', 'password', '2fa', 'theme', 'sound'],
        icon: UserCog,
        action: () => runRoleCommand('settings')
      },
      {
        id: 'lock',
        label: 'Lock Account',
        detail: 'Lock this CAD session and require your password.',
        keywords: ['session', 'secure', 'password', 'ctrl l'],
        icon: LockKeyhole,
        action: () => window.dispatchEvent(new CustomEvent('cad:lock-session'))
      }
    ];

    if (user.role === UserRole.ADMIN || user.role === UserRole.DISPATCHER) {
      baseItems.push(
        {
          id: 'new-call',
          label: 'New Call',
          detail: 'Create a dispatch call.',
          keywords: ['create', 'dispatch', 'incident'],
          icon: Plus,
          action: () => runDashboardCommand('/dashboard', 'new-call')
        },
        {
          id: 'units',
          label: 'Unit Status',
          detail: 'Open on-duty unit status.',
          keywords: ['officers', 'units', 'status'],
          icon: Radio,
          action: () => runDashboardCommand('/dashboard', 'units')
        }
      );
    }

    if (user.role === UserRole.OFFICER || user.role === UserRole.ADMIN) {
      baseItems.push({
        id: 'officer-status',
        label: 'Officer Unit Status',
        detail: 'Open active units and officer status.',
        keywords: ['units', 'officers', 'status', 'distance'],
        icon: Radio,
        action: () => runDashboardCommand('/officer', 'status')
      });
    }

    if (user.role === UserRole.ADMIN) {
      baseItems.push(
        {
          id: 'dispatch-side',
          label: 'Dispatch Side',
          detail: 'Switch to dispatch.',
          keywords: ['dispatcher', 'cad'],
          icon: LayoutDashboard,
          action: () => navigate('/dashboard')
        },
        {
          id: 'admin-settings',
          label: 'Admin Settings',
          detail: 'Open CAD administration.',
          keywords: ['configuration', 'users', 'security', 'districts'],
          icon: Settings,
          action: () => navigate('/admin/configuration')
        }
      );
    }

    return baseItems;
  }, [isAuthenticated, navigate, runDashboardCommand, runRoleCommand, user]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;

    const terms = normalizedQuery.split(/\s+/u);
    return items.filter((item) => {
      const haystack = [item.label, item.detail, ...item.keywords].join(' ').toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((index) => (filteredItems.length ? (index + 1) % filteredItems.length : 0));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((index) => (filteredItems.length ? (index - 1 + filteredItems.length) % filteredItems.length : 0));
      return;
    }

    if (event.key === 'Enter' && filteredItems[selectedIndex]) {
      event.preventDefault();
      runAndClose(filteredItems[selectedIndex].action);
    }
  };

  if (!open || !isAuthenticated) return null;

  return (
    <div className="fixed inset-0 z-[950] flex items-start justify-center bg-slate-950/35 px-3 pt-[9vh] sm:px-6" onMouseDown={closePalette}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick access"
        className="floating-window-mac-enter w-full max-w-2xl overflow-hidden rounded-lg border border-cad-line bg-white shadow-[0_24px_80px_rgba(15,23,42,0.36)] dark:border-slate-700 dark:bg-slate-950"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-cad-line px-4 py-3 dark:border-slate-700">
          <Command className="shrink-0 text-cad-blue dark:text-blue-100" size={20} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands, modals, and CAD tools..."
            className="min-w-0 flex-1 bg-transparent text-base font-semibold text-cad-ink outline-none placeholder:text-slate-400 dark:text-white"
          />
          <span className="hidden rounded border border-cad-line px-2 py-1 text-[11px] font-bold uppercase text-slate-500 dark:border-slate-700 dark:text-slate-300 sm:inline-flex">
            Ctrl K
          </span>
          <button type="button" onClick={closePalette} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Close quick access">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[min(28rem,62dvh)] overflow-y-auto p-2">
          {filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">No matching commands</div>
          ) : (
            filteredItems.map((item, index) => {
              const Icon = item.icon;
              const selected = index === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => runAndClose(item.action)}
                  className={`flex w-full items-center gap-3 rounded px-3 py-3 text-left transition ${
                    selected
                      ? 'bg-cad-blue text-white shadow-sm'
                      : 'text-cad-ink hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-900'
                  }`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded border ${
                    selected
                      ? 'border-white/25 bg-white/15 text-white'
                      : 'border-cad-line bg-white text-cad-blue dark:border-slate-700 dark:bg-slate-900 dark:text-blue-100'
                  }`}>
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{item.label}</span>
                    <span className={`mt-0.5 block truncate text-xs font-semibold ${selected ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'}`}>{item.detail}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

const ProtectedRoute: React.FC<{ children: React.ReactNode; allowedRoles?: UserRole[] }> = ({ children, allowedRoles }) => {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <AppLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === UserRole.OFFICER ? '/officer' : '/dashboard'} replace />;
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  const basename = process.env.PUBLIC_URL || '/';

  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <SessionLockGuard>
          <Suspense fallback={<AppLoading />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.DISPATCHER]}>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                    <Navigate to="/admin/configuration" replace />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/configuration"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                    <AdminConfigurationPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/officer"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.OFFICER]}>
                    <OfficerDashboard />
                  </ProtectedRoute>
                }
              />
              <Route path="/" element={<RoleHome />} />
            </Routes>
          </Suspense>
          <GlobalQuickAccessPalette />
        </SessionLockGuard>
      </AuthProvider>
    </BrowserRouter>
  );
};

const RoleHome: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={user?.role === UserRole.OFFICER ? '/officer' : '/dashboard'} replace />;
};

export default App;
