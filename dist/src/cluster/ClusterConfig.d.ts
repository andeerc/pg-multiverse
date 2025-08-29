/// <reference types="node" />
import { EventEmitter } from 'events';
import { ClusterConfig as ClusterConfigType, ValidationResult, SchemaMapping } from '../types';
/**
 * Gerenciador de configuração para clusters PostgreSQL
 * com suporte a recarregamento dinâmico e validação
 */
export declare class ClusterConfig extends EventEmitter {
    private configPath?;
    private config;
    private isWatching;
    private lastModified;
    constructor(configPath?: string);
    /**
     * Carrega configuração do arquivo
     */
    loadConfig(): Promise<Record<string, any>>;
    /**
     * Salva configuração no arquivo
     */
    saveConfig(config: Record<string, any>, path?: string): Promise<void>;
    /**
     * Obtém configuração atual
     */
    getConfig(): Record<string, any>;
    /**
     * Obtém configuração de um cluster específico
     */
    getClusterConfig(clusterId: string): ClusterConfigType | undefined;
    /**
     * Obtém todos os clusters configurados
     */
    getClusters(): string[];
    /**
     * Mapeia schema para cluster
     */
    mapSchemaToCluster(schema: string, clusterId: string, options?: Partial<SchemaMapping>): void;
    /**
     * Remove mapeamento de schema
     */
    unmapSchemaFromCluster(schema: string, clusterId: string): void;
    /**
     * Encontra cluster por schema
     */
    getClusterForSchema(schema: string): string | undefined;
    /**
     * Valida a configuração
     */
    validate(): ValidationResult;
    /**
     * Para observação do arquivo de configuração
     */
    stopWatching(): void;
    /**
     * Fecha o gerenciador de configuração
     */
    close(): void;
    private _watchConfigFile;
    private _handleConfigChange;
    private _validateConnection;
    private _validateSharding;
    private _validateLoadBalancing;
}
//# sourceMappingURL=ClusterConfig.d.ts.map