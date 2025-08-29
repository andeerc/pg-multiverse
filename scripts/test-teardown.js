const { execSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const COMPOSE_FILE = path.join(PROJECT_ROOT, 'docker-compose.test.yml');

console.log('🧹 Tearing down PostgreSQL test environment...');

async function teardown() {
  try {
    console.log('🛑 Stopping PostgreSQL containers...');
    execSync(`docker-compose -f "${COMPOSE_FILE}" down -v --remove-orphans`, {
      stdio: 'inherit',
      cwd: PROJECT_ROOT
    });
    
    console.log('🗑️  Removing test volumes...');
    try {
      // Remove any dangling volumes that might be left
      execSync('docker volume prune -f', {
        stdio: 'pipe',
        cwd: PROJECT_ROOT
      });
    } catch (error) {
      // Ignore volume cleanup errors
    }
    
    console.log('✅ Test environment cleaned up successfully!');
    
  } catch (error) {
    console.error('❌ Failed to teardown test environment:', error.message);
    process.exit(1);
  }
}

teardown();