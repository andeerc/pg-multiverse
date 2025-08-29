"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DistributedTransaction = void 0;
const events_1 = require("events");
const uuid_1 = require("uuid");
class DistributedTransaction extends events_1.EventEmitter {
    constructor(clusterManager) {
        super();
        this.activeTransactions = new Map();
        this.clusterManager = clusterManager;
        this.metrics = {
            total: 0,
            active: 0,
            committed: 0,
            aborted: 0,
            avgDuration: 0,
            distributed: 0
        };
    }
    async initialize() {
        console.log('DistributedTransaction initialized');
    }
    async begin(schemas, options = {}) {
        const transactionId = (0, uuid_1.v4)();
        const clusters = new Set();
        // Determine which clusters are involved
        for (const schema of schemas) {
            const clusterId = this.getClusterForSchema(schema);
            if (clusterId) {
                clusters.add(clusterId);
            }
        }
        const transaction = {
            id: transactionId,
            schemas,
            clusters,
            state: 'preparing',
            connections: new Map(),
            startedAt: new Date(),
            options
        };
        // Get connections for all involved clusters
        for (const clusterId of clusters) {
            try {
                const connection = await this.clusterManager.getConnection({
                    clusterId,
                    operation: 'write'
                });
                await connection.query('BEGIN');
                transaction.connections.set(clusterId, connection);
            }
            catch (error) {
                // Rollback any connections already started
                await this.rollbackConnections(transaction);
                throw new Error(`Failed to start transaction on cluster ${clusterId}: ${error.message}`);
            }
        }
        transaction.state = 'prepared';
        this.activeTransactions.set(transactionId, transaction);
        this.metrics.total++;
        this.metrics.active++;
        if (clusters.size > 1) {
            this.metrics.distributed++;
        }
        this.emit('transactionStarted', {
            transactionId,
            schemas,
            clusters: Array.from(clusters)
        });
        return transactionId;
    }
    async execute(transactionId, operation) {
        const transaction = this.activeTransactions.get(transactionId);
        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }
        if (transaction.state !== 'prepared') {
            throw new Error(`Transaction ${transactionId} is in ${transaction.state} state, cannot execute operations`);
        }
        // Determine target cluster
        let targetCluster = operation.clusterId;
        if (!targetCluster && operation.schema) {
            targetCluster = this.getClusterForSchema(operation.schema);
        }
        if (!targetCluster) {
            throw new Error('Cannot determine target cluster for operation');
        }
        const connection = transaction.connections.get(targetCluster);
        if (!connection) {
            throw new Error(`No connection available for cluster ${targetCluster} in transaction ${transactionId}`);
        }
        try {
            const result = await connection.query(operation.sql, operation.params || []);
            return result;
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    async commit(transactionId) {
        const transaction = this.activeTransactions.get(transactionId);
        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }
        const startTime = Date.now();
        transaction.state = 'committing';
        try {
            // Two-phase commit for distributed transactions
            if (transaction.clusters.size > 1) {
                await this.twoPhaseCommit(transaction);
            }
            else {
                // Single cluster transaction
                await this.singleClusterCommit(transaction);
            }
            transaction.state = 'committed';
            this.metrics.active--;
            this.metrics.committed++;
            const duration = Date.now() - startTime;
            this.updateAvgDuration(duration);
            this.emit('transactionCommitted', { transactionId, duration });
        }
        catch (error) {
            transaction.state = 'aborted';
            await this.rollbackConnections(transaction);
            this.metrics.active--;
            this.metrics.aborted++;
            const duration = Date.now() - startTime;
            this.emit('transactionAborted', {
                transactionId,
                reason: error.message,
                duration
            });
            throw error;
        }
        finally {
            this.releaseConnections(transaction);
            this.activeTransactions.delete(transactionId);
        }
    }
    async rollback(transactionId) {
        const transaction = this.activeTransactions.get(transactionId);
        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }
        const startTime = Date.now();
        transaction.state = 'aborting';
        try {
            await this.rollbackConnections(transaction);
            transaction.state = 'aborted';
            this.metrics.active--;
            this.metrics.aborted++;
            const duration = Date.now() - startTime;
            this.emit('transactionAborted', {
                transactionId,
                reason: 'Manual rollback',
                duration
            });
        }
        finally {
            this.releaseConnections(transaction);
            this.activeTransactions.delete(transactionId);
        }
    }
    getMetrics() {
        return { ...this.metrics };
    }
    async close() {
        // Rollback all active transactions
        const activeIds = Array.from(this.activeTransactions.keys());
        for (const transactionId of activeIds) {
            try {
                await this.rollback(transactionId);
            }
            catch (error) {
                this.emit('error', error);
            }
        }
        this.activeTransactions.clear();
        console.log('DistributedTransaction closed');
    }
    async twoPhaseCommit(transaction) {
        // Phase 1: Prepare all clusters
        const preparePromises = Array.from(transaction.connections.entries()).map(async ([clusterId, connection]) => {
            try {
                await connection.query('PREPARE TRANSACTION $1', [transaction.id]);
                return { clusterId, success: true };
            }
            catch (error) {
                return { clusterId, success: false, error };
            }
        });
        const prepareResults = await Promise.all(preparePromises);
        const failedPrepares = prepareResults.filter(result => !result.success);
        if (failedPrepares.length > 0) {
            // Abort prepared transactions
            await this.abortPreparedTransactions(transaction, prepareResults);
            throw new Error(`Prepare phase failed on clusters: ${failedPrepares.map(f => f.clusterId).join(', ')}`);
        }
        // Phase 2: Commit all clusters
        const commitPromises = Array.from(transaction.connections.entries()).map(async ([clusterId, connection]) => {
            try {
                await connection.query('COMMIT PREPARED $1', [transaction.id]);
                return { clusterId, success: true };
            }
            catch (error) {
                return { clusterId, success: false, error };
            }
        });
        const commitResults = await Promise.all(commitPromises);
        const failedCommits = commitResults.filter(result => !result.success);
        if (failedCommits.length > 0) {
            console.warn(`Commit phase partially failed on clusters: ${failedCommits.map(f => f.clusterId).join(', ')}`);
            // Note: In a real implementation, you would need recovery mechanisms here
        }
    }
    async singleClusterCommit(transaction) {
        const [connection] = transaction.connections.values();
        await connection.query('COMMIT');
    }
    async abortPreparedTransactions(transaction, prepareResults) {
        const abortPromises = prepareResults
            .filter(result => result.success)
            .map(async (result) => {
            const connection = transaction.connections.get(result.clusterId);
            if (connection) {
                try {
                    await connection.query('ROLLBACK PREPARED $1', [transaction.id]);
                }
                catch (error) {
                    console.warn(`Failed to abort prepared transaction on ${result.clusterId}:`, error);
                }
            }
        });
        await Promise.all(abortPromises);
    }
    async rollbackConnections(transaction) {
        const rollbackPromises = Array.from(transaction.connections.values()).map(async (connection) => {
            try {
                await connection.query('ROLLBACK');
            }
            catch (error) {
                // Connection might already be closed or in an error state
                console.warn('Failed to rollback connection:', error);
            }
        });
        await Promise.all(rollbackPromises);
    }
    releaseConnections(transaction) {
        for (const connection of transaction.connections.values()) {
            try {
                connection.release();
            }
            catch (error) {
                console.warn('Failed to release connection:', error);
            }
        }
        transaction.connections.clear();
    }
    getClusterForSchema(schema) {
        // This should query the cluster manager or config for schema mapping
        // For now, we'll use a simple implementation
        const clusters = this.clusterManager.getClusters();
        for (const [clusterId, cluster] of clusters.entries()) {
            if (cluster.config.schemas?.includes(schema)) {
                return clusterId;
            }
        }
        return undefined;
    }
    updateAvgDuration(duration) {
        const totalTransactions = this.metrics.committed + this.metrics.aborted;
        if (totalTransactions === 0) {
            this.metrics.avgDuration = duration;
        }
        else {
            this.metrics.avgDuration = ((this.metrics.avgDuration * (totalTransactions - 1)) + duration) / totalTransactions;
        }
    }
}
exports.DistributedTransaction = DistributedTransaction;
//# sourceMappingURL=DistributedTransaction.js.map