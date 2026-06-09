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

const defaults: Array<Omit<AdminConfigurationItem, 'createdAt' | 'updatedAt'>> = [
  { id: 'agency-police', section: 'agencies', name: 'Police', code: 'POL', agency: 'CAD', category: 'Public Safety', active: true, sortOrder: 10, metadata: {} },
  { id: 'agency-ems', section: 'agencies', name: 'EMS', code: 'EMS', agency: 'CAD', category: 'Medical', active: true, sortOrder: 20, metadata: {} },
  { id: 'agency-fire', section: 'agencies', name: 'Fire', code: 'FIRE', agency: 'CAD', category: 'Fire', active: true, sortOrder: 30, metadata: {} },
  { id: 'agency-towing', section: 'agencies', name: 'Towing', code: 'TOW', agency: 'CAD', category: 'Service', active: true, sortOrder: 40, metadata: {} },
  { id: 'district-north', section: 'districts', name: 'North District', code: 'NORTH', agency: 'Police', category: 'District', active: true, sortOrder: 10, metadata: {} },
  { id: 'district-south', section: 'districts', name: 'South District', code: 'SOUTH', agency: 'Police', category: 'District', active: true, sortOrder: 20, metadata: {} },
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
  { id: 'security-db-ssl', section: 'security', name: 'Require DB SSL', code: 'REQUIRE_DB_SSL', agency: 'All', category: 'Database', active: true, sortOrder: 50, metadata: { value: true, type: 'boolean' } }
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
    }
  }

  static async list(): Promise<AdminConfigurationItem[]> {
    await this.ensureDefaults();
    const [rows] = await pool.execute<AdminConfigurationRow[]>(
      'SELECT * FROM admin_configuration_items ORDER BY section ASC, sort_order ASC, name ASC'
    );
    return rows.map(toItem);
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
