import { AdminConfigurationItem } from '../services/ConfigurationService';

export type MapPoint = { lat: number; lon: number };

export type MapGeofence = {
  id: string;
  name: string;
  code: string;
  kind: 'district' | 'beat';
  points: MapPoint[];
};

const isPoint = (value: unknown): value is { lat: number | string; lon?: number | string; lng?: number | string } => {
  const point = value as { lat?: unknown; lon?: unknown; lng?: unknown };
  const lat = Number(point?.lat);
  const lon = Number(point?.lon ?? point?.lng);
  return Number.isFinite(lat) && Number.isFinite(lon);
};

const parseBoundary = (metadata: Record<string, unknown>): MapPoint[] => {
  const raw = metadata.boundary || metadata.polygon || metadata.points;
  if (Array.isArray(raw)) {
    return raw.filter(isPoint).map((point) => ({
      lat: Number(point.lat),
      lon: Number(point.lon ?? point.lng)
    }));
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
    .map((item) => {
      const kind: MapGeofence['kind'] = item.category.toLowerCase().includes('beat') ? 'beat' : 'district';
      return {
        id: item.id,
        name: item.name,
        code: item.code,
        kind,
        points: parseBoundary(item.metadata || {})
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
