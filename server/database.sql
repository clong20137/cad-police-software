CREATE DATABASE IF NOT EXISTS cad_police
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE cad_police;

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
  password_hash VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_email (email),
  INDEX idx_users_role (role)
);

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
);
