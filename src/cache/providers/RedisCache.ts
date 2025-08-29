import { EventEmitter } from 'events';
import { CacheProvider, CacheSetOptions, RedisConfig } from '../interfaces/CacheProvider';
import { CacheStats, CacheEntry } from '../../types';
import * as zlib from 'zlib';
import { promisify } from 'util';

// Dynamically import Redis to avoid TypeScript issues
let Redis: any;
let RedisCluster: any;

async function loadRedis() {
  if (!Redis) {
    try {
      const ioredis = await import('ioredis');
      Redis = ioredis.default || ioredis;
      RedisCluster = Redis.Cluster;
    } catch (error) {
      throw new Error('ioredis package is required for Redis cache provider');
    }
  }
}

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

interface RedisStats {
  connections: number;
  memory: number;
  operations: number;
  latency: number;
}

export class RedisCache extends EventEmitter implements CacheProvider {
  private redis: any = null;
  private config: RedisConfig;
  private stats: CacheStats;
  private isConnected = false;
  private connectionAttempts = 0;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(config: RedisConfig) {
    super();
    this.config = {
      keyPrefix: 'pg-multiverse:',
      compression: 'gzip',
      serialization: 'json',
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      connectTimeout: 10000,
      lazyConnect: true,
      keepAlive: 30000,
      ...config,
    };

    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalSize: 0,
      itemCount: 0,
      evictions: 0,
      compressionRatio: 0,
    };
  }

  async initialize(): Promise<void> {
    try {
      await loadRedis();
      await this.connect();
      this.setupEventHandlers();
      this.emit('connected');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  private async connect(): Promise<void> {
    const redisOptions: any = {
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db || 0,
      keyPrefix: this.config.keyPrefix,
      maxRetriesPerRequest: this.config.maxRetriesPerRequest,
      retryDelayOnFailover: this.config.retryDelayOnFailover,
      enableReadyCheck: this.config.enableReadyCheck,
      connectTimeout: this.config.connectTimeout,
      lazyConnect: this.config.lazyConnect,
      keepAlive: this.config.keepAlive,
    };

    if (this.config.cluster && this.config.cluster.length > 0) {
      // Redis Cluster mode
      this.redis = new RedisCluster(this.config.cluster, {
        redisOptions,
        enableOfflineQueue: false,
        maxRedirections: 3,
      });
    } else if (this.config.sentinels && this.config.sentinels.length > 0) {
      // Redis Sentinel mode
      this.redis = new Redis({
        ...redisOptions,
        sentinels: this.config.sentinels,
        name: 'mymaster', // Default sentinel name
      });
    } else {
      // Single Redis instance
      this.redis = new Redis(redisOptions);
    }

    await this.redis.ping();
    this.isConnected = true;
    this.connectionAttempts = 0;
  }

  private setupEventHandlers(): void {
    if (!this.redis) return;

    this.redis.on('connect', () => {
      this.isConnected = true;
      this.emit('connected');
    });

    this.redis.on('error', (error: any) => {
      this.isConnected = false;
      this.emit('error', error);
      this.handleReconnection();
    });

    this.redis.on('close', () => {
      this.isConnected = false;
      this.emit('disconnected');
    });

    this.redis.on('reconnecting', () => {
      this.emit('reconnected');
    });
  }

  private async handleReconnection(): Promise<void> {
    if (this.connectionAttempts >= this.maxRetries) {
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.connectionAttempts++;
    await new Promise(resolve => setTimeout(resolve, this.retryDelay * this.connectionAttempts));

    try {
      await this.connect();
      this.emit('reconnected');
    } catch (error) {
      this.emit('error', error);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.redis || !this.isConnected) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    try {
      const data = await this.redis.get(key);

      if (!data) {
        this.stats.misses++;
        this.emit('miss', key);
        this.updateHitRate();
        return null;
      }

      const entry = await this.deserialize<CacheEntry<T>>(data);

      // Check TTL (additional safety check)
      if (this.isExpired(entry)) {
        await this.redis.del(key);
        this.stats.misses++;
        this.emit('miss', key);
        this.emit('eviction', { key, reason: 'ttl' });
        this.updateHitRate();
        return null;
      }

      // Update access count using Redis HINCRBY
      await this.redis.hincrby(`${key}:meta`, 'accessCount', 1);
      await this.redis.hset(`${key}:meta`, 'lastAccessed', Date.now());

      this.stats.hits++;
      this.emit('hit', key);
      this.updateHitRate();

      return entry.value;
    } catch (error) {
      this.emit('error', error);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }
  }

  async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<boolean> {
    if (!this.redis || !this.isConnected) {
      return false;
    }

    try {
      const now = Date.now();
      const ttl = options.ttl || 300000; // 5 minutes default

      const entry: CacheEntry<T> = {
        value,
        ttl: now + ttl,
        createdAt: now,
        accessCount: 0,
        lastAccessed: now,
        size: this.calculateSize(value),
        tags: new Set(options.tags || []),
        schema: options.schema,
        cluster: options.cluster,
      };

      const serializedEntry = await this.serialize(entry);
      const pipeline = this.redis.pipeline();

      // Set the main entry with TTL
      pipeline.setex(key, Math.ceil(ttl / 1000), serializedEntry);

      // Store metadata for querying
      if (options.schema) {
        pipeline.sadd(`schema:${options.schema}`, key);
        pipeline.expire(`schema:${options.schema}`, Math.ceil(ttl / 1000));
      }

      if (options.cluster) {
        pipeline.sadd(`cluster:${options.cluster}`, key);
        pipeline.expire(`cluster:${options.cluster}`, Math.ceil(ttl / 1000));
      }

      if (options.tags && options.tags.length > 0) {
        for (const tag of options.tags) {
          pipeline.sadd(`tag:${tag}`, key);
          pipeline.expire(`tag:${tag}`, Math.ceil(ttl / 1000));
        }
      }

      await pipeline.exec();

      this.emit('set', key);
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  async has(key: string): Promise<boolean> {
    if (!this.redis || !this.isConnected) {
      return false;
    }

    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.redis || !this.isConnected) {
      return false;
    }

    try {
      const result = await this.redis.del(key);
      this.emit('delete', key);
      return result === 1;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  async invalidateBySchema(schema: string): Promise<number> {
    if (!this.redis || !this.isConnected) {
      return 0;
    }

    try {
      const keys = await this.redis.smembers(`schema:${schema}`);
      if (keys.length === 0) return 0;

      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        pipeline.del(key);
      }
      pipeline.del(`schema:${schema}`);

      const results = await pipeline.exec();
      const deletedCount =
        results?.filter(([err, result]: any) => !err && result === 1).length || 0;

      for (const key of keys) {
        this.emit('eviction', { key, reason: 'manual' });
      }

      return deletedCount;
    } catch (error) {
      this.emit('error', error);
      return 0;
    }
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    if (!this.redis || !this.isConnected || tags.length === 0) {
      return 0;
    }

    try {
      const allKeys = new Set<string>();

      for (const tag of tags) {
        const keys = await this.redis.smembers(`tag:${tag}`);
        keys.forEach((key: string) => allKeys.add(key));
      }

      if (allKeys.size === 0) return 0;

      const pipeline = this.redis.pipeline();
      for (const key of allKeys) {
        pipeline.del(key);
      }

      for (const tag of tags) {
        pipeline.del(`tag:${tag}`);
      }

      const results = await pipeline.exec();
      const deletedCount =
        results?.filter(([err, result]: any) => !err && result === 1).length || 0;

      for (const key of allKeys) {
        this.emit('eviction', { key, reason: 'manual' });
      }

      return deletedCount;
    } catch (error) {
      this.emit('error', error);
      return 0;
    }
  }

  async invalidateByCluster(cluster: string): Promise<number> {
    if (!this.redis || !this.isConnected) {
      return 0;
    }

    try {
      const keys = await this.redis.smembers(`cluster:${cluster}`);
      if (keys.length === 0) return 0;

      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        pipeline.del(key);
      }
      pipeline.del(`cluster:${cluster}`);

      const results = await pipeline.exec();
      const deletedCount =
        results?.filter(([err, result]: any) => !err && result === 1).length || 0;

      for (const key of keys) {
        this.emit('eviction', { key, reason: 'manual' });
      }

      return deletedCount;
    } catch (error) {
      this.emit('error', error);
      return 0;
    }
  }

  async invalidateByPattern(pattern: RegExp): Promise<number> {
    if (!this.redis || !this.isConnected) {
      return 0;
    }

    try {
      // Convert RegExp to Redis pattern (limited support)
      const redisPattern = this.regexToRedisPattern(pattern);
      const keys = await this.redis.keys(redisPattern);

      if (keys.length === 0) return 0;

      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        pipeline.del(key);
      }

      const results = await pipeline.exec();
      const deletedCount =
        results?.filter(([err, result]: any) => !err && result === 1).length || 0;

      for (const key of keys) {
        this.emit('eviction', { key, reason: 'manual' });
      }

      return deletedCount;
    } catch (error) {
      this.emit('error', error);
      return 0;
    }
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  async clear(): Promise<void> {
    if (!this.redis || !this.isConnected) {
      return;
    }

    try {
      await this.redis.flushdb();
      this.stats.evictions = 0; // Reset since we cleared everything
      this.stats.itemCount = 0;
      this.stats.totalSize = 0;
    } catch (error) {
      this.emit('error', error);
    }
  }

  async close(): Promise<void> {
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }

    this.isConnected = false;
    this.removeAllListeners();
  }

  async isHealthy(): Promise<boolean> {
    if (!this.redis || !this.isConnected) {
      return false;
    }

    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<Omit<CacheEntry, 'value'> | null> {
    if (!this.redis || !this.isConnected) {
      return null;
    }

    try {
      const data = await this.redis.get(key);
      if (!data) return null;

      const entry = await this.deserialize<CacheEntry>(data);
      const { value, ...metadata } = entry;
      return metadata;
    } catch (error) {
      this.emit('error', error);
      return null;
    }
  }

  private async serialize<T>(data: T): Promise<string> {
    try {
      let serialized = JSON.stringify(data);

      if (this.config.compression === 'gzip' && serialized.length > 1024) {
        const compressed = await gzip(Buffer.from(serialized));
        serialized = `gzip:${compressed.toString('base64')}`;
      }

      return serialized;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  private async deserialize<T>(data: string): Promise<T> {
    try {
      if (data.startsWith('gzip:')) {
        const compressed = Buffer.from(data.substring(5), 'base64');
        const decompressed = await gunzip(compressed);
        return JSON.parse(decompressed.toString());
      }

      return JSON.parse(data);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  private calculateSize(value: any): number {
    if (typeof value === 'string') {
      return value.length * 2;
    }

    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 100;
    }
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.ttl;
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  private regexToRedisPattern(regex: RegExp): string {
    // Convert basic regex patterns to Redis patterns
    // This is a simplified conversion - Redis patterns are limited
    let pattern = regex.source;

    // Replace common regex patterns with Redis equivalents
    pattern = pattern.replace(/\.\*/g, '*');
    pattern = pattern.replace(/\./g, '?');
    pattern = pattern.replace(/\[.*?\]/g, '*');

    return `${this.config.keyPrefix || ''}${pattern}`;
  }
}
