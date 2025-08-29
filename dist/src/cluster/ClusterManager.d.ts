/// <reference types="node" />
import { EventEmitter } from 'events';
import { PoolClient } from 'pg';
import { ClusterConfig, ClusterManagerConfig, QueryOptions, QueryParam, QueryResult, ClusterHealth, ClusterMetrics, TransactionOptions } from '../types';
import { ConnectionPool } from './ConnectionPool';
interface ClusterInfo {
    id: string;
    primary: any | null;
    replicas: any[];
    pools: {
        primary: ConnectionPool | null;
        replicas: ConnectionPool[];
    };
    status: 'initializing' | 'active' | 'down' | 'maintenance';
    config: ClusterConfig;
}
export interface WrappedConnection extends PoolClient {
    _clusterMetadata: {
        clusterId: string;
        schema?: string;
        pool: string;
    };
}
/**
 * Gerencia múltiplos clusters PostgreSQL com read/write splitting,
 * load balancing, failover automático e health checking
 */
export declare class ClusterManager extends EventEmitter {
    private config;
    private clusters;
    private schemaClusterMap;
    private connectionPools;
    private healthChecker;
    private loadBalancer;
    private isInitialized;
    private stats;
    constructor(config?: ClusterManagerConfig);
    /**
     * Inicializa o cluster manager com configuração de clusters
     */
    initialize(clusterConfigs: Record<string, any>): Promise<void>;
    /**
     * Atualiza configuração dinamicamente
     */
    updateConfig(clusterConfigs: Record<string, any>): Promise<void>;
    /**
     * Obtém connection pool adequado para operação
     */
    getConnection(options?: QueryOptions): Promise<WrappedConnection>;
    /**
     * Executa query com roteamento inteligente
     */
    executeQuery<T = any>(sql: string, params?: QueryParam[], options?: QueryOptions): Promise<QueryResult<T> & {
        clusterId: string;
    }>;
    /**
     * Executa transação distribuída se necessário
     */
    transaction<T>(callback: (connection: PoolClient) => Promise<T>, options?: TransactionOptions & {
        schemas?: string[];
    }): Promise<T | T[]>;
    /**
     * Obtém clusters registrados
     */
    getClusters(): Map<string, ClusterInfo>;
    /**
     * Obtém métricas dos clusters
     */
    getMetrics(): Record<string, ClusterMetrics>;
    /**
     * Obtém estatísticas gerais
     */
    getStats(): {
        clusters: {
            id: string;
            status: "initializing" | "active" | "down" | "maintenance";
            schemas: string[];
            primaryActive: boolean;
            replicasActive: number;
            stats: {
                queries: number;
                errors: number;
                avgResponseTime: number;
                connections: number;
            } | undefined;
        }[];
        totalConnections: number;
        activeConnections: number;
        totalQueries: number;
        failedQueries: number;
        clusterStats: Map<string, {
            queries: number;
            errors: number;
            avgResponseTime: number;
            connections: number;
        }>;
    };
    /**
     * Obtém saúde de um cluster específico
     */
    getClusterHealth(clusterId: string): ClusterHealth;
    /**
     * Força health check em um cluster
     */
    forceHealthCheck(clusterId: string): Promise<void>;
    /**
     * Força failover para um cluster
     */
    forceFailover(clusterId: string, targetReplicaIndex?: number): Promise<void>;
    /**
     * Fecha todas as conexões
     */
    close(): Promise<void>;
    private _setupEventHandlers;
    private _registerCluster;
    private _updateCluster;
    private _removeCluster;
    private _shouldUseReplica;
    private _wrapConnection;
    private _updateClusterStats;
    private _testClusterConnectivity;
    private _singleClusterTransaction;
    private _distributedTransaction;
}
export {};
//# sourceMappingURL=ClusterManager.d.ts.map