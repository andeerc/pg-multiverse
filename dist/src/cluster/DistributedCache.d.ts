/// <reference types="node" />
import { EventEmitter } from 'events';
import { CacheConfig, CacheStats } from '../types';
export declare class DistributedCache extends EventEmitter {
    private config;
    private cache;
    private stats;
    private cleanupInterval?;
    constructor(config?: CacheConfig);
    initialize(): Promise<void>;
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, options?: {
        ttl?: number;
        tags?: string[];
        schema?: string;
        cluster?: string;
    }): Promise<boolean>;
    invalidateBySchema(schema: string): Promise<number>;
    invalidateByTags(tags: string[]): Promise<number>;
    invalidateByCluster(cluster: string): Promise<number>;
    invalidateByPattern(pattern: RegExp): Promise<number>;
    getStats(): CacheStats;
    clear(): Promise<void>;
    close(): Promise<void>;
    private cleanup;
    private evictLRU;
    private isExpired;
    private calculateSize;
    private compress;
    private updateStats;
    private updateHitRate;
}
//# sourceMappingURL=DistributedCache.d.ts.map