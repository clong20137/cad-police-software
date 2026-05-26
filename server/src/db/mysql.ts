import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
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

export const pool: Pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: dbName,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  namedPlaceholders: true
});

export const initializeDatabase = async (): Promise<void> => {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || ''
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
      password_hash VARCHAR(255) NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_users_email (email),
      INDEX idx_users_role (role)
    )
  `);

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

  await pool.execute(
    `
      INSERT INTO users (id, email, name, role, badge, password_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [uuidv4(), email, name, UserRole.ADMIN, badge, passwordHash]
  );

  console.log(`Seeded initial admin user: ${email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn('Using default seed admin password. Set SEED_ADMIN_PASSWORD before production use.');
  }
};

export type UserRow = RowDataPacket & {
  id: string;
  email: string;
  name: string;
  role: string;
  badge: string | null;
  password_hash: string;
  active: number | boolean;
  created_at: Date;
  updated_at: Date;
};
