import { ResultSetHeader } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import { pool, IncidentNoteRow, IncidentRow, IncidentUnitRow } from '../db/mysql';
import {
  AddIncidentNoteRequest,
  CreateIncidentRequest,
  Incident,
  IncidentNote,
  IncidentPriority,
  IncidentStatus,
  IncidentUnit,
  IncidentUnitStatus
} from '../types/auth';

const priorityValues = new Set<IncidentPriority>(['Low', 'Normal', 'High', 'Emergency']);
const statusValues = new Set<IncidentStatus>([
  'Pending',
  'Dispatched',
  'En Route',
  'On Scene',
  'Closed',
  'Canceled'
]);
const unitStatusValues = new Set<IncidentUnitStatus>(['Assigned', 'En Route', 'On Scene', 'Cleared']);

const toIncidentUnit = (row: IncidentUnitRow): IncidentUnit => ({
  userId: row.user_id,
  name: row.name,
  cadUnitNumber: row.cad_unit_number || undefined,
  status: row.status as IncidentUnitStatus,
  assignedAt: row.assigned_at,
  clearedAt: row.cleared_at || undefined
});

const toIncidentNote = (row: IncidentNoteRow): IncidentNote => ({
  id: row.id,
  incidentId: row.incident_id,
  userId: row.user_id || undefined,
  userName: row.user_name || undefined,
  noteType: row.note_type as IncidentNote['noteType'],
  body: row.body,
  createdAt: row.created_at
});

const toIncident = (row: IncidentRow, units: IncidentUnit[] = [], notes: IncidentNote[] = []): Incident => ({
  id: row.id,
  callNumber: row.call_number,
  type: row.type,
  priority: row.priority as IncidentPriority,
  status: row.status as IncidentStatus,
  address: row.address,
  description: row.description || undefined,
  callerName: row.caller_name || undefined,
  callerPhone: row.caller_phone || undefined,
  lat: row.lat === null ? undefined : Number(row.lat),
  lon: row.lon === null ? undefined : Number(row.lon),
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  closedAt: row.closed_at || undefined,
  disposition: row.disposition || undefined,
  units,
  notes
});

const isValidCoordinatePair = (lat?: number | null, lon?: number | null): boolean => {
  if (lat === undefined && lon === undefined) return true;
  if (lat === null && lon === null) return true;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lon) >= -180 &&
    Number(lon) <= 180
  );
};

export class IncidentService {
  static async getActiveIncidents(): Promise<Incident[]> {
    const [rows] = await pool.execute<IncidentRow[]>(
      `
        SELECT *
        FROM incidents
        WHERE status NOT IN ('Closed', 'Canceled')
        ORDER BY
          FIELD(priority, 'Emergency', 'High', 'Normal', 'Low'),
          created_at DESC
        LIMIT 100
      `
    );

    return this.withUnits(rows);
  }

  static async getIncident(id: string): Promise<Incident | null> {
    const [rows] = await pool.execute<IncidentRow[]>('SELECT * FROM incidents WHERE id = ? LIMIT 1', [id]);
    if (!rows[0]) {
      return null;
    }

    const [incident] = await this.withUnits(rows);
    return incident;
  }

