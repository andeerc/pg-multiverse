import { Migration, MigrationContext } from 'pg-multiverse';

const migration: Migration = {
  version: '20241230130000_add_products',
  name: 'add_products',
  description: 'Add products and categories tables for e-commerce functionality',
  targetSchemas: ['products_data'],
  dependencies: ['20241230120000_initial_setup'],
  tags: ['products', 'categories', 'ecommerce'],
  createdAt: new Date('2024-12-30T13:00:00Z'),

  async up(context: MigrationContext): Promise<void> {
    context.logger.info(`Adding products functionality to ${context.schema} on ${context.cluster}`);
    
    // Create categories table
    await context.query(`
      CREATE TABLE categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        image_url VARCHAR(500),
        sort_order INTEGER DEFAULT 0,
        active BOOLEAN DEFAULT true,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create products table
    await context.query(`
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        short_description VARCHAR(500),
        sku VARCHAR(100) UNIQUE NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        compare_price DECIMAL(10,2),
        cost_price DECIMAL(10,2),
        category_id INTEGER REFERENCES categories(id),
        stock_quantity INTEGER DEFAULT 0,
        track_inventory BOOLEAN DEFAULT true,
        allow_backorder BOOLEAN DEFAULT false,
        weight DECIMAL(8,3),
        dimensions JSONB,
        images JSONB DEFAULT '[]',
        tags TEXT[],
        status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
        featured BOOLEAN DEFAULT false,
        seo_title VARCHAR(255),
        seo_description TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create product variants table
    await context.query(`
      CREATE TABLE product_variants (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(100) UNIQUE NOT NULL,
        price DECIMAL(10,2),
        compare_price DECIMAL(10,2),
        stock_quantity INTEGER DEFAULT 0,
        weight DECIMAL(8,3),
        options JSONB DEFAULT '{}',
        images JSONB DEFAULT '[]',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create product reviews table
    await context.query(`
      CREATE TABLE product_reviews (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        customer_email VARCHAR(255) NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        title VARCHAR(255),
        content TEXT,
        verified_purchase BOOLEAN DEFAULT false,
        helpful_count INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes
    await context.query(`CREATE INDEX idx_categories_slug ON categories(slug);`);
    await context.query(`CREATE INDEX idx_categories_parent_id ON categories(parent_id);`);
    await context.query(`CREATE INDEX idx_categories_active ON categories(active) WHERE active = true;`);
    
    await context.query(`CREATE INDEX idx_products_slug ON products(slug);`);
    await context.query(`CREATE INDEX idx_products_sku ON products(sku);`);
    await context.query(`CREATE INDEX idx_products_category_id ON products(category_id);`);
    await context.query(`CREATE INDEX idx_products_status ON products(status);`);
    await context.query(`CREATE INDEX idx_products_featured ON products(featured) WHERE featured = true;`);
    await context.query(`CREATE INDEX idx_products_price ON products(price);`);
    await context.query(`CREATE INDEX idx_products_created_at ON products(created_at);`);
    
    await context.query(`CREATE INDEX idx_product_variants_product_id ON product_variants(product_id);`);
    await context.query(`CREATE INDEX idx_product_variants_sku ON product_variants(sku);`);
    
    await context.query(`CREATE INDEX idx_product_reviews_product_id ON product_reviews(product_id);`);
    await context.query(`CREATE INDEX idx_product_reviews_rating ON product_reviews(rating);`);
    await context.query(`CREATE INDEX idx_product_reviews_status ON product_reviews(status);`);

    // Add updated_at triggers
    await context.query(`
      CREATE TRIGGER update_categories_updated_at 
      BEFORE UPDATE ON categories 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    await context.query(`
      CREATE TRIGGER update_products_updated_at 
      BEFORE UPDATE ON products 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    await context.query(`
      CREATE TRIGGER update_product_variants_updated_at 
      BEFORE UPDATE ON product_variants 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    await context.query(`
      CREATE TRIGGER update_product_reviews_updated_at 
      BEFORE UPDATE ON product_reviews 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // Insert sample categories
    await context.query(`
      INSERT INTO categories (name, slug, description, sort_order) VALUES
      ('Electronics', 'electronics', 'Electronic devices and gadgets', 1),
      ('Computers', 'computers', 'Computers and accessories', 2),
      ('Smartphones', 'smartphones', 'Mobile phones and accessories', 3),
      ('Home & Garden', 'home-garden', 'Home and garden products', 4),
      ('Books', 'books', 'Books and educational materials', 5),
      ('Clothing', 'clothing', 'Fashion and apparel', 6)
      ON CONFLICT (slug) DO NOTHING;
    `);

    // Create category hierarchy (computers under electronics)
    await context.query(`
      UPDATE categories 
      SET parent_id = (SELECT id FROM categories WHERE slug = 'electronics' LIMIT 1)
      WHERE slug IN ('computers', 'smartphones');
    `);

    // Insert sample products
    await context.query(`
      INSERT INTO products (
        name, slug, description, short_description, sku, price, compare_price,
        category_id, stock_quantity, weight, tags, status, featured, seo_title
      ) 
      SELECT 
        'MacBook Pro 16"',
        'macbook-pro-16',
        'The most powerful MacBook Pro ever is here. With the blazing-fast M1 Pro or M1 Max chip — the first Apple silicon designed for pros — you get groundbreaking performance and amazing battery life.',
        'Powerful laptop with M1 Pro chip',
        'MBP-16-M1PRO-512',
        2499.00,
        2799.00,
        c.id,
        25,
        2.1,
        ARRAY['apple', 'laptop', 'macbook', 'professional'],
        'active',
        true,
        'MacBook Pro 16" with M1 Pro - Professional Laptop'
      FROM categories c WHERE c.slug = 'computers' LIMIT 1
      ON CONFLICT (sku) DO NOTHING;
    `);

    await context.query(`
      INSERT INTO products (
        name, slug, description, short_description, sku, price,
        category_id, stock_quantity, weight, tags, status, featured
      ) 
      SELECT 
        'iPhone 15 Pro',
        'iphone-15-pro',
        'The iPhone 15 Pro features a titanium design, A17 Pro chip, and advanced camera system with 3x telephoto zoom.',
        'Latest iPhone with titanium design',
        'IPH-15-PRO-128',
        999.00,
        c.id,
        50,
        0.187,
        ARRAY['apple', 'iphone', 'smartphone', '5g'],
        'active',
        true
      FROM categories c WHERE c.slug = 'smartphones' LIMIT 1
      ON CONFLICT (sku) DO NOTHING;
    `);

    // Add product variants
    await context.query(`
      INSERT INTO product_variants (product_id, name, sku, price, stock_quantity, options)
      SELECT 
        p.id,
        '128GB Space Black',
        'IPH-15-PRO-128-SB',
        999.00,
        20,
        '{"storage": "128GB", "color": "Space Black"}'
      FROM products p WHERE p.sku = 'IPH-15-PRO-128' LIMIT 1
      ON CONFLICT (sku) DO NOTHING;
    `);

    await context.query(`
      INSERT INTO product_variants (product_id, name, sku, price, stock_quantity, options)
      SELECT 
        p.id,
        '256GB Natural Titanium',
        'IPH-15-PRO-256-NT',
        1099.00,
        15,
        '{"storage": "256GB", "color": "Natural Titanium"}'
      FROM products p WHERE p.sku = 'IPH-15-PRO-128' LIMIT 1
      ON CONFLICT (sku) DO NOTHING;
    `);

    context.logger.info('Products functionality added successfully');
  },

  async down(context: MigrationContext): Promise<void> {
    context.logger.info(`Removing products functionality from ${context.schema} on ${context.cluster}`);
    
    // Drop triggers
    await context.query(`DROP TRIGGER IF EXISTS update_product_reviews_updated_at ON product_reviews;`);
    await context.query(`DROP TRIGGER IF EXISTS update_product_variants_updated_at ON product_variants;`);
    await context.query(`DROP TRIGGER IF EXISTS update_products_updated_at ON products;`);
    await context.query(`DROP TRIGGER IF EXISTS update_categories_updated_at ON categories;`);
    
    // Drop tables in reverse order of creation
    await context.query(`DROP TABLE IF EXISTS product_reviews;`);
    await context.query(`DROP TABLE IF EXISTS product_variants;`);
    await context.query(`DROP TABLE IF EXISTS products;`);
    await context.query(`DROP TABLE IF EXISTS categories;`);
    
    context.logger.info('Products functionality removed successfully');
  }
};

export default migration;