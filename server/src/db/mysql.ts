import fs from 'fs';
import mysql, { Pool, PoolOptions, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '../types/auth';

const databaseName = process.env.MYSQL_DATABASE || 'cad_police';

const assertSafeDatabaseName = (name: string): string => {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error('MYSQL_DATABASE may only contain letters, numbers, and underscores.');
  }
  return name;
};

const dbName = assertSafeDatabaseName(databaseName);
const BCRYPT_ROUNDS = 12;
const mysqlSslOptions = (): PoolOptions['ssl'] | undefined => {
  if (process.env.MYSQL_SSL !== 'true' && !process.env.MYSQL_SSL_CA_PATH) {
    return undefined;
  }

  return {
    ca: process.env.MYSQL_SSL_CA_PATH ? fs.readFileSync(process.env.MYSQL_SSL_CA_PATH, 'utf8') : undefined,
    rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false'
  };
};

const ssl = mysqlSslOptions();

export const pool: Pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: dbName,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  namedPlaceholders: true,
  ssl
});

export const initializeDatabase = async (): Promise<void> => {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    ssl
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      role ENUM('admin', 'dispatcher', 'officer', 'viewer') NOT NULL DEFAULT 'viewer',
      badge VARCHAR(64) NULL,
      unit_number VARCHAR(64) NULL,
      cad_unit_number VARCHAR(64) NULL,
      status ENUM('Available', 'Dispatched', 'En Route', 'On Scene', 'Transporting', 'Traffic Stop') NULL DEFAULT NULL,
      unit_group VARCHAR(80) NULL,
      district VARCHAR(80) NULL,
      lat DECIMAL(10, 7) NULL,
      lon DECIMAL(10, 7) NULL,
      speed_mph DECIMAL(7, 2) NULL,
      destination_lat DECIMAL(10, 7) NULL,
      destination_lon DECIMAL(10, 7) NULL,
      destination_label VARCHAR(160) NULL,
      last_location_at DATETIME NULL,
      last_seen_at DATETIME NULL,
      password_hash VARCHAR(255) NOT NULL,
      password_changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_users_email (email),
      INDEX idx_users_role (role)
    )
  `);

  await ensureUserLocationColumns();
  await ensureUserSecurityColumns();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_refresh_tokens_user_id (user_id),
      INDEX idx_refresh_tokens_token_hash (token_hash),
      CONSTRAINT fk_refresh_tokens_user_id
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  await seedInitialAdmin();
  await initializePasswordHistoryTables();
  await initializeLocationHistoryTables();
  await initializeMessagingTables();
  await initializeIncidentTables();
  await initializeAuditLogTables();
};

export const initializePasswordHistoryTables = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_history (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_password_history_user_created (user_id, created_at),
      CONSTRAINT fk_password_history_user_id
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);
};

export const initializeLocationHistoryTables = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_location_history (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      lat DECIMAL(10, 7) NOT NULL,
      lon DECIMAL(10, 7) NOT NULL,
      speed_mph DECIMAL(7, 2) NULL,
      recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_location_history_user_recorded (user_id, recorded_at),
      CONSTRAINT fk_location_history_user_id
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);
};

const seedInitialAdmin = async (): Promise<void> => {
  const [[row]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM users');
  const userCount = Number(row?.count || 0);

  if (userCount > 0) {
    return;
  }

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@dispatch.local').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
  const name = (process.env.SEED_ADMIN_NAME || 'System Administrator').trim();
  const badge = (process.env.SEED_ADMIN_BADGE || 'ADM001').trim();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const userId = uuidv4();
  await pool.execute(
    `
      INSERT INTO users (id, email, name, role, badge, password_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [userId, email, name, UserRole.ADMIN, badge, passwordHash]
  );
  await initializePasswordHistoryTables();
  await pool.execute('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)', [userId, passwordHash]);

  console.log(`Seeded initial admin user: ${email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn('Using default seed admin password. Set SEED_ADMIN_PASSWORD before production use.');
  }
};

const ensureUserSecurityColumns = async (): Promise<void> => {
  try {
    await pool.query('ALTER TABLE users ADD COLUMN password_changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'ER_DUP_FIELDNAME') {
      throw error;
    }
  }

  await pool.query('UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL');
};

const ensureUserLocationColumns = async (): Promise<void> => {
  const columns = [
    "ADD COLUMN unit_number VARCHAR(64) NULL",
    "ADD COLUMN cad_unit_number VARCHAR(64) NULL",
    "ADD COLUMN status ENUM('Available', 'Dispatched', 'En Route', 'On Scene', 'Transporting', 'Traffic Stop') NULL DEFAULT NULL",
    "ADD COLUMN unit_group VARCHAR(80) NULL",
    "ADD COLUMN district VARCHAR(80) NULL",
    "ADD COLUMN lat DECIMAL(10, 7) NULL",
    "ADD COLUMN lon DECIMAL(10, 7) NULL",
    "ADD COLUMN speed_mph DECIMAL(7, 2) NULL",
    "ADD COLUMN destination_lat DECIMAL(10, 7) NULL",
    "ADD COLUMN destination_lon DECIMAL(10, 7) NULL",
    "ADD COLUMN destination_label VARCHAR(160) NULL",
    "ADD COLUMN last_location_at DATETIME NULL",
    "ADD COLUMN last_seen_at DATETIME NULL"
  ];

  for (const column of columns) {
    try {
      await pool.query(`ALTER TABLE users ${column}`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ER_DUP_FIELDNAME') {
        throw error;
      }
    }
  }

  await pool.query(
    "ALTER TABLE users MODIFY COLUMN status ENUM('Available', 'Dispatched', 'En Route', 'On Scene', 'Transporting', 'Traffic Stop') NULL DEFAULT NULL"
  );
};

export const initializeMessagingTables = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(36) PRIMARY KEY,
      sender_id VARCHAR(36) NOT NULL,
      recipient_id VARCHAR(36) NOT NULL,
      body TEXT NOT NULL,
      body_iv VARCHAR(32) NULL,
      body_tag VARCHAR(32) NULL,
      encrypted BOOLEAN NOT NULL DEFAULT FALSE,
      read_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_messages_pair_created (sender_id, recipient_id, created_at),
      INDEX idx_messages_recipient_created (recipient_id, created_at),
      CONSTRAINT fk_messages_sender_id
        FOREIGN KEY (sender_id) REFERENCES users(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_messages_recipient_id
        FOREIGN KEY (recipient_id) REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  const columns = [
    "ADD COLUMN body_iv VARCHAR(32) NULL",
    "ADD COLUMN body_tag VARCHAR(32) NULL",
    "ADD COLUMN encrypted BOOLEAN NOT NULL DEFAULT FALSE"
  ];

  for (const column of columns) {
    try {
      await pool.query(`ALTER TABLE messages ${column}`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ER_DUP_FIELDNAME') {
        throw error;
      }
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      id VARCHAR(36) PRIMARY KEY,
      message_id VARCHAR(36) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      size_bytes INT UNSIGNED NOT NULL,
      data MEDIUMBLOB NOT NULL,
      data_iv VARCHAR(32) NULL,
      data_tag VARCHAR(32) NULL,
      encrypted BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_message_attachments_message_id (message_id),
      CONSTRAINT fk_message_attachments_message_id
        FOREIGN KEY (message_id) REFERENCES messages(id)
        ON DELETE CASCADE
    )
  `);
};

