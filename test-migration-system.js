const { PgMultiverse } = require('./dist');

async function testMigrationSystem() {
  console.log('🧪 Testing PgMultiverse Migration System');
  
  const postgres = new PgMultiverse({
    enableMigrations: true,
    migrations: {
      migrationsPath: './migrations',
      autoCreateMigrationsTable: true,
      validateChecksums: false, // Disable for testing
      logger: {
        info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ''),
        warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta || ''),
        error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta || ''),
        debug: (msg, meta) => console.log(`[DEBUG] ${msg}`, meta || ''),
      }
    },
  });

  try {
    // Initialize with your cluster configuration
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
      }
    });

    console.log('✅ PgMultiverse initialized with migrations');

    // Check migration status
    let status = await postgres.getMigrationStatus();
    console.log('\n📊 Initial Migration Status:');
    console.log(`  Total migrations: ${status.totalMigrations}`);
    console.log(`  Applied: ${status.appliedMigrations}`);
    console.log(`  Pending: ${status.pendingMigrations}`);

    // List available migrations
    const migrations = postgres.getMigrations();
    console.log('\n📋 Available Migrations:');
    migrations.forEach(migration => {
      console.log(`  - ${migration.version}: ${migration.name}`);
      console.log(`    Schemas: ${migration.targetSchemas.join(', ')}`);
      console.log(`    Description: ${migration.description || 'No description'}`);
    });

    // Run migrations if there are pending ones
    if (status.pendingMigrations > 0) {
      console.log('\n🚀 Running pending migrations...');
      
      // Add event listeners for progress
      const migrationManager = postgres.getMigrationManager();
      
      migrationManager.on('migrationStarted', (data) => {
        console.log(`  ⚡ Starting: ${data.name} on ${data.schema}@${data.cluster}`);
      });
      
      migrationManager.on('migrationCompleted', (data) => {
        console.log(`  ✅ Completed: ${data.name} (${data.duration}ms)`);
      });
      
      migrationManager.on('migrationFailed', (data) => {
        console.log(`  ❌ Failed: ${data.name} - ${data.error.message}`);
      });

      status = await postgres.migrate({
        parallel: false,
      });

      console.log('\n✅ Migration process completed');
      console.log(`  Applied: ${status.appliedMigrations}`);
      console.log(`  Pending: ${status.pendingMigrations}`);
    }

    // Test the migrated database
    console.log('\n🧪 Testing migrated database...');
    
    try {
      // Test if users table exists and has data
      const usersResult = await postgres.query(`
        SELECT COUNT(*) as count FROM users
      `, [], { schema: 'users_data' });
      
      console.log(`  Users table: ${usersResult.rows[0].count} records`);

      // Test if profiles table exists
      const profilesResult = await postgres.query(`
        SELECT COUNT(*) as count FROM profiles
      `, [], { schema: 'users_data' });
      
      console.log(`  Profiles table: ${profilesResult.rows[0].count} records`);

      // Insert a test user
      const newUserResult = await postgres.query(`
        INSERT INTO users (email, name, password_hash, email_verified)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email
      `, [
        'migration.test@example.com',
        'Migration Test User',
        '$2b$10$example_hash_for_testing',
        true
      ], { schema: 'users_data' });

      if (newUserResult.rows.length > 0) {
        const newUser = newUserResult.rows[0];
        console.log(`  ✅ Created test user: ${newUser.email} (ID: ${newUser.id})`);

        // Create profile for test user
        await postgres.query(`
          INSERT INTO profiles (user_id, bio, location)
          VALUES ($1, $2, $3)
        `, [
          newUser.id,
          'Created by migration system test',
          'Test Environment'
        ], { schema: 'users_data' });

        console.log(`  ✅ Created profile for test user`);
      }

    } catch (testError) {
      console.log(`  ⚠️ Database test failed: ${testError.message}`);
    }

    // Show final status
    console.log('\n📊 Final Migration Status:');
    const finalStatus = await postgres.getMigrationStatus();
    
    Object.entries(finalStatus.bySchema).forEach(([schema, stats]) => {
      console.log(`  ${schema}:`);
      console.log(`    Applied: ${stats.applied}`);
      console.log(`    Pending: ${stats.pending}`);
      if (stats.lastApplied) {
        console.log(`    Last applied: ${stats.lastApplied}`);
      }
    });

    // Demonstrate dry run rollback
    console.log('\n🔍 Testing rollback (dry run)...');
    try {
      await postgres.rollback({
        steps: 1,
        dryRun: true,
      });
      console.log('  ✅ Rollback dry run completed');
    } catch (rollbackError) {
      console.log(`  ⚠️ Rollback test failed: ${rollbackError.message}`);
    }

  } catch (error) {
    console.error('❌ Migration test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await postgres.close();
    console.log('\n✅ Migration system test completed');
  }
}

testMigrationSystem().catch(console.error);