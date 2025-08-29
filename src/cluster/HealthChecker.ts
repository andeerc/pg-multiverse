import { EventEmitter } from 'events';
import { ClusterHealth, ClusterManagerConfig, TypedEventEmitter } from '../types';

interface HealthCheckerEvents {
  clusterDown: (data: { clusterId: string; reason: string; health: ClusterHealth }) => void;
  clusterUp: (data: { clusterId: string; health: ClusterHealth }) => void;
  clusterRecovered: (data: { clusterId: string; downtime: number }) => void;
  healthCheckComplete: (results: Record<string, ClusterHealth>) => void;
  error: (error: Error) => void;
  [key: string]: (...args: any[]) => void;
}

export class HealthChecker extends EventEmitter {
  private config: Required<ClusterManagerConfig>;
  private clusters: Map<string, any> = new Map();
  private healthData: Map<string, ClusterHealth> = new Map();
  private intervalId?: NodeJS.Timeout;
  private isRunning: boolean = false;

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
  }

  async start(clusters: Map<string, any>): Promise<void> {
    if (this.isRunning) return;

    this.clusters = clusters;
    this.isRunning = true;

    // Inicializa dados de health
    for (const [clusterId] of clusters.entries()) {
      this.healthData.set(clusterId, this.createInitialHealth(clusterId));
    }

    // Inicia verificacao periodica
    this.intervalId = setInterval(() => {
      this.performHealthCheck().catch(error => {
        this.emit('error', error as Error);
      });
    }, this.config.healthCheckInterval);

    // Primeira verificacao imediata
    await this.performHealthCheck();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.clusters.clear();
    this.healthData.clear();
  }

  async forceCheck(clusterId: string): Promise<void> {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) {
      throw new Error(`Cluster ${clusterId} not found`);
    }

    await this.checkClusterHealth(clusterId, cluster);
  }

  getClusterHealth(clusterId: string): ClusterHealth {
    const health = this.healthData.get(clusterId);
    if (!health) {
      return this.createInitialHealth(clusterId);
    }
    return { ...health };
  }

  removeCluster(clusterId: string): void {
    this.clusters.delete(clusterId);
    this.healthData.delete(clusterId);
  }

  private async performHealthCheck(): Promise<void> {
    const results: Record<string, ClusterHealth> = {};

    for (const [clusterId, cluster] of this.clusters.entries()) {
      try {
        const health = await this.checkClusterHealth(clusterId, cluster);
        results[clusterId] = health;
      } catch (error) {
        this.emit('error', error as Error);
      }
    }

    this.emit('healthCheckComplete', results);
  }

  private async checkClusterHealth(clusterId: string, cluster: any): Promise<ClusterHealth> {
    const startTime = Date.now();
    let healthy = true;
    let error: string | undefined;
    let responseTime = 0;

    try {
      // Testa primary
      if (cluster.pools.primary) {
        await this.testConnection(cluster.pools.primary);
      }

      // Testa replicas
      for (const replica of cluster.pools.replicas || []) {
        await this.testConnection(replica);
      }

      responseTime = Date.now() - startTime;
    } catch (err) {
      healthy = false;
      error = (err as Error).message;
      responseTime = Date.now() - startTime;
    }

    const previousHealth = this.healthData.get(clusterId);
    const wasHealthy = previousHealth?.healthy ?? true;

    // Calcula metricas
    const connections = this.getConnectionMetrics(cluster);
    const queries = this.getQueryMetrics(cluster);

    const health: ClusterHealth = {
      clusterId,
      healthy,
      lastCheck: new Date(),
      responseTime,
      failureCount: healthy ? 0 : (previousHealth?.failureCount ?? 0) + 1,
      uptime: previousHealth ? Date.now() - previousHealth.lastCheck.getTime() : 0,
      connections,
      queries,
      error,
    };

    // Atualiza status se mudou
    if (wasHealthy && !healthy) {
      this.emit('clusterDown', {
        clusterId,
        reason: error || 'Health check failed',
        health,
      });
    } else if (!wasHealthy && healthy && previousHealth) {
      const downtime = Date.now() - previousHealth.lastCheck.getTime();
      this.emit('clusterRecovered', { clusterId, downtime });
      this.emit('clusterUp', { clusterId, health });
    }

    this.healthData.set(clusterId, health);
    return health;
  }

  private async testConnection(pool: any): Promise<void> {
    const connection = await pool.getConnection();
    try {
      await connection.query('SELECT 1');
    } finally {
      connection.release();
    }
  }

  private getConnectionMetrics(cluster: any) {
    let active = 0;
    let idle = 0;
    let total = 0;

    if (cluster.pools.primary) {
      const metrics = cluster.pools.primary.getMetrics();
      active += metrics.active;
      idle += metrics.idle;
      total += metrics.total;
    }

    for (const replica of cluster.pools.replicas || []) {
      const metrics = replica.getMetrics();
      active += metrics.active;
      idle += metrics.idle;
      total += metrics.total;
    }

    return { active, idle, total };
  }

  private getQueryMetrics(cluster: any) {
    return {
      total: 0,
      successful: 0,
      failed: 0,
      avgResponseTime: 0,
    };
  }

  private createInitialHealth(clusterId: string): ClusterHealth {
    return {
      clusterId,
      healthy: true,
      lastCheck: new Date(),
      responseTime: 0,
      failureCount: 0,
      uptime: 0,
      connections: { active: 0, idle: 0, total: 0 },
      queries: { total: 0, successful: 0, failed: 0, avgResponseTime: 0 },
    };
  }
}
