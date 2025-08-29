import { EventEmitter } from 'events';
import { CacheProvider, CacheProviderConfig } from '../interfaces/CacheProvider';
import { MemoryCache } from '../providers/MemoryCache';
import { RedisCache } from '../providers/RedisCache';

export class CacheFactory {
  private static instance: CacheFactory;

  public static getInstance(): CacheFactory {
    if (!CacheFactory.instance) {
      CacheFactory.instance = new CacheFactory();
    }
    return CacheFactory.instance;
  }

  /**
   * Create a cache provider instance based on configuration
   */
  public async createProvider(config: CacheProviderConfig): Promise<CacheProvider> {
    const provider = config.provider || 'memory';

    switch (provider) {
      case 'redis':
        if (!config.redis) {
          throw new Error('Redis configuration is required when provider is "redis"');
        }
        return await this.createRedisProvider(config);

      case 'memory':
        return this.createMemoryProvider(config);

      default:
        throw new Error(`Unsupported cache provider: ${provider}`);
    }
  }

  /**
   * Create a cache provider with fallback support
   */
  public async createProviderWithFallback(config: CacheProviderConfig): Promise<CacheProvider> {
    try {
      const primaryProvider = await this.createProvider(config);
      await primaryProvider.initialize();

      // If fallback is enabled, wrap the primary provider
      if (config.fallback?.enabled && config.provider !== 'memory') {
        return this.createFallbackProvider(primaryProvider, config);
      }

      return primaryProvider;
    } catch (error) {
      // If primary provider fails and fallback is enabled, use fallback
      if (config.fallback?.enabled) {
        console.warn(
          `Primary cache provider failed, falling back to ${config.fallback.provider}:`,
          error
        );
        const fallbackConfig: CacheProviderConfig = {
          ...config,
          provider: config.fallback.provider,
        };
        const fallbackProvider = await this.createProvider(fallbackConfig);
        await fallbackProvider.initialize();
        return fallbackProvider;
      }

      throw error;
    }
  }

