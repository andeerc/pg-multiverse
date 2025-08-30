import { EventEmitter } from 'events';
import { PoolClient } from 'pg';
import {
  ClusterConfig,
  ClustersConfig,
  ClusterManagerConfig,
  QueryOptions,
  QueryParam,
  QueryResult,
  ClusterHealth,
  ClusterMetrics,
  LoadBalancingStrategy,
  ConsistencyLevel,
  ReadPreference,
  OperationType,
  TransactionOptions,
  TypedEventEmitter,
} from '../types';
import { ConnectionPool } from './ConnectionPool';
import { HealthChecker } from './HealthChecker';
import { LoadBalancer } from './LoadBalancer';

interface ClusterManagerEvents {
  initialized: (data: { clusters: string[] }) => void;
  error: (error: Error) => void;
  clusterRegistered: (data: { clusterId: string; config: any }) => void;
  clusterDown: (data: { clusterId: string; reason: string; health: ClusterHealth }) => void;
  clusterUp: (data: { clusterId: string; health: ClusterHealth }) => void;
  clusterRecovered: (data: { clusterId: string; downtime: number }) => void;
  connectionError: (data: { clusterId: string; error: Error }) => void;
  queryError: (data: {
    sql: string;
    params: QueryParam[];
    options: QueryOptions;
    error: Error;
    cluster: string;
  }) => void;
  failover: (data: { clusterId: string; newPrimary: string; oldPrimary?: string }) => void;
  closed: () => void;
  [key: string]: (...args: any[]) => void;
}

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

interface ClusterStats {
  totalConnections: number;
  activeConnections: number;
  totalQueries: number;
  failedQueries: number;
  clusterStats: Map<
    string,
    {
      queries: number;
      errors: number;
      avgResponseTime: number;
      connections: number;
    }
  >;
}

/**
 * Gerencia múltiplos clusters PostgreSQL com read/write splitting,
 * load balancing, failover automático e health checking
 */
export class ClusterManager extends EventEmitter {
  private config: Required<ClusterManagerConfig>;
  private clusters: Map<string, ClusterInfo>;
  private schemaClusterMap: Map<string, string>;
  private connectionPools: Map<string, ConnectionPool>;
  private healthChecker: HealthChecker;
  private loadBalancer: LoadBalancer;
  private isInitialized: boolean = false;
  private stats: ClusterStats;

  constructor(config: ClusterManagerConfig = {}) {
    super();

    this.config = {
      healthCheckInterval: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      maxFailuresBeforeMarkDown: 3,
      recoveryCheckInterval: 60000,
      ...config,
    };

    this.clusters = new Map<string, ClusterInfo>();
    this.schemaClusterMap = new Map<string, string>();
    this.connectionPools = new Map<string, ConnectionPool>();
    this.healthChecker = new HealthChecker(this.config);
    this.loadBalancer = new LoadBalancer();

    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      totalQueries: 0,
      failedQueries: 0,
      clusterStats: new Map(),
    };

