import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  DistributedTransactionState,
  TransactionOptions,
  TransactionMetrics,
  QueryParam,
  QueryResult,
  TypedEventEmitter,
} from '../types';
import { ClusterManager } from './ClusterManager';

interface DistributedTransactionEvents {
  transactionStarted: (data: {
    transactionId: string;
    schemas: string[];
    clusters: string[];
  }) => void;
  transactionCommitted: (data: { transactionId: string; duration: number }) => void;
  transactionAborted: (data: { transactionId: string; reason: string; duration: number }) => void;
  error: (error: Error) => void;
  [key: string]: (...args: any[]) => void;
}

export class DistributedTransaction extends EventEmitter {
  private clusterManager: ClusterManager;
  private activeTransactions: Map<string, DistributedTransactionState> = new Map();
  private metrics: TransactionMetrics;

  constructor(clusterManager: ClusterManager) {
    super();
    this.clusterManager = clusterManager;

    this.metrics = {
      total: 0,
      active: 0,
      committed: 0,
      aborted: 0,
      avgDuration: 0,
      distributed: 0,
    };
  }

  async initialize(): Promise<void> {
    console.log('DistributedTransaction initialized');
  }

  async begin(schemas: string[], options: TransactionOptions = {}): Promise<string> {
    const transactionId = uuidv4();
    const clusters = new Set<string>();

    // Determine which clusters are involved
    for (const schema of schemas) {
      const clusterId = this.getClusterForSchema(schema);
      if (clusterId) {
        clusters.add(clusterId);
      }
    }

    const transaction: DistributedTransactionState = {
      id: transactionId,
      schemas,
      clusters,
      state: 'preparing',
      connections: new Map(),
      startedAt: new Date(),
      options,
    };

    // Get connections for all involved clusters
    for (const clusterId of clusters) {
      try {
        const connection = await this.clusterManager.getConnection({
          clusterId,
          operation: 'write',
        });

        await connection.query('BEGIN');
        transaction.connections.set(clusterId, connection);
      } catch (error) {
        // Rollback any connections already started
        await this.rollbackConnections(transaction);
        throw new Error(
          `Failed to start transaction on cluster ${clusterId}: ${(error as Error).message}`
        );
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
      clusters: Array.from(clusters),
    });

    return transactionId;
  }

  async execute<T = any>(
    transactionId: string,
    operation: {
      sql: string;
      params?: QueryParam[];
      schema?: string;
      clusterId?: string;
    }
  ): Promise<QueryResult<T>> {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (transaction.state !== 'prepared') {
      throw new Error(
        `Transaction ${transactionId} is in ${transaction.state} state, cannot execute operations`
      );
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
      throw new Error(
        `No connection available for cluster ${targetCluster} in transaction ${transactionId}`
      );
    }

    try {
      const result = await connection.query(operation.sql, operation.params || []);
      return result as QueryResult<T>;
    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    }
  }

  async commit(transactionId: string): Promise<void> {
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
      } else {
        // Single cluster transaction
        await this.singleClusterCommit(transaction);
      }

      transaction.state = 'committed';
      this.metrics.active--;
      this.metrics.committed++;

      const duration = Date.now() - startTime;
      this.updateAvgDuration(duration);

      this.emit('transactionCommitted', { transactionId, duration });
    } catch (error) {
      transaction.state = 'aborted';
      await this.rollbackConnections(transaction);

      this.metrics.active--;
      this.metrics.aborted++;

      const duration = Date.now() - startTime;
      this.emit('transactionAborted', {
        transactionId,
        reason: (error as Error).message,
        duration,
      });

      throw error;
    } finally {
      this.releaseConnections(transaction);
      this.activeTransactions.delete(transactionId);
    }
  }

  async rollback(transactionId: string): Promise<void> {
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
        duration,
      });
    } finally {
      this.releaseConnections(transaction);
      this.activeTransactions.delete(transactionId);
    }
  }

  getMetrics(): TransactionMetrics {
    return { ...this.metrics };
  }

  async close(): Promise<void> {
    // Rollback all active transactions
    const activeIds = Array.from(this.activeTransactions.keys());

    for (const transactionId of activeIds) {
      try {
        await this.rollback(transactionId);
      } catch (error) {
        this.emit('error', error as Error);
      }
    }

    this.activeTransactions.clear();
  }

  private async twoPhaseCommit(transaction: DistributedTransactionState): Promise<void> {
    // Phase 1: Prepare all clusters
    const preparePromises = Array.from(transaction.connections.entries()).map(
      async ([clusterId, connection]) => {
        try {
          await connection.query('PREPARE TRANSACTION $1', [transaction.id]);
          return { clusterId, success: true };
        } catch (error) {
          return { clusterId, success: false, error };
        }
      }
    );

    const prepareResults = await Promise.all(preparePromises);
    const failedPrepares = prepareResults.filter(result => !result.success);

    if (failedPrepares.length > 0) {
      // Abort prepared transactions
      await this.abortPreparedTransactions(transaction, prepareResults);
      throw new Error(
        `Prepare phase failed on clusters: ${failedPrepares.map(f => f.clusterId).join(', ')}`
      );
    }

    // Phase 2: Commit all clusters
    const commitPromises = Array.from(transaction.connections.entries()).map(
      async ([clusterId, connection]) => {
        try {
          await connection.query('COMMIT PREPARED $1', [transaction.id]);
          return { clusterId, success: true };
        } catch (error) {
          return { clusterId, success: false, error };
        }
      }
    );

    const commitResults = await Promise.all(commitPromises);
    const failedCommits = commitResults.filter(result => !result.success);

    if (failedCommits.length > 0) {
      console.warn(
        `Commit phase partially failed on clusters: ${failedCommits.map(f => f.clusterId).join(', ')}`
      );
      // Note: In a real implementation, you would need recovery mechanisms here
    }
  }

  private async singleClusterCommit(transaction: DistributedTransactionState): Promise<void> {
    const [connection] = transaction.connections.values();
    await connection.query('COMMIT');
  }

  private async abortPreparedTransactions(
    transaction: DistributedTransactionState,
    prepareResults: any[]
  ): Promise<void> {
    const abortPromises = prepareResults
      .filter(result => result.success)
      .map(async result => {
        const connection = transaction.connections.get(result.clusterId);
        if (connection) {
          try {
            await connection.query('ROLLBACK PREPARED $1', [transaction.id]);
          } catch (error) {
            console.warn(`Failed to abort prepared transaction on ${result.clusterId}:`, error);
          }
        }
      });

    await Promise.all(abortPromises);
  }

  private async rollbackConnections(transaction: DistributedTransactionState): Promise<void> {
    const rollbackPromises = Array.from(transaction.connections.values()).map(async connection => {
      try {
        await connection.query('ROLLBACK');
      } catch (error) {
        // Connection might already be closed or in an error state
        console.warn('Failed to rollback connection:', error);
      }
    });

    await Promise.all(rollbackPromises);
  }

  private releaseConnections(transaction: DistributedTransactionState): void {
    for (const connection of transaction.connections.values()) {
      try {
        connection.release();
      } catch (error) {
        console.warn('Failed to release connection:', error);
      }
    }

    transaction.connections.clear();
  }

  private getClusterForSchema(schema: string): string | undefined {
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

  private updateAvgDuration(duration: number): void {
    const totalTransactions = this.metrics.committed + this.metrics.aborted;
    if (totalTransactions === 0) {
      this.metrics.avgDuration = duration;
    } else {
      this.metrics.avgDuration =
        (this.metrics.avgDuration * (totalTransactions - 1) + duration) / totalTransactions;
    }
  }
}
