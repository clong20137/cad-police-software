import React from 'react';
import { UserRole } from 'cad-shared';
import { useAuth } from '../context/AuthContext';
import { Protected, RoleBasedRender } from './Protected';

const navItems = [
  { href: '#dispatch', label: 'Active Dispatch', permission: 'view_dispatch' as const },
  { href: '#officers', label: 'Officers', permission: 'view_officers' as const },
  { href: '#reports', label: 'Reports', permission: 'view_reports' as const }
];

export const Dashboard: React.FC = () => {
  const { user, logout, permissions } = useAuth();

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-cad-ink">
      <header className="flex min-h-16 items-center justify-between border-b border-slate-800 bg-cad-navy px-5 text-white">
        <div>
          <h1 className="text-xl font-semibold">CAD Dispatch</h1>
          <p className="text-xs text-slate-300">Operational dashboard</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-slate-200 sm:inline">
            {user?.name} ({user?.role})
          </span>
          <button
            onClick={logout}
            className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-cad-line bg-white py-5 md:block">
          <nav aria-label="Primary navigation">
            <h2 className="px-5 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Navigation
            </h2>

            <div className="mt-4 space-y-1">
              {navItems.map((item) => (
                <Protected key={item.href} permission={item.permission}>
                  <a
                    href={item.href}
                    className="block border-l-4 border-transparent px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-cad-blue hover:bg-slate-50"
                  >
                    {item.label}
                  </a>
                </Protected>
              ))}

              <RoleBasedRender roles={[UserRole.ADMIN]}>
                <a
                  href="#admin"
                  className="block border-l-4 border-transparent px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-cad-blue hover:bg-slate-50"
                >
                  Administration
                </a>
              </RoleBasedRender>
            </div>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-8">
          <section className="mx-auto max-w-6xl">
            <div className="mb-6">
              <h2 className="text-2xl font-bold">Dashboard</h2>
              <p className="mt-1 text-sm text-slate-600">
                Signed in with {permissions.length} active permissions.
              </p>
            </div>

            <div className="mb-5 rounded-lg border border-cad-line bg-white p-5 shadow-control">
              <h3 className="text-lg font-semibold">User Information</h3>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="font-semibold text-slate-500">Name</dt>
                  <dd>{user?.name}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Email</dt>
                  <dd>{user?.email}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Role</dt>
                  <dd className="capitalize">{user?.role}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Badge</dt>
                  <dd>{user?.badge || 'N/A'}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Permissions</dt>
                  <dd>{permissions.length}</dd>
                </div>
              </dl>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Protected permission="view_dispatch">
                <div className="rounded-lg border border-cad-line bg-white p-5 shadow-control">
                  <h3 className="text-lg font-semibold">Active Dispatch</h3>
                  <p className="mt-3 text-sm text-slate-600">No active dispatches at this time.</p>
                </div>
              </Protected>

              <Protected permission="create_dispatch">
                <div className="rounded-lg border border-cad-line bg-white p-5 shadow-control">
                  <h3 className="text-lg font-semibold">Create New Dispatch</h3>
                  <button className="mt-4 rounded-md bg-cad-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200">
                    New Dispatch
                  </button>
                </div>
              </Protected>

              <Protected permission="manage_users">
                <div className="rounded-lg border border-cad-line bg-white p-5 shadow-control">
                  <h3 className="text-lg font-semibold">User Management</h3>
                  <p className="mt-3 text-sm text-slate-600">
                    Admin-only section for managing system users.
                  </p>
                  <button className="mt-4 rounded-md bg-cad-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200">
                    Manage Users
                  </button>
                </div>
              </Protected>

              <RoleBasedRender roles={[UserRole.DISPATCHER, UserRole.ADMIN]}>
                <div className="rounded-lg border border-cad-line bg-white p-5 shadow-control">
                  <h3 className="text-lg font-semibold">Dispatcher Features</h3>
                  <p className="mt-3 text-sm text-slate-600">
                    Quick access to dispatcher tools and features.
                  </p>
                </div>
              </RoleBasedRender>

              <RoleBasedRender roles={[UserRole.ADMIN]}>
                <div className="rounded-lg border border-cad-line bg-white p-5 shadow-control">
                  <h3 className="text-lg font-semibold">System Administration</h3>
                  <p className="mt-3 text-sm text-slate-600">
                    Administrative controls and system settings.
                  </p>
                </div>
              </RoleBasedRender>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};
