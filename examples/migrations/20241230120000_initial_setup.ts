import { Migration, MigrationContext } from 'pg-multiverse';

const migration: Migration = {
  version: '20241230120000_initial_setup',
  name: 'initial_setup',
  description: 'Initial database setup with users and profiles tables',
  targetSchemas: ['users_data'],
  tags: ['initial', 'users', 'profiles'],
  createdAt: new Date('2024-12-30T12:00:00Z'),

  async up(context: MigrationContext): Promise<void> {
    context.logger.info(`Applying initial setup to ${context.schema} on ${context.cluster}`);
    
    // Create users table
    await context.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email_verified BOOLEAN DEFAULT false,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create profiles table
    await context.query(`
      CREATE TABLE profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        bio TEXT,
        avatar_url VARCHAR(500),
        website VARCHAR(500),
        location VARCHAR(255),
        settings JSONB DEFAULT '{}',
        preferences JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for performance
    await context.query(`
      CREATE INDEX idx_users_email ON users(email);
    `);

    await context.query(`
      CREATE INDEX idx_users_active ON users(active) WHERE active = true;
    `);

    await context.query(`
      CREATE INDEX idx_users_created_at ON users(created_at);
    `);

    // Create function to update updated_at timestamp
    await context.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    // Create triggers for updated_at
    await context.query(`
      CREATE TRIGGER update_users_updated_at 
      BEFORE UPDATE ON users 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    await context.query(`
      CREATE TRIGGER update_profiles_updated_at 
      BEFORE UPDATE ON profiles 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // Insert sample data for testing
    await context.query(`
      INSERT INTO users (email, name, password_hash, email_verified) VALUES
      ('admin@example.com', 'Admin User', '$2b$10$example_hash', true),
      ('user@example.com', 'Regular User', '$2b$10$example_hash', true),
      ('test@example.com', 'Test User', '$2b$10$example_hash', false)
      ON CONFLICT (email) DO NOTHING;
    `);

    // Insert corresponding profiles
    await context.query(`
      INSERT INTO profiles (user_id, bio, location, settings)
      SELECT 
        u.id,
        CASE 
          WHEN u.email = 'admin@example.com' THEN 'System Administrator'
          WHEN u.email = 'user@example.com' THEN 'Regular platform user'
          ELSE 'Test account'
        END,
        'Global',
        '{"theme": "light", "notifications": true}'
      FROM users u
      WHERE u.email IN ('admin@example.com', 'user@example.com', 'test@example.com')
      ON CONFLICT (user_id) DO NOTHING;
    `);

    context.logger.info('Initial setup completed successfully');
  },

  async down(context: MigrationContext): Promise<void> {
    context.logger.info(`Rolling back initial setup from ${context.schema} on ${context.cluster}`);
    
    // Drop triggers first
    await context.query(`DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;`);
    await context.query(`DROP TRIGGER IF EXISTS update_users_updated_at ON users;`);
    
    // Drop function
    await context.query(`DROP FUNCTION IF EXISTS update_updated_at_column();`);
    
    // Drop tables (foreign key constraints will handle cascade)
    await context.query(`DROP TABLE IF EXISTS profiles;`);
    await context.query(`DROP TABLE IF EXISTS users;`);
    
    context.logger.info('Initial setup rolled back successfully');
  }
};

export default migration;