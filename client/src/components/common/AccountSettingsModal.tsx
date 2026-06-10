import React, { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, KeyRound, Monitor, ShieldCheck, UserRound } from 'lucide-react';
import { User } from '../../types/auth';
import { ModalShell } from './ModalShell';

export type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type TwoFactorSetupState = {
  challengeToken: string;
  secret: string;
  otpauthUrl: string;
};

type AccountSettingsTab = 'account' | 'security' | 'preferences';

export const AccountSettingsModal: React.FC<{
  open: boolean;
  user: User | null;
  passwordForm: PasswordFormState;
  passwordMessage: string;
  twoFactorSetup: TwoFactorSetupState | null;
  twoFactorCode: string;
  twoFactorMessage: string;
  twoFactorBackupCodes: string[];
  theme: 'light' | 'dark';
  onClose: () => void;
  onPasswordChange: (form: PasswordFormState) => void;
  onPasswordSubmit: () => void;
  onStartTwoFactorSetup: () => void;
  onTwoFactorCodeChange: (value: string) => void;
  onVerifyTwoFactorSetup: () => void;
  onThemeChange: (theme: 'light' | 'dark') => void;
}> = ({
  open,
  user,
  passwordForm,
  passwordMessage,
  twoFactorSetup,
  twoFactorCode,
  twoFactorMessage,
  twoFactorBackupCodes,
  theme,
  onClose,
  onPasswordChange,
  onPasswordSubmit,
  onStartTwoFactorSetup,
  onTwoFactorCodeChange,
  onVerifyTwoFactorSetup,
  onThemeChange
}) => {
  const [activeTab, setActiveTab] = useState<AccountSettingsTab>('account');
  const initials = useMemo(
    () => (user?.name || 'CAD').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'CAD',
    [user?.name]
  );

  return (
    <ModalShell title="Account Settings" open={open} onClose={onClose} maxWidthClass="max-w-3xl" placement="center" contentClassName="max-h-[78vh] overflow-auto p-0">
      <div className="grid min-h-[32rem] sm:grid-cols-[13rem_1fr]">
        <aside className="border-b border-cad-line bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950 sm:border-b-0 sm:border-r">
          <div className="mb-3 flex items-center gap-3 rounded-md border border-cad-line bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cad-blue/10 text-sm font-black text-cad-blue dark:bg-blue-950 dark:text-blue-100">
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-slate-950 dark:text-white">{user?.name || 'User'}</span>
              <span className="block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{user?.email}</span>
            </span>
          </div>
          <div className="grid gap-1">
            {([
              ['account', 'Account', <UserRound size={16} />],
              ['security', 'Security', <ShieldCheck size={16} />],
              ['preferences', 'Preferences', <Monitor size={16} />]
            ] as Array<[AccountSettingsTab, string, React.ReactNode]>).map(([tab, label, icon]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-2 rounded px-3 py-2 text-left text-sm font-bold transition ${
                  activeTab === tab
                    ? 'bg-cad-blue text-white'
                    : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900'
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </aside>

        <section className="p-4">
          {activeTab === 'account' && (
            <div className="grid gap-4">
              <h3 className="text-base font-black text-slate-950 dark:text-white">Account</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Info label="Name" value={user?.name || 'Unavailable'} />
                <Info label="Email" value={user?.email || 'Unavailable'} />
                <Info label="Role" value={user?.role || 'Unavailable'} />
                <Info label="Badge" value={user?.badge || 'Not set'} />
                <Info label="Unit" value={user?.cadUnitNumber || user?.unitNumber || 'Not set'} />
                <Info label="District" value={user?.district || 'Unassigned'} />
              </div>
              <div className="rounded-md border border-cad-line bg-slate-50 p-3 text-sm font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                Profile identity fields are managed by an administrator so CAD unit assignments stay consistent.
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="grid gap-5">
              <section className="grid gap-3">
                <h3 className="text-base font-black text-slate-950 dark:text-white">Password</h3>
                <div className="grid gap-3">
                  <PasswordInput value={passwordForm.currentPassword} placeholder="Current password" onChange={(value) => onPasswordChange({ ...passwordForm, currentPassword: value })} />
                  <PasswordInput value={passwordForm.newPassword} placeholder="New password" onChange={(value) => onPasswordChange({ ...passwordForm, newPassword: value })} />
                  <PasswordInput value={passwordForm.confirmPassword} placeholder="Confirm new password" onChange={(value) => onPasswordChange({ ...passwordForm, confirmPassword: value })} />
                </div>
                {passwordMessage && <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{passwordMessage}</p>}
                <button type="button" onClick={onPasswordSubmit} className="w-fit rounded-md bg-cad-blue px-4 py-2 text-sm font-black text-white">
                  Update Password
                </button>
              </section>

              <section className="grid gap-3 border-t border-cad-line pt-4 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-slate-950 dark:text-white">Two-Factor Authentication</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                      {user?.twoFactorEnabled ? '2FA is enabled on this account.' : 'Set up an authenticator app for this account.'}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black ${
                    user?.twoFactorEnabled
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800'
                      : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800'
                  }`}>
                    {user?.twoFactorEnabled ? <CheckCircle2 size={14} /> : <KeyRound size={14} />}
                    {user?.twoFactorEnabled ? 'Enabled' : 'Setup Needed'}
                  </span>
                </div>
                {!user?.twoFactorEnabled && !twoFactorSetup && (
                  <button type="button" onClick={onStartTwoFactorSetup} className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                    Set Up 2FA
                  </button>
                )}
                {twoFactorSetup && (
                  <div className="grid gap-3 rounded-md border border-cad-line bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <div className="mx-auto rounded-lg border border-cad-line bg-white p-3 shadow-control dark:border-slate-700">
                      <QRCodeSVG value={twoFactorSetup.otpauthUrl} size={176} level="M" includeMargin />
                    </div>
                    <Info label="Manual Secret" value={twoFactorSetup.secret} mono />
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={twoFactorCode}
                      onChange={(event) => onTwoFactorCodeChange(event.target.value)}
                      placeholder="Enter 6 digit code"
                      className="h-10 rounded-md border border-cad-line bg-white px-3 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <button type="button" onClick={onVerifyTwoFactorSetup} className="w-fit rounded-md bg-cad-blue px-4 py-2 text-sm font-black text-white">
                      Verify 2FA
                    </button>
                  </div>
                )}
                {twoFactorMessage && <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{twoFactorMessage}</p>}
                {twoFactorBackupCodes.length > 0 && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
                    <p className="text-sm font-black text-emerald-800 dark:text-emerald-100">Backup Codes</p>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {twoFactorBackupCodes.map((code) => (
                        <code key={code} className="rounded bg-white px-2 py-1 text-xs font-black text-slate-700 dark:bg-slate-900 dark:text-slate-100">{code}</code>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="grid gap-4">
              <h3 className="text-base font-black text-slate-950 dark:text-white">Preferences</h3>
              <div className="rounded-md border border-cad-line p-3 dark:border-slate-800">
                <p className="text-sm font-black text-slate-950 dark:text-white">Theme</p>
                <div className="mt-3 flex rounded-md border border-cad-line p-1 dark:border-slate-700">
                  {(['light', 'dark'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onThemeChange(item)}
                      className={`flex-1 rounded px-3 py-2 text-sm font-black capitalize ${
                        theme === item ? 'bg-cad-blue text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </ModalShell>
  );
};

const Info: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
    {label}
    <input
      value={value}
      readOnly
      className={`h-10 rounded-md border border-cad-line bg-white px-3 text-sm font-semibold text-slate-700 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 ${mono ? 'font-mono' : ''}`}
    />
  </label>
);

const PasswordInput: React.FC<{ value: string; placeholder: string; onChange: (value: string) => void }> = ({ value, placeholder, onChange }) => (
  <input
    type="password"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    placeholder={placeholder}
    className="h-10 rounded-md border border-cad-line bg-white px-3 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
  />
);
