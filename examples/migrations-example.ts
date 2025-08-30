import { PgMultiverse, Migration, MigrationContext } from '../src';

async function migrationExample() {
  console.log('🚀 PgMultiverse Migration System Example');
  
  // 1. Initialize PgMultiverse with migrations enabled
  const postgres = new PgMultiverse({
    enableMigrations: true,
    migrations: {
      migrationsPath: './migrations',
      autoCreateMigrationsTable: true,
      validateChecksums: true,
    },
  });

  await postgres.initialize({
    users_cluster: {
      schemas: ['users_data'],
      primary: {
        host: 'localhost',
        port: 5454,
        database: 'test_db',
        user: 'test_user',
        password: 'test_password',
        maxConnections: 10
      }
    },
    products_cluster: {
      schemas: ['products_data'],
      primary: {
        host: 'localhost',
        port: 5456,
        database: 'test_products',
        user: 'test_user',
        password: 'test_password',
        maxConnections: 10
      }
    }
  });

  console.log('✅ PgMultiverse initialized');

  // 2. Create migrations programmatically
  const usersMigration: Migration = {
    version: '20241230120000_create_users_table',
    name: 'create_users_table',
    description: 'Create initial users table with profile support',
    targetSchemas: ['users_data'],
    createdAt: new Date(),
    
    async up(context: MigrationContext): Promise<void> {
      context.logger.info(`Creating users table in ${context.schema}`);
      
      await context.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await context.query(`
        CREATE TABLE IF NOT EXISTS profiles (
          user_id INTEGER PRIMARY KEY REFERENCES users(id),
          bio TEXT,
          avatar_url VARCHAR(500),
          settings JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      context.logger.info('Users and profiles tables created successfully');
    },

    async down(context: MigrationContext): Promise<void> {
      context.logger.info(`Dropping users tables from ${context.schema}`);
      
      await context.query(`DROP TABLE IF EXISTS profiles`);
      await context.query(`DROP TABLE IF EXISTS users`);
      
      context.logger.info('Users tables dropped successfully');
    }
  };

  const productsMigration: Migration = {
    version: '20241230120100_create_products_table',
    name: 'create_products_table',
    description: 'Create products catalog with categories',
    targetSchemas: ['products_data'],
    dependencies: ['20241230120000_create_users_table'], // Example dependency
    createdAt: new Date(),
    
    async up(context: MigrationContext): Promise<void> {
      context.logger.info(`Creating products table in ${context.schema}`);
      
      await context.query(`
        CREATE TABLE IF NOT EXISTS categories (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(255) UNIQUE NOT NULL,
          description TEXT,
          parent_id INTEGER REFERENCES categories(id),
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await context.query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(255) UNIQUE NOT NULL,
          description TEXT,
          price DECIMAL(10,2) NOT NULL,
          category_id INTEGER REFERENCES categories(id),
          stock_quantity INTEGER DEFAULT 0,
          active BOOLEAN DEFAULT true,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Insert sample categories
      await context.query(`
        INSERT INTO categories (name, slug, description) VALUES
        ('Electronics', 'electronics', 'Electronic devices and accessories'),
        ('Clothing', 'clothing', 'Fashion and apparel'),
        ('Books', 'books', 'Books and educational materials')
        ON CONFLICT (slug) DO NOTHING
      `);

      context.logger.info('Products and categories tables created successfully');
    },

    async down(context: MigrationContext): Promise<void> {
      context.logger.info(`Dropping products tables from ${context.schema}`);
      
      await context.query(`DROP TABLE IF EXISTS products`);
      await context.query(`DROP TABLE IF EXISTS categories`);
      
      context.logger.info('Products tables dropped successfully');
    }
  };

  // 3. Add migrations
  postgres.addMigration(usersMigration);
  postgres.addMigration(productsMigration);
  
  console.log('✅ Migrations added');

  // 4. Check migration status
  console.log('\n📊 Checking migration status...');
  let status = await postgres.getMigrationStatus();
  console.log(`Total migrations: ${status.totalMigrations}`);
  console.log(`Applied: ${status.appliedMigrations}`);
  console.log(`Pending: ${status.pendingMigrations}`);

  // 5. Run migrations
  if (status.pendingMigrations > 0) {
    console.log('\n🚀 Running pending migrations...');
    
    status = await postgres.migrate({
      parallel: false, // Run sequentially for demo
    });
    
    console.log(`✅ Migrations completed. Applied: ${status.appliedMigrations}, Pending: ${status.pendingMigrations}`);
  }

  // 6. Test the created tables
  console.log('\n🧪 Testing created tables...');
  
  try {
    // Insert test user
    const userResult = await postgres.query(`
      INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id
    `, ['john.doe@example.com', 'John Doe'], {
      schema: 'users_data'
    });
    
    const userId = userResult.rows[0].id;
    console.log(`User created with ID: ${userId}`);

    // Insert user profile
    await postgres.query(`
      INSERT INTO profiles (user_id, bio, avatar_url) VALUES ($1, $2, $3)
    `, [userId, 'Software Engineer', 'https://example.com/avatar.jpg'], {
      schema: 'users_data'
    });

    console.log('User profile created');

    // Insert test product
    const categoryResult = await postgres.query(`
      SELECT id FROM categories WHERE slug = $1 LIMIT 1
    `, ['electronics'], {
      schema: 'products_data'
    });
    
    if (categoryResult.rows.length > 0) {
      const categoryId = categoryResult.rows[0].id;
      
      await postgres.query(`
        INSERT INTO products (name, slug, description, price, category_id, stock_quantity)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        'Smartphone Pro',
        'smartphone-pro',
        'Latest smartphone with advanced features',
        999.99,
        categoryId,
        50
      ], {
        schema: 'products_data'
      });

      console.log('Product created');
    }

    // Query data to verify
    const users = await postgres.query(`
      SELECT u.*, p.bio FROM users u 
      LEFT JOIN profiles p ON u.id = p.user_id
    `, [], { schema: 'users_data' });
    
    const products = await postgres.query(`
      SELECT p.*, c.name as category_name FROM products p
      JOIN categories c ON p.category_id = c.id
    `, [], { schema: 'products_data' });

    console.log(`Found ${users.rows.length} users and ${products.rows.length} products`);

  } catch (error) {
    console.error('Test failed:', error);
  }

  // 7. Demonstrate rollback (optional)
  console.log('\n↩️ Demonstrating rollback...');
  
  try {
    await postgres.rollback({
      steps: 1, // Rollback last migration
      dryRun: true, // Just show what would happen
    });
    
    console.log('✅ Rollback dry run completed');
  } catch (error) {
    console.error('Rollback demo failed:', error);
  }

  // 8. Show final status
  console.log('\n📊 Final migration status:');
  const finalStatus = await postgres.getMigrationStatus();
  
  console.log('By Schema:');
  for (const [schema, stats] of Object.entries(finalStatus.bySchema)) {
    console.log(`  ${schema}: ${stats.applied} applied, ${stats.pending} pending`);
    if (stats.lastApplied) {
      console.log(`    Last applied: ${stats.lastApplied}`);
    }
  }

  // 9. Create migration files for demonstration
  console.log('\n📝 Creating migration files...');
  
  try {
    const filePath = await postgres.createMigration('add_user_indexes', {
      targetSchemas: ['users_data'],
      description: 'Add performance indexes to users table',
    });
    
    console.log(`Migration file created: ${filePath}`);
  } catch (error) {
    console.log('Migration file creation skipped:', (error as Error).message);
  }

  // Cleanup
  await postgres.close();
  console.log('\n✅ Example completed successfully!');
}

// Advanced migration example with multiple schemas
async function advancedMigrationExample() {
  console.log('\n🔥 Advanced Migration Example - Cross-schema operations');
  
  const postgres = new PgMultiverse({
    enableMigrations: true,
    enableTransactions: true,
    migrations: {
      migrationsPath: './migrations',
      autoCreateMigrationsTable: true,
    },
  });

  // Multi-cluster setup
  await postgres.initialize({
    users_cluster: {
      schemas: ['users_data', 'auth_data'],
      primary: {
        host: 'localhost',
        port: 5454,
        database: 'test_db',
        user: 'test_user',
        password: 'test_password',
      }
    },
    business_cluster: {
      schemas: ['products_data', 'orders_data'],
      primary: {
        host: 'localhost',
        port: 5456,
        database: 'test_business',
        user: 'test_user',
        password: 'test_password',
      }
    }
  });

  // Cross-schema migration
  const crossSchemaMigration: Migration = {
    version: '20241230130000_setup_complete_system',
    name: 'setup_complete_system',
    description: 'Setup complete e-commerce system across multiple schemas',
    targetSchemas: ['users_data', 'auth_data', 'products_data', 'orders_data'],
    createdAt: new Date(),
    
    async up(context: MigrationContext): Promise<void> {
      context.logger.info(`Setting up ${context.schema} in ${context.cluster}`);
      
      if (context.schema === 'auth_data') {
        await context.query(`
          CREATE TABLE IF NOT EXISTS user_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_email VARCHAR(255) NOT NULL,
            token_hash VARCHAR(255) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
      }
      
      if (context.schema === 'orders_data') {
        await context.query(`
          CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            user_email VARCHAR(255) NOT NULL,
            total_amount DECIMAL(10,2) NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);

        await context.query(`
          CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INTEGER REFERENCES orders(id),
            product_name VARCHAR(255) NOT NULL,
            quantity INTEGER NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
      }
    },

    async down(context: MigrationContext): Promise<void> {
      if (context.schema === 'auth_data') {
        await context.query(`DROP TABLE IF EXISTS user_sessions`);
      }
      
      if (context.schema === 'orders_data') {
        await context.query(`DROP TABLE IF EXISTS order_items`);
        await context.query(`DROP TABLE IF EXISTS orders`);
      }
    }
  };

  postgres.addMigration(crossSchemaMigration);

  // Run with parallel execution
  const status = await postgres.migrate({
    parallel: true,
    maxParallel: 4,
  });

  console.log('✅ Advanced migration completed');
  console.log(`Schemas processed: ${Object.keys(status.bySchema).length}`);
  console.log(`Clusters processed: ${Object.keys(status.byCluster).length}`);

  await postgres.close();
}

// Run examples
async function runExamples() {
  try {
    await migrationExample();
    // await advancedMigrationExample(); // Uncomment to run advanced example
  } catch (error) {
    console.error('❌ Example failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runExamples();
}

export { migrationExample, advancedMigrationExample };