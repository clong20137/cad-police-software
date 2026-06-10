import React, { useEffect, useMemo, useState } from 'react';
import { Car, Fingerprint, IdCard, RefreshCw, Search } from 'lucide-react';
import { authClient } from '../../services/authClient';
import { AuditLogEntry, BmvInquiryRequest, IdacsInquiryRequest, IntegrationStatus, User } from '../../types/auth';

export type InquiryKind = 'plate' | 'vin' | 'name';

export interface InquirySubmission {
  kind: InquiryKind;
  type: '10-27' | '10-28';
  title: string;
  description: string;
  bmvRequest: BmvInquiryRequest;
  idacsRequest: IdacsInquiryRequest;
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
    officerId: defaultOfficerId,
    reason: 'Probable Cause'
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
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationStatus[]>([]);
  const [history, setHistory] = useState<AuditLogEntry[]>([]);
  const [historySearch, setHistorySearch] = useState('');

  const loadIntegrationContext = async () => {
    try {
      const [statuses, inquiryHistory] = await Promise.all([
        authClient.getIntegrationStatuses(),
        authClient.getInquiryHistory(100)
      ]);
      setIntegrationStatuses(statuses);
      setHistory(inquiryHistory);
    } catch {
      setIntegrationStatuses([]);
      setHistory([]);
    }
  };

  useEffect(() => {
    loadIntegrationContext();
  }, []);

  const filteredHistory = history.filter((entry) => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return true;
    return [entry.action, entry.resourceId, JSON.stringify(entry.metadata || {})]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  const bmvStatus = integrationStatuses.find((item) => item.code === 'BMV');
  const idacsStatus = integrationStatuses.find((item) => item.code === 'IDACS');
  const integrationWarning = [bmvStatus, idacsStatus].filter((item) => item && (!item.enabled || !item.configured)) as IntegrationStatus[];

  const submitNameInquiry = () => {
    if (!driver.reason.trim()) return;
    const fields = [
      `Name: ${driver.name.trim() || 'N/A'}`,
      `DOB: ${driver.dob || 'N/A'}`,
      `Sex: ${driver.sex}`,
      `State: ${driver.state}`,
      `Reason: ${driver.reason.trim() || 'N/A'}`,
      `Image: ${driver.image ? 'Requested' : 'Not requested'}`,
      `Officer: ${selectedOfficer?.cadUnitNumber || selectedOfficer?.unitNumber || selectedOfficer?.name || 'N/A'}`
    ];

    onSubmit({
      kind: 'name',
      type: '10-27',
      title: '10-27 Driver License Inquiry',
      description: fields.join('\n'),
      bmvRequest: {
        kind: 'driver-license',
        reason: driver.reason.trim(),
        officerId: driver.officerId || undefined,
        driver: {
          name: driver.name.trim(),
          dob: driver.dob,
          sex: driver.sex,
          state: driver.state,
          imageRequested: driver.image
        }
      },
      idacsRequest: {
        kind: 'driver-license',
        reason: driver.reason.trim(),
        officerId: driver.officerId || undefined,
        driver: {
          name: driver.name.trim(),
          dob: driver.dob,
          sex: driver.sex,
          state: driver.state,
          imageRequested: driver.image
        }
      }
    });
  };

  const submitVehicleInquiry = () => {
    const identifier = plateMode ? vehicle.plate.trim() : vehicle.vin.trim();
    if (!vehicle.reason.trim()) return;
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
      description: fields.join('\n'),
      bmvRequest: {
        kind: 'vehicle-registration',
        reason: vehicle.reason.trim(),
        vehicle: {
          plate: plateMode ? identifier : undefined,
          vin: plateMode ? undefined : identifier,
          year: vehicle.year.trim(),
          state: vehicle.state,
          avq: vehicle.avq.trim()
        }
      },
      idacsRequest: {
        kind: 'vehicle-registration',
        reason: vehicle.reason.trim(),
        vehicle: {
          plate: plateMode ? identifier : undefined,
          vin: plateMode ? undefined : identifier,
          year: vehicle.year.trim(),
          state: vehicle.state,
          avq: vehicle.avq.trim()
        }
      }
    });
  };

  return (
    <div className="space-y-4">
      {integrationWarning.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {integrationWarning.map((item) => item.message).join(' ')}
        </div>
      )}

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
              Query Reason
              <input value={driver.reason} onChange={(event) => setDriver((value) => ({ ...value, reason: event.target.value }))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
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
          <button type="button" disabled={busy || !driver.name.trim() || !driver.reason.trim()} onClick={submitNameInquiry} className="inline-flex items-center justify-center gap-2 rounded-md bg-cad-blue px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
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
          <button type="button" disabled={busy || !vehicle.reason.trim() || !(plateMode ? vehicle.plate.trim() : vehicle.vin.trim())} onClick={submitVehicleInquiry} className="inline-flex items-center justify-center gap-2 rounded-md bg-cad-blue px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            <Search size={17} />
            Submit 10-28
          </button>
        </div>
      )}

      {message && <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{message}</p>}

      <section className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-950 dark:text-white">Inquiry History</h3>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">BMV, IDACS, MyCase, and protective order audits.</p>
          </div>
          <button type="button" onClick={loadIntegrationContext} className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold dark:border-slate-700 dark:bg-slate-900">
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
        <input
          value={historySearch}
          onChange={(event) => setHistorySearch(event.target.value)}
          placeholder="Search inquiry history"
          className="mt-3 h-9 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
        <div className="mt-3 max-h-52 overflow-y-auto rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {filteredHistory.length === 0 && <p className="p-3 text-sm font-semibold text-slate-500 dark:text-slate-400">No inquiry history found.</p>}
          {filteredHistory.slice(0, 25).map((entry) => (
            <div key={entry.id} className="border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <span className="font-black uppercase text-cad-blue dark:text-blue-100">{entry.action.replace('_', ' ')}</span>
                <span className="shrink-0 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 truncate font-semibold text-slate-600 dark:text-slate-300">{JSON.stringify(entry.metadata || {})}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
