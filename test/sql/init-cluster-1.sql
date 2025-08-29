-- Cluster 1 Initialization - Users and Auth schemas
-- This cluster handles user management and authentication

-- Create schemas
CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS auth;

-- Set search path
SET search_path TO users, auth, public;

-- Users schema tables
CREATE TABLE users.users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users.user_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users.users(id) ON DELETE CASCADE,
    bio TEXT,
    avatar_url VARCHAR(500),
    location VARCHAR(255),
    website VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Auth schema tables
CREATE TABLE auth.sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users.users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth.login_attempts (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    ip_address INET,
    success BOOLEAN DEFAULT false,
    attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert test data
INSERT INTO users.users (email, name, active) VALUES
    ('john@example.com', 'John Doe', true),
    ('jane@example.com', 'Jane Smith', true),
    ('bob@example.com', 'Bob Johnson', false),
    ('alice@example.com', 'Alice Wilson', true);

INSERT INTO users.user_profiles (user_id, bio, location) VALUES
    (1, 'Software developer passionate about databases', 'São Paulo, BR'),
    (2, 'Product manager with focus on user experience', 'New York, US'),
    (4, 'Database administrator and DevOps enthusiast', 'London, UK');

INSERT INTO auth.sessions (user_id, token, expires_at) VALUES
    (1, 'token_john_123', CURRENT_TIMESTAMP + INTERVAL '7 days'),
    (2, 'token_jane_456', CURRENT_TIMESTAMP + INTERVAL '7 days'),
    (4, 'token_alice_789', CURRENT_TIMESTAMP + INTERVAL '7 days');

-- Create indexes for performance
CREATE INDEX idx_users_email ON users.users(email);
CREATE INDEX idx_users_active ON users.users(active);
CREATE INDEX idx_sessions_token ON auth.sessions(token);
CREATE INDEX idx_sessions_user_id ON auth.sessions(user_id);
CREATE INDEX idx_login_attempts_email ON auth.login_attempts(email);

-- Grant permissions
GRANT USAGE ON SCHEMA users TO test_user;
GRANT USAGE ON SCHEMA auth TO test_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA users TO test_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO test_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA users TO test_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA auth TO test_user;