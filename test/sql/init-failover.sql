-- Failover Cluster Initialization - Testing failover scenarios
-- This cluster is used for testing failover and recovery mechanisms

-- Create schemas
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS logs;

-- Set search path
SET search_path TO analytics, logs, public;

-- Analytics schema tables
CREATE TABLE analytics.events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    user_id INTEGER,
    session_id VARCHAR(255),
    data JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET
);

CREATE TABLE analytics.page_views (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    page_url VARCHAR(500) NOT NULL,
    referrer VARCHAR(500),
    user_agent TEXT,
    view_duration INTEGER, -- seconds
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Logs schema tables
CREATE TABLE logs.application_logs (
    id SERIAL PRIMARY KEY,
    level VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    context JSONB,
    service VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    trace_id VARCHAR(100)
);

CREATE TABLE logs.database_logs (
    id SERIAL PRIMARY KEY,
    query_type VARCHAR(50),
    table_name VARCHAR(100),
    execution_time INTEGER, -- milliseconds
    rows_affected INTEGER,
    error_message TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert test data
INSERT INTO analytics.events (event_type, user_id, session_id, data) VALUES
    ('page_view', 1, 'sess_123', '{"page": "/dashboard", "section": "main"}'),
    ('click', 1, 'sess_123', '{"button": "save", "form": "user_profile"}'),
    ('page_view', 2, 'sess_456', '{"page": "/products", "category": "electronics"}'),
    ('purchase', 2, 'sess_456', '{"product_id": 1, "amount": 999.99}'),
    ('search', 4, 'sess_789', '{"query": "laptop", "results": 15}');

INSERT INTO analytics.page_views (user_id, page_url, referrer, view_duration) VALUES
    (1, '/dashboard', 'https://google.com', 120),
    (1, '/profile', '/dashboard', 45),
    (2, '/products', 'https://facebook.com', 200),
    (2, '/product/1', '/products', 300),
    (4, '/search', 'direct', 60);

INSERT INTO logs.application_logs (level, message, context, service, trace_id) VALUES
    ('INFO', 'User login successful', '{"user_id": 1, "ip": "192.168.1.100"}', 'auth-service', 'trace_001'),
    ('WARN', 'High memory usage detected', '{"memory_percent": 85}', 'monitoring', 'trace_002'),
    ('ERROR', 'Database connection timeout', '{"timeout": 30000, "retries": 3}', 'user-service', 'trace_003'),
    ('INFO', 'Order processed successfully', '{"order_id": 1, "amount": 1549.98}', 'order-service', 'trace_004'),
    ('DEBUG', 'Cache hit for user profile', '{"user_id": 2, "cache_key": "user:profile:2"}', 'cache-service', 'trace_005');

INSERT INTO logs.database_logs (query_type, table_name, execution_time, rows_affected) VALUES
    ('SELECT', 'users', 15, 1),
    ('INSERT', 'orders', 23, 1),
    ('UPDATE', 'products', 8, 1),
    ('SELECT', 'analytics_events', 45, 100),
    ('DELETE', 'sessions', 12, 3);

-- Create indexes for performance
CREATE INDEX idx_events_type ON analytics.events(event_type);
CREATE INDEX idx_events_user_id ON analytics.events(user_id);
CREATE INDEX idx_events_timestamp ON analytics.events(timestamp);
CREATE INDEX idx_page_views_user_id ON analytics.page_views(user_id);
CREATE INDEX idx_page_views_timestamp ON analytics.page_views(timestamp);
CREATE INDEX idx_app_logs_level ON logs.application_logs(level);
CREATE INDEX idx_app_logs_service ON logs.application_logs(service);
CREATE INDEX idx_app_logs_timestamp ON logs.application_logs(timestamp);
CREATE INDEX idx_db_logs_query_type ON logs.database_logs(query_type);
CREATE INDEX idx_db_logs_timestamp ON logs.database_logs(timestamp);

-- Grant permissions
GRANT USAGE ON SCHEMA analytics TO test_user;
GRANT USAGE ON SCHEMA logs TO test_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA analytics TO test_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA logs TO test_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA analytics TO test_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA logs TO test_user;