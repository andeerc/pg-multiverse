"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthChecker = void 0;
const events_1 = require("events");
class HealthChecker extends events_1.EventEmitter {
    constructor(config = {}) {
        super();
        this.clusters = new Map();
        this.healthData = new Map();
        this.isRunning = false;
        this.config = {
            healthCheckInterval: 30000,
            retryAttempts: 3,
            retryDelay: 1000,
            maxFailuresBeforeMarkDown: 3,
            recoveryCheckInterval: 60000,
            ...config
        };
    }
    async start(clusters) {
        if (this.isRunning)
            return;
        this.clusters = clusters;
        this.isRunning = true;
        // Inicializa dados de health
        for (const [clusterId] of clusters.entries()) {
            this.healthData.set(clusterId, this.createInitialHealth(clusterId));
        }
        // Inicia verificacao periodica
        this.intervalId = setInterval(() => {
            this.performHealthCheck().catch(error => {
                this.emit('error', error);
            });
        }, this.config.healthCheckInterval);
        // Primeira verificacao imediata
        await this.performHealthCheck();
    }
    async stop() {
        if (!this.isRunning)
            return;
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        this.clusters.clear();
        this.healthData.clear();
    }
    async forceCheck(clusterId) {
        const cluster = this.clusters.get(clusterId);
        if (!cluster) {
            throw new Error(`Cluster ${clusterId} not found`);
        }
        await this.checkClusterHealth(clusterId, cluster);
    }
    getClusterHealth(clusterId) {
        const health = this.healthData.get(clusterId);
        if (!health) {
            return this.createInitialHealth(clusterId);
        }
        return { ...health };
    }
    removeCluster(clusterId) {
        this.clusters.delete(clusterId);
        this.healthData.delete(clusterId);
    }
    async performHealthCheck() {
        const results = {};
        for (const [clusterId, cluster] of this.clusters.entries()) {
            try {
                const health = await this.checkClusterHealth(clusterId, cluster);
                results[clusterId] = health;
            }
            catch (error) {
                this.emit('error', error);
            }
        }
        this.emit('healthCheckComplete', results);
    }
    async checkClusterHealth(clusterId, cluster) {
        const startTime = Date.now();
        let healthy = true;
        let error;
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
        }
        catch (err) {
            healthy = false;
            error = err.message;
            responseTime = Date.now() - startTime;
        }
        const previousHealth = this.healthData.get(clusterId);
        const wasHealthy = previousHealth?.healthy ?? true;
        // Calcula metricas
        const connections = this.getConnectionMetrics(cluster);
        const queries = this.getQueryMetrics(cluster);
        const health = {
            clusterId,
            healthy,
            lastCheck: new Date(),
            responseTime,
            failureCount: healthy ? 0 : (previousHealth?.failureCount ?? 0) + 1,
            uptime: previousHealth ? Date.now() - previousHealth.lastCheck.getTime() : 0,
            connections,
            queries,
            error
        };
        // Atualiza status se mudou
        if (wasHealthy && !healthy) {
            this.emit('clusterDown', {
                clusterId,
                reason: error || 'Health check failed',
                health
            });
        }
        else if (!wasHealthy && healthy && previousHealth) {
            const downtime = Date.now() - previousHealth.lastCheck.getTime();
            this.emit('clusterRecovered', { clusterId, downtime });
            this.emit('clusterUp', { clusterId, health });
        }
        this.healthData.set(clusterId, health);
        return health;
    }
    async testConnection(pool) {
        const connection = await pool.getConnection();
        try {
            await connection.query('SELECT 1');
        }
        finally {
            connection.release();
        }
    }
    getConnectionMetrics(cluster) {
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
    getQueryMetrics(cluster) {
        return {
            total: 0,
            successful: 0,
            failed: 0,
            avgResponseTime: 0
        };
    }
    createInitialHealth(clusterId) {
        return {
            clusterId,
            healthy: true,
            lastCheck: new Date(),
            responseTime: 0,
            failureCount: 0,
            uptime: 0,
            connections: { active: 0, idle: 0, total: 0 },
            queries: { total: 0, successful: 0, failed: 0, avgResponseTime: 0 }
        };
    }
}
exports.HealthChecker = HealthChecker;
//# sourceMappingURL=HealthChecker.js.map