  static async createIncident(input: CreateIncidentRequest, createdBy: string): Promise<Incident> {
    if (!input.type?.trim() || !input.address?.trim()) {
      throw new Error('type and address are required');
    }

    const priority = priorityValues.has(input.priority || 'Normal') ? input.priority || 'Normal' : 'Normal';
    if (!isValidCoordinatePair(input.lat, input.lon)) {
      throw new Error('Valid lat and lon are required when a map location is provided');
    }

    const id = uuidv4();
    const callNumber = await this.nextCallNumber();

    await pool.execute<ResultSetHeader>(
      `
        INSERT INTO incidents (
          id,
          call_number,
          type,
          priority,
          address,
          description,
          caller_name,
          caller_phone,
          lat,
          lon,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        callNumber,
        input.type.trim(),
        priority,
        input.address.trim(),
        input.description?.trim() || null,
        input.callerName?.trim() || null,
        input.callerPhone?.trim() || null,
        input.lat ?? null,
        input.lon ?? null,
        createdBy
      ]
    );

    const incident = await this.getIncident(id);
    if (!incident) {
      throw new Error('Incident was not created');
    }

    return incident;
  }

  static async updateStatus(id: string, status: IncidentStatus, disposition?: string, updatedBy?: string): Promise<Incident | null> {
    if (!statusValues.has(status)) {
      throw new Error('Invalid incident status');
    }

    const incident = await this.getIncident(id);
    if (!incident) {
      return null;
    }

    await pool.execute<ResultSetHeader>(
      `
        UPDATE incidents
        SET status = ?,
            disposition = CASE WHEN ? IN ('Closed', 'Canceled') THEN ? ELSE disposition END,
            closed_at = CASE WHEN ? IN ('Closed', 'Canceled') THEN UTC_TIMESTAMP() ELSE NULL END
        WHERE id = ?
      `,
      [status, status, disposition?.trim() || null, status, id]
    );

    await this.addNote(id, updatedBy || null, {
      noteType: status === 'Closed' || status === 'Canceled' ? 'disposition' : 'status',
      body:
        status === 'Closed' || status === 'Canceled'
          ? `${status}${disposition?.trim() ? `: ${disposition.trim()}` : ''}`
          : `Status changed to ${status}`
    });

    if (status === 'Closed' || status === 'Canceled') {
      await pool.execute(
        `
          UPDATE incident_units
          SET status = 'Cleared', cleared_at = COALESCE(cleared_at, UTC_TIMESTAMP())
          WHERE incident_id = ?
        `,
        [id]
      );
      await pool.execute(
        `
          UPDATE users
          INNER JOIN incident_units ON incident_units.user_id = users.id
          SET
            users.status = 'Available',
            users.destination_lat = NULL,
            users.destination_lon = NULL,
            users.destination_label = NULL
          WHERE incident_units.incident_id = ?
        `,
        [id]
      );
    } else if (status === 'Dispatched' || status === 'En Route' || status === 'On Scene') {
      const unitStatus: IncidentUnitStatus =
        status === 'En Route' ? 'En Route' : status === 'On Scene' ? 'On Scene' : 'Assigned';
      await pool.execute(
        `
          UPDATE incident_units
          SET status = ?, cleared_at = NULL
          WHERE incident_id = ? AND status <> 'Cleared'
        `,
        [unitStatus, id]
      );
      await pool.execute(
        `
          UPDATE users
          INNER JOIN incident_units ON incident_units.user_id = users.id
          SET
            users.status = ?,
            users.destination_lat = ?,
            users.destination_lon = ?,
            users.destination_label = ?
          WHERE incident_units.incident_id = ?
            AND incident_units.status <> 'Cleared'
        `,
        [
          status === 'On Scene' ? 'On Scene' : status === 'En Route' ? 'En Route' : 'Dispatched',
          incident.lat ?? null,
          incident.lon ?? null,
          `${incident.callNumber} ${incident.address}`,
          id
        ]
      );
    }

    return this.getIncident(id);
  }

  static async assignUnit(
    incidentId: string,
    userId: string,
    assignedBy: string,
    status: IncidentUnitStatus = 'Assigned'
  ): Promise<Incident | null> {
    if (!unitStatusValues.has(status)) {
      throw new Error('Invalid unit status');
    }

    const incident = await this.getIncident(incidentId);
    if (!incident) {
      return null;
    }

    await pool.execute(
      `
        INSERT INTO incident_units (incident_id, user_id, assigned_by, status)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          cleared_at = CASE WHEN VALUES(status) = 'Cleared' THEN UTC_TIMESTAMP() ELSE NULL END
      `,
      [incidentId, userId, assignedBy, status]
    );

    await this.addNote(incidentId, assignedBy, {
      noteType: 'assignment',
      body: `Unit ${userId} set to ${status}`
    });

    const nextIncidentStatus = status === 'En Route' ? 'En Route' : status === 'On Scene' ? 'On Scene' : 'Dispatched';
    await pool.execute('UPDATE incidents SET status = ? WHERE id = ? AND status = ?', [
      nextIncidentStatus,
      incidentId,
      'Pending'
    ]);

    await pool.execute(
      `
        UPDATE users
        SET
          status = ?,
          destination_lat = ?,
          destination_lon = ?,
          destination_label = ?
        WHERE id = ? AND active = TRUE
      `,
      [
        status === 'Cleared' ? 'Available' : status === 'On Scene' ? 'On Scene' : status === 'En Route' ? 'En Route' : 'Dispatched',
        status === 'Cleared' ? null : incident.lat ?? null,
        status === 'Cleared' ? null : incident.lon ?? null,
        status === 'Cleared' ? null : `${incident.callNumber} ${incident.address}`,
        userId
      ]
    );

    return this.getIncident(incidentId);
  }

  static async addNote(
    incidentId: string,
    userId: string | null,
    input: AddIncidentNoteRequest
  ): Promise<IncidentNote | null> {
    if (!input.body?.trim()) {
      throw new Error('Note body is required');
    }

    const incident = await this.getIncident(incidentId);
    if (!incident) {
      return null;
    }

    const noteType = input.noteType || 'note';
    const id = uuidv4();
    await pool.execute(
      `
        INSERT INTO incident_notes (id, incident_id, user_id, note_type, body)
        VALUES (?, ?, ?, ?, ?)
      `,
      [id, incidentId, userId, noteType, input.body.trim()]
    );

    const notes = await this.getNotes(incidentId);
    return notes.find((note) => note.id === id) || null;
  }

  static async getNotes(incidentId: string): Promise<IncidentNote[]> {
    const [rows] = await pool.execute<IncidentNoteRow[]>(
      `
        SELECT incident_notes.*, users.name AS user_name
        FROM incident_notes
        LEFT JOIN users ON users.id = incident_notes.user_id
        WHERE incident_notes.incident_id = ?
        ORDER BY incident_notes.created_at ASC
      `,
      [incidentId]
    );
    return rows.map(toIncidentNote);
  }

  private static async nextCallNumber(): Promise<string> {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const [[row]] = await pool.query<({ count: number } & ResultSetHeader)[]>(
      'SELECT COUNT(*) + 1 AS count FROM incidents WHERE DATE(created_at) = UTC_DATE()'
    );
    return `${datePart}-${String(Number(row?.count || 1)).padStart(4, '0')}`;
  }

  private static async withUnits(rows: IncidentRow[]): Promise<Incident[]> {
    if (rows.length === 0) {
      return [];
    }

    const incidentIds = rows.map((row) => row.id);
    const placeholders = incidentIds.map(() => '?').join(',');
    const [unitRows] = await pool.execute<IncidentUnitRow[]>(
      `
        SELECT
          incident_units.incident_id,
          incident_units.user_id,
          users.name,
          users.cad_unit_number,
          incident_units.status,
          incident_units.assigned_at,
          incident_units.cleared_at
        FROM incident_units
        INNER JOIN users ON users.id = incident_units.user_id
        WHERE incident_units.incident_id IN (${placeholders})
        ORDER BY incident_units.assigned_at ASC
      `,
      incidentIds
    );

    const unitsByIncident = unitRows.reduce<Record<string, IncidentUnit[]>>((groups, unitRow) => {
      groups[unitRow.incident_id] = groups[unitRow.incident_id] || [];
      groups[unitRow.incident_id].push(toIncidentUnit(unitRow));
      return groups;
    }, {});

    const [noteRows] = await pool.execute<IncidentNoteRow[]>(
      `
        SELECT incident_notes.*, users.name AS user_name
        FROM incident_notes
        LEFT JOIN users ON users.id = incident_notes.user_id
        WHERE incident_notes.incident_id IN (${placeholders})
        ORDER BY incident_notes.created_at ASC
      `,
      incidentIds
    );
    const notesByIncident = noteRows.reduce<Record<string, IncidentNote[]>>((groups, noteRow) => {
      groups[noteRow.incident_id] = groups[noteRow.incident_id] || [];
      groups[noteRow.incident_id].push(toIncidentNote(noteRow));
      return groups;
    }, {});

    return rows.map((row) => toIncident(row, unitsByIncident[row.id] || [], notesByIncident[row.id] || []));
  }
}
