import { AdminConfigurationItem } from '../types/auth';

export type MapPoint = { lat: number; lon: number };

export type MapGeofence = {
  id: string;
  name: string;
  code: string;
  kind: 'district' | 'beat';
  color: string;
  points: MapPoint[];
};

const defaultColors = ['#2563eb', '#0f766e', '#f59e0b', '#dc2626', '#7c3aed'];

const isPoint = (value: unknown): value is { lat: number | string; lon?: number | string; lng?: number | string } => {
  const point = value as { lat?: unknown; lon?: unknown; lng?: unknown };
  const lat = Number(point?.lat);
  const lon = Number(point?.lon ?? point?.lng);
  return Number.isFinite(lat) && Number.isFinite(lon);
};

const parseBoundary = (metadata: Record<string, unknown>): MapPoint[] => {
  const raw = metadata.boundary || metadata.polygon || metadata.points;
  if (Array.isArray(raw)) {
    return raw
      .filter(isPoint)
      .map((point) => ({ lat: Number(point.lat), lon: Number(point.lon ?? point.lng) }));
  }

  if (typeof raw === 'string') {
    return raw
      .split(';')
      .map((pair) => pair.trim().split(',').map(Number))
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))
      .map(([lat, lon]) => ({ lat, lon }));
  }

  return [];
};

export const geofencesFromConfig = (items: AdminConfigurationItem[]): MapGeofence[] =>
  items
    .filter((item) => item.section === 'districts' && item.active)
    .map((item, index) => {
      const metadata = item.metadata || {};
      const category = item.category.toLowerCase();
      const kind: MapGeofence['kind'] = category.includes('beat') ? 'beat' : 'district';
      return {
        id: item.id,
        name: item.name,
        code: item.code,
        kind,
        color: typeof metadata.fillColor === 'string' ? metadata.fillColor : defaultColors[index % defaultColors.length],
        points: parseBoundary(metadata)
      };
    })
    .filter((geofence) => geofence.points.length >= 3);

export const pointInGeofence = (point: MapPoint, geofence: MapGeofence): boolean => {
  let inside = false;
  for (let current = 0, previous = geofence.points.length - 1; current < geofence.points.length; previous = current++) {
    const currentPoint = geofence.points[current];
    const previousPoint = geofence.points[previous];
    const crossesLongitude =
      (currentPoint.lon > point.lon) !== (previousPoint.lon > point.lon);
    const intersects =
      crossesLongitude &&
      point.lat <
        ((previousPoint.lat - currentPoint.lat) * (point.lon - currentPoint.lon)) /
          (previousPoint.lon - currentPoint.lon) +
          currentPoint.lat;
    if (intersects) inside = !inside;
  }
  return inside;
};

export const geofenceAssignmentForPoint = (
  point: MapPoint | null,
  geofences: MapGeofence[]
): { district?: string; beat?: string } => {
  if (!point) return {};
  const matches = geofences.filter((geofence) => pointInGeofence(point, geofence));
  return {
    district: matches.find((geofence) => geofence.kind === 'district')?.name,
    beat: matches.find((geofence) => geofence.kind === 'beat')?.name
  };
};
