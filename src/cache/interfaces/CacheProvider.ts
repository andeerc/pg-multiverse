import { EventEmitter } from 'events';
import { CacheStats, CacheEntry } from '../../types';

export interface CacheSetOptions {
  ttl?: number;
  tags?: string[];
  schema?: string;
  cluster?: string;
}

export interface CacheProvider extends EventEmitter {
  /**
   * Initialize the cache provider
   */
  initialize(): Promise<void>;

  /**
   * Get a value from cache
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in cache
   */
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<boolean>;

  /**
   * Check if key exists in cache
   */
  has(key: string): Promise<boolean>;

  /**
   * Delete a key from cache
   */
  delete(key: string): Promise<boolean>;

  /**
   * Invalidate cache entries by schema
   */
  invalidateBySchema(schema: string): Promise<number>;

  /**
   * Invalidate cache entries by tags
   */
  invalidateByTags(tags: string[]): Promise<number>;

  /**
   * Invalidate cache entries by cluster
   */
  invalidateByCluster(cluster: string): Promise<number>;

  /**
   * Invalidate cache entries by pattern
   */
  invalidateByPattern(pattern: RegExp): Promise<number>;

  /**
   * Get cache statistics
   */
  getStats(): CacheStats;

  /**
   * Clear all cache entries
   */
  clear(): Promise<void>;

  /**
   * Close the cache provider and cleanup resources
   */
  close(): Promise<void>;

  /**
   * Check if the cache provider is healthy/connected
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get cache entry metadata without retrieving the value
   */
  getMetadata(key: string): Promise<Omit<CacheEntry, 'value'> | null>;
}

export interface CacheProviderConfig {
  provider: 'memory' | 'redis';
  maxSize?: number;
  ttl?: number;
  enableCompression?: boolean;
  compressionThreshold?: number;
  strategy?: 'lru' | 'lfu' | 'fifo';
  redis?: RedisConfig;
  fallback?: {
    enabled: boolean;
    provider: 'memory';
    syncOnReconnect?: boolean;
  };
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  cluster?: RedisClusterNode[];
  sentinels?: RedisSentinelNode[];
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  retryDelayOnFailover?: number;
  enableReadyCheck?: boolean;
  connectTimeout?: number;
  lazyConnect?: boolean;
  keepAlive?: number;
  compression?: 'none' | 'gzip' | 'lz4';
  serialization?: 'json' | 'msgpack';
  pool?: {
    min?: number;
    max?: number;
  };
}

export interface RedisClusterNode {
  host: string;
  port: number;
}

export interface RedisSentinelNode {
  host: string;
  port: number;
}

export type CacheEventType = 
  | 'hit'
  | 'miss'
  | 'set'
  | 'delete'
  | 'eviction'
  | 'error'
  | 'connected'
  | 'disconnected'
  | 'reconnected';

export interface CacheEvent {
  type: CacheEventType;
  key?: string;
  error?: Error;
  metadata?: Record<string, any>;
  timestamp: Date;
}