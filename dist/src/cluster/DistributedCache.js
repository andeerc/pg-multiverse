"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DistributedCache = void 0;
const events_1 = require("events");
class DistributedCache extends events_1.EventEmitter {
    constructor(config = {}) {
        super();
        this.cache = new Map();
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
    async initialize() {
        // Start cleanup interval
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000); // Every minute
        console.log('DistributedCache initialized');
    }
    async get(key) {
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
        return entry.value;
    }
    async set(key, value, options = {}) {
        const ttl = options.ttl || this.config.ttl;
        const now = Date.now();
        let processedValue = value;
        let size = this.calculateSize(value);
        // Compress if enabled and above threshold
        if (this.config.enableCompression && size > this.config.compressionThreshold) {
            try {
                processedValue = this.compress(value);
                size = this.calculateSize(processedValue);
            }
            catch (error) {
                this.emit('error', error);
            }
        }
        const entry = {
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
    async invalidateBySchema(schema) {
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
    async invalidateByTags(tags) {
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
    async invalidateByCluster(cluster) {
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
    async invalidateByPattern(pattern) {
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
    getStats() {
        return { ...this.stats };
    }
    async clear() {
        const count = this.cache.size;
        this.cache.clear();
        this.stats.evictions += count;
        this.updateStats();
    }
    async close() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }
        this.cache.clear();
        this.removeAllListeners();
        console.log('DistributedCache closed');
    }
    cleanup() {
        const now = Date.now();
        const expiredKeys = [];
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
    evictLRU() {
        let oldestKey = null;
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
    isExpired(entry) {
        return Date.now() > entry.ttl;
    }
    calculateSize(value) {
        if (typeof value === 'string') {
            return value.length * 2; // Rough estimate for UTF-16
        }
        try {
            return JSON.stringify(value).length * 2;
        }
        catch {
            return 100; // Default estimate
        }
    }
    compress(value) {
        // Simple compression placeholder
        // In production, use libraries like lz4, snappy, etc.
        return value;
    }
    updateStats() {
        this.stats.itemCount = this.cache.size;
        this.stats.totalSize = Array.from(this.cache.values())
            .reduce((sum, entry) => sum + entry.size, 0);
        this.updateHitRate();
    }
    updateHitRate() {
        const total = this.stats.hits + this.stats.misses;
        this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
    }
}
exports.DistributedCache = DistributedCache;
//# sourceMappingURL=DistributedCache.js.map