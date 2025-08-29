const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const COMPOSE_FILE = path.join(PROJECT_ROOT, 'docker-compose.test.yml');
const MAX_WAIT_TIME = 120000; // 2 minutes
const HEALTH_CHECK_INTERVAL = 2000; // 2 seconds

console.log('🚀 Setting up PostgreSQL test environment...');

async function waitForServices() {
  const services = [
    'pg-multiverse-primary-1',
    'pg-multiverse-replica-1', 
    'pg-multiverse-primary-2',
    'pg-multiverse-replica-2',
    'pg-multiverse-failover'
  ];

  console.log('⏳ Waiting for PostgreSQL services to be healthy...');
  
  const startTime = Date.now();
  
  while (Date.now() - startTime < MAX_WAIT_TIME) {
    try {
      // Check if all services are healthy
      const result = execSync(`docker-compose -f "${COMPOSE_FILE}" ps --services --filter "status=running"`, {
        encoding: 'utf-8',
        cwd: PROJECT_ROOT
      });

      const runningServices = result.trim().split('\n').filter(s => s.length > 0);
      
      if (runningServices.length === services.length) {
        // Additional health check - try to connect to each PostgreSQL instance
        let allHealthy = true;
        
        for (const service of services) {
          try {
            execSync(`docker exec ${service} pg_isready -U test_user`, {
              stdio: 'pipe',
              cwd: PROJECT_ROOT
            });
          } catch (error) {
            allHealthy = false;
            break;
          }
        }
        
        if (allHealthy) {
          console.log('✅ All PostgreSQL services are healthy!');
          return true;
        }
      }
      
      console.log(`⏳ Waiting... (${Math.floor((Date.now() - startTime) / 1000)}s elapsed)`);
      await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL));
      
    } catch (error) {
      console.log(`⏳ Services still starting... (${Math.floor((Date.now() - startTime) / 1000)}s elapsed)`);
      await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL));
    }
  }
  
  throw new Error(`❌ Timeout waiting for services to be ready (${MAX_WAIT_TIME / 1000}s)`);
}

async function setup() {
  try {
    // Check if Docker is available
    console.log('🔍 Checking Docker availability...');
    execSync('docker --version', { stdio: 'pipe' });
    execSync('docker-compose --version', { stdio: 'pipe' });
    
    // Check if compose file exists
    if (!fs.existsSync(COMPOSE_FILE)) {
      throw new Error(`Docker Compose file not found: ${COMPOSE_FILE}`);
    }
    
    console.log('🧹 Cleaning up any existing containers...');
    try {
      execSync(`docker-compose -f "${COMPOSE_FILE}" down -v --remove-orphans`, {
        stdio: 'pipe',
        cwd: PROJECT_ROOT
      });
    } catch (error) {
      // Ignore cleanup errors
    }
    
    console.log('📦 Starting PostgreSQL containers...');
    execSync(`docker-compose -f "${COMPOSE_FILE}" up -d`, {
      stdio: 'inherit',
      cwd: PROJECT_ROOT
    });
    
    await waitForServices();
    
    console.log('🎯 Running database initialization...');
    // Give a bit more time for initialization scripts to complete
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('✨ Test environment is ready!');
    console.log('');
    console.log('📊 Available services:');
    console.log('  - Cluster 1 Primary:  localhost:5432 (test_db)');
    console.log('  - Cluster 1 Replica:  localhost:5437 (test_db)');
    console.log('  - Cluster 2 Primary:  localhost:5438 (test_commerce)');
    console.log('  - Cluster 2 Replica:  localhost:5439 (test_commerce)');
    console.log('  - Failover Cluster:   localhost:5440 (test_failover)');
    console.log('');
    console.log('🔑 Credentials: test_user / test_password');
    
  } catch (error) {
    console.error('❌ Failed to setup test environment:', error.message);
    process.exit(1);
  }
}

setup();