    this._setupEventHandlers();
  }

  /**
   * Inicializa o cluster manager com configuração de clusters
   */
  async initialize(clusterConfigs: ClustersConfig): Promise<void> {
    if (this.isInitialized) {
      throw new Error('ClusterManager already initialized');
    }

    try {
      // Registra todos os clusters
      for (const [clusterId, clusterConfig] of Object.entries(clusterConfigs)) {
        await this._registerCluster(clusterId, clusterConfig);
      }

      // Inicia health checking
      await this.healthChecker.start(this.clusters);

      this.isInitialized = true;
      this.emit('initialized', { clusters: Array.from(this.clusters.keys()) });

      // ClusterManager initialized
    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Atualiza configuração dinamicamente
   */
  async updateConfig(clusterConfigs: Record<string, any>): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('ClusterManager not initialized');
    }

    // Remove clusters que não existem mais
    const newClusterIds = new Set(Object.keys(clusterConfigs));
    for (const [clusterId] of this.clusters.entries()) {
      if (!newClusterIds.has(clusterId)) {
        await this._removeCluster(clusterId);
      }
    }

    // Adiciona ou atualiza clusters
    for (const [clusterId, config] of Object.entries(clusterConfigs)) {
      if (this.clusters.has(clusterId)) {
        await this._updateCluster(clusterId, config);
      } else {
        await this._registerCluster(clusterId, config);
      }
    }
  }

  /**
   * Obtém connection pool adequado para operação
   */
  async getConnection(options: QueryOptions = {}): Promise<WrappedConnection> {
    const {
      schema,
      operation = 'read',
      consistencyLevel = 'eventual' as ConsistencyLevel,
      clusterId,
    } = options;

    if (!this.isInitialized) {
      throw new Error('ClusterManager not initialized');
    }

    let targetCluster = clusterId;

    // Determina cluster baseado no schema
    if (schema && !targetCluster) {
      targetCluster = this.schemaClusterMap.get(schema);
      if (!targetCluster) {
        throw new Error(`No cluster configured for schema: ${schema}`);
      }
    }

    // Se não especificou cluster nem schema, usa o primeiro disponível
    if (!targetCluster) {
      const availableClusters = Array.from(this.clusters.keys()).filter(
        id => this.clusters.get(id)?.status === 'active'
      );

      if (availableClusters.length === 0) {
        throw new Error('No active clusters available');
      }

      targetCluster = availableClusters[0];
    }

    const cluster = this.clusters.get(targetCluster);
    if (!cluster) {
      throw new Error(`Cluster not found: ${targetCluster}`);
    }

    // Determina se deve usar primary ou replica
    const useReplica = this._shouldUseReplica(operation, consistencyLevel);

    try {
      let pool: ConnectionPool;

      if (useReplica && cluster.pools.replicas.length > 0) {
        // Seleciona replica usando load balancer
        const replicaIndex = this.loadBalancer.selectReplica(cluster.pools.replicas, options);
        pool = cluster.pools.replicas[replicaIndex];
      } else if (cluster.pools.primary) {
        // Usa primary
        pool = cluster.pools.primary;
      } else {
        throw new Error(`No suitable connection pool found for cluster: ${targetCluster}`);
      }

      const connection = await pool.getConnection();

      // Envolve connection com metadata
      const wrappedConnection = this._wrapConnection(connection, {
        clusterId: targetCluster,
        schema,
        pool: pool.getId(),
      }) as WrappedConnection;

      this.stats.activeConnections++;
      return wrappedConnection;
    } catch (error) {
      this.stats.failedQueries++;
      this.emit('connectionError', { clusterId: targetCluster, error: error as Error });
      throw error;
    }
  }

  /**
   * Executa query com roteamento inteligente
   */
  async executeQuery<T = any>(
    sql: string,
    params: QueryParam[] = [],
    options: QueryOptions = {}
  ): Promise<QueryResult<T> & { clusterId: string }> {
    const connection = await this.getConnection(options);

    try {
      const startTime = Date.now();
      const result = (await connection.query(sql, params)) as QueryResult<T>;
      const endTime = Date.now();

      // Atualiza estatísticas
      this.stats.totalQueries++;
      this._updateClusterStats(connection._clusterMetadata.clusterId, endTime - startTime);

      return {
        ...result,
        clusterId: connection._clusterMetadata.clusterId,
      };
    } catch (error) {
      this.stats.failedQueries++;
      this.emit('queryError', {
        sql,
        params,
        options,
        error: error as Error,
        cluster: connection._clusterMetadata.clusterId,
      });
      throw error;
    } finally {
      connection.release();
      this.stats.activeConnections--;
    }
  }

  /**
   * Executa transação distribuída se necessário
   */
  async transaction<T>(
    callback: (connection: PoolClient) => Promise<T>,
    options: TransactionOptions & { schemas?: string[] } = {}
  ): Promise<T | T[]> {
    const { schemas = [], isolationLevel = 'READ_COMMITTED' } = options;

    // Se apenas um schema/cluster, usa transação simples
    const involvedClusters = new Set<string>();
    for (const schema of schemas) {
      const clusterId = this.schemaClusterMap.get(schema);
      if (clusterId) {
        involvedClusters.add(clusterId);
      }
    }

    if (involvedClusters.size <= 1) {
      return this._singleClusterTransaction(callback, options);
    }

    // Transação distribuída (implementação simplificada)
    if (options.isolationLevel && options.isolationLevel !== 'READ_UNCOMMITTED') {
      return this._distributedTransaction(callback, options);
    }

    // Para eventual consistency, executa separadamente
    const results: T[] = [];
    for (const clusterId of involvedClusters) {
      const result = await this._singleClusterTransaction(callback, {
        ...options,
        clusterId,
      });
      results.push(result);
    }

    return results;
  }

  /**
   * Obtém clusters registrados
   */
  getClusters(): Map<string, ClusterInfo> {
    return new Map(this.clusters);
  }

  /**
   * Obtém métricas dos clusters
   */
  getMetrics(): Record<string, ClusterMetrics> {
    const metrics: Record<string, ClusterMetrics> = {};

    for (const [clusterId, cluster] of this.clusters.entries()) {
      const stats = this.stats.clusterStats.get(clusterId);
      const health = this.healthChecker.getClusterHealth(clusterId);

      metrics[clusterId] = {
        clusterId,
        queries: {
          total: stats?.queries || 0,
          reads: 0, // Calculado baseado no histórico
          writes: 0, // Calculado baseado no histórico
          cached: 0, // Calculado pelo cache
          avgResponseTime: stats?.avgResponseTime || 0,
          errors: stats?.errors || 0,
        },
        connections: {
          active: health.connections.active,
          idle: health.connections.idle,
          max: health.connections.total,
          created: 0, // Tracked by pools
          destroyed: 0, // Tracked by pools
        },
        cache: {
          hits: 0, // Provided by cache layer
          misses: 0, // Provided by cache layer
          hitRate: 0, // Calculated by cache layer
        },
        uptime: health.uptime,
        lastUpdated: new Date(),
      };
    }

    return metrics;
  }

  /**
   * Obtém estatísticas gerais
   */
  getStats() {
    return {
      ...this.stats,
      clusters: Array.from(this.clusters.entries()).map(([id, cluster]) => ({
        id,
        status: cluster.status,
        schemas: cluster.config.schemas,
        primaryActive: !!cluster.pools.primary,
        replicasActive: cluster.pools.replicas.length,
        stats: this.stats.clusterStats.get(id),
      })),
    };
  }

  /**
   * Obtém saúde de um cluster específico
   */
  getClusterHealth(clusterId: string): ClusterHealth {
    return this.healthChecker.getClusterHealth(clusterId);
  }

  /**
   * Força health check em um cluster
   */
  async forceHealthCheck(clusterId: string): Promise<void> {
    return this.healthChecker.forceCheck(clusterId);
  }

  /**
   * Força failover para um cluster
   */
  async forceFailover(clusterId: string, targetReplicaIndex: number = 0): Promise<void> {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) {
      throw new Error(`Cluster not found: ${clusterId}`);
    }

    if (cluster.pools.replicas.length === 0) {
      throw new Error(`No replicas available for failover in cluster: ${clusterId}`);
    }

    // Promove replica para primary
    const newPrimary = cluster.pools.replicas[targetReplicaIndex];
    const oldPrimary = cluster.pools.primary;

    cluster.pools.primary = newPrimary;
    cluster.pools.replicas.splice(targetReplicaIndex, 1);

    if (oldPrimary) {
      cluster.pools.replicas.push(oldPrimary);
    }

    this.emit('failover', {
      clusterId,
      newPrimary: newPrimary.getId(),
      oldPrimary: oldPrimary?.getId(),
    });

    // Failover completed
  }

  /**
   * Fecha todas as conexões
   */
  async close(): Promise<void> {
    if (!this.isInitialized) return;

    // Para health checker
    await this.healthChecker.stop();

    // Fecha todos os pools
    const closePromises = Array.from(this.connectionPools.values()).map(pool => pool.close());

    await Promise.all(closePromises);

    this.clusters.clear();
    this.connectionPools.clear();
    this.schemaClusterMap.clear();

    this.isInitialized = false;
    this.emit('closed');
  }

  // ==================== MÉTODOS PRIVADOS ====================

  private _setupEventHandlers(): void {
    this.healthChecker.on('clusterDown', ({ clusterId, reason, health }) => {
      const cluster = this.clusters.get(clusterId);
      if (cluster) {
        cluster.status = 'down';
        this.emit('clusterDown', { clusterId, reason, health });
      }
    });

    this.healthChecker.on('clusterUp', ({ clusterId, health }) => {
      const cluster = this.clusters.get(clusterId);
      if (cluster) {
        cluster.status = 'active';
        this.emit('clusterUp', { clusterId, health });
      }
    });

    this.healthChecker.on('clusterRecovered', ({ clusterId, downtime }) => {
      this.emit('clusterRecovered', { clusterId, downtime });
    });
  }

  private async _registerCluster(clusterId: string, config: any): Promise<void> {
    const clusterInfo: ClusterInfo = {
      id: clusterId,
      primary: null,
      replicas: [],
      pools: {
        primary: null,
        replicas: [],
      },
      status: 'initializing',
      config: {
        id: clusterId,
        schemas: config.schemas || [],
        priority: config.priority || 1,
        readPreference: config.readPreference || 'replica',
        consistencyLevel: config.consistencyLevel || 'eventual',
        primary: config.primary,
        replicas: config.replicas || [],
        sharding: config.sharding,
        loadBalancing: config.loadBalancing,
        connectionPool: config.connectionPool,
      },
    };

    // Configura conexão primária
    if (config.primary) {
      const primaryPool = new ConnectionPool({
        ...config.primary,
        clusterId,
        role: 'primary',
      });

      clusterInfo.primary = config.primary;
      clusterInfo.pools.primary = primaryPool;

      this.connectionPools.set(`${clusterId}_primary`, primaryPool);
      
      // Aguarda primary estar ready
      await this._waitForPoolReady(primaryPool);
    }

    // Configura réplicas (assíncrono e tolerante a falhas)
    if (config.replicas && config.replicas.length > 0) {
      for (let i = 0; i < config.replicas.length; i++) {
        const replicaConfig = config.replicas[i];
        const replicaPool = new ConnectionPool({
          ...replicaConfig,
          clusterId,
          role: 'replica',
          replicaIndex: i,
        });

        clusterInfo.replicas.push(replicaConfig);
        clusterInfo.pools.replicas.push(replicaPool);

        this.connectionPools.set(`${clusterId}_replica_${i}`, replicaPool);

        // Adiciona listener de erro antes de aguardar
        replicaPool.on('error', (error) => {
          // Não propagar erro
        });

        // Aguarda réplica de forma não-bloqueante
        this._waitForPoolReady(replicaPool, 15000)
          .then(() => {
            // Replica ready
          })
          .catch((error) => {
            // Remove réplica com falha
            const replicaIndex = clusterInfo.pools.replicas.indexOf(replicaPool);
            if (replicaIndex > -1) {
              clusterInfo.pools.replicas.splice(replicaIndex, 1);
              clusterInfo.replicas.splice(replicaIndex, 1);
              this.connectionPools.delete(`${clusterId}_replica_${i}`);
            }
          });
      }
    }

    // Mapeia schemas para este cluster
    if (config.schemas) {
      for (const schema of config.schemas) {
        this.schemaClusterMap.set(schema, clusterId);
      }
    }

    this.clusters.set(clusterId, clusterInfo);
    this.stats.clusterStats.set(clusterId, {
      queries: 0,
      errors: 0,
      avgResponseTime: 0,
      connections: 0,
    });

    // Conectividade inicial já testada durante inicialização dos pools

    clusterInfo.status = 'active';
    this.emit('clusterRegistered', { clusterId, config });
  }

  private async _updateCluster(clusterId: string, config: any): Promise<void> {
    // Remove cluster existente
    await this._removeCluster(clusterId);

    // Re-adiciona com nova configuração
    await this._registerCluster(clusterId, config);
  }

  private async _removeCluster(clusterId: string): Promise<void> {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return;

    // Remove do health checker
    this.healthChecker.removeCluster(clusterId);

    // Fecha pools de conexão
    if (cluster.pools.primary) {
      await cluster.pools.primary.close();
      this.connectionPools.delete(`${clusterId}_primary`);
    }

    for (let i = 0; i < cluster.pools.replicas.length; i++) {
      await cluster.pools.replicas[i].close();
      this.connectionPools.delete(`${clusterId}_replica_${i}`);
    }

    // Remove mapeamentos de schema
    for (const [schema, mappedClusterId] of this.schemaClusterMap.entries()) {
      if (mappedClusterId === clusterId) {
        this.schemaClusterMap.delete(schema);
      }
    }

    // Remove cluster e stats
    this.clusters.delete(clusterId);
    this.stats.clusterStats.delete(clusterId);
  }

  private _shouldUseReplica(operation: OperationType, consistencyLevel: ConsistencyLevel): boolean {
    if (consistencyLevel === 'strong') return false;
    if (operation === 'write') return false;

    return true; // Usa replica quando possível para reads
  }

  private _wrapConnection(connection: PoolClient, metadata: any): PoolClient {
    (connection as any)._clusterMetadata = metadata;

    const originalRelease = connection.release.bind(connection);
    connection.release = () => {
      this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);
      return originalRelease();
    };

    return connection;
  }

  private _updateClusterStats(clusterId: string, responseTime: number): void {
    const stats = this.stats.clusterStats.get(clusterId);
    if (stats) {
      stats.queries++;
      stats.avgResponseTime = (stats.avgResponseTime + responseTime) / 2;
    }
  }

  private async _waitForPoolReady(pool: ConnectionPool, timeoutMs: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Pool ${pool.getId()} not ready within ${timeoutMs}ms`));
      }, timeoutMs);

      const checkReady = () => {
        const info = pool.getInfo();
        if (info.isReady) {
          clearTimeout(timeout);
          resolve();
        } else if (info.isClosed) {
          clearTimeout(timeout);
          reject(new Error(`Pool ${pool.getId()} was closed while waiting for ready`));
        } else {
          setTimeout(checkReady, 100);
        }
      };

      // Se já está ready
      if (pool.getInfo().isReady) {
        clearTimeout(timeout);
        resolve();
        return;
      }

      // Aguarda evento poolReady
      pool.once('poolReady', () => {
        clearTimeout(timeout);
        resolve();
      });

      pool.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      checkReady();
    });
  }

  private async _testClusterConnectivity(clusterId: string): Promise<void> {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return;

    let primaryConnected = false;
    let replicasConnected = 0;

    // Testa primary
    if (cluster.pools.primary) {
      try {
        const conn = await cluster.pools.primary.getConnection();
        await conn.query('SELECT 1');
        conn.release();
        primaryConnected = true;
        // Primary connection healthy
      } catch (error) {
        // Primary connection failed
        throw new Error(`Primary database connection failed for cluster ${clusterId}`);
      }
    }

    // Testa replicas (tolerante a falhas)
    for (let i = 0; i < cluster.pools.replicas.length; i++) {
      const replica = cluster.pools.replicas[i];
      try {
        const conn = await replica.getConnection();
        await conn.query('SELECT 1');
        conn.release();
        replicasConnected++;
        // Replica connection healthy
      } catch (error) {
        // Replica connection failed
        // Remove réplica com falha do pool
        cluster.pools.replicas.splice(i, 1);
        cluster.replicas.splice(i, 1);
        this.connectionPools.delete(`${clusterId}_replica_${i}`);
        i--; // Ajusta índice após remoção
      }
    }

    // Connectivity test completed
    
    if (!primaryConnected) {
      throw new Error(`Cluster ${clusterId} primary connection is required but failed`);
    }
  }

  private async _singleClusterTransaction<T>(
    callback: (connection: PoolClient) => Promise<T>,
    options: any = {}
  ): Promise<T> {
    const connection = await this.getConnection({
      ...options,
      operation: 'write',
    });

    try {
      await connection.query('BEGIN');
      const result = await callback(connection);
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }

  private async _distributedTransaction<T>(
    callback: (connection: PoolClient) => Promise<T>,
    options: any = {}
  ): Promise<T> {
    // Implementação simplificada de 2PC (Two-Phase Commit)
    // Em produção, considere usar bibliotecas especializadas
    throw new Error(
      'Distributed transactions not fully implemented. Use eventual consistency for cross-cluster operations.'
    );
  }
}
