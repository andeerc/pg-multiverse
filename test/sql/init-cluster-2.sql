-- Cluster 2 Initialization - Products and Orders schemas
-- This cluster handles e-commerce operations

-- Create schemas
CREATE SCHEMA IF NOT EXISTS products;
CREATE SCHEMA IF NOT EXISTS orders;

-- Set search path
SET search_path TO products, orders, public;

-- Products schema tables
CREATE TABLE products.categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id INTEGER REFERENCES products.categories(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products.products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    category_id INTEGER REFERENCES products.categories(id),
    sku VARCHAR(100) UNIQUE,
    stock_quantity INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products.product_images (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products.products(id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    alt_text VARCHAR(255),
    display_order INTEGER DEFAULT 0
);

-- Orders schema tables
CREATE TABLE orders.orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL, -- Reference to users from cluster 1
    status VARCHAR(50) DEFAULT 'pending',
    total_amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    shipping_address TEXT,
    billing_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders.order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders.orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL, -- Reference to products
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL
);

CREATE TABLE orders.payments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders.orders(id) ON DELETE CASCADE,
    method VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    amount DECIMAL(10,2) NOT NULL,
    transaction_id VARCHAR(255),
    processed_at TIMESTAMP
);

-- Insert test data
INSERT INTO products.categories (name, description) VALUES
    ('Electronics', 'Electronic devices and gadgets'),
    ('Books', 'Physical and digital books'),
    ('Clothing', 'Apparel and accessories'),
    ('Home & Garden', 'Items for home and garden');

INSERT INTO products.products (name, description, price, category_id, sku, stock_quantity) VALUES
    ('Smartphone Pro', 'Latest smartphone with advanced features', 999.99, 1, 'PHONE-001', 50),
    ('Laptop Elite', 'High-performance laptop for professionals', 1499.99, 1, 'LAPTOP-001', 25),
    ('Programming Guide', 'Comprehensive guide to modern programming', 49.99, 2, 'BOOK-001', 100),
    ('Casual T-Shirt', 'Comfortable cotton t-shirt', 29.99, 3, 'SHIRT-001', 200),
    ('Garden Tools Set', 'Complete set of essential garden tools', 89.99, 4, 'GARDEN-001', 30);

INSERT INTO products.product_images (product_id, image_url, alt_text, display_order) VALUES
    (1, 'https://example.com/phone1.jpg', 'Smartphone front view', 0),
    (1, 'https://example.com/phone2.jpg', 'Smartphone back view', 1),
    (2, 'https://example.com/laptop1.jpg', 'Laptop open view', 0),
    (3, 'https://example.com/book1.jpg', 'Book cover', 0);

INSERT INTO orders.orders (user_id, status, total_amount, shipping_address, billing_address) VALUES
    (1, 'completed', 1549.98, '123 Main St, São Paulo, SP', '123 Main St, São Paulo, SP'),
    (2, 'pending', 79.98, '456 Oak Ave, New York, NY', '456 Oak Ave, New York, NY'),
    (4, 'shipped', 999.99, '789 Pine Rd, London, UK', '789 Pine Rd, London, UK');

INSERT INTO orders.order_items (order_id, product_id, quantity, unit_price, total_price) VALUES
    (1, 1, 1, 999.99, 999.99),
    (1, 3, 1, 49.99, 49.99),
    (1, 4, 1, 29.99, 29.99),
    (2, 3, 1, 49.99, 49.99),
    (2, 4, 1, 29.99, 29.99),
    (3, 1, 1, 999.99, 999.99);

INSERT INTO orders.payments (order_id, method, status, amount, transaction_id, processed_at) VALUES
    (1, 'credit_card', 'completed', 1549.98, 'txn_abc123', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
    (2, 'paypal', 'pending', 79.98, 'txn_def456', NULL),
    (3, 'credit_card', 'completed', 999.99, 'txn_ghi789', CURRENT_TIMESTAMP - INTERVAL '1 hour');

-- Create indexes for performance
CREATE INDEX idx_products_category ON products.products(category_id);
CREATE INDEX idx_products_sku ON products.products(sku);
CREATE INDEX idx_products_active ON products.products(active);
CREATE INDEX idx_orders_user_id ON orders.orders(user_id);
CREATE INDEX idx_orders_status ON orders.orders(status);
CREATE INDEX idx_order_items_order_id ON orders.order_items(order_id);
CREATE INDEX idx_order_items_product_id ON orders.order_items(product_id);
CREATE INDEX idx_payments_order_id ON orders.payments(order_id);

-- Grant permissions
GRANT USAGE ON SCHEMA products TO test_user;
GRANT USAGE ON SCHEMA orders TO test_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA products TO test_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA orders TO test_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA products TO test_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA orders TO test_user;