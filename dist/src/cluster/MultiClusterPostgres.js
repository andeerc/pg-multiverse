"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiClusterPostgres = void 0;
const events_1 = require("events");
const ClusterManager_1 = require("./ClusterManager");
const ClusterConfig_1 = require("./ClusterConfig");
const DistributedCache_1 = require("./DistributedCache");
const DistributedTransaction_1 = require("./DistributedTransaction");
const cache_1 = require("../cache");
/**
 * Classe principal para gerenciamento de múltiplos clusters PostgreSQL
 * com suporte a multi-schema, caching distribuído e transações
 */
class MultiClusterPostgres extends events_1.EventEmitter {
    constructor(config = {}) {
        super();
        this.isInitialized = false;
        this.config = {
            enableCache: true,
            enableMetrics: true,
            enableTransactions: true,
            cluster: {},
            cache: {},
            configPath: config.configPath || '',
            ...config
        };
        this.clusterManager = new ClusterManager_1.ClusterManager(config.cluster);
        this.clusterConfig = new ClusterConfig_1.ClusterConfig(config.configPath);
        this.cache = null;
        this.legacyCache = null;
        this.transactionManager = null;
        this.schemas = new Map();
        this._setupEventHandlers();
    }
    /**
     * Inicializa o sistema com configuração
     */
    async initialize(clusterConfigs) {
        if (this.isInitialized) {
            throw new Error('MultiClusterPostgres already initialized');
        }
        try {
            // Carrega configuração
            let configs = clusterConfigs;
            if (!configs && this.config.configPath) {
                configs = await this.clusterConfig.loadConfig();
            }
            if (!configs) {
                throw new Error('No cluster configuration provided');
            }
            // Inicializa cluster manager
            await this.clusterManager.initialize(configs);
            // Mapeia schemas para clusters
            this._mapSchemasFromConfig(configs);
            // Inicializa cache se habilitado
            if (this.config.enableCache) {
                await this._initializeCache();
            }
            // Inicializa transaction manager se habilitado
            if (this.config.enableTransactions) {
                this.transactionManager = new DistributedTransaction_1.DistributedTransaction(this.clusterManager);
                await this.transactionManager.initialize();
            }
            this.isInitialized = true;
            this.emit('initialized', {
                clusters: Array.from(this.clusterManager.getClusters().keys()),
                schemas: Array.from(this.schemas.keys())
            });
            console.log(`MultiClusterPostgres initialized with ${this.clusterManager.getClusters().size} clusters and ${this.schemas.size} schemas`);
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    /**
     * Executa query com roteamento automático
     */
    async query(sql, params = [], options = {}) {
        this._ensureInitialized();
        const { schema, clusterId, cache: useCache = false, cacheTtl, cacheKey, operation = this._detectOperation(sql) } = options;
        // Tenta cache primeiro (apenas para reads)
        if (useCache && operation === 'read' && (this.cache || this.legacyCache)) {
            const key = cacheKey || this._generateCacheKey(sql, params, schema);
            const cacheProvider = this.cache || this.legacyCache;
            const cachedResult = await cacheProvider.get(key);
            if (cachedResult) {
                this.emit('cacheHit', { key, schema, clusterId });
                return cachedResult;
            }
            else {
                this.emit('cacheMiss', { key, schema, clusterId });
            }
        }
        try {
            // Executa query
            const startTime = Date.now();
            const result = await this.clusterManager.executeQuery(sql, params, options);
            const duration = Date.now() - startTime;
            // Armazena no cache se configurado
            if (useCache && operation === 'read' && (this.cache || this.legacyCache) && result) {
                const key = cacheKey || this._generateCacheKey(sql, params, schema);
                const cacheProvider = this.cache || this.legacyCache;
                await cacheProvider.set(key, result, {
                    ttl: cacheTtl,
                    tags: schema ? [schema] : undefined,
                    schema,
                    cluster: clusterId
                });
            }
            this.emit('queryExecuted', {
                sql,
                params,
                duration,
                clusterId: result.clusterId || 'unknown'
            });
            return result;
        }
        catch (error) {
            this.emit('queryError', {
                sql,
                params,
                error: error,
                clusterId: clusterId || 'unknown'
            });
            throw error;
        }
    }
    /**
     * Obtém conexão para uso direto
     */
    async getConnection(options = {}) {
        this._ensureInitialized();
        return this.clusterManager.getConnection(options);
    }
    /**
     * Inicia transação (simples ou distribuída)
     */
    async beginTransaction(schemas, options = {}) {
        this._ensureInitialized();
        if (!this.transactionManager) {
            throw new Error('Transactions not enabled');
        }
        const schemaList = Array.isArray(schemas) ? schemas : [schemas];
        return this.transactionManager.begin(schemaList, options);
    }
    /**
     * Executa operação dentro de transação
     */
    async executeInTransaction(transactionId, sql, params = [], options = {}) {
        this._ensureInitialized();
        if (!this.transactionManager) {
            throw new Error('Transactions not enabled');
        }
        return this.transactionManager.execute(transactionId, {
            sql,
            params,
            ...options
        });
    }
    /**
     * Confirma transação
     */
    async commitTransaction(transactionId) {
        this._ensureInitialized();
        if (!this.transactionManager) {
            throw new Error('Transactions not enabled');
        }
        return this.transactionManager.commit(transactionId);
    }
    /**
     * Desfaz transação
     */
    async rollbackTransaction(transactionId) {
        this._ensureInitialized();
        if (!this.transactionManager) {
            throw new Error('Transactions not enabled');
        }
        return this.transactionManager.rollback(transactionId);
    }
    /**
     * Executa função dentro de transação automática
     */
    async withTransaction(schemas, callback, options = {}) {
        const transactionId = await this.beginTransaction(schemas, options);
        try {
            const context = {
                query: (sql, params, opts) => this.executeInTransaction(transactionId, sql, params || [], opts || {}),
                transactionId
            };
            const result = await callback(context);
            await this.commitTransaction(transactionId);
            return result;
        }
        catch (error) {
            await this.rollbackTransaction(transactionId);
            throw error;
        }
    }
    /**
     * Adiciona schema dinamicamente
     */
    registerSchema(schema, clusterId, options = {}) {
        this._ensureInitialized();
        const mapping = {
            clusterId,
            ...options
        };
        this.clusterConfig.mapSchemaToCluster(schema, clusterId, options);
        this.schemas.set(schema, mapping);
        this.emit('schemaRegistered', { schema, clusterId, options: mapping });
    }
    /**
     * Invalida cache por critério
     */
    async invalidateCache(criteria) {
        const cacheProvider = this.cache || this.legacyCache;
        if (!cacheProvider)
            return 0;
        if (criteria.schema) {
            return cacheProvider.invalidateBySchema(criteria.schema);
        }
        if (criteria.tags) {
            return cacheProvider.invalidateByTags(criteria.tags);
        }
        if (criteria.cluster) {
            return cacheProvider.invalidateByCluster(criteria.cluster);
        }
        if (criteria.pattern) {
            return cacheProvider.invalidateByPattern(criteria.pattern);
        }
        return 0;
    }
    /**
     * Obtém métricas do sistema
     */
    getMetrics() {
        this._ensureInitialized();
        const clusterMetrics = this.clusterManager.getMetrics();
        const cacheProvider = this.cache || this.legacyCache;
        const cacheStats = cacheProvider?.getStats();
        const transactionMetrics = this.transactionManager?.getMetrics();
        const totalQueries = Object.values(clusterMetrics).reduce((sum, cluster) => sum + cluster.queries.total, 0);
        const totalErrors = Object.values(clusterMetrics).reduce((sum, cluster) => sum + cluster.queries.errors, 0);
        const avgResponseTime = Object.values(clusterMetrics).reduce((sum, cluster, _, arr) => sum + (cluster.queries.avgResponseTime / arr.length), 0);
        return {
            clusters: clusterMetrics,
            cache: cacheStats,
            transactions: transactionMetrics,
            uptime: process.uptime(),
            totalQueries,
            avgResponseTime,
            errorRate: totalQueries > 0 ? (totalErrors / totalQueries) * 100 : 0
        };
    }
    /**
     * Executa health check em todos os clusters
     */
    async healthCheck() {
        this._ensureInitialized();
        const clusterHealth = {};
        for (const [clusterId] of this.clusterManager.getClusters().entries()) {
            try {
                await this.clusterManager.forceHealthCheck(clusterId);
                clusterHealth[clusterId] = this.clusterManager.getClusterHealth(clusterId);
            }
            catch (error) {
                clusterHealth[clusterId] = {
                    clusterId,
                    healthy: false,
                    lastCheck: new Date(),
                    responseTime: 0,
                    failureCount: 0,
                    uptime: 0,
                    connections: { active: 0, idle: 0, total: 0 },
                    queries: { total: 0, successful: 0, failed: 0, avgResponseTime: 0 },
                    error: error.message
                };
            }
        }
        return clusterHealth;
    }
    /**
     * Valida configuração
     */
    validateConfig() {
        this._ensureInitialized();
        return this.clusterConfig.validate();
    }
    /**
     * Fecha todas as conexões e limpa recursos
     */
    async close() {
        if (!this.isInitialized) {
            return;
        }
        try {
            // Para transaction manager
            if (this.transactionManager) {
                await this.transactionManager.close();
            }
            // Para cluster manager
            await this.clusterManager.close();
            // Para cache
            if (this.cache) {
                await this.cache.close();
            }
            // Para cache legado
            if (this.legacyCache) {
                await this.legacyCache.close();
            }
            // Para observação de arquivos de config
            this.clusterConfig.stopWatching();
            this.isInitialized = false;
            this.emit('closed');
            console.log('MultiClusterPostgres closed');
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    // ==================== MÉTODOS PRIVADOS ====================
    async _initializeCache() {
        if (!this.config.cache) {
            return;
        }
        try {
            const cacheConfig = {
                provider: 'memory', // Default to memory
                ...this.config.cache,
            };
            const factory = cache_1.CacheFactory.getInstance();
            this.cache = await factory.createProviderWithFallback(cacheConfig);
            // Setup cache event forwarding
            this.cache.on('hit', (key) => this.emit('cacheHit', { key }));
            this.cache.on('miss', (key) => this.emit('cacheMiss', { key }));
            this.cache.on('eviction', (data) => this.emit('cacheEviction', data));
            this.cache.on('error', (error) => this.emit('error', error));
            console.log(`Cache initialized with provider: ${cacheConfig.provider}`);
        }
        catch (error) {
            // Fallback to legacy cache if new cache fails
            console.warn('Failed to initialize new cache system, falling back to legacy cache:', error);
            this.legacyCache = new DistributedCache_1.DistributedCache(this.config.cache);
            await this.legacyCache.initialize();
            this.emit('error', new Error('Using legacy cache due to initialization failure'));
        }
    }
    _setupEventHandlers() {
        this.clusterManager.on('error', (error) => this.emit('error', error));
        this.clusterManager.on('clusterDown', (data) => this.emit('clusterDown', data));
        this.clusterManager.on('clusterUp', (data) => this.emit('clusterUp', data));
        this.clusterManager.on('clusterRecovered', (data) => this.emit('clusterRecovered', data));
        this.clusterConfig.on('configChanged', () => this._handleConfigChange());
        // Legacy cache events (for backwards compatibility)
        if (this.legacyCache) {
            this.legacyCache.on('error', (error) => this.emit('error', error));
            this.legacyCache.on('eviction', (data) => this.emit('cacheEviction', data));
        }
    }
    async _handleConfigChange() {
        try {
            const configs = await this.clusterConfig.loadConfig();
            await this.clusterManager.updateConfig(configs);
            this._mapSchemasFromConfig(configs);
            this.emit('configReloaded', {
                clusters: this.clusterManager.getClusters().size,
                schemas: this.schemas.size
            });
        }
        catch (error) {
            this.emit('error', error);
        }
    }
    _mapSchemasFromConfig(configs) {
        this.schemas.clear();
        for (const [clusterId, config] of Object.entries(configs)) {
            if (config.schemas && Array.isArray(config.schemas)) {
                for (const schema of config.schemas) {
                    this.schemas.set(schema, {
                        clusterId,
                        shardKey: config.shardKey,
                        cacheStrategy: config.cacheStrategy || 'conservative',
                        priority: config.priority || 1
                    });
                }
            }
        }
    }
    _ensureInitialized() {
        if (!this.isInitialized) {
            throw new Error('MultiClusterPostgres not initialized. Call initialize() first.');
        }
    }
    _detectOperation(sql) {
        const normalizedSql = sql.trim().toLowerCase();
        if (normalizedSql.startsWith('select') ||
            normalizedSql.startsWith('with') ||
            normalizedSql.startsWith('explain')) {
            return 'read';
        }
        if (normalizedSql.startsWith('insert') ||
            normalizedSql.startsWith('update') ||
            normalizedSql.startsWith('delete') ||
            normalizedSql.startsWith('merge')) {
            return 'write';
        }
        return 'read'; // Default para operações desconhecidas
    }
    _generateCacheKey(sql, params, schema) {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        const paramsStr = params.length > 0 ? JSON.stringify(params) : '';
        const schemaStr = schema || '';
        // Hash simples para chave de cache
        const data = `${normalizedSql}|${paramsStr}|${schemaStr}`;
        return `query:${this._simpleHash(data)}`;
    }
    _simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }
}
exports.MultiClusterPostgres = MultiClusterPostgres;
//# sourceMappingURL=MultiClusterPostgres.js.map