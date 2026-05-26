import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRole } from '../types/auth';
import { useAuth } from '../context/AuthContext';

export const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [badge, setBadge] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.VIEWER);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const isRegistering = mode === 'register';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const success = isRegistering
        ? await register({ email, password, name, role, badge })
        : await login(email, password);

      if (success) {
        navigate('/dashboard');
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
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-2xl shadow-slate-950/30">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cad-signal">
            Secure Access
          </p>
          <h1 className="mt-2 text-3xl font-bold text-cad-ink">CAD Dispatch</h1>
          <p className="mt-2 text-sm text-slate-600">
            {isRegistering ? 'Create an agency account' : 'Computer-aided dispatch command center'}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 rounded-md border border-cad-line bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`rounded px-3 py-2 text-sm font-semibold transition ${
              !isRegistering ? 'bg-white text-cad-blue shadow-control' : 'text-slate-600'
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`rounded px-3 py-2 text-sm font-semibold transition ${
              isRegistering ? 'bg-white text-cad-blue shadow-control' : 'text-slate-600'
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
                <label className="block text-sm font-semibold text-slate-700" htmlFor="name">
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
                  className="mt-2 w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-blue focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="role">
                    Role
                  </label>
                  <select
                    id="role"
                    value={role}
                    onChange={(event) => setRole(event.target.value as UserRole)}
                    disabled={loading}
                    className="mt-2 w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-blue focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    <option value={UserRole.VIEWER}>Viewer</option>
                    <option value={UserRole.OFFICER}>Officer</option>
                    <option value={UserRole.DISPATCHER}>Dispatcher</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="badge">
                    Badge
                  </label>
                  <input
                    id="badge"
                    type="text"
                    value={badge}
                    onChange={(event) => setBadge(event.target.value)}
                    disabled={loading}
                    className="mt-2 w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-blue focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700" htmlFor="email">
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
              className="mt-2 w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-blue focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700" htmlFor="password">
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
              className="mt-2 w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm text-cad-ink shadow-control outline-none transition focus:border-cad-blue focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-cad-blue px-4 py-2.5 text-sm font-semibold text-white shadow-control transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading ? 'Working...' : isRegistering ? 'Create Account' : 'Login'}
          </button>
        </form>
      </section>
    </main>
  );
};
