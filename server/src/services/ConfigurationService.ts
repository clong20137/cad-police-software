import { ResultSetHeader } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import { AdminConfigurationRow, pool } from '../db/mysql';

export type AdminConfigSection = 'agencies' | 'districts' | 'units' | 'calls' | 'statuses' | 'security';

export interface AdminConfigurationItem {
  id: string;
  section: AdminConfigSection;
  name: string;
  code: string;
  agency: string;
  category: string;
  active: boolean;
  sortOrder: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertConfigurationItemRequest {
  section?: AdminConfigSection;
  name?: string;
  code?: string;
  agency?: string;
  category?: string;
  active?: boolean;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
}

const allowedSections = new Set<AdminConfigSection>(['agencies', 'districts', 'units', 'calls', 'statuses', 'security']);

const districtBoundary = (
  nw: [number, number],
  ne: [number, number],
  se: [number, number],
  sw: [number, number]
): Array<{ lat: number; lon: number }> => [
  { lat: nw[0], lon: nw[1] },
  { lat: ne[0], lon: ne[1] },
  { lat: se[0], lon: se[1] },
  { lat: sw[0], lon: sw[1] }
];

const ispDistrictDefaults: Array<Omit<AdminConfigurationItem, 'createdAt' | 'updatedAt'>> = [
  {
    id: 'district-isp-21-toll-road',
    section: 'districts',
    name: 'ISP District 21 - Toll Road',
    code: 'ISP-21',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 10,
    metadata: {
      fillColor: '#0f766e',
      counties: ['Indiana Toll Road'],
      boundary: districtBoundary([41.77, -87.55], [41.77, -84.80], [41.61, -84.80], [41.61, -87.55])
    }
  },
  {
    id: 'district-isp-13-lowell',
    section: 'districts',
    name: 'ISP District 13 - Lowell',
    code: 'ISP-13',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 20,
    metadata: {
      fillColor: '#2563eb',
      counties: ['Jasper', 'Lake', 'LaPorte', 'Newton', 'Porter', 'Pulaski', 'Starke'],
      boundary: districtBoundary([41.77, -87.55], [41.77, -86.45], [40.72, -86.45], [40.72, -87.55])
    }
  },
  {
    id: 'district-isp-14-lafayette',
    section: 'districts',
    name: 'ISP District 14 - Lafayette',
    code: 'ISP-14',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 30,
    metadata: {
      fillColor: '#7c3aed',
      counties: ['Benton', 'Carroll', 'Clinton', 'Fountain', 'Montgomery', 'Tippecanoe', 'Warren', 'White'],
      boundary: districtBoundary([40.72, -87.55], [40.72, -86.45], [39.70, -86.45], [39.70, -87.55])
    }
  },
  {
    id: 'district-isp-16-peru',
    section: 'districts',
    name: 'ISP District 16 - Peru',
    code: 'ISP-16',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 40,
    metadata: {
      fillColor: '#0891b2',
      counties: ['Cass', 'Fulton', 'Grant', 'Howard', 'Miami', 'Tipton', 'Wabash'],
      boundary: districtBoundary([41.00, -86.45], [41.00, -85.55], [40.30, -85.55], [40.30, -86.45])
    }
  },
  {
    id: 'district-isp-22-fort-wayne',
    section: 'districts',
    name: 'ISP District 22 - Fort Wayne',
    code: 'ISP-22',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 50,
    metadata: {
      fillColor: '#dc2626',
      counties: ['Adams', 'Allen', 'Blackford', 'DeKalb', 'Huntington', 'Jay', 'LaGrange', 'Noble', 'Steuben', 'Wells', 'Whitley'],
      boundary: districtBoundary([41.77, -85.55], [41.77, -84.78], [40.30, -84.78], [40.30, -85.55])
    }
  },
  {
    id: 'district-isp-24-bremen',
    section: 'districts',
    name: 'ISP District 24 - Bremen',
    code: 'ISP-24',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 60,
    metadata: {
      fillColor: '#ca8a04',
      counties: ['Elkhart', 'Kosciusko', 'Marshall', 'St. Joseph'],
      boundary: districtBoundary([41.77, -86.45], [41.77, -85.55], [41.00, -85.55], [41.00, -86.45])
    }
  },
  {
    id: 'district-isp-33-bloomington',
    section: 'districts',
    name: 'ISP District 33 - Bloomington',
    code: 'ISP-33',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 70,
    metadata: {
      fillColor: '#16a34a',
      counties: ['Brown', 'Greene', 'Lawrence', 'Monroe', 'Morgan', 'Owen'],
      boundary: districtBoundary([39.70, -86.45], [39.70, -85.85], [38.70, -85.85], [38.70, -86.80])
    }
  },
  {
    id: 'district-isp-34-jasper',
    section: 'districts',
    name: 'ISP District 34 - Jasper',
    code: 'ISP-34',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 80,
    metadata: {
      fillColor: '#ea580c',
      counties: ['Crawford', 'Daviess', 'Dubois', 'Martin', 'Orange', 'Perry', 'Spencer'],
      boundary: districtBoundary([38.80, -87.35], [38.80, -86.20], [37.75, -86.20], [37.75, -87.35])
    }
  },
  {
    id: 'district-isp-35-evansville',
    section: 'districts',
    name: 'ISP District 35 - Evansville',
    code: 'ISP-35',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 90,
    metadata: {
      fillColor: '#be123c',
      counties: ['Gibson', 'Knox', 'Pike', 'Posey', 'Vanderburgh', 'Warrick'],
      boundary: districtBoundary([38.80, -88.10], [38.80, -87.25], [37.75, -87.25], [37.75, -88.10])
    }
  },
  {
    id: 'district-isp-42-versailles',
    section: 'districts',
    name: 'ISP District 42 - Versailles',
    code: 'ISP-42',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 100,
    metadata: {
      fillColor: '#4f46e5',
      counties: ['Bartholomew', 'Dearborn', 'Decatur', 'Franklin', 'Jackson', 'Jefferson', 'Jennings', 'Ohio', 'Ripley', 'Switzerland'],
      boundary: districtBoundary([39.45, -86.15], [39.45, -84.78], [38.55, -84.78], [38.55, -86.15])
    }
  },
  {
    id: 'district-isp-45-sellersburg',
    section: 'districts',
    name: 'ISP District 45 - Sellersburg',
    code: 'ISP-45',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 110,
    metadata: {
      fillColor: '#db2777',
      counties: ['Clark', 'Floyd', 'Harrison', 'Scott', 'Washington'],
      boundary: districtBoundary([38.75, -86.35], [38.75, -85.35], [37.75, -85.35], [37.75, -86.35])
    }
  },
  {
    id: 'district-isp-51-pendleton',
    section: 'districts',
    name: 'ISP District 51 - Pendleton',
    code: 'ISP-51',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 120,
    metadata: {
      fillColor: '#0284c7',
      counties: ['Delaware', 'Fayette', 'Henry', 'Madison', 'Randolph', 'Rush', 'Union', 'Wayne'],
      boundary: districtBoundary([40.30, -85.55], [40.30, -84.78], [39.30, -84.78], [39.30, -85.55])
    }
  },
  {
    id: 'district-isp-52-indianapolis',
    section: 'districts',
    name: 'ISP District 52 - Indianapolis',
    code: 'ISP-52',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 130,
    metadata: {
      fillColor: '#9333ea',
      counties: ['Boone', 'Hamilton', 'Hancock', 'Hendricks', 'Johnson', 'Marion', 'Shelby'],
      boundary: districtBoundary([40.30, -86.45], [40.30, -85.55], [39.30, -85.55], [39.30, -86.45])
    }
  },
  {
    id: 'district-isp-53-putnamville',
    section: 'districts',
    name: 'ISP District 53 - Putnamville',
    code: 'ISP-53',
    agency: 'Indiana State Police',
    category: 'District',
    active: true,
    sortOrder: 140,
    metadata: {
      fillColor: '#64748b',
      counties: ['Clay', 'Parke', 'Putnam', 'Sullivan', 'Vermillion', 'Vigo'],
      boundary: districtBoundary([39.70, -87.55], [39.70, -86.45], [38.70, -86.45], [38.70, -87.55])
    }
  }
];

const defaults: Array<Omit<AdminConfigurationItem, 'createdAt' | 'updatedAt'>> = [
  { id: 'agency-police', section: 'agencies', name: 'Police', code: 'POL', agency: 'CAD', category: 'Public Safety', active: true, sortOrder: 10, metadata: {} },
  { id: 'agency-ems', section: 'agencies', name: 'EMS', code: 'EMS', agency: 'CAD', category: 'Medical', active: true, sortOrder: 20, metadata: {} },
  { id: 'agency-fire', section: 'agencies', name: 'Fire', code: 'FIRE', agency: 'CAD', category: 'Fire', active: true, sortOrder: 30, metadata: {} },
  { id: 'agency-towing', section: 'agencies', name: 'Towing', code: 'TOW', agency: 'CAD', category: 'Service', active: true, sortOrder: 40, metadata: {} },
  ...ispDistrictDefaults,
  { id: 'unit-patrol', section: 'units', name: 'Patrol Unit', code: 'PATROL', agency: 'Police', category: 'Officer', active: true, sortOrder: 10, metadata: {} },
  { id: 'unit-medic', section: 'units', name: 'Medic Unit', code: 'MEDIC', agency: 'EMS', category: 'Ambulance', active: true, sortOrder: 20, metadata: {} },
  { id: 'unit-engine', section: 'units', name: 'Engine', code: 'ENG', agency: 'Fire', category: 'Apparatus', active: true, sortOrder: 30, metadata: {} },
  { id: 'unit-tow', section: 'units', name: 'Tow Truck', code: 'TOW', agency: 'Towing', category: 'Truck', active: true, sortOrder: 40, metadata: {} },
  { id: 'call-traffic-stop', section: 'calls', name: 'Traffic Stop', code: 'TS', agency: 'Police', category: 'Law', active: true, sortOrder: 10, metadata: { priority: 'Normal' } },
  { id: 'call-medical', section: 'calls', name: 'Medical Emergency', code: 'MED', agency: 'EMS', category: 'Medical', active: true, sortOrder: 20, metadata: { priority: 'High' } },
  { id: 'call-fire', section: 'calls', name: 'Structure Fire', code: 'FIRE', agency: 'Fire', category: 'Fire', active: true, sortOrder: 30, metadata: { priority: 'Emergency' } },
  { id: 'call-tow', section: 'calls', name: 'Tow Request', code: 'TOW', agency: 'Towing', category: 'Service', active: true, sortOrder: 40, metadata: { priority: 'Normal' } },
  { id: 'status-available', section: 'statuses', name: 'Available', code: 'AVL', agency: 'All', category: 'Unit', active: true, sortOrder: 10, metadata: { color: 'green' } },
  { id: 'status-enroute', section: 'statuses', name: 'En Route', code: 'ENR', agency: 'All', category: 'Unit', active: true, sortOrder: 20, metadata: { color: 'yellow' } },
  { id: 'status-onscene', section: 'statuses', name: 'On Scene', code: 'ONS', agency: 'All', category: 'Unit', active: true, sortOrder: 30, metadata: { color: 'red' } },
  { id: 'status-clear', section: 'statuses', name: 'Cleared', code: 'CLR', agency: 'All', category: 'Disposition', active: true, sortOrder: 40, metadata: { color: 'gray' } },
  { id: 'security-idle-timeout', section: 'security', name: 'Idle timeout minutes', code: 'IDLE_TIMEOUT_MINUTES', agency: 'All', category: 'Session', active: true, sortOrder: 10, metadata: { value: 30, type: 'number', min: 1 } },
  { id: 'security-location-stale', section: 'security', name: 'Location stale seconds', code: 'LOCATION_STALE_SECONDS', agency: 'All', category: 'Realtime', active: true, sortOrder: 20, metadata: { value: 45, type: 'number', min: 10 } },
  { id: 'security-heartbeat', section: 'security', name: 'Websocket heartbeat seconds', code: 'WEBSOCKET_HEARTBEAT_SECONDS', agency: 'All', category: 'Realtime', active: true, sortOrder: 30, metadata: { value: 20, type: 'number', min: 5 } },
  { id: 'security-https', section: 'security', name: 'Require HTTPS', code: 'REQUIRE_HTTPS', agency: 'All', category: 'Transport', active: true, sortOrder: 40, metadata: { value: true, type: 'boolean' } },
  { id: 'security-db-ssl', section: 'security', name: 'Require DB SSL', code: 'REQUIRE_DB_SSL', agency: 'All', category: 'Database', active: true, sortOrder: 50, metadata: { value: true, type: 'boolean' } },
  { id: 'security-registration-enabled', section: 'security', name: 'Allow public registration', code: 'ALLOW_PUBLIC_REGISTRATION', agency: 'All', category: 'Access', active: true, sortOrder: 60, metadata: { value: true, type: 'boolean' } }
];

const toItem = (row: AdminConfigurationRow): AdminConfigurationItem => ({
  id: row.id,
  section: row.section as AdminConfigSection,
  name: row.name,
  code: row.code,
  agency: row.agency,
  category: row.category,
  active: Boolean(row.active),
  sortOrder: Number(row.sort_order || 0),
  metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : row.metadata || {},
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export class ConfigurationService {
  static async ensureDefaults(): Promise<void> {
    for (const item of defaults) {
      await pool.execute(
        `
          INSERT IGNORE INTO admin_configuration_items (id, section, name, code, agency, category, active, sort_order, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          item.id,
          item.section,
          item.name,
          item.code,
          item.agency,
          item.category,
          item.active,
          item.sortOrder,
          JSON.stringify(item.metadata)
        ]
      );
      await pool.execute(
        `
          UPDATE admin_configuration_items
          SET metadata = ?
          WHERE id = ?
            AND (metadata IS NULL OR JSON_LENGTH(metadata) = 0)
        `,
        [JSON.stringify(item.metadata), item.id]
      );
    }
    await pool.execute(
      `
        UPDATE admin_configuration_items
        SET active = 0,
            category = 'Legacy'
        WHERE id IN ('district-north', 'district-south', 'district-beat-central')
      `
    );
  }

  static async list(): Promise<AdminConfigurationItem[]> {
    await this.ensureDefaults();
    const [rows] = await pool.execute<AdminConfigurationRow[]>(
      'SELECT * FROM admin_configuration_items ORDER BY section ASC, sort_order ASC, name ASC'
    );
    return rows.map(toItem);
  }

  static async getBoolean(code: string, fallback: boolean): Promise<boolean> {
    await this.ensureDefaults();
    const [rows] = await pool.execute<AdminConfigurationRow[]>(
      'SELECT * FROM admin_configuration_items WHERE section = ? AND code = ? LIMIT 1',
      ['security', code]
    );
    const item = rows[0] ? toItem(rows[0]) : null;
    const value = item?.metadata?.value;
    return item?.active !== false && typeof value === 'boolean' ? value : fallback;
  }

  static async create(input: UpsertConfigurationItemRequest): Promise<AdminConfigurationItem> {
    const section = input.section;
    if (!section || !allowedSections.has(section)) {
      throw new Error('Valid configuration section is required');
    }

    const id = uuidv4();
    await pool.execute(
      `
        INSERT INTO admin_configuration_items (id, section, name, code, agency, category, active, sort_order, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        section,
        input.name?.trim() || 'New Item',
        input.code?.trim().toUpperCase() || `NEW-${Date.now()}`,
        input.agency?.trim() || 'All',
        input.category?.trim() || '',
        input.active ?? true,
        input.sortOrder || 0,
        JSON.stringify(input.metadata || {})
      ]
    );
    const item = await this.get(id);
    if (!item) {
      throw new Error('Unable to create configuration item');
    }
    return item;
  }

  static async update(id: string, input: UpsertConfigurationItemRequest): Promise<AdminConfigurationItem | null> {
    const existing = await this.get(id);
    if (!existing) {
      return null;
    }

    await pool.execute<ResultSetHeader>(
      `
        UPDATE admin_configuration_items
        SET name = ?,
            code = ?,
            agency = ?,
            category = ?,
            active = ?,
            sort_order = ?,
            metadata = ?
        WHERE id = ?
      `,
      [
        input.name === undefined ? existing.name : input.name.trim() || existing.name,
        input.code === undefined ? existing.code : input.code.trim().toUpperCase() || existing.code,
        input.agency === undefined ? existing.agency : input.agency.trim() || 'All',
        input.category === undefined ? existing.category : input.category.trim(),
        input.active === undefined ? existing.active : input.active,
        input.sortOrder === undefined ? existing.sortOrder : input.sortOrder,
        JSON.stringify(input.metadata === undefined ? existing.metadata : input.metadata || {}),
        id
      ]
    );
    return this.get(id);
  }

  static async delete(id: string): Promise<boolean> {
    const [result] = await pool.execute<ResultSetHeader>('DELETE FROM admin_configuration_items WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  private static async get(id: string): Promise<AdminConfigurationItem | null> {
    const [rows] = await pool.execute<AdminConfigurationRow[]>('SELECT * FROM admin_configuration_items WHERE id = ? LIMIT 1', [
      id
    ]);
    return rows[0] ? toItem(rows[0]) : null;
  }
}
