import { AdminConfigurationItem, IncidentPriority, UnitStatus } from '../types/auth';

export const defaultUnitStatuses: UnitStatus[] = [
  'Available',
  'Dispatched',
  'En Route',
  'On Scene',
  'Transporting',
  'Traffic Stop'
];

export const knownUnitStatus = (value: string): value is UnitStatus =>
  defaultUnitStatuses.includes(value as UnitStatus);

export const configItemsFor = (items: AdminConfigurationItem[], section: AdminConfigurationItem['section']) =>
  items
    .filter((item) => item.section === section && item.active)
    .sort((first, second) => first.sortOrder - second.sortOrder || first.name.localeCompare(second.name));

export const unitStatusesFromConfig = (items: AdminConfigurationItem[]): UnitStatus[] => {
  const statuses = configItemsFor(items, 'statuses')
    .filter((item) => item.category.toLowerCase() === 'unit' && knownUnitStatus(item.name))
    .map((item) => item.name as UnitStatus);

  return statuses.length > 0 ? Array.from(new Set(statuses)) : defaultUnitStatuses;
};

export const callTypesFromConfig = (items: AdminConfigurationItem[]) => {
  const calls = configItemsFor(items, 'calls').map((item) => ({
    label: item.name,
    priority: priorityFromMetadata(item.metadata?.priority)
  }));

  return calls.length > 0 ? calls : [{ label: '911 Call', priority: 'Normal' as IncidentPriority }];
};

export const sessionTimeoutMinutesFromConfig = (items: AdminConfigurationItem[], fallback = 30): number => {
  const value = items.find((item) => item.section === 'security' && item.code === 'IDLE_TIMEOUT_MINUTES')?.metadata
    ?.value;
  const minutes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return fallback;
  }

  return Math.min(480, Math.max(1, minutes));
};

const priorityFromMetadata = (value: unknown): IncidentPriority => {
  return value === 'Low' || value === 'Normal' || value === 'High' || value === 'Emergency' ? value : 'Normal';
};
