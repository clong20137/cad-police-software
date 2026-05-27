import React from 'react';
import { ModalShell } from './ModalShell';

export type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export const ChangePasswordModal: React.FC<{
  open: boolean;
  form: PasswordFormState;
  message: string;
  onClose: () => void;
  onChange: (form: PasswordFormState) => void;
  onSubmit: () => void;
}> = ({ open, form, message, onClose, onChange, onSubmit }) => (
  <ModalShell title="Change Password" open={open} onClose={onClose} maxWidthClass="max-w-md" placement="center">
    <div className="grid gap-3">
      <input
        type="password"
        value={form.currentPassword}
        onChange={(event) => onChange({ ...form, currentPassword: event.target.value })}
        placeholder="Current password"
        className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      />
      <input
        type="password"
        value={form.newPassword}
        onChange={(event) => onChange({ ...form, newPassword: event.target.value })}
        placeholder="New password"
        className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      />
      <input
        type="password"
        value={form.confirmPassword}
        onChange={(event) => onChange({ ...form, confirmPassword: event.target.value })}
        placeholder="Confirm new password"
        className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      />
      {message && <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{message}</p>}
      <button type="button" onClick={onSubmit} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white">
        Update Password
      </button>
    </div>
  </ModalShell>
);
