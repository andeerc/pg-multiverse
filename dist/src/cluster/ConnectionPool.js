"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionPool = void 0;
const events_1 = require("events");
const pg_1 = require("pg");
class ConnectionPool extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.isReady = false;
        this.isClosed = false;
        this.config = {
            min: 2,
            max: 20,
            acquireTimeoutMillis: 30000,
            createTimeoutMillis: 10000,
            idleTimeoutMillis: 300000,
            warmupConnections: true,
            ...config
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
            total: 0
        };
        this._createPool();
    }
    async getConnection() {
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
        }
        catch (error) {
            this.emit('error', error, this.poolId);
            throw error;
        }
    }
    async query(sql, params = []) {
        const client = await this.getConnection();
        try {
            const result = await client.query(sql, params);
            return result;
        }
        finally {
            client.release();
        }
    }
    async testConnection() {
        try {
            const client = await this.getConnection();
            await client.query('SELECT 1');
            client.release();
            return true;
        }
        catch (error) {
            this.emit('error', error, this.poolId);
            return false;
        }
    }
    getMetrics() {
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
                waiting: this.pool.waitingCount
            }
        };
    }
    getId() {
        return this.poolId;
    }
    getInfo() {
        return {
            poolId: this.poolId,
            clusterId: this.clusterId,
            role: this.role,
            replicaIndex: this.replicaIndex,
            isReady: this.isReady,
            isClosed: this.isClosed
        };
    }
    async warmup() {
        if (!this.config.warmupConnections || this.isClosed) {
            return;
        }
        const minConnections = this.config.min || 2;
        const warmupPromises = [];
        for (let i = 0; i < minConnections; i++) {
            warmupPromises.push(this.getConnection()
                .then(client => {
                setTimeout(() => client.release(), 100);
            })
                .catch(error => {
                this.emit('error', error, this.poolId);
            }));
        }
        try {
            await Promise.all(warmupPromises);
            console.log(`Pool ${this.poolId} warmed up with ${minConnections} connections`);
        }
        catch (error) {
            console.warn(`Failed to warm up pool ${this.poolId}:`, error);
        }
    }
    async close() {
        if (this.isClosed) {
            return;
        }
        this.isClosed = true;
        this.isReady = false;
        try {
            await this.pool.end();
            this.emit('poolClosed', this.poolId);
            console.log(`Pool ${this.poolId} closed`);
        }
        catch (error) {
            this.emit('error', error, this.poolId);
            throw error;
        }
    }
    _createPool() {
        const poolConfig = {
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            user: this.config.user,
            password: this.config.password,
            min: this.config.min,
            max: this.config.max,
            idleTimeoutMillis: this.config.idleTimeoutMillis,
            ssl: this.config.ssl
        };
        if (this.config.searchPath) {
            poolConfig.options = `-c search_path=${this.config.searchPath.join(',')}`;
        }
        this.pool = new pg_1.Pool(poolConfig);
        this._setupPoolEvents();
        this._initialize();
    }
    _setupPoolEvents() {
        this.pool.on('connect', () => {
            this.metrics.created++;
            this.emit('connectionCreated', this.poolId);
        });
        this.pool.on('remove', () => {
            this.metrics.destroyed++;
            this.emit('connectionDestroyed', this.poolId);
        });
        this.pool.on('error', (error) => {
            this.emit('error', error, this.poolId);
        });
    }
    async _initialize() {
        try {
            await this.testConnection();
            if (this.config.warmupConnections) {
                await this.warmup();
            }
            this.isReady = true;
            this.emit('poolReady', this.poolId);
        }
        catch (error) {
            this.emit('error', error, this.poolId);
        }
    }
    async _waitForReady(timeoutMs = 30000) {
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
                }
                else if (this.isClosed) {
                    clearTimeout(timeout);
                    reject(new Error(`Pool ${this.poolId} was closed while waiting for ready`));
                }
                else {
                    setTimeout(checkReady, 100);
                }
            };
            checkReady();
        });
    }
    _wrapClient(client) {
        const originalRelease = client.release.bind(client);
        client.release = (err) => {
            this.metrics.released++;
            this.emit('connectionReleased', this.poolId);
            return originalRelease(err);
        };
        return client;
    }
    _generatePoolId() {
        const suffix = this.role === 'replica' && this.replicaIndex !== undefined
            ? `_replica_${this.replicaIndex}`
            : `_${this.role}`;
        return `${this.clusterId}${suffix}`;
    }
}
exports.ConnectionPool = ConnectionPool;
//# sourceMappingURL=ConnectionPool.js.map