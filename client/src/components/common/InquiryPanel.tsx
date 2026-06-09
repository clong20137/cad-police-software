import React, { useMemo, useState } from 'react';
import { Car, Fingerprint, IdCard, Search } from 'lucide-react';
import { User } from '../../types/auth';

export type InquiryKind = 'plate' | 'vin' | 'name';

export interface InquirySubmission {
  kind: InquiryKind;
  type: '10-27' | '10-28';
  title: string;
  description: string;
}

interface InquiryPanelProps {
  officers: User[];
  defaultOfficerId?: string;
  busy?: boolean;
  message?: string;
  onSubmit: (submission: InquirySubmission) => void;
}

const states = ['IN', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'IL', 'KY', 'MI', 'OH', 'TN'];
const sexes = ['Male', 'Female', 'Unknown'];

export const InquiryPanel: React.FC<InquiryPanelProps> = ({
  officers,
  defaultOfficerId = '',
  busy = false,
  message,
  onSubmit
}) => {
  const [activeTab, setActiveTab] = useState<InquiryKind>('plate');
  const [driver, setDriver] = useState({
    name: '',
    dob: '',
    sex: 'Unknown',
    state: 'IN',
    image: false,
    officerId: defaultOfficerId
  });
  const [vehicle, setVehicle] = useState({
    plate: '',
    vin: '',
    reason: 'Probable Cause',
    year: '',
    state: 'IN',
    avq: ''
  });

  const officerOptions = useMemo(
    () => officers.filter((officer) => officer.active !== false),
    [officers]
  );
  const selectedOfficer = officerOptions.find((officer) => officer.id === driver.officerId);
  const plateMode = activeTab === 'plate';

  const submitNameInquiry = () => {
    const fields = [
      `Name: ${driver.name.trim() || 'N/A'}`,
      `DOB: ${driver.dob || 'N/A'}`,
      `Sex: ${driver.sex}`,
      `State: ${driver.state}`,
      `Image: ${driver.image ? 'Requested' : 'Not requested'}`,
      `Officer: ${selectedOfficer?.cadUnitNumber || selectedOfficer?.unitNumber || selectedOfficer?.name || 'N/A'}`
    ];

    onSubmit({
      kind: 'name',
      type: '10-27',
      title: '10-27 Driver License Inquiry',
      description: fields.join('\n')
    });
  };

  const submitVehicleInquiry = () => {
    const identifier = plateMode ? vehicle.plate.trim() : vehicle.vin.trim();
    const fields = [
      `${plateMode ? 'Plate' : 'VIN'}: ${identifier || 'N/A'}`,
      `Type: ${vehicle.reason.trim() || 'Probable Cause'}`,
      `Year: ${vehicle.year.trim() || 'N/A'}`,
      `State: ${vehicle.state}`,
      `AVQ: ${vehicle.avq.trim() || 'N/A'}`
    ];

    onSubmit({
      kind: activeTab,
      type: '10-28',
      title: `10-28 ${plateMode ? 'Plate' : 'VIN'} Inquiry`,
      description: fields.join('\n')
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
        {[
          { id: 'plate' as InquiryKind, label: 'Plate', icon: <Car size={16} /> },
          { id: 'vin' as InquiryKind, label: 'VIN', icon: <Fingerprint size={16} /> },
          { id: 'name' as InquiryKind, label: 'Name', icon: <IdCard size={16} /> }
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 px-3 text-sm font-bold ${
              activeTab === tab.id
                ? 'bg-cad-blue text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'name' ? (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Name
              <input value={driver.name} onChange={(event) => setDriver((value) => ({ ...value, name: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              DOB
              <input type="date" value={driver.dob} onChange={(event) => setDriver((value) => ({ ...value, dob: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Sex
              <select value={driver.sex} onChange={(event) => setDriver((value) => ({ ...value, sex: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                {sexes.map((sex) => <option key={sex} value={sex}>{sex}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              State
              <select value={driver.state} onChange={(event) => setDriver((value) => ({ ...value, state: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                {states.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Officer
              <select value={driver.officerId} onChange={(event) => setDriver((value) => ({ ...value, officerId: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                <option value="">Select officer</option>
                {officerOptions.map((officer) => (
                  <option key={officer.id} value={officer.id}>{officer.cadUnitNumber || officer.unitNumber || officer.badge || officer.name} - {officer.name}</option>
                ))}
              </select>
            </label>
            <label className="flex min-h-[4.25rem] items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              Toggle Image
              <input type="checkbox" checked={driver.image} onChange={(event) => setDriver((value) => ({ ...value, image: event.target.checked }))} className="h-5 w-5 rounded border-slate-300 text-cad-blue focus:ring-cad-blue" />
            </label>
          </div>
          <button type="button" disabled={busy || !driver.name.trim()} onClick={submitNameInquiry} className="inline-flex items-center justify-center gap-2 rounded-md bg-cad-blue px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            <Search size={17} />
            Submit 10-27
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              {plateMode ? 'Plate #' : 'VIN'}
              <input value={plateMode ? vehicle.plate : vehicle.vin} onChange={(event) => setVehicle((value) => ({ ...value, [plateMode ? 'plate' : 'vin']: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal uppercase outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Type
              <input value={vehicle.reason} onChange={(event) => setVehicle((value) => ({ ...value, reason: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Year
              <input inputMode="numeric" value={vehicle.year} onChange={(event) => setVehicle((value) => ({ ...value, year: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              State
              <select value={vehicle.state} onChange={(event) => setVehicle((value) => ({ ...value, state: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                {states.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2">
              AVQ
              <input value={vehicle.avq} onChange={(event) => setVehicle((value) => ({ ...value, avq: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
          </div>
          <button type="button" disabled={busy || !(plateMode ? vehicle.plate.trim() : vehicle.vin.trim())} onClick={submitVehicleInquiry} className="inline-flex items-center justify-center gap-2 rounded-md bg-cad-blue px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            <Search size={17} />
            Submit 10-28
          </button>
        </div>
      )}

      {message && <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{message}</p>}
    </div>
  );
};
