// Cache interfaces
export { CacheProvider, CacheSetOptions, CacheProviderConfig, RedisConfig, RedisClusterNode, RedisSentinelNode, CacheEventType, CacheEvent } from './interfaces/CacheProvider';

// Cache providers
export { MemoryCache } from './providers/MemoryCache';
export { RedisCache } from './providers/RedisCache';

// Cache factory
export { CacheFactory } from './factory/CacheFactory';

// Legacy cache (maintained for backwards compatibility)
export { DistributedCache } from '../cluster/DistributedCache';