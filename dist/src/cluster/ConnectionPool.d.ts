/// <reference types="node" />
import { EventEmitter } from 'events';
import { PoolClient } from 'pg';
import { DatabaseConnection, ConnectionPoolConfig } from '../types';
interface PoolMetrics {
    created: number;
    destroyed: number;
    acquired: number;
    released: number;
    active: number;
    idle: number;
    waiting: number;
    total: number;
}
export declare class ConnectionPool extends EventEmitter {
    private pool;
    private config;
    private poolId;
    private clusterId;
    private role;
    private replicaIndex?;
    private isReady;
    private isClosed;
    private metrics;
    constructor(config: DatabaseConnection & ConnectionPoolConfig & {
        clusterId: string;
        role: 'primary' | 'replica';
        replicaIndex?: number;
    });
    getConnection(): Promise<PoolClient>;
    query<T = any>(sql: string, params?: any[]): Promise<T>;
    testConnection(): Promise<boolean>;
    getMetrics(): PoolMetrics & {
        poolId: string;
        clusterId: string;
        role: string;
        config: {
            min: number;
            max: number;
            idle: number;
            waiting: number;
        };
    };
    getId(): string;
    getInfo(): {
        poolId: string;
        clusterId: string;
        role: string;
        replicaIndex?: number;
        isReady: boolean;
        isClosed: boolean;
    };
    warmup(): Promise<void>;
    close(): Promise<void>;
    private _createPool;
    private _setupPoolEvents;
    private _initialize;
    private _waitForReady;
    private _wrapClient;
    private _generatePoolId;
}
export {};
//# sourceMappingURL=ConnectionPool.d.ts.map