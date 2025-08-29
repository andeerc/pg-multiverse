import { EventEmitter } from 'events';
import { CacheConfig, CacheEntry, CacheStats, TypedEventEmitter } from '../types';

interface DistributedCacheEvents {
  hit: (key: string) => void;
  miss: (key: string) => void;
  eviction: (data: { key: string; reason: 'ttl' | 'size' | 'manual' }) => void;
  error: (error: Error) => void;
  [key: string]: (...args: any[]) => void;
}

export class DistributedCache extends EventEmitter {
  private config: Required<CacheConfig>;
  private cache: Map<string, CacheEntry> = new Map();
  private stats: CacheStats;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: CacheConfig = {}) {
    super();
    
    this.config = {
      maxSize: 1000,
      ttl: 300000, // 5 minutes
      enableCompression: false,
      compressionThreshold: 1024,
      strategy: 'lru'
    };

    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalSize: 0,
      itemCount: 0,
      evictions: 0,
      compressionRatio: 0
    };

    Object.assign(this.config, config);
  }

  async initialize(): Promise<void> {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute

    console.log('DistributedCache initialized');
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      this.emit('miss', key);
      this.updateHitRate();
      return null;
    }

    // Check TTL
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      this.emit('miss', key);
      this.emit('eviction', { key, reason: 'ttl' });
      this.updateHitRate();
      return null;
    }

    // Update access info
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    this.stats.hits++;
    this.emit('hit', key);
    this.updateHitRate();

    return entry.value as T;
  }

  async set<T>(
    key: string, 
    value: T, 
    options: {
      ttl?: number;
      tags?: string[];
      schema?: string;
      cluster?: string;
    } = {}
  ): Promise<boolean> {
    const ttl = options.ttl || this.config.ttl;
    const now = Date.now();

    let processedValue = value;
    let size = this.calculateSize(value);

    // Compress if enabled and above threshold
    if (this.config.enableCompression && size > this.config.compressionThreshold) {
      try {
        processedValue = this.compress(value);
        size = this.calculateSize(processedValue);
      } catch (error) {
        this.emit('error', error as Error);
      }
    }

    const entry: CacheEntry<T> = {
      value: processedValue,
      ttl: now + ttl,
      createdAt: now,
      accessCount: 0,
      lastAccessed: now,
      size,
      tags: new Set(options.tags || []),
      schema: options.schema,
      cluster: options.cluster
    };

    // Evict if necessary
    if (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, entry);
    this.updateStats();

    return true;
  }

  async invalidateBySchema(schema: string): Promise<number> {
    let count = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.schema === schema) {
        this.cache.delete(key);
        this.emit('eviction', { key, reason: 'manual' });
        count++;
      }
    }

    this.updateStats();
    return count;
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    let count = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      const hasMatchingTag = tags.some(tag => entry.tags.has(tag));
      if (hasMatchingTag) {
        this.cache.delete(key);
        this.emit('eviction', { key, reason: 'manual' });
        count++;
      }
    }

    this.updateStats();
    return count;
  }

  async invalidateByCluster(cluster: string): Promise<number> {
    let count = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.cluster === cluster) {
        this.cache.delete(key);
        this.emit('eviction', { key, reason: 'manual' });
        count++;
      }
    }

    this.updateStats();
    return count;
  }

  async invalidateByPattern(pattern: RegExp): Promise<number> {
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        this.emit('eviction', { key, reason: 'manual' });
        count++;
      }
    }

    this.updateStats();
    return count;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  async clear(): Promise<void> {
    const count = this.cache.size;
    this.cache.clear();
    
    this.stats.evictions += count;
    this.updateStats();
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    this.cache.clear();
    this.removeAllListeners();
    
    console.log('DistributedCache closed');
  }

  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.ttl) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
      this.emit('eviction', { key, reason: 'ttl' });
    }

    if (expiredKeys.length > 0) {
      this.stats.evictions += expiredKeys.length;
      this.updateStats();
    }
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestAccess) {
        oldestAccess = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.emit('eviction', { key: oldestKey, reason: 'size' });
      this.stats.evictions++;
    }
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.ttl;
  }

  private calculateSize(value: any): number {
    if (typeof value === 'string') {
      return value.length * 2; // Rough estimate for UTF-16
    }
    
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 100; // Default estimate
    }
  }

  private compress<T>(value: T): T {
    // Simple compression placeholder
    // In production, use libraries like lz4, snappy, etc.
    return value;
  }

  private updateStats(): void {
    this.stats.itemCount = this.cache.size;
    this.stats.totalSize = Array.from(this.cache.values())
      .reduce((sum, entry) => sum + entry.size, 0);
    
    this.updateHitRate();
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

}