  /**
   * Validate cache configuration
   */
  public validateConfig(config: CacheProviderConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate provider
    if (!['memory', 'redis'].includes(config.provider)) {
      errors.push(`Invalid cache provider: ${config.provider}. Must be "memory" or "redis"`);
    }

    // Validate Redis config
    if (config.provider === 'redis') {
      if (!config.redis) {
        errors.push('Redis configuration is required when provider is "redis"');
      } else {
        const redisErrors = this.validateRedisConfig(config.redis);
        errors.push(...redisErrors);
      }
    }

    // Validate fallback config
    if (config.fallback?.enabled) {
      if (!config.fallback.provider) {
        errors.push('Fallback provider is required when fallback is enabled');
      } else if (config.fallback.provider === config.provider) {
        errors.push('Fallback provider must be different from primary provider');
      }
    }

    // Validate numeric values
    if (config.maxSize !== undefined && config.maxSize <= 0) {
      errors.push('maxSize must be a positive number');
    }

    if (config.ttl !== undefined && config.ttl <= 0) {
      errors.push('ttl must be a positive number');
    }

    if (config.compressionThreshold !== undefined && config.compressionThreshold <= 0) {
      errors.push('compressionThreshold must be a positive number');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private async createRedisProvider(config: CacheProviderConfig): Promise<CacheProvider> {
    if (!config.redis) {
      throw new Error('Redis configuration is required');
    }

    const redisProvider = new RedisCache(config.redis);
    await redisProvider.initialize();
    return redisProvider;
  }

  private createMemoryProvider(config: CacheProviderConfig): CacheProvider {
    const memoryProvider = new MemoryCache({
      maxSize: config.maxSize,
      ttl: config.ttl,
      enableCompression: config.enableCompression,
      compressionThreshold: config.compressionThreshold,
      strategy: config.strategy,
    });

    // Initialize asynchronously but return immediately for compatibility
    setTimeout(async () => {
      await memoryProvider.initialize();
    }, 0);

    return memoryProvider;
  }

  private createFallbackProvider(
    primaryProvider: CacheProvider,
    config: CacheProviderConfig
  ): CacheProvider {
    return new FallbackCacheProvider(primaryProvider, config);
  }

  private validateRedisConfig(redis: any): string[] {
    const errors: string[] = [];

    if (!redis.host || typeof redis.host !== 'string') {
      errors.push('Redis host is required and must be a string');
    }

    if (!redis.port || typeof redis.port !== 'number') {
      errors.push('Redis port is required and must be a number');
    }

    if (redis.port <= 0 || redis.port > 65535) {
      errors.push('Redis port must be between 1 and 65535');
    }

    if (redis.db !== undefined && (typeof redis.db !== 'number' || redis.db < 0)) {
      errors.push('Redis db must be a non-negative number');
    }

    if (
      redis.connectTimeout !== undefined &&
      (typeof redis.connectTimeout !== 'number' || redis.connectTimeout <= 0)
    ) {
      errors.push('connectTimeout must be a positive number');
    }

    if (redis.compression && !['none', 'gzip', 'lz4'].includes(redis.compression)) {
      errors.push('compression must be one of: none, gzip, lz4');
    }

    if (redis.serialization && !['json', 'msgpack'].includes(redis.serialization)) {
      errors.push('serialization must be one of: json, msgpack');
    }

    return errors;
  }
}

/**
 * Fallback cache provider that wraps a primary provider with a fallback
 */
class FallbackCacheProvider extends EventEmitter implements CacheProvider {
  private fallbackProvider?: CacheProvider;
  private syncTimeout?: NodeJS.Timeout;

  constructor(
    private primaryProvider: CacheProvider,
    private config: CacheProviderConfig
  ) {
    super();
    this.setupEventForwarding();
  }

  async initialize(): Promise<void> {
    try {
      await this.primaryProvider.initialize();
    } catch (error) {
      // If primary fails, initialize fallback
      await this.initializeFallback();
      throw error;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (await this.primaryProvider.isHealthy()) {
        return await this.primaryProvider.get<T>(key);
      }
    } catch (error) {
      this.emit('error', error);
    }

    // Fallback to secondary provider
    if (this.fallbackProvider) {
      return await this.fallbackProvider.get<T>(key);
    }

    return null;
  }

  async set<T>(key: string, value: T, options?: any): Promise<boolean> {
    let primarySuccess = false;

    try {
      if (await this.primaryProvider.isHealthy()) {
        primarySuccess = await this.primaryProvider.set(key, value, options);
      }
    } catch (error) {
      this.emit('error', error);
    }

    // Always try to set in fallback if available
    if (this.fallbackProvider) {
      try {
        await this.fallbackProvider.set(key, value, options);
      } catch (error) {
        this.emit('error', error);
      }
    }

    return primarySuccess;
  }

  async has(key: string): Promise<boolean> {
    try {
      if (await this.primaryProvider.isHealthy()) {
        return await this.primaryProvider.has(key);
      }
    } catch (error) {
      this.emit('error', error);
    }

    if (this.fallbackProvider) {
      return await this.fallbackProvider.has(key);
    }

    return false;
  }

  async delete(key: string): Promise<boolean> {
    const promises: Promise<boolean>[] = [];

    try {
      if (await this.primaryProvider.isHealthy()) {
        promises.push(this.primaryProvider.delete(key));
      }
    } catch (error) {
      this.emit('error', error);
    }

    if (this.fallbackProvider) {
      promises.push(this.fallbackProvider.delete(key));
    }

    const results = await Promise.allSettled(promises);
    return results.some(result => result.status === 'fulfilled' && result.value === true);
  }

  async invalidateBySchema(schema: string): Promise<number> {
    return this.invalidateFromBoth(provider => provider.invalidateBySchema(schema));
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    return this.invalidateFromBoth(provider => provider.invalidateByTags(tags));
  }

  async invalidateByCluster(cluster: string): Promise<number> {
    return this.invalidateFromBoth(provider => provider.invalidateByCluster(cluster));
  }

  async invalidateByPattern(pattern: RegExp): Promise<number> {
    return this.invalidateFromBoth(provider => provider.invalidateByPattern(pattern));
  }

  getStats() {
    // Combine stats from both providers
    const primaryStats = this.primaryProvider.getStats();
    const fallbackStats = this.fallbackProvider?.getStats();

    if (!fallbackStats) {
      return primaryStats;
    }

    return {
      hits: primaryStats.hits + fallbackStats.hits,
      misses: primaryStats.misses + fallbackStats.misses,
      hitRate:
        (primaryStats.hits + fallbackStats.hits) /
        (primaryStats.hits + primaryStats.misses + fallbackStats.hits + fallbackStats.misses),
      totalSize: primaryStats.totalSize + fallbackStats.totalSize,
      itemCount: primaryStats.itemCount + fallbackStats.itemCount,
      evictions: primaryStats.evictions + fallbackStats.evictions,
      compressionRatio: (primaryStats.compressionRatio + fallbackStats.compressionRatio) / 2,
    };
  }

  async clear(): Promise<void> {
    const promises: Promise<void>[] = [this.primaryProvider.clear()];

    if (this.fallbackProvider) {
      promises.push(this.fallbackProvider.clear());
    }

    await Promise.allSettled(promises);
  }

  async close(): Promise<void> {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }

    const promises: Promise<void>[] = [this.primaryProvider.close()];

    if (this.fallbackProvider) {
      promises.push(this.fallbackProvider.close());
    }

    await Promise.allSettled(promises);
    this.removeAllListeners();
  }

  async isHealthy(): Promise<boolean> {
    try {
      return await this.primaryProvider.isHealthy();
    } catch {
      return this.fallbackProvider ? await this.fallbackProvider.isHealthy() : false;
    }
  }

  async getMetadata(key: string) {
    try {
      if (await this.primaryProvider.isHealthy()) {
        return await this.primaryProvider.getMetadata(key);
      }
    } catch (error) {
      this.emit('error', error);
    }

    if (this.fallbackProvider) {
      return await this.fallbackProvider.getMetadata(key);
    }

    return null;
  }

  private async initializeFallback(): Promise<void> {
    if (!this.config.fallback?.enabled) return;

    const fallbackConfig: CacheProviderConfig = {
      ...this.config,
      provider: this.config.fallback.provider,
    };

    const factory = CacheFactory.getInstance();
    this.fallbackProvider = await factory.createProvider(fallbackConfig);
    await this.fallbackProvider.initialize();
  }

  private setupEventForwarding(): void {
    this.primaryProvider.on('error', error => this.emit('error', error));
    this.primaryProvider.on('connected', () => this.emit('connected'));
    this.primaryProvider.on('disconnected', () => {
      this.emit('disconnected');
      this.handlePrimaryDisconnection();
    });
    this.primaryProvider.on('reconnected', () => {
      this.emit('reconnected');
      this.handlePrimaryReconnection();
    });
  }

  private async handlePrimaryDisconnection(): Promise<void> {
    if (!this.fallbackProvider) {
      await this.initializeFallback();
    }
  }

  private handlePrimaryReconnection(): void {
    if (this.config.fallback?.syncOnReconnect && this.fallbackProvider) {
      // Schedule sync from fallback to primary
      this.syncTimeout = setTimeout(() => {
        this.syncFallbackToPrimary();
      }, 1000);
    }
  }

  private async syncFallbackToPrimary(): Promise<void> {
    // This would require implementing a way to iterate over all keys in fallback
    // For now, we just emit an event to notify about reconnection
    this.emit('sync', { from: 'fallback', to: 'primary' });
  }

  private async invalidateFromBoth(
    invalidateFn: (provider: CacheProvider) => Promise<number>
  ): Promise<number> {
    const promises: Promise<number>[] = [];

    try {
      if (await this.primaryProvider.isHealthy()) {
        promises.push(invalidateFn(this.primaryProvider));
      }
    } catch (error) {
      this.emit('error', error);
    }

    if (this.fallbackProvider) {
      promises.push(invalidateFn(this.fallbackProvider));
    }

    const results = await Promise.allSettled(promises);
    return results.reduce((total, result) => {
      return total + (result.status === 'fulfilled' ? result.value : 0);
    }, 0);
  }
}
