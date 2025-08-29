import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Simple integration test to verify PostgreSQL connectivity
describe('PostgreSQL Integration Tests', () => {
  let pool1: Pool;
  let pool2: Pool;
  let pool3: Pool;

  beforeAll(async () => {
    // Initialize connection pools
    pool1 = new Pool({
      host: 'localhost',
      port: 5432,
      database: 'test_db',
      user: 'test_user',
      password: 'test_password',
      max: 2
    });

    pool2 = new Pool({
      host: 'localhost',
      port: 5438,
      database: 'test_commerce',
      user: 'test_user',
      password: 'test_password',
      max: 2
    });

    pool3 = new Pool({
      host: 'localhost',
      port: 5440,
      database: 'test_failover',
      user: 'test_user',
      password: 'test_password',
      max: 2
    });
  });

  afterAll(async () => {
    await pool1.end();
    await pool2.end();
    await pool3.end();
  });

  describe('Database Connectivity', () => {
    it('should connect to cluster 1 (users & auth)', async () => {
      const client = await pool1.connect();
      try {
        const result = await client.query('SELECT 1 as test');
        expect(result.rows[0].test).toBe(1);
      } finally {
        client.release();
      }
    });

    it('should connect to cluster 2 (commerce)', async () => {
      const client = await pool2.connect();
      try {
        const result = await client.query('SELECT 1 as test');
        expect(result.rows[0].test).toBe(1);
      } finally {
        client.release();
      }
    });

    it('should connect to cluster 3 (failover)', async () => {
      const client = await pool3.connect();
      try {
        const result = await client.query('SELECT 1 as test');
        expect(result.rows[0].test).toBe(1);
      } finally {
        client.release();
      }
    });
  });

  describe('Schema Validation', () => {
    it('should have users schema in cluster 1', async () => {
      const client = await pool1.connect();
      try {
        const result = await client.query(`
          SELECT schema_name 
          FROM information_schema.schemata 
          WHERE schema_name = 'users'
        `);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].schema_name).toBe('users');
      } finally {
        client.release();
      }
    });

    it('should have auth schema in cluster 1', async () => {
      const client = await pool1.connect();
      try {
        const result = await client.query(`
          SELECT schema_name 
          FROM information_schema.schemata 
          WHERE schema_name = 'auth'
        `);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].schema_name).toBe('auth');
      } finally {
        client.release();
      }
    });

    it('should have products schema in cluster 2', async () => {
      const client = await pool2.connect();
      try {
        const result = await client.query(`
          SELECT schema_name 
          FROM information_schema.schemata 
          WHERE schema_name = 'products'
        `);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].schema_name).toBe('products');
      } finally {
        client.release();
      }
    });

    it('should have orders schema in cluster 2', async () => {
      const client = await pool2.connect();
      try {
        const result = await client.query(`
          SELECT schema_name 
          FROM information_schema.schemata 
          WHERE schema_name = 'orders'
        `);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].schema_name).toBe('orders');
      } finally {
        client.release();
      }
    });

    it('should have analytics schema in cluster 3', async () => {
      const client = await pool3.connect();
      try {
        const result = await client.query(`
          SELECT schema_name 
          FROM information_schema.schemata 
          WHERE schema_name = 'analytics'
        `);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].schema_name).toBe('analytics');
      } finally {
        client.release();
      }
    });
  });

  describe('Data Validation', () => {
    it('should have test users in cluster 1', async () => {
      const client = await pool1.connect();
      try {
        const result = await client.query('SELECT COUNT(*) as count FROM users.users');
        expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });

    it('should have test products in cluster 2', async () => {
      const client = await pool2.connect();
      try {
        const result = await client.query('SELECT COUNT(*) as count FROM products.products');
        expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });

    it('should have test orders in cluster 2', async () => {
      const client = await pool2.connect();
      try {
        const result = await client.query('SELECT COUNT(*) as count FROM orders.orders');
        expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });

    it('should have test events in cluster 3', async () => {
      const client = await pool3.connect();
      try {
        const result = await client.query('SELECT COUNT(*) as count FROM analytics.events');
        expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });
  });

  describe('Basic CRUD Operations', () => {
    it('should insert and retrieve user data', async () => {
      const client = await pool1.connect();
      try {
        const email = `test_${Date.now()}@example.com`;
        
        // Insert
        const insertResult = await client.query(
          'INSERT INTO users.users (email, name, active) VALUES ($1, $2, $3) RETURNING id',
          [email, 'Test User', true]
        );
        
        const userId = insertResult.rows[0].id;
        expect(userId).toBeGreaterThan(0);
        
        // Retrieve
        const selectResult = await client.query(
          'SELECT * FROM users.users WHERE id = $1',
          [userId]
        );
        
        expect(selectResult.rows).toHaveLength(1);
        expect(selectResult.rows[0].email).toBe(email);
        expect(selectResult.rows[0].name).toBe('Test User');
        expect(selectResult.rows[0].active).toBe(true);
        
      } finally {
        client.release();
      }
    });

    it('should insert and retrieve product data', async () => {
      const client = await pool2.connect();
      try {
        const sku = `TEST-${Date.now()}`;
        
        // Insert
        const insertResult = await client.query(`
          INSERT INTO products.products (name, description, price, category_id, sku, stock_quantity, active) 
          VALUES ($1, $2, $3, $4, $5, $6, $7) 
          RETURNING id
        `, ['Test Product', 'Integration test product', 99.99, 1, sku, 10, true]);
        
        const productId = insertResult.rows[0].id;
        expect(productId).toBeGreaterThan(0);
        
        // Retrieve
        const selectResult = await client.query(
          'SELECT * FROM products.products WHERE id = $1',
          [productId]
        );
        
        expect(selectResult.rows).toHaveLength(1);
        expect(selectResult.rows[0].sku).toBe(sku);
        expect(selectResult.rows[0].name).toBe('Test Product');
        expect(parseFloat(selectResult.rows[0].price)).toBe(99.99);
        
      } finally {
        client.release();
      }
    });
  });

  describe('Replica Connectivity', () => {
    it('should connect to cluster 1 replica', async () => {
      const replicaPool = new Pool({
        host: 'localhost',
        port: 5437,
        database: 'test_db',
        user: 'test_user',
        password: 'test_password',
        max: 1
      });

      try {
        const client = await replicaPool.connect();
        try {
          const result = await client.query('SELECT COUNT(*) as count FROM users.users');
          expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
        } finally {
          client.release();
        }
      } finally {
        await replicaPool.end();
      }
    });

    it('should connect to cluster 2 replica', async () => {
      const replicaPool = new Pool({
        host: 'localhost',
        port: 5439,
        database: 'test_commerce',
        user: 'test_user',
        password: 'test_password',
        max: 1
      });

      try {
        const client = await replicaPool.connect();
        try {
          const result = await client.query('SELECT COUNT(*) as count FROM products.products');
          expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
        } finally {
          client.release();
        }
      } finally {
        await replicaPool.end();
      }
    });
  });
});