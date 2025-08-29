import { PgMultiverse, CacheFactory } from '../src';

async function redisExample() {
  console.log('🌟 Redis Cache Example');
  
  // Example 1: Using Redis cache with PgMultiverse
  const postgres = new PgMultiverse({
    enableCache: true,
    enableMetrics: true,
    cache: {
      provider: 'redis',
      maxSize: 10000,
      ttl: 300000, // 5 minutes
      redis: {
        host: 'localhost',
        port: 6379,
        // password: 'your-redis-password', // uncomment if Redis has password
        keyPrefix: 'pg-multiverse:',
        compression: 'gzip',
        pool: {
          min: 5,
          max: 20,
        },
      },
      fallback: {
        enabled: true,
        provider: 'memory',
        syncOnReconnect: true,
      },
    },
  });

  try {
    // Initialize with cluster configuration
    await postgres.initialize({
      main_cluster: {
        id: 'main',
        schemas: ['public', 'users'],
        primary: {
          host: 'localhost',
          port: 5432,
          database: 'test_db',
          user: 'postgres',
          password: 'password',
        },
      },
    });

    console.log('✅ PgMultiverse with Redis cache initialized');

    // Example query with caching
    const result = await postgres.query(
      'SELECT * FROM users WHERE active = $1 LIMIT 10',
      [true],
      {
        schema: 'users',
        cache: true,
        cacheTtl: 60000, // 1 minute
        cacheKey: 'active_users_list',
      }
    );

    console.log(`📊 Query result: ${result.rowCount} rows`);

    // Cache invalidation example
    await postgres.invalidateCache({
      schema: 'users',
    });

    console.log('🗑️ Cache invalidated for users schema');

    // Get cache metrics
    const metrics = postgres.getMetrics();
    console.log('📈 Cache Metrics:');
    console.log(`  - Hit Rate: ${(metrics.cache?.hitRate || 0) * 100}%`);
    console.log(`  - Items: ${metrics.cache?.itemCount || 0}`);
    console.log(`  - Total Size: ${metrics.cache?.totalSize || 0} bytes`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await postgres.close();
  }
}

async function standaloneRedisExample() {
  console.log('\n🔧 Standalone Redis Cache Example');

  const factory = CacheFactory.getInstance();
  
  const cacheConfig = {
    provider: 'redis' as const,
    redis: {
      host: 'localhost',
      port: 6379,
      keyPrefix: 'test:',
      compression: 'gzip' as const,
    },
    fallback: {
      enabled: true,
      provider: 'memory' as const,
    },
  };

  try {
    const cache = await factory.createProviderWithFallback(cacheConfig);

    // Test cache operations
    await cache.set('user:123', { id: 123, name: 'John Doe', email: 'john@example.com' }, {
      ttl: 60000,
      tags: ['user', 'profile'],
      schema: 'users',
    });

    console.log('✅ Data cached successfully');

    const userData = await cache.get('user:123');
    console.log('📦 Retrieved from cache:', userData);

    // Test invalidation by tags
    const invalidatedCount = await cache.invalidateByTags(['user']);
    console.log(`🗑️ Invalidated ${invalidatedCount} entries by tags`);

    // Test health check
    const isHealthy = await cache.isHealthy();
    console.log(`❤️ Cache health: ${isHealthy ? 'Healthy' : 'Unhealthy'}`);

    await cache.close();

  } catch (error) {
    console.error('❌ Standalone cache error:', error);
  }
}

async function memoryFallbackExample() {
  console.log('\n🧠 Memory Fallback Example');

  const factory = CacheFactory.getInstance();
  
  // Configure with invalid Redis to test fallback
  const cacheConfig = {
    provider: 'redis' as const,
    redis: {
      host: 'invalid-redis-host',
      port: 6379,
      connectTimeout: 1000, // Quick timeout for demo
    },
    fallback: {
      enabled: true,
      provider: 'memory' as const,
    },
  };

  try {
    const cache = await factory.createProviderWithFallback(cacheConfig);
    console.log('✅ Cache initialized (should fallback to memory)');

    await cache.set('test:key', 'test value');
    const value = await cache.get('test:key');
    console.log('📦 Retrieved:', value);

    await cache.close();

  } catch (error) {
    console.error('❌ Fallback example error:', error);
  }
}

// Configuration validation example
function configurationExample() {
  console.log('\n⚙️ Configuration Validation Example');

  const factory = CacheFactory.getInstance();

  // Valid configuration
  const validConfig = {
    provider: 'redis' as const,
    redis: {
      host: 'localhost',
      port: 6379,
    },
  };

  const validation = factory.validateConfig(validConfig);
  console.log('✅ Valid config validation:', validation);

  // Invalid configuration
  const invalidConfig = {
    provider: 'redis' as const,
    redis: {
      host: '', // Invalid host
      port: -1, // Invalid port
    },
  };

  const invalidValidation = factory.validateConfig(invalidConfig);
  console.log('❌ Invalid config validation:', invalidValidation);
}

async function main() {
  console.log('🚀 PG-Multiverse Redis Cache Examples\n');

  try {
    // Run configuration validation first
    configurationExample();

    // Run examples (comment out if Redis is not available)
    // await redisExample();
    // await standaloneRedisExample();
    
    // This example works without Redis
    await memoryFallbackExample();

    console.log('\n✅ All examples completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Example failed:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export {
  redisExample,
  standaloneRedisExample,
  memoryFallbackExample,
  configurationExample,
};