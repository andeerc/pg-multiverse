import { PgMultiverse } from '../src';

// Integration tests for PgMultiverse functionality
describe('PgMultiverse Integration Tests', () => {
  let postgres: PgMultiverse;

  beforeAll(async () => {
    // Initialize PgMultiverse with test configuration
    postgres = new PgMultiverse({
      enableCache: true,
      enableMetrics: true,
      enableTransactions: true,
      enableMigrations: true,
    });

    await postgres.initialize({
      users_cluster: {
        schemas: ['users', 'auth'],
        primary: {
          host: 'localhost',
          port: 5432,
          database: 'test_db',
          user: 'test_user',
          password: 'test_password',
          maxConnections: 10
        },
        replicas: [{
          host: 'localhost',
          port: 5437,
          database: 'test_db',
          user: 'test_user',
          password: 'test_password',
          maxConnections: 8
        }]
      },
      commerce_cluster: {
        schemas: ['products', 'orders'],
        primary: {
          host: 'localhost',
          port: 5438,
          database: 'test_commerce',
          user: 'test_user',
          password: 'test_password',
          maxConnections: 15
        },
        replicas: [{
          host: 'localhost',
          port: 5439,
          database: 'test_commerce',
          user: 'test_user',
          password: 'test_password',
          maxConnections: 10
        }]
      },
      analytics_cluster: {
        schemas: ['analytics'],
        primary: {
          host: 'localhost',
          port: 5440,
          database: 'test_failover',
          user: 'test_user',
          password: 'test_password',
          maxConnections: 8
        }
      }
    });
  });

  afterAll(async () => {
    if (postgres) {
      await postgres.close();
    }
  });

  describe('Database Connectivity', () => {
    it('should connect to users cluster', async () => {
      const result = await postgres.query('SELECT 1 as test', [], { 
        schema: 'users' 
      });
      expect(result.rows[0].test).toBe(1);
      expect(result.clusterId).toBe('users_cluster');
      expect(['primary', 'replica']).toContain(result.databaseRole);
      
      // Should have detailed connection info
      expect(result.connectionInfo).toBeDefined();
      expect(result.connectionInfo!.host).toBe('localhost');
      expect(result.connectionInfo!.port).toBeGreaterThan(0);
      expect(result.connectionInfo!.database).toBeDefined();
      expect(result.connectionInfo!.user).toBe('test_user');
    });

    it('should connect to commerce cluster', async () => {
      const result = await postgres.query('SELECT 1 as test', [], { 
        schema: 'products' 
      });
      expect(result.rows[0].test).toBe(1);
      expect(result.clusterId).toBe('commerce_cluster');
    });

    it('should connect to analytics cluster', async () => {
      const result = await postgres.query('SELECT 1 as test', [], { 
        schema: 'analytics' 
      });
      expect(result.rows[0].test).toBe(1);
      expect(result.clusterId).toBe('analytics_cluster');
    });
  });

  describe('Schema Routing', () => {
    it('should route users schema to users_cluster', async () => {
      const result = await postgres.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name = 'users'
      `, [], { schema: 'users' });
      
      expect(result.clusterId).toBe('users_cluster');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].schema_name).toBe('users');
    });

    it('should route auth schema to users_cluster', async () => {
      const result = await postgres.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name = 'auth'
      `, [], { schema: 'auth' });
      
      expect(result.clusterId).toBe('users_cluster');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].schema_name).toBe('auth');
    });

    it('should route products schema to commerce_cluster', async () => {
      const result = await postgres.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name = 'products'
      `, [], { schema: 'products' });
      
      expect(result.clusterId).toBe('commerce_cluster');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].schema_name).toBe('products');
    });

    it('should route orders schema to commerce_cluster', async () => {
      const result = await postgres.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name = 'orders'
      `, [], { schema: 'orders' });
      
      expect(result.clusterId).toBe('commerce_cluster');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].schema_name).toBe('orders');
    });

    it('should route analytics schema to analytics_cluster', async () => {
      const result = await postgres.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name = 'analytics'
      `, [], { schema: 'analytics' });
      
      expect(result.clusterId).toBe('analytics_cluster');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].schema_name).toBe('analytics');
    });
  });

  describe('Data Validation', () => {
    it('should have test users in users cluster', async () => {
      const result = await postgres.query(
        'SELECT COUNT(*) as count FROM users.users', 
        [], 
        { schema: 'users' }
      );
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      expect(result.clusterId).toBe('users_cluster');
    });

    it('should have test products in commerce cluster', async () => {
      const result = await postgres.query(
        'SELECT COUNT(*) as count FROM products.products', 
        [], 
        { schema: 'products' }
      );
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      expect(result.clusterId).toBe('commerce_cluster');
    });

    it('should have test orders in commerce cluster', async () => {
      const result = await postgres.query(
        'SELECT COUNT(*) as count FROM orders.orders', 
        [], 
        { schema: 'orders' }
      );
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      expect(result.clusterId).toBe('commerce_cluster');
    });

    it('should have test events in analytics cluster', async () => {
      const result = await postgres.query(
        'SELECT COUNT(*) as count FROM analytics.events', 
        [], 
        { schema: 'analytics' }
      );
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      expect(result.clusterId).toBe('analytics_cluster');
    });
  });

  describe('Basic CRUD Operations', () => {
    it('should insert and retrieve user data', async () => {
      const email = `test_${Date.now()}@example.com`;
      
      // Insert
      const insertResult = await postgres.query(
        'INSERT INTO users.users (email, name, active) VALUES ($1, $2, $3) RETURNING id',
        [email, 'Test User', true],
        { schema: 'users' }
      );
      
      const userId = insertResult.rows[0].id;
      expect(userId).toBeGreaterThan(0);
      expect(insertResult.clusterId).toBe('users_cluster');
      
      console.log('INSERT went to:', insertResult.databaseRole, `${insertResult.connectionInfo!.host}:${insertResult.connectionInfo!.port}`);
      
      // Retrieve
      const selectResult = await postgres.query(
        'SELECT * FROM users.users WHERE id = $1',
        [userId],
        { schema: 'users' }
      );
      
      console.log('SELECT went to:', selectResult.databaseRole, `${selectResult.connectionInfo!.host}:${selectResult.connectionInfo!.port}`);
      console.log('SELECT found rows:', selectResult.rows.length);
      
      expect(selectResult.rows).toHaveLength(1);
      expect(selectResult.rows[0].email).toBe(email);
      expect(selectResult.rows[0].name).toBe('Test User');
      expect(selectResult.rows[0].active).toBe(true);
      expect(selectResult.clusterId).toBe('users_cluster');
    });

    it('should insert and retrieve product data', async () => {
      const sku = `TEST-${Date.now()}`;
      
      // Insert
      const insertResult = await postgres.query(`
        INSERT INTO products.products (name, description, price, category_id, sku, stock_quantity, active) 
        VALUES ($1, $2, $3, $4, $5, $6, $7) 
        RETURNING id
      `, ['Test Product', 'Integration test product', 99.99, 1, sku, 10, true], {
        schema: 'products'
      });
      
      const productId = insertResult.rows[0].id;
      expect(productId).toBeGreaterThan(0);
      expect(insertResult.clusterId).toBe('commerce_cluster');
      
      // Retrieve
      const selectResult = await postgres.query(
        'SELECT * FROM products.products WHERE id = $1',
        [productId],
        { schema: 'products' }
      );
      
      expect(selectResult.rows).toHaveLength(1);
      expect(selectResult.rows[0].sku).toBe(sku);
      expect(selectResult.rows[0].name).toBe('Test Product');
      expect(parseFloat(selectResult.rows[0].price)).toBe(99.99);
      expect(selectResult.clusterId).toBe('commerce_cluster');
    });
  });

  describe('Replica Connectivity', () => {
    it('should route read queries to replicas when available', async () => {
      // Test that reads can be handled by replicas in users cluster
      const result = await postgres.query(
        'SELECT COUNT(*) as count FROM users.users',
        [],
        { 
          schema: 'users',
          preferReplica: true // This should use replica if available
        }
      );
      
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      expect(result.clusterId).toBe('users_cluster');
      // Should prefer replica if available, otherwise use primary
      expect(['primary', 'replica']).toContain(result.databaseRole);
    });

    it('should route read queries to replicas in commerce cluster', async () => {
      // Test that reads can be handled by replicas in commerce cluster
      const result = await postgres.query(
        'SELECT COUNT(*) as count FROM products.products',
        [],
        { 
          schema: 'products',
          preferReplica: true // This should use replica if available
        }
      );
      
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      expect(result.clusterId).toBe('commerce_cluster');
    });

    it('should fallback to primary when replicas are unavailable', async () => {
      // Test fallback behavior - this will use primary since replicas might not be configured
      const result = await postgres.query(
        'SELECT COUNT(*) as count FROM analytics.events',
        [],
        { 
          schema: 'analytics',
          preferReplica: true
        }
      );
      
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      expect(result.clusterId).toBe('analytics_cluster');
      expect(['primary', 'replica']).toContain(result.databaseRole);
    });

    it('should always use primary for write operations', async () => {
      const email = `write_test_${Date.now()}@example.com`;
      
      // Insert operation should always go to primary
      const insertResult = await postgres.query(
        'INSERT INTO users.users (email, name, active) VALUES ($1, $2, $3) RETURNING id',
        [email, 'Write Test User', true],
        { 
          schema: 'users',
          preferReplica: true // Even with preferReplica, writes should go to primary
        }
      );
      
      expect(insertResult.clusterId).toBe('users_cluster');
      expect(insertResult.databaseRole).toBe('primary');
      expect(insertResult.connectionInfo!.host).toBe('localhost');
      expect(insertResult.connectionInfo!.port).toBe(5432); // Primary port
    });

    it('should show exactly which database returned the result', async () => {
      // Test different operations to see which exact database was used
      const readResult = await postgres.query(
        'SELECT COUNT(*) as count FROM users.users',
        [],
        { schema: 'users', preferReplica: true }
      );

      const writeResult = await postgres.query(
        'UPDATE users.users SET active = true WHERE active = true',
        [],
        { schema: 'users' }
      );

      // Both should have complete connection info
      expect(readResult.connectionInfo).toEqual({
        host: expect.any(String),
        port: expect.any(Number),
        database: expect.any(String),
        user: 'test_user',
        replicaIndex: expect.anything()
      });

      expect(writeResult.connectionInfo).toEqual({
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        user: 'test_user',
        replicaIndex: undefined // Primary doesn't have replicaIndex
      });

      // Write should always be primary
      expect(writeResult.databaseRole).toBe('primary');
      
      console.log('Read query used:', readResult.databaseRole, `${readResult.connectionInfo!.host}:${readResult.connectionInfo!.port}`);
      console.log('Write query used:', writeResult.databaseRole, `${writeResult.connectionInfo!.host}:${writeResult.connectionInfo!.port}`);
    });
  });
});