export const initializeIncidentTables = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id VARCHAR(36) PRIMARY KEY,
      call_number VARCHAR(32) NOT NULL UNIQUE,
      type VARCHAR(120) NOT NULL,
      priority ENUM('Low', 'Normal', 'High', 'Emergency') NOT NULL DEFAULT 'Normal',
      status ENUM('Pending', 'Dispatched', 'En Route', 'On Scene', 'Closed', 'Canceled') NOT NULL DEFAULT 'Pending',
      address VARCHAR(255) NOT NULL,
      description TEXT NULL,
      caller_name VARCHAR(120) NULL,
      caller_phone VARCHAR(40) NULL,
      lat DECIMAL(10, 7) NULL,
      lon DECIMAL(10, 7) NULL,
      disposition VARCHAR(255) NULL,
      created_by VARCHAR(36) NOT NULL,
      closed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_incidents_status_created (status, created_at),
      INDEX idx_incidents_call_number (call_number),
      CONSTRAINT fk_incidents_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE RESTRICT
    )
  `);

  try {
    await pool.query('ALTER TABLE incidents ADD COLUMN disposition VARCHAR(255) NULL');
  } catch (error) {
    if ((error as { code?: string }).code !== 'ER_DUP_FIELDNAME') {
      throw error;
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS incident_units (
      incident_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      assigned_by VARCHAR(36) NOT NULL,
      status ENUM('Assigned', 'En Route', 'On Scene', 'Cleared') NOT NULL DEFAULT 'Assigned',
      assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cleared_at DATETIME NULL,
      PRIMARY KEY (incident_id, user_id),
      INDEX idx_incident_units_user_id (user_id),
      CONSTRAINT fk_incident_units_incident_id
        FOREIGN KEY (incident_id) REFERENCES incidents(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_incident_units_user_id
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_incident_units_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES users(id)
        ON DELETE RESTRICT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS incident_notes (
      id VARCHAR(36) PRIMARY KEY,
      incident_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NULL,
      note_type ENUM('note', 'status', 'assignment', 'disposition') NOT NULL DEFAULT 'note',
      body TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_incident_notes_incident_created (incident_id, created_at),
      CONSTRAINT fk_incident_notes_incident_id
        FOREIGN KEY (incident_id) REFERENCES incidents(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_incident_notes_user_id
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);
};

export const initializeAuditLogTables = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NULL,
      action VARCHAR(120) NOT NULL,
      resource VARCHAR(120) NULL,
      resource_id VARCHAR(120) NULL,
      severity ENUM('info', 'warning', 'error', 'critical') NOT NULL DEFAULT 'info',
      ip_address VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      metadata JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_logs_created_at (created_at),
      INDEX idx_audit_logs_user_created (user_id, created_at),
      INDEX idx_audit_logs_action_created (action, created_at),
      CONSTRAINT fk_audit_logs_user_id
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);
};

export type UserRow = RowDataPacket & {
  id: string;
  email: string;
  name: string;
  role: string;
  badge: string | null;
  unit_number: string | null;
  cad_unit_number: string | null;
  status: string | null;
  unit_group: string | null;
  district: string | null;
  lat: string | number | null;
  lon: string | number | null;
  speed_mph: string | number | null;
  destination_lat: string | number | null;
  destination_lon: string | number | null;
  destination_label: string | null;
  last_location_at: Date | null;
  last_seen_at: Date | null;
  password_hash: string;
  password_changed_at: Date;
  active: number | boolean;
  created_at: Date;
  updated_at: Date;
};

export type PasswordHistoryRow = RowDataPacket & {
  password_hash: string;
  created_at: Date;
};

export type LocationHistoryRow = RowDataPacket & {
  user_id: string;
  lat: string | number;
  lon: string | number;
  speed_mph: string | number | null;
  recorded_at: Date;
};

export type IncidentRow = RowDataPacket & {
  id: string;
  call_number: string;
  type: string;
  priority: string;
  status: string;
  address: string;
  description: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  lat: string | number | null;
  lon: string | number | null;
  disposition: string | null;
  created_by: string;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type IncidentNoteRow = RowDataPacket & {
  id: string;
  incident_id: string;
  user_id: string | null;
  user_name: string | null;
  note_type: string;
  body: string;
  created_at: Date;
};

export type IncidentUnitRow = RowDataPacket & {
  incident_id: string;
  user_id: string;
  name: string;
  cad_unit_number: string | null;
  status: string;
  assigned_at: Date;
  cleared_at: Date | null;
};

export type AuditLogRow = RowDataPacket & {
  id: string;
  user_id: string | null;
  action: string;
  resource: string | null;
  resource_id: string | null;
  severity: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | object | null;
  created_at: Date;
};
