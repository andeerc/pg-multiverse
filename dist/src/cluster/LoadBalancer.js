"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoadBalancer = void 0;
class LoadBalancer {
    constructor() {
        this.strategy = 'round_robin';
        this.currentIndex = 0;
        this.stats = new Map();
    }
    setStrategy(strategy) {
        this.strategy = strategy;
        this.currentIndex = 0;
    }
    selectReplica(replicas, options = {}) {
        if (replicas.length === 0) {
            throw new Error('No replicas available');
        }
        if (replicas.length === 1) {
            return 0;
        }
        switch (this.strategy) {
            case 'round_robin':
                return this.roundRobinSelect(replicas);
            case 'weighted':
                return this.weightedSelect(replicas, options.weights);
            case 'least_connections':
                return this.leastConnectionsSelect(replicas);
            case 'response_time':
                return this.responseTimeSelect(replicas);
            case 'health_aware':
                return this.healthAwareSelect(replicas, options);
            default:
                return this.roundRobinSelect(replicas);
        }
    }
    getStats() {
        return {
            strategy: this.strategy,
            nodes: [],
            totalRequests: 0,
            totalErrors: 0,
            avgResponseTime: 0,
            distribution: Object.fromEntries(this.stats)
        };
    }
    roundRobinSelect(replicas) {
        const index = this.currentIndex % replicas.length;
        this.currentIndex = (this.currentIndex + 1) % replicas.length;
        this.updateStats(index);
        return index;
    }
    weightedSelect(replicas, weights) {
        if (!weights) {
            return this.roundRobinSelect(replicas);
        }
        const totalWeight = replicas.reduce((sum, replica, index) => {
            const replicaId = replica.getId ? replica.getId() : `replica_${index}`;
            return sum + (weights[replicaId] || 1);
        }, 0);
        let random = Math.random() * totalWeight;
        for (let i = 0; i < replicas.length; i++) {
            const replicaId = replicas[i].getId ? replicas[i].getId() : `replica_${i}`;
            const weight = weights[replicaId] || 1;
            if (random <= weight) {
                this.updateStats(i);
                return i;
            }
            random -= weight;
        }
        return this.roundRobinSelect(replicas);
    }
    leastConnectionsSelect(replicas) {
        let minConnections = Infinity;
        let selectedIndex = 0;
        replicas.forEach((replica, index) => {
            const connections = this.getConnectionCount(replica);
            if (connections < minConnections) {
                minConnections = connections;
                selectedIndex = index;
            }
        });
        this.updateStats(selectedIndex);
        return selectedIndex;
    }
    responseTimeSelect(replicas) {
        let minResponseTime = Infinity;
        let selectedIndex = 0;
        replicas.forEach((replica, index) => {
            const responseTime = this.getResponseTime(replica);
            if (responseTime < minResponseTime) {
                minResponseTime = responseTime;
                selectedIndex = index;
            }
        });
        this.updateStats(selectedIndex);
        return selectedIndex;
    }
    healthAwareSelect(replicas, options = {}) {
        const scores = replicas.map((replica, index) => {
            const health = this.calculateHealthScore(replica, options);
            return { index, score: health };
        });
        scores.sort((a, b) => b.score - a.score);
        const selectedIndex = scores[0].index;
        this.updateStats(selectedIndex);
        return selectedIndex;
    }
    calculateHealthScore(replica, options) {
        let score = 100;
        // Penaliza por conexoes ativas
        const connections = this.getConnectionCount(replica);
        const maxConnections = replica.config?.maxConnections || 20;
        score -= (connections / maxConnections) * 30;
        // Penaliza por tempo de resposta
        const responseTime = this.getResponseTime(replica);
        score -= Math.min(responseTime / 10, 50);
        // Considera pesos se configurados
        if (options.weights) {
            const replicaId = replica.getId ? replica.getId() : 'unknown';
            const weight = options.weights[replicaId] || 1;
            score *= weight;
        }
        // Penaliza se nao saudavel
        if (options.healthThreshold && score < options.healthThreshold) {
            score *= 0.1;
        }
        return Math.max(score, 0);
    }
    getConnectionCount(replica) {
        try {
            const metrics = replica.getMetrics ? replica.getMetrics() : null;
            return metrics?.active || 0;
        }
        catch {
            return 0;
        }
    }
    getResponseTime(replica) {
        try {
            const metrics = replica.getMetrics ? replica.getMetrics() : null;
            return metrics?.avgResponseTime || 0;
        }
        catch {
            return 0;
        }
    }
    updateStats(index) {
        const key = `replica_${index}`;
        this.stats.set(key, (this.stats.get(key) || 0) + 1);
    }
}
exports.LoadBalancer = LoadBalancer;
//# sourceMappingURL=LoadBalancer.js.map