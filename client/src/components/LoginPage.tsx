import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon, Shield, Sun } from 'lucide-react';
import { UserRole } from '../types/auth';
import { useAuth } from '../context/AuthContext';
import { APP_DESCRIPTION, APP_NAME } from '../constants/branding';

export const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('cad_theme') === 'dark' ? 'dark' : 'light'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [badge, setBadge] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [cadUnitNumber, setCadUnitNumber] = useState('');
  const [group, setGroup] = useState('');
  const [district, setDistrict] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.VIEWER);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const isRegistering = mode === 'register';

  React.useEffect(() => {
    localStorage.setItem('cad_theme', theme);
  }, [theme]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const success = isRegistering
        ? await register({
            email,
            password,
            name,
            role,
            badge,
            unitNumber,
            cadUnitNumber,
            status: 'Available',
            group,
            district
          })
        : await login(email, password);

      if (success) {
        navigate('/');
      } else {
        setError(isRegistering ? 'Registration failed' : 'Invalid credentials');
      }
    } catch {
      setError('Request failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={`flex min-h-screen items-center justify-center px-4 py-10 ${theme === 'dark' ? 'dark bg-gray-950 text-gray-100' : 'bg-gray-100 text-cad-ink'}`}>
      <button
        type="button"
        onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
        className="fixed right-4 top-4 flex h-11 w-11 items-center justify-center rounded border border-slate-200 bg-white text-cad-blue shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-gray-900 dark:text-blue-100 dark:hover:bg-gray-800"
        aria-label="Toggle light dark mode"
      >
        {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
      </button>
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-shield dark:border-slate-800 dark:bg-gray-900">
        <div className="mb-8">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded bg-cad-blue text-white dark:bg-white dark:text-cad-blue">
            <Shield size={22} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cad-accent">
            Secure Access
          </p>
          <h1 className="mt-2 text-3xl font-bold text-cad-blue dark:text-blue-100">{APP_NAME}</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {isRegistering ? 'Create an agency account' : APP_DESCRIPTION}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 rounded border border-cad-line bg-slate-100 p-1 dark:border-slate-700 dark:bg-gray-950">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`rounded px-3 py-2 text-sm font-semibold transition ${
              !isRegistering ? 'bg-white text-cad-blue shadow-control dark:bg-gray-800 dark:text-blue-100' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`rounded px-3 py-2 text-sm font-semibold transition ${
              isRegistering ? 'bg-white text-cad-blue shadow-control dark:bg-gray-800 dark:text-blue-100' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-cad-alert"
              role="alert"
            >
              {error}
            </div>
          )}

          {isRegistering && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="name">
                  Full name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  disabled={loading}
                  className="mt-2 w-full rounded border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-gray-950 dark:text-white dark:disabled:bg-slate-900"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="role">
                    Role
                  </label>
                  <select
                    id="role"
                    value={role}
                    onChange={(event) => setRole(event.target.value as UserRole)}
                    disabled={loading}
                    className="mt-2 w-full rounded border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-gray-950 dark:text-white dark:disabled:bg-slate-900"
                  >
                    <option value={UserRole.VIEWER}>Viewer</option>
                    <option value={UserRole.OFFICER}>Officer</option>
                    <option value={UserRole.DISPATCHER}>Dispatcher</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="badge">
                    Badge
                  </label>
                  <input
                    id="badge"
                    type="text"
                    value={badge}
                    onChange={(event) => setBadge(event.target.value)}
                    disabled={loading}
                    className="mt-2 w-full rounded border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-gray-950 dark:text-white dark:disabled:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="unitNumber">
                    Unit Number
                  </label>
                  <input
                    id="unitNumber"
                    type="text"
                    value={unitNumber}
                    onChange={(event) => setUnitNumber(event.target.value)}
                    disabled={loading}
                    className="mt-2 w-full rounded border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-gray-950 dark:text-white dark:disabled:bg-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="cadUnitNumber">
                    CAD Unit Number
                  </label>
                  <input
                    id="cadUnitNumber"
                    type="text"
                    value={cadUnitNumber}
                    onChange={(event) => setCadUnitNumber(event.target.value)}
                    disabled={loading}
                    className="mt-2 w-full rounded border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-gray-950 dark:text-white dark:disabled:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="group">
                    Group
                  </label>
                  <input
                    id="group"
                    type="text"
                    value={group}
                    onChange={(event) => setGroup(event.target.value)}
                    disabled={loading}
                    className="mt-2 w-full rounded border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-gray-950 dark:text-white dark:disabled:bg-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="district">
                    District
                  </label>
                  <input
                    id="district"
                    type="text"
                    value={district}
                    onChange={(event) => setDistrict(event.target.value)}
                    disabled={loading}
                    className="mt-2 w-full rounded border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-gray-950 dark:text-white dark:disabled:bg-slate-900"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@agency.gov"
              autoComplete="username"
              required
              disabled={loading}
              className="mt-2 w-full rounded border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-gray-950 dark:text-white dark:disabled:bg-slate-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              required
              minLength={isRegistering ? 8 : undefined}
              disabled={loading}
              className="mt-2 w-full rounded border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-gray-950 dark:text-white dark:disabled:bg-slate-900"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-cad-blue px-4 py-2.5 text-sm font-semibold text-white shadow-control transition hover:bg-cad-secondary focus:outline-none focus:ring-4 focus:ring-cad-accent/30 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading ? 'Working...' : isRegistering ? 'Create Account' : 'Login'}
          </button>
        </form>
      </section>
    </main>
  );
};
