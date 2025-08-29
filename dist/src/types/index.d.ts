/// <reference types="node" />
/// <reference types="node" />
import { PoolClient } from 'pg';
export type QueryParam = string | number | boolean | Date | null | Buffer;
export interface QueryField {
    name: string;
    tableID: number;
    columnID: number;
    dataTypeID: number;
    dataTypeSize: number;
    dataTypeModifier: number;
    format: string;
}
export interface QueryResult<T = any> {
    rows: T[];
    rowCount: number;
    command: string;
    fields: QueryField[];
    oid?: number;
}
export interface DatabaseConnection {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    maxConnections?: number;
    minConnections?: number;
    ssl?: boolean | SSLConfig;
    connectionTimeoutMillis?: number;
    idleTimeoutMillis?: number;
    searchPath?: string[];
}
export interface SSLConfig {
    rejectUnauthorized?: boolean;
    cert?: string;
    key?: string;
    ca?: string;
}
export interface MultiClusterConfig {
    enableCache?: boolean;
    enableMetrics?: boolean;
    enableTransactions?: boolean;
    cluster?: ClusterManagerConfig;
    cache?: CacheConfig;
    configPath?: string;
}
export interface ClusterManagerConfig {
    healthCheckInterval?: number;
    retryAttempts?: number;
    retryDelay?: number;
    maxFailuresBeforeMarkDown?: number;
    recoveryCheckInterval?: number;
}
export interface CacheConfig {
    maxSize?: number;
    ttl?: number;
    enableCompression?: boolean;
    compressionThreshold?: number;
    strategy?: 'lru' | 'lfu' | 'fifo';
}
export type ConsistencyLevel = 'eventual' | 'strong';
export type ReadPreference = 'replica' | 'primary' | 'any';
export type OperationType = 'read' | 'write';
export interface ClusterConfig {
    id: string;
    schemas: string[];
    priority?: number;
    readPreference?: ReadPreference;
    consistencyLevel?: ConsistencyLevel;
    primary: DatabaseConnection;
    replicas?: DatabaseConnection[];
    sharding?: ShardingConfig;
    loadBalancing?: LoadBalancingConfig;
    connectionPool?: ConnectionPoolConfig;
}
export interface ShardingConfig {
    strategy: 'hash' | 'range' | 'directory';
    key: string;
    partitions?: number;
    ranges?: RangePartition[];
    directory?: Record<string, number>;
}
export interface RangePartition {
    min: string | number;
    max: string | number;
}
export type LoadBalancingStrategy = 'round_robin' | 'weighted' | 'least_connections' | 'response_time' | 'health_aware';
export interface LoadBalancingConfig {
    strategy: LoadBalancingStrategy;
    weights?: Record<string, number>;
    healthThreshold?: number;
}
export interface ConnectionPoolConfig {
    min?: number;
    max?: number;
    acquireTimeoutMillis?: number;
    createTimeoutMillis?: number;
    idleTimeoutMillis?: number;
    warmupConnections?: boolean;
}
export interface SchemaMapping {
    clusterId: string;
    shardKey?: string;
    cacheStrategy?: CacheStrategy;
    priority?: number;
    options?: Record<string, any>;
}
export type CacheStrategy = 'aggressive' | 'conservative' | 'none';
export interface QueryOptions {
    schema?: string;
    clusterId?: string;
    cache?: boolean;
    cacheTtl?: number;
    cacheKey?: string;
    operation?: OperationType;
    readPreference?: ReadPreference;
    consistencyLevel?: ConsistencyLevel;
    timeout?: number;
    retryAttempts?: number;
    shardKey?: string | number;
}
export interface PreparedQuery {
    sql: string;
    params: QueryParam[];
    options: QueryOptions;
}
export interface TransactionOptions {
    isolationLevel?: 'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';
    timeout?: number;
    readonly?: boolean;
    deferrable?: boolean;
}
export interface TransactionCallback<T> {
    (transaction: TransactionContext): Promise<T>;
}
export interface TransactionContext {
    query<T = any>(sql: string, params?: QueryParam[], options?: QueryOptions): Promise<QueryResult<T>>;
    transactionId: string;
}
export interface DistributedTransactionState {
    id: string;
    schemas: string[];
    clusters: Set<string>;
    state: 'preparing' | 'prepared' | 'committing' | 'committed' | 'aborting' | 'aborted';
    connections: Map<string, PoolClient>;
    startedAt: Date;
    options: TransactionOptions;
}
export interface CacheEntry<T = any> {
    value: T;
    ttl: number;
    createdAt: number;
    accessCount: number;
    lastAccessed: number;
    size: number;
    tags: Set<string>;
    schema?: string;
    cluster?: string;
}
export interface CacheStats {
    hits: number;
    misses: number;
    hitRate: number;
    totalSize: number;
    itemCount: number;
    evictions: number;
    compressionRatio: number;
}
export interface CacheInvalidationCriteria {
    schema?: string;
    tags?: string[];
    cluster?: string;
    pattern?: RegExp;
}
export interface ClusterHealth {
    clusterId: string;
    healthy: boolean;
    lastCheck: Date;
    responseTime: number;
    failureCount: number;
    uptime: number;
    connections: {
        active: number;
        idle: number;
        total: number;
    };
    queries: {
        total: number;
        successful: number;
        failed: number;
        avgResponseTime: number;
    };
    error?: string;
}
export interface ClusterMetrics {
    clusterId: string;
    queries: {
        total: number;
        reads: number;
        writes: number;
        cached: number;
        avgResponseTime: number;
        errors: number;
    };
    connections: {
        active: number;
        idle: number;
        max: number;
        created: number;
        destroyed: number;
    };
    cache: {
        hits: number;
        misses: number;
        hitRate: number;
    };
    uptime: number;
    lastUpdated: Date;
}
export interface SystemMetrics {
    clusters: Record<string, ClusterMetrics>;
    cache?: CacheStats;
    transactions?: TransactionMetrics;
    uptime: number;
    totalQueries: number;
    avgResponseTime: number;
    errorRate: number;
}
export interface TransactionMetrics {
    total: number;
    active: number;
    committed: number;
    aborted: number;
    avgDuration: number;
    distributed: number;
}
export interface MultiClusterEvents {
    initialized: (data: {
        clusters: string[];
        schemas: string[];
    }) => void;
    error: (error: Error) => void;
    clusterDown: (data: {
        clusterId: string;
        reason: string;
        health: ClusterHealth;
    }) => void;
    clusterUp: (data: {
        clusterId: string;
        health: ClusterHealth;
    }) => void;
    clusterRecovered: (data: {
        clusterId: string;
        downtime: number;
    }) => void;
    queryExecuted: (data: {
        sql: string;
        params: QueryParam[];
        duration: number;
        clusterId: string;
    }) => void;
    queryError: (data: {
        sql: string;
        params: QueryParam[];
        error: Error;
        clusterId: string;
    }) => void;
    cacheHit: (data: {
        key: string;
        schema?: string;
        clusterId?: string;
    }) => void;
    cacheMiss: (data: {
        key: string;
        schema?: string;
        clusterId?: string;
    }) => void;
    cacheEviction: (data: {
        key: string;
        reason: 'ttl' | 'size' | 'manual';
    }) => void;
    transactionStarted: (data: {
        transactionId: string;
        schemas: string[];
        clusters: string[];
    }) => void;
    transactionCommitted: (data: {
        transactionId: string;
        duration: number;
    }) => void;
    transactionAborted: (data: {
        transactionId: string;
        reason: string;
        duration: number;
    }) => void;
    schemaRegistered: (data: {
        schema: string;
        clusterId: string;
        options: SchemaMapping;
    }) => void;
    configReloaded: (data: {
        clusters: number;
        schemas: number;
    }) => void;
    closed: () => void;
    [key: string]: (...args: any[]) => void;
}
export interface LoadBalancerNode {
    id: string;
    connection: DatabaseConnection;
    weight: number;
    currentConnections: number;
    responseTime: number;
    healthy: boolean;
    lastHealthCheck: Date;
    totalRequests: number;
    errorCount: number;
}
export interface LoadBalancerStats {
    strategy: LoadBalancingStrategy;
    nodes: LoadBalancerNode[];
    totalRequests: number;
    totalErrors: number;
    avgResponseTime: number;
    distribution: Record<string, number>;
}
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
export interface ConnectionTestResult {
    success: boolean;
    responseTime: number;
    error?: string;
    timestamp: Date;
}
export declare function isQueryResult<T>(obj: any): obj is QueryResult<T>;
export declare function isDatabaseConnection(obj: any): obj is DatabaseConnection;
export declare function isClusterConfig(obj: any): obj is ClusterConfig;
export interface TypedEventEmitter<T extends Record<string, (...args: any[]) => void> & {
    [K: string]: (...args: any[]) => void;
}> {
    on<K extends keyof T>(event: K, listener: T[K]): this;
    once<K extends keyof T>(event: K, listener: T[K]): this;
    emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): boolean;
    off<K extends keyof T>(event: K, listener: T[K]): this;
    removeAllListeners<K extends keyof T>(event?: K): this;
    listeners<K extends keyof T>(event: K): T[K][];
    listenerCount<K extends keyof T>(event: K): number;
}
//# sourceMappingURL=index.d.ts.map