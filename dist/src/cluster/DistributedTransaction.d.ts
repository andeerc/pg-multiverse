/// <reference types="node" />
import { EventEmitter } from 'events';
import { TransactionOptions, TransactionMetrics, QueryParam, QueryResult } from '../types';
import { ClusterManager } from './ClusterManager';
export declare class DistributedTransaction extends EventEmitter {
    private clusterManager;
    private activeTransactions;
    private metrics;
    constructor(clusterManager: ClusterManager);
    initialize(): Promise<void>;
    begin(schemas: string[], options?: TransactionOptions): Promise<string>;
    execute<T = any>(transactionId: string, operation: {
        sql: string;
        params?: QueryParam[];
        schema?: string;
        clusterId?: string;
    }): Promise<QueryResult<T>>;
    commit(transactionId: string): Promise<void>;
    rollback(transactionId: string): Promise<void>;
    getMetrics(): TransactionMetrics;
    close(): Promise<void>;
    private twoPhaseCommit;
    private singleClusterCommit;
    private abortPreparedTransactions;
    private rollbackConnections;
    private releaseConnections;
    private getClusterForSchema;
    private updateAvgDuration;
}
//# sourceMappingURL=DistributedTransaction.d.ts.map