"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusterConfig = void 0;
const events_1 = require("events");
const fs_1 = require("fs");
/**
 * Gerenciador de configuração para clusters PostgreSQL
 * com suporte a recarregamento dinâmico e validação
 */
class ClusterConfig extends events_1.EventEmitter {
    constructor(configPath) {
        super();
        this.config = {};
        this.isWatching = false;
        this.lastModified = new Date();
        this.configPath = configPath;
        if (configPath) {
            this._watchConfigFile();
        }
    }
    /**
     * Carrega configuração do arquivo
     */
    async loadConfig() {
        if (!this.configPath) {
            throw new Error('No config path provided');
        }
        try {
            const configData = (0, fs_1.readFileSync)(this.configPath, 'utf8');
            this.config = JSON.parse(configData);
            const validation = this.validate();
            if (!validation.valid) {
                this.emit('validationError', validation.errors);
                throw new Error(`Config validation failed: ${validation.errors.join(', ')}`);
            }
            this.lastModified = new Date();
            this.emit('configLoaded', this.config);
            return this.config;
        }
        catch (error) {
            const err = error;
            this.emit('error', err);
            throw new Error(`Failed to load config from ${this.configPath}: ${err.message}`);
        }
    }
    /**
     * Salva configuração no arquivo
     */
    async saveConfig(config, path) {
        const targetPath = path || this.configPath;
        if (!targetPath) {
            throw new Error('No config path provided');
        }
        try {
            // Valida antes de salvar
            this.config = config;
            const validation = this.validate();
            if (!validation.valid) {
                throw new Error(`Config validation failed: ${validation.errors.join(', ')}`);
            }
            (0, fs_1.writeFileSync)(targetPath, JSON.stringify(config, null, 2), 'utf8');
            this.emit('configSaved', targetPath);
        }
        catch (error) {
            const err = error;
            this.emit('error', err);
            throw new Error(`Failed to save config to ${targetPath}: ${err.message}`);
        }
    }
    /**
     * Obtém configuração atual
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Obtém configuração de um cluster específico
     */
    getClusterConfig(clusterId) {
        return this.config[clusterId];
    }
    /**
     * Obtém todos os clusters configurados
     */
    getClusters() {
        return Object.keys(this.config);
    }
    /**
     * Mapeia schema para cluster
     */
    mapSchemaToCluster(schema, clusterId, options = {}) {
        if (!this.config[clusterId]) {
            throw new Error(`Cluster ${clusterId} not found in config`);
        }
        // Atualiza mapeamento no cluster
        if (!this.config[clusterId].schemas) {
            this.config[clusterId].schemas = [];
        }
        if (!this.config[clusterId].schemas.includes(schema)) {
            this.config[clusterId].schemas.push(schema);
        }
        // Adiciona opções específicas do schema
        if (Object.keys(options).length > 0) {
            if (!this.config[clusterId].schemaOptions) {
                this.config[clusterId].schemaOptions = {};
            }
            this.config[clusterId].schemaOptions[schema] = options;
        }
    }
    /**
     * Remove mapeamento de schema
     */
    unmapSchemaFromCluster(schema, clusterId) {
        if (!this.config[clusterId]) {
            return;
        }
        if (this.config[clusterId].schemas) {
            const index = this.config[clusterId].schemas.indexOf(schema);
            if (index > -1) {
                this.config[clusterId].schemas.splice(index, 1);
            }
        }
        if (this.config[clusterId].schemaOptions) {
            delete this.config[clusterId].schemaOptions[schema];
        }
    }
    /**
     * Encontra cluster por schema
     */
    getClusterForSchema(schema) {
        for (const [clusterId, config] of Object.entries(this.config)) {
            if (config.schemas && config.schemas.includes(schema)) {
                return clusterId;
            }
        }
        return undefined;
    }
    /**
     * Valida a configuração
     */
    validate() {
        const errors = [];
        const warnings = [];
        // Verifica se há pelo menos um cluster
        if (Object.keys(this.config).length === 0) {
            errors.push('No clusters configured');
        }
        for (const [clusterId, clusterConfig] of Object.entries(this.config)) {
            // Valida configuração básica do cluster
            if (!clusterConfig.primary) {
                errors.push(`Cluster ${clusterId}: No primary connection configured`);
            }
            else {
                // Valida conexão primária
                const primaryErrors = this._validateConnection(clusterConfig.primary, `${clusterId}.primary`);
                errors.push(...primaryErrors);
            }
            // Valida réplicas se configuradas
            if (clusterConfig.replicas && Array.isArray(clusterConfig.replicas)) {
                clusterConfig.replicas.forEach((replica, index) => {
                    const replicaErrors = this._validateConnection(replica, `${clusterId}.replicas[${index}]`);
                    errors.push(...replicaErrors);
                });
            }
            else if (!clusterConfig.replicas) {
                warnings.push(`Cluster ${clusterId}: No replicas configured - no read scaling available`);
            }
            // Valida schemas
            if (!clusterConfig.schemas || !Array.isArray(clusterConfig.schemas)) {
                warnings.push(`Cluster ${clusterId}: No schemas configured`);
            }
            else if (clusterConfig.schemas.length === 0) {
                warnings.push(`Cluster ${clusterId}: Empty schemas array`);
            }
            // Valida sharding se configurado
            if (clusterConfig.sharding) {
                const shardingErrors = this._validateSharding(clusterConfig.sharding, clusterId);
                errors.push(...shardingErrors);
            }
            // Valida load balancing se configurado
            if (clusterConfig.loadBalancing) {
                const lbErrors = this._validateLoadBalancing(clusterConfig.loadBalancing, clusterId);
                errors.push(...lbErrors);
            }
        }
        // Verifica duplicação de schemas
        const allSchemas = [];
        for (const clusterConfig of Object.values(this.config)) {
            if (clusterConfig.schemas) {
                allSchemas.push(...clusterConfig.schemas);
            }
        }
        const duplicateSchemas = allSchemas.filter((schema, index, arr) => arr.indexOf(schema) !== index);
        if (duplicateSchemas.length > 0) {
            errors.push(`Duplicate schemas found: ${[...new Set(duplicateSchemas)].join(', ')}`);
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
    /**
     * Para observação do arquivo de configuração
     */
    stopWatching() {
        if (this.isWatching && this.configPath) {
            (0, fs_1.unwatchFile)(this.configPath);
            this.isWatching = false;
        }
    }
    /**
     * Fecha o gerenciador de configuração
     */
    close() {
        this.stopWatching();
        this.removeAllListeners();
    }
    // ==================== MÉTODOS PRIVADOS ====================
    _watchConfigFile() {
        if (!this.configPath || this.isWatching) {
            return;
        }
        try {
            (0, fs_1.watchFile)(this.configPath, { interval: 1000 }, (curr, prev) => {
                if (curr.mtime > prev.mtime && curr.mtime > this.lastModified) {
                    this._handleConfigChange();
                }
            });
            this.isWatching = true;
        }
        catch (error) {
            this.emit('error', error);
        }
    }
    async _handleConfigChange() {
        try {
            await this.loadConfig();
            this.emit('configChanged');
        }
        catch (error) {
            this.emit('error', error);
        }
    }
    _validateConnection(connection, path) {
        const errors = [];
        if (!connection) {
            errors.push(`${path}: Connection config is required`);
            return errors;
        }
        if (!connection.host) {
            errors.push(`${path}: host is required`);
        }
        if (!connection.port) {
            errors.push(`${path}: port is required`);
        }
        else if (typeof connection.port !== 'number' || connection.port < 1 || connection.port > 65535) {
            errors.push(`${path}: port must be a number between 1 and 65535`);
        }
        if (!connection.database) {
            errors.push(`${path}: database is required`);
        }
        if (!connection.user) {
            errors.push(`${path}: user is required`);
        }
        if (!connection.password) {
            errors.push(`${path}: password is required`);
        }
        if (connection.maxConnections !== undefined &&
            (typeof connection.maxConnections !== 'number' || connection.maxConnections < 1)) {
            errors.push(`${path}: maxConnections must be a positive number`);
        }
        return errors;
    }
    _validateSharding(sharding, clusterId) {
        const errors = [];
        const path = `Cluster ${clusterId}.sharding`;
        if (!sharding.strategy) {
            errors.push(`${path}: strategy is required`);
        }
        else if (!['hash', 'range', 'directory'].includes(sharding.strategy)) {
            errors.push(`${path}: strategy must be one of: hash, range, directory`);
        }
        if (!sharding.key) {
            errors.push(`${path}: key is required`);
        }
        if (sharding.strategy === 'hash' && !sharding.partitions) {
            errors.push(`${path}: partitions is required for hash strategy`);
        }
        if (sharding.strategy === 'range' && !sharding.ranges) {
            errors.push(`${path}: ranges is required for range strategy`);
        }
        if (sharding.strategy === 'directory' && !sharding.directory) {
            errors.push(`${path}: directory is required for directory strategy`);
        }
        return errors;
    }
    _validateLoadBalancing(loadBalancing, clusterId) {
        const errors = [];
        const path = `Cluster ${clusterId}.loadBalancing`;
        if (!loadBalancing.strategy) {
            errors.push(`${path}: strategy is required`);
        }
        else if (!['round_robin', 'weighted', 'least_connections', 'response_time', 'health_aware'].includes(loadBalancing.strategy)) {
            errors.push(`${path}: invalid strategy`);
        }
        if (loadBalancing.strategy === 'weighted' && !loadBalancing.weights) {
            errors.push(`${path}: weights are required for weighted strategy`);
        }
        return errors;
    }
}
exports.ClusterConfig = ClusterConfig;
//# sourceMappingURL=ClusterConfig.js.map