/// <reference types="node" />
import { EventEmitter } from 'events';
import { MultiClusterConfig, QueryParam, QueryResult, QueryOptions, TransactionOptions, TransactionCallback, SchemaMapping, CacheInvalidationCriteria, SystemMetrics, ClusterHealth, ValidationResult } from '../types';
/**
 * Classe principal para gerenciamento de múltiplos clusters PostgreSQL
 * com suporte a multi-schema, caching distribuído e transações
 */
export declare class MultiClusterPostgres extends EventEmitter {
    private config;
    private clusterManager;
    private clusterConfig;
    private cache;
    private transactionManager;
    private isInitialized;
    private schemas;
    constructor(config?: MultiClusterConfig);
    /**
     * Inicializa o sistema com configuração
     */
    initialize(clusterConfigs?: Record<string, any>): Promise<void>;
    /**
     * Executa query com roteamento automático
     */
    query<T = any>(sql: string, params?: QueryParam[], options?: QueryOptions): Promise<QueryResult<T>>;
    /**
     * Obtém conexão para uso direto
     */
    getConnection(options?: QueryOptions): Promise<import("./ClusterManager").WrappedConnection>;
    /**
     * Inicia transação (simples ou distribuída)
     */
    beginTransaction(schemas: string | string[], options?: TransactionOptions): Promise<string>;
    /**
     * Executa operação dentro de transação
     */
    executeInTransaction<T = any>(transactionId: string, sql: string, params?: QueryParam[], options?: QueryOptions): Promise<QueryResult<T>>;
    /**
     * Confirma transação
     */
    commitTransaction(transactionId: string): Promise<void>;
    /**
     * Desfaz transação
     */
    rollbackTransaction(transactionId: string): Promise<void>;
    /**
     * Executa função dentro de transação automática
     */
    withTransaction<T>(schemas: string | string[], callback: TransactionCallback<T>, options?: TransactionOptions): Promise<T>;
    /**
     * Adiciona schema dinamicamente
     */
    registerSchema(schema: string, clusterId: string, options?: Partial<SchemaMapping>): void;
    /**
     * Invalida cache por critério
     */
    invalidateCache(criteria: CacheInvalidationCriteria): Promise<number>;
    /**
     * Obtém métricas do sistema
     */
    getMetrics(): SystemMetrics;
    /**
     * Executa health check em todos os clusters
     */
    healthCheck(): Promise<Record<string, ClusterHealth>>;
    /**
     * Valida configuração
     */
    validateConfig(): ValidationResult;
    /**
     * Fecha todas as conexões e limpa recursos
     */
    close(): Promise<void>;
    private _setupEventHandlers;
    private _handleConfigChange;
    private _mapSchemasFromConfig;
    private _ensureInitialized;
    private _detectOperation;
    private _generateCacheKey;
    private _simpleHash;
}
//# sourceMappingURL=MultiClusterPostgres.d.ts.map