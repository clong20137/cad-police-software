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
  last_seen_at DATETIME NULL,
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
);

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
);

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
  created_by VARCHAR(36) NOT NULL,
  closed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_incidents_status_created (status, created_at),
  INDEX idx_incidents_call_number (call_number),
  CONSTRAINT fk_incidents_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT
);

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
);
