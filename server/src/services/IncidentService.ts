import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import { pool, IncidentNoteRow, IncidentRow, IncidentUnitRow } from '../db/mysql';
import { ConfigurationService } from './ConfigurationService';
import { geofenceAssignmentForPoint, geofencesFromConfig } from '../utils/mapGeofences';
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
const unitStatusValues = new Set<IncidentUnitStatus>([
  'Assigned',
  'Acknowledged',
  'En Route',
  'On Scene',
  'Transporting',
  'At Hospital',
  'Staged',
  'Loaded',
  'Delivered',
  'Cleared'
]);

const toIncidentUnit = (row: IncidentUnitRow): IncidentUnit => ({
  userId: row.user_id,
  name: row.name,
  cadUnitNumber: row.cad_unit_number || undefined,
  status: row.status as IncidentUnitStatus,
  assignedAt: row.assigned_at,
  statusUpdatedAt: row.status_updated_at || row.assigned_at,
  clearedAt: row.cleared_at || undefined
});

const unitStatusToUserStatus = (status: IncidentUnitStatus) => {
  if (status === 'Cleared' || status === 'Delivered') return 'Available';
  if (status === 'On Scene' || status === 'Staged') return 'On Scene';
  if (status === 'En Route') return 'En Route';
  if (status === 'Transporting' || status === 'At Hospital' || status === 'Loaded') return 'Transporting';
  return 'Dispatched';
};

const unitStatusToIncidentStatus = (status: IncidentUnitStatus): IncidentStatus => {
  if (status === 'En Route' || status === 'Transporting' || status === 'Loaded') return 'En Route';
  if (status === 'On Scene' || status === 'Staged' || status === 'At Hospital' || status === 'Delivered') return 'On Scene';
  return 'Dispatched';
};

