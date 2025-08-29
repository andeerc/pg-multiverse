import { EventEmitter } from 'events';
import { CacheProvider, CacheSetOptions } from '../interfaces/CacheProvider';
import { CacheEntry, CacheStats } from '../../types';

export class MemoryCache extends EventEmitter implements CacheProvider {
  private cache: Map<string, CacheEntry> = new Map();
  private stats: CacheStats;
  private cleanupInterval?: NodeJS.Timeout;
  private maxSize: number;
  private defaultTtl: number;
  private enableCompression: boolean;
  private compressionThreshold: number;
  private strategy: 'lru' | 'lfu' | 'fifo';

  constructor(
    config: {
      maxSize?: number;
      ttl?: number;
      enableCompression?: boolean;
      compressionThreshold?: number;
      strategy?: 'lru' | 'lfu' | 'fifo';
    } = {}
  ) {
    super();

    this.maxSize = config.maxSize || 1000;
    this.defaultTtl = config.ttl || 300000; // 5 minutes
    this.enableCompression = config.enableCompression || false;
    this.compressionThreshold = config.compressionThreshold || 1024;
    this.strategy = config.strategy || 'lru';

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
    // Start cleanup interval for expired entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute

    this.emit('connected');
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
      this.updateStats();
      this.updateHitRate();
      return null;
    }

    // Update access info for LRU/LFU strategies
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    this.stats.hits++;
    this.emit('hit', key);
    this.updateHitRate();

    return entry.value as T;
  }

  async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<boolean> {
    try {
      const ttl = options.ttl || this.defaultTtl;
      const now = Date.now();

      let processedValue = value;
      let size = this.calculateSize(value);

      // Simple compression simulation (in production use real compression libraries)
      if (this.enableCompression && size > this.compressionThreshold) {
        try {
          // Simulate compression by just marking it as compressed
          processedValue = {
            __compressed: true,
            data: JSON.stringify(value),
          } as any;
          size = this.calculateSize(processedValue);
        } catch (error) {
          this.emit('error', error);
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
        cluster: options.cluster,
      };

      // Evict if necessary
      if (this.cache.size >= this.maxSize) {
        this.evictByStrategy();
      }

      this.cache.set(key, entry);
      this.updateStats();
      this.emit('set', key);

      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.emit('eviction', { key, reason: 'ttl' });
      this.updateStats();
      return false;
    }

    return true;
  }

  async delete(key: string): Promise<boolean> {
    const deleted = this.cache.delete(key);

    if (deleted) {
      this.emit('delete', key);
      this.updateStats();
    }

    return deleted;
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
    this.emit('disconnected');
  }

  async isHealthy(): Promise<boolean> {
    // Memory cache is always "healthy" if it exists
    return true;
  }

  async getMetadata(key: string): Promise<Omit<CacheEntry, 'value'> | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.emit('eviction', { key, reason: 'ttl' });
      this.updateStats();
      return null;
    }

    const { value, ...metadata } = entry;
    return metadata;
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

  private evictByStrategy(): void {
    let keyToEvict: string | null = null;

    switch (this.strategy) {
      case 'lru':
        keyToEvict = this.getLRUKey();
        break;
      case 'lfu':
        keyToEvict = this.getLFUKey();
        break;
      case 'fifo':
        keyToEvict = this.getFIFOKey();
        break;
    }

    if (keyToEvict) {
      this.cache.delete(keyToEvict);
      this.emit('eviction', { key: keyToEvict, reason: 'size' });
      this.stats.evictions++;
    }
  }

  private getLRUKey(): string | null {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestAccess) {
        oldestAccess = entry.lastAccessed;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  private getLFUKey(): string | null {
    let leastUsedKey: string | null = null;
    let leastAccessCount = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessCount < leastAccessCount) {
        leastAccessCount = entry.accessCount;
        leastUsedKey = key;
      }
    }

    return leastUsedKey;
  }

  private getFIFOKey(): string | null {
    let oldestKey: string | null = null;
    let oldestCreated = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestCreated) {
        oldestCreated = entry.createdAt;
        oldestKey = key;
      }
    }

    return oldestKey;
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

  private updateStats(): void {
    this.stats.itemCount = this.cache.size;
    this.stats.totalSize = Array.from(this.cache.values()).reduce(
      (sum, entry) => sum + entry.size,
      0
    );

    this.updateHitRate();
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
}
