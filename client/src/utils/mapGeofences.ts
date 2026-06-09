import { AdminConfigurationItem } from '../types/auth';

export type MapPoint = { lat: number; lon: number };

export type MapGeofence = {
  id: string;
  name: string;
  code: string;
  kind: 'district' | 'beat';
  color: string;
  rings: MapPoint[][];
  points: MapPoint[];
};

const defaultColors = ['#2563eb', '#0f766e', '#f59e0b', '#dc2626', '#7c3aed'];

const isPoint = (value: unknown): value is { lat: number | string; lon?: number | string; lng?: number | string } => {
  const point = value as { lat?: unknown; lon?: unknown; lng?: unknown };
  const lat = Number(point?.lat);
  const lon = Number(point?.lon ?? point?.lng);
  return Number.isFinite(lat) && Number.isFinite(lon);
};

const normalizeRing = (value: unknown): MapPoint[] =>
  Array.isArray(value)
    ? value
        .filter(isPoint)
        .map((point) => ({ lat: Number(point.lat), lon: Number(point.lon ?? point.lng) }))
    : [];

const parseBoundary = (metadata: Record<string, unknown>): MapPoint[][] => {
  const raw = metadata.boundaries || metadata.boundary || metadata.polygon || metadata.points;
  if (Array.isArray(raw)) {
    if (raw.every(isPoint)) {
      return [normalizeRing(raw)].filter((ring) => ring.length >= 3);
    }

    return raw
      .map(normalizeRing)
      .filter((ring) => ring.length >= 3);
  }

  if (typeof raw === 'string') {
    const ring = raw
      .split(';')
      .map((pair) => pair.trim().split(',').map(Number))
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))
      .map(([lat, lon]) => ({ lat, lon }));
    return ring.length >= 3 ? [ring] : [];
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
      const rings = parseBoundary(metadata);
      return {
        id: item.id,
        name: item.name,
        code: item.code,
        kind,
        color: typeof metadata.fillColor === 'string' ? metadata.fillColor : defaultColors[index % defaultColors.length],
        rings,
        points: rings[0] || []
      };
    })
    .filter((geofence) => geofence.rings.length > 0);

const pointInRing = (point: MapPoint, ring: MapPoint[]): boolean => {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const currentPoint = ring[current];
    const previousPoint = ring[previous];
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

export const pointInGeofence = (point: MapPoint, geofence: MapGeofence): boolean =>
  geofence.rings.some((ring) => pointInRing(point, ring));

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