const isClosedIncidentStatus = (status: IncidentStatus): boolean => status === 'Closed' || status === 'Canceled';

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
  district: row.district || undefined,
  beat: row.beat || undefined,
  lat: row.lat === null ? undefined : Number(row.lat),
  lon: row.lon === null ? undefined : Number(row.lon),
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  statusUpdatedAt: row.status_updated_at || row.updated_at,
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
          OR closed_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
        ORDER BY
          CASE WHEN status IN ('Closed', 'Canceled') THEN 1 ELSE 0 END,
          FIELD(priority, 'Emergency', 'High', 'Normal', 'Low'),
          COALESCE(closed_at, created_at) DESC
        LIMIT 200
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
    const lat = input.lat ?? null;
    const lon = input.lon ?? null;
    const geofenceAssignment =
      lat !== null && lon !== null
        ? geofenceAssignmentForPoint(
            { lat, lon },
            geofencesFromConfig(await ConfigurationService.list())
          )
        : {};
    const district = input.district?.trim() || geofenceAssignment.district || null;
    const beat = input.beat?.trim() || geofenceAssignment.beat || null;

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
          district,
          beat,
          lat,
          lon,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        district,
        beat,
        lat,
        lon,
        createdBy
      ]
    );

    const incident = await this.getIncident(id);
    if (!incident) {
      throw new Error('Incident was not created');
    }
    await this.addNote(id, createdBy, {
      noteType: 'status',
      body: `Call created as ${priority} priority: ${input.type.trim()} at ${input.address.trim()}`
    });

    const createdIncident = await this.getIncident(id);
    if (!createdIncident) {
      throw new Error('Incident was not created');
    }
    return createdIncident;
  }

  static async updateStatus(id: string, status: IncidentStatus, disposition?: string, updatedBy?: string): Promise<Incident | null> {
    if (!statusValues.has(status)) {
      throw new Error('Invalid incident status');
    }

    const incident = await this.getIncident(id);
    if (!incident) {
      return null;
    }
    if (isClosedIncidentStatus(incident.status) && !isClosedIncidentStatus(status)) {
      throw new Error('Reopen the call before changing status');
    }
    if (isClosedIncidentStatus(status) && !disposition?.trim()) {
      throw new Error('Disposition is required to close or cancel a call');
    }

    await pool.execute<ResultSetHeader>(
      `
        UPDATE incidents
        SET status = ?,
            disposition = CASE WHEN ? IN ('Closed', 'Canceled') THEN ? ELSE disposition END,
            closed_at = CASE WHEN ? IN ('Closed', 'Canceled') THEN UTC_TIMESTAMP() ELSE NULL END,
            status_updated_at = UTC_TIMESTAMP(),
            updated_at = UTC_TIMESTAMP()
        WHERE id = ?
      `,
      [status, status, disposition?.trim() || null, status, id]
    );

    await this.addNote(id, updatedBy || null, {
      noteType: status === 'Closed' || status === 'Canceled' ? 'disposition' : 'status',
      body:
        status === 'Closed' || status === 'Canceled'
          ? `${incident.status} to ${status}${disposition?.trim() ? `: ${disposition.trim()}` : ''}`
          : `Status changed from ${incident.status} to ${status}`
    });

    if (isClosedIncidentStatus(status)) {
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
          SET status = ?, status_updated_at = UTC_TIMESTAMP(), cleared_at = NULL
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
          unitStatusToUserStatus(unitStatus),
          incident.lat ?? null,
          incident.lon ?? null,
          incident.callNumber,
          id
        ]
      );
    }

    return this.getIncident(id);
  }

  static async reopenIncident(id: string, reopenedBy?: string): Promise<Incident | null> {
    const incident = await this.getIncident(id);
    if (!incident) {
      return null;
    }
    if (!isClosedIncidentStatus(incident.status)) {
      return incident;
    }

    await pool.execute<ResultSetHeader>(
      `
        UPDATE incidents
        SET status = 'Pending',
            disposition = NULL,
            closed_at = NULL,
            status_updated_at = UTC_TIMESTAMP(),
            updated_at = UTC_TIMESTAMP()
        WHERE id = ?
      `,
      [id]
    );
    await this.addNote(id, reopenedBy || null, {
      noteType: 'status',
      body: `Call reopened from ${incident.status}${incident.disposition ? `: ${incident.disposition}` : ''}`
    });

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
    if (isClosedIncidentStatus(incident.status) && status !== 'Cleared') {
      throw new Error('Reopen the call before assigning units');
    }

    await pool.execute(
      `
        INSERT INTO incident_units (incident_id, user_id, assigned_by, status)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          status_updated_at = UTC_TIMESTAMP(),
          cleared_at = CASE WHEN VALUES(status) = 'Cleared' THEN UTC_TIMESTAMP() ELSE NULL END
      `,
      [incidentId, userId, assignedBy, status]
    );

    const unitLabel = await this.unitLabel(userId);
    await this.addNote(incidentId, assignedBy, {
      noteType: 'assignment',
      body: `Unit ${unitLabel} set to ${status}`
    });

    const nextIncidentStatus = unitStatusToIncidentStatus(status);
    await pool.execute('UPDATE incidents SET status = ?, status_updated_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ? AND status = ?', [
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
        unitStatusToUserStatus(status),
        status === 'Cleared' ? null : incident.lat ?? null,
        status === 'Cleared' ? null : incident.lon ?? null,
        status === 'Cleared' ? null : incident.callNumber,
        userId
      ]
    );

    return this.getIncident(incidentId);
  }

  static async updateAssignedUnitStatus(
    incidentId: string,
    userId: string,
    status: IncidentUnitStatus
  ): Promise<Incident | null> {
    if (!unitStatusValues.has(status)) {
      throw new Error('Invalid unit status');
    }

    const incident = await this.getIncident(incidentId);
    if (!incident || !incident.units.some((unit) => unit.userId === userId)) {
      return null;
    }
    if (isClosedIncidentStatus(incident.status)) {
      throw new Error('Reopen the call before changing unit status');
    }

    await pool.execute(
      `
        UPDATE incident_units
        SET status = ?,
            status_updated_at = UTC_TIMESTAMP(),
            cleared_at = CASE WHEN ? = 'Cleared' THEN UTC_TIMESTAMP() ELSE NULL END
        WHERE incident_id = ? AND user_id = ?
      `,
      [status, status, incidentId, userId]
    );

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
        unitStatusToUserStatus(status),
        status === 'Cleared' ? null : incident.lat ?? null,
        status === 'Cleared' ? null : incident.lon ?? null,
        status === 'Cleared' ? null : incident.callNumber,
        userId
      ]
    );

    await this.addNote(incidentId, userId, {
      noteType: status === 'Cleared' ? 'assignment' : 'status',
      body: `Unit ${await this.unitLabel(userId)} status changed to ${status}`
    });

    const nextIncidentStatus = unitStatusToIncidentStatus(status);
    if (status !== 'Cleared') {
      await pool.execute('UPDATE incidents SET status = ?, status_updated_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ? AND status IN (?, ?)', [
        nextIncidentStatus,
        incidentId,
        'Pending',
        'Dispatched'
      ]);
    } else {
      const remainingActiveUnits = incident.units.filter((unit) => unit.userId !== userId && unit.status !== 'Cleared');
      if (remainingActiveUnits.length === 0) {
        await pool.execute('UPDATE incidents SET status = ?, status_updated_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ? AND status NOT IN (?, ?)', [
          'Pending',
          incidentId,
          'Closed',
          'Canceled'
        ]);
        await this.addNote(incidentId, userId, {
          noteType: 'status',
          body: 'All assigned units cleared; call is pending disposition'
        });
      }
    }

    return this.getIncident(incidentId);
  }

  static async addAssignedUnitNote(
    incidentId: string,
    userId: string,
    input: AddIncidentNoteRequest
  ): Promise<IncidentNote | null> {
    const incident = await this.getIncident(incidentId);
    if (!incident || !incident.units.some((unit) => unit.userId === userId)) {
      return null;
    }

    return this.addNote(incidentId, userId, input);
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

  private static async unitLabel(userId: string): Promise<string> {
    const [rows] = await pool.execute<Array<{ name: string; cad_unit_number: string | null } & RowDataPacket>>(
      'SELECT name, cad_unit_number FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const row = rows[0];
    return row ? `${row.cad_unit_number || userId} ${row.name}`.trim() : userId;
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
          incident_units.status_updated_at,
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
