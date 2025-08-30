import { EventEmitter } from 'events';
import { Pool, PoolClient, PoolConfig } from 'pg';
import { DatabaseConnection, ConnectionPoolConfig, TypedEventEmitter } from '../types';

interface ConnectionPoolEvents {
  connectionCreated: (poolId: string) => void;
  connectionDestroyed: (poolId: string) => void;
  connectionAcquired: (poolId: string) => void;
  connectionReleased: (poolId: string) => void;
  error: (error: Error, poolId: string) => void;
  poolReady: (poolId: string) => void;
  poolClosed: (poolId: string) => void;
  [key: string]: (...args: any[]) => void;
}

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

export class ConnectionPool extends EventEmitter {
  private pool!: Pool;
  private config: DatabaseConnection & ConnectionPoolConfig;
  private poolId: string;
  private clusterId: string;
  private role: 'primary' | 'replica';
  private replicaIndex?: number;
  private isReady: boolean = false;
  private isClosed: boolean = false;
  private metrics: PoolMetrics;

  constructor(
    config: DatabaseConnection &
      ConnectionPoolConfig & {
        clusterId: string;
        role: 'primary' | 'replica';
        replicaIndex?: number;
      }
  ) {
    super();

    this.config = {
      min: 2,
      max: 20,
      acquireTimeoutMillis: 30000,
      createTimeoutMillis: 10000,
      idleTimeoutMillis: 300000,
      warmupConnections: true,
      ...config,
    };

    this.clusterId = config.clusterId;
    this.role = config.role;
    this.replicaIndex = config.replicaIndex;
    this.poolId = this._generatePoolId();

    this.metrics = {
      created: 0,
      destroyed: 0,
      acquired: 0,
      released: 0,
      active: 0,
      idle: 0,
      waiting: 0,
      total: 0,
    };

    this._createPool();
    
    // Inicialização assíncrona não-bloqueante
    this._initialize().catch(error => {
      this.emit('error', error, this.poolId);
      // Não re-lançar o erro para não quebrar a aplicação
    });
  }

  async getConnection(): Promise<PoolClient> {
    if (this.isClosed) {
      throw new Error(`Connection pool ${this.poolId} is closed`);
    }

    if (!this.isReady) {
      await this._waitForReady();
    }

    try {
      const client = await this.pool.connect();
      const wrappedClient = this._wrapClient(client);

      this.metrics.acquired++;
      this.emit('connectionAcquired', this.poolId);

      return wrappedClient;
    } catch (error) {
      this.emit('error', error as Error, this.poolId);
      throw error;
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T> {
    const client = await this.getConnection();
    try {
      const result = await client.query(sql, params);
      return result as T;
    } finally {
      client.release();
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      return true;
    } catch (error) {
      this.emit('error', error as Error, this.poolId);
      return false;
    }
  }

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
  } {
    this.metrics.total = this.pool.totalCount;
    this.metrics.idle = this.pool.idleCount;
    this.metrics.waiting = this.pool.waitingCount;
    this.metrics.active = this.metrics.total - this.metrics.idle;

    return {
      ...this.metrics,
      poolId: this.poolId,
      clusterId: this.clusterId,
      role: this.role,
      config: {
        min: this.config.min || 0,
        max: this.config.max || 10,
        idle: this.pool.idleCount,
        waiting: this.pool.waitingCount,
      },
    };
  }

  getId(): string {
    return this.poolId;
  }

  getInfo(): {
    poolId: string;
    clusterId: string;
    role: string;
    replicaIndex?: number;
    isReady: boolean;
    isClosed: boolean;
  } {
    return {
      poolId: this.poolId,
      clusterId: this.clusterId,
      role: this.role,
      replicaIndex: this.replicaIndex,
      isReady: this.isReady,
      isClosed: this.isClosed,
    };
  }

  async warmup(): Promise<void> {
    if (!this.config.warmupConnections || this.isClosed) {
      return;
    }

    const minConnections = this.config.min || 2;
    const warmupPromises: Promise<void>[] = [];

    for (let i = 0; i < minConnections; i++) {
      warmupPromises.push(
        this.pool.connect()
          .then(client => {
            setTimeout(() => client.release(), 100);
          })
          .catch(error => {
            this.emit('error', error, this.poolId);
          })
      );
    }

    try {
      await Promise.all(warmupPromises);
    } catch (error) {
      // Silently handle warmup failures
    }
  }

  async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;
    this.isReady = false;

    try {
      await this.pool.end();
      this.emit('poolClosed', this.poolId);
    } catch (error) {
      this.emit('error', error as Error, this.poolId);
      throw error;
    }
  }

  private _createPool(): void {
    const poolConfig: PoolConfig = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      min: this.config.min,
      max: this.config.max,
      idleTimeoutMillis: this.config.idleTimeoutMillis,
      ssl: this.config.ssl,
    };

    if (this.config.searchPath) {
      poolConfig.options = `-c search_path=${this.config.searchPath.join(',')}`;
    }

    this.pool = new Pool(poolConfig);
    this._setupPoolEvents();
  }

  private _setupPoolEvents(): void {
    this.pool.on('connect', () => {
      this.metrics.created++;
      this.emit('connectionCreated', this.poolId);
    });

    this.pool.on('remove', () => {
      this.metrics.destroyed++;
      this.emit('connectionDestroyed', this.poolId);
    });

    this.pool.on('error', (error: Error) => {
      this.emit('error', error, this.poolId);
    });
  }

  private async _initialize(): Promise<void> {
    try {
      const connectionTest = await this.testConnection();
      
      if (!connectionTest) {
        throw new Error(`Failed to establish connection for pool ${this.poolId}`);
      }
      
      if (this.config.warmupConnections) {
        await this.warmup();
      }

      this.isReady = true;
      this.emit('poolReady', this.poolId);
    } catch (error) {
      this.emit('error', error as Error, this.poolId);
      // Não re-lançar o erro - deixa o pool em estado não-ready
    }
  }

  private async _waitForReady(timeoutMs: number = 30000): Promise<void> {
    if (this.isReady) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Pool ${this.poolId} not ready within ${timeoutMs}ms`));
      }, timeoutMs);

      const checkReady = () => {
        if (this.isReady) {
          clearTimeout(timeout);
          resolve();
        } else if (this.isClosed) {
          clearTimeout(timeout);
          reject(new Error(`Pool ${this.poolId} was closed while waiting for ready`));
        } else {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();
    });
  }

  private _wrapClient(client: PoolClient): PoolClient {
    const originalRelease = client.release.bind(client);

    client.release = (err?: Error | boolean) => {
      this.metrics.released++;
      this.emit('connectionReleased', this.poolId);
      return originalRelease(err);
    };

    return client;
  }

  private _generatePoolId(): string {
    const suffix =
      this.role === 'replica' && this.replicaIndex !== undefined
        ? `_replica_${this.replicaIndex}`
        : `_${this.role}`;

    return `${this.clusterId}${suffix}`;
  }
}
