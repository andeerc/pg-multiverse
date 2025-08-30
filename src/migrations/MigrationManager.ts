import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import {
  Migration,
  MigrationConfig,
  MigrationContext,
  MigrationRecord,
  MigrationState,
  MigrationStatus,
  MigrationExecutionOptions,
  MigrationRollbackOptions,
  MigrationLogger,
  MigrationManagerEvents,
  QueryParam,
  QueryResult,
} from '../types';
import { PgMultiverse } from '../cluster/MultiClusterPostgres';

/**
 * Gerenciador de migrations para PgMultiverse
 * Suporta múltiplos clusters e schemas com controle de versão
 */
export class MigrationManager extends EventEmitter {
  private pgMultiverse: PgMultiverse;
  private config: Required<MigrationConfig>;
  private migrations: Map<string, Migration> = new Map();
  private isInitialized: boolean = false;
  private logger: MigrationLogger;

  constructor(pgMultiverse: PgMultiverse, config: MigrationConfig = {}) {
    super();
    
    this.pgMultiverse = pgMultiverse;
    this.config = {
      migrationsPath: path.resolve(process.cwd(), 'migrations'),
      migrationsTable: 'pg_multiverse_migrations',
      lockTable: 'pg_multiverse_migration_locks',
      lockTimeout: 60000, // 1 minuto
      batchSize: 100,
      autoCreateMigrationsTable: true,
      validateChecksums: true,
      allowOutOfOrder: false,
      logger: this._createDefaultLogger(),
      ...config,
    };

    this.logger = this.config.logger;
  }

  /**
   * Inicializa o sistema de migrations
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('MigrationManager already initialized');
    }

    try {
      this.logger.info('Initializing MigrationManager');
      
      // Carrega migrations do diretório
      await this._loadMigrations();
      
      // Criação das tabelas será feita quando necessário

      this.isInitialized = true;
      this.logger.info('MigrationManager initialized successfully');
      
    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Executa migrations pendentes
   */
  async migrate(options: MigrationExecutionOptions = {}): Promise<MigrationStatus> {
    this._ensureInitialized();

    const {
      targetVersion,
      targetSchemas,
      targetClusters,
      dryRun = false,
      force = false,
      parallel = false,
      maxParallel = 5,
      continueOnError = false,
    } = options;

    this.logger.info('Starting migration process', { 
      targetVersion, 
      targetSchemas, 
      targetClusters, 
      dryRun 
    });

    try {
      // Obtém schemas e clusters a processar
      const schemasToProcess = await this._getTargetSchemas(targetSchemas);
      const clustersToProcess = await this._getTargetClusters(targetClusters);
      
      // Cria tabelas de controle se necessário
      if (this.config.autoCreateMigrationsTable && schemasToProcess.length > 0) {
        await this._createMigrationTables();
      }

      // Obtém migrations pendentes
      const pendingMigrations = await this._getPendingMigrations(
        schemasToProcess, 
        clustersToProcess, 
        targetVersion
      );

      this.logger.info(`Found ${pendingMigrations.length} pending migrations`);

      if (dryRun) {
        this.logger.info('DRY RUN - No changes will be applied');
        return this._generateStatus(schemasToProcess, clustersToProcess);
      }

      // Valida dependencies
      if (!force) {
        await this._validateDependencies(pendingMigrations);
      }

      // Executa migrations
      let executed = 0;
      const errors: Error[] = [];

      if (parallel) {
        // Execução paralela por schema/cluster
        executed = await this._executeParallel(
          pendingMigrations, 
          maxParallel, 
          continueOnError, 
          errors
        );
      } else {
        // Execução sequencial
        executed = await this._executeSequential(
          pendingMigrations, 
          continueOnError, 
          errors
        );
      }

      const status = await this._generateStatus(schemasToProcess, clustersToProcess);
      
      this.logger.info(`Migration process completed. ${executed} migrations executed.`);
      
      if (errors.length > 0) {
        this.logger.warn(`${errors.length} migrations failed`, { errors });
      }

      return status;

    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Executa rollback de migrations
   */
  async rollback(options: MigrationRollbackOptions = {}): Promise<MigrationStatus> {
    this._ensureInitialized();

    const {
      targetVersion,
      steps = 1,
      targetSchemas,
      targetClusters,
      dryRun = false,
      force = false,
    } = options;

    this.logger.info('Starting rollback process', { 
      targetVersion, 
      steps, 
      targetSchemas, 
      targetClusters, 
      dryRun 
    });

    try {
      const schemasToProcess = await this._getTargetSchemas(targetSchemas);
      const clustersToProcess = await this._getTargetClusters(targetClusters);
      
      // Obtém migrations para rollback
      const migrationsToRollback = await this._getMigrationsToRollback(
        schemasToProcess,
        clustersToProcess,
        targetVersion,
        steps
      );

      this.logger.info(`Found ${migrationsToRollback.length} migrations to rollback`);

      if (dryRun) {
        this.logger.info('DRY RUN - No rollbacks will be performed');
        return this._generateStatus(schemasToProcess, clustersToProcess);
      }

      // Executa rollbacks em ordem reversa
      let rolledBack = 0;
      const errors: Error[] = [];

      for (const migrationRecord of migrationsToRollback.reverse()) {
        try {
          await this._rollbackMigration(migrationRecord, force);
          rolledBack++;
        } catch (error) {
          this.logger.error(`Failed to rollback migration ${migrationRecord.version}`, error);
          errors.push(error as Error);
          if (!force) break;
        }
      }

      const status = await this._generateStatus(schemasToProcess, clustersToProcess);
      
      this.logger.info(`Rollback process completed. ${rolledBack} migrations rolled back.`);
      
      if (errors.length > 0) {
        this.logger.warn(`${errors.length} rollbacks failed`, { errors });
      }

      return status;

    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Obtém status das migrations
   */
  async getStatus(): Promise<MigrationStatus> {
    this._ensureInitialized();
    
    const allSchemas = await this._getAllSchemas();
    const allClusters = await this._getAllClusters();
    
    return this._generateStatus(allSchemas, allClusters);
  }

  /**
   * Adiciona uma migration programaticamente
   */
  addMigration(migration: Migration): void {
    this._validateMigration(migration);
    this.migrations.set(migration.version, migration);
    this.logger.debug(`Added migration ${migration.version}: ${migration.name}`);
  }

  /**
   * Remove uma migration
   */
  removeMigration(version: string): boolean {
    const removed = this.migrations.delete(version);
    if (removed) {
      this.logger.debug(`Removed migration ${version}`);
    }
    return removed;
  }

  /**
   * Lista todas as migrations carregadas
   */
  getMigrations(): Migration[] {
    return Array.from(this.migrations.values()).sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Cria uma nova migration file
   */
  async createMigration(name: string, options: {
    targetSchemas: string[];
    targetClusters?: string[];
    description?: string;
    tags?: string[];
  }): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    const version = `${timestamp}_${name}`;
    const filename = `${version}.ts`;
    const filepath = path.join(this.config.migrationsPath, filename);

    // Garante que o diretório existe
    await fs.promises.mkdir(this.config.migrationsPath, { recursive: true });

    const template = this._generateMigrationTemplate(version, name, options);
    
    await fs.promises.writeFile(filepath, template, 'utf8');
    
    this.logger.info(`Created migration file: ${filepath}`);
    return filepath;
  }

  /**
   * Fecha o migration manager
   */
  async close(): Promise<void> {
    if (!this.isInitialized) return;
    
    this.migrations.clear();
    this.isInitialized = false;
    this.logger.info('MigrationManager closed');
  }

  // ==================== MÉTODOS PRIVADOS ====================

  private _ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('MigrationManager not initialized. Call initialize() first.');
    }
  }

  private _createDefaultLogger(): MigrationLogger {
    return {
      info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
      warn: (message: string, meta?: any) => console.warn(`[WARN] ${message}`, meta || ''),
      error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
      debug: (message: string, meta?: any) => console.debug(`[DEBUG] ${message}`, meta || ''),
    };
  }

  private _validateMigration(migration: Migration): void {
    if (!migration.version) {
      throw new Error('Migration version is required');
    }
    if (!migration.name) {
      throw new Error('Migration name is required');
    }
    if (!Array.isArray(migration.targetSchemas) || migration.targetSchemas.length === 0) {
      throw new Error('Migration must target at least one schema');
    }
    if (typeof migration.up !== 'function') {
      throw new Error('Migration up function is required');
    }
    if (typeof migration.down !== 'function') {
      throw new Error('Migration down function is required');
    }
  }

  private async _loadMigrations(): Promise<void> {
    this.logger.info(`Loading migrations from ${this.config.migrationsPath}`);

    if (!fs.existsSync(this.config.migrationsPath)) {
      this.logger.warn(`Migrations directory does not exist: ${this.config.migrationsPath}`);
      return;
    }

    const files = await fs.promises.readdir(this.config.migrationsPath);
    const migrationFiles = files.filter(file => 
      file.endsWith('.ts') || file.endsWith('.js')
    ).sort();

    for (const file of migrationFiles) {
      try {
        const filepath = path.resolve(this.config.migrationsPath, file);
        let migration: any;

        if (file.endsWith('.ts')) {
          // Para arquivos TypeScript, usa ts-node para compilação dinâmica
          try {
            // Registra ts-node se não estiver registrado
            if (!process.env.TS_NODE_REGISTERED) {
              require('ts-node').register({
                transpileOnly: true,
                compilerOptions: {
                  module: 'commonjs',
                  target: 'es2018',
                  esModuleInterop: true,
                  allowSyntheticDefaultImports: true,
                  resolveJsonModule: true,
                  declaration: false,
                  sourceMap: false,
                }
              });
              process.env.TS_NODE_REGISTERED = 'true';
            }
            
            // Remove do cache para permitir hot reload
            delete require.cache[filepath];
            migration = require(filepath);
          } catch (tsError) {
            this.logger.warn(`Failed to load TypeScript migration ${file} with ts-node, trying fallback:`, tsError);
            // Fallback: tentar carregar arquivo já compilado
            const jsPath = filepath.replace('.ts', '.js');
            if (fs.existsSync(jsPath)) {
              delete require.cache[jsPath];
              migration = require(jsPath);
            } else {
              throw tsError;
            }
          }
        } else {
          // Para arquivos JavaScript
          delete require.cache[filepath];
          migration = require(filepath);
        }
        
        const migrationObject = migration.default || migration;
        if (migrationObject && typeof migrationObject === 'object') {
          this._validateMigration(migrationObject);
          this.migrations.set(migrationObject.version, migrationObject);
          this.logger.debug(`Loaded migration: ${migrationObject.version}`);
        } else {
          this.logger.warn(`Migration ${file} does not export a valid migration object`);
        }
      } catch (error) {
        this.logger.error(`Failed to load migration ${file}:`, error);
        throw new Error(`Failed to load migration ${file}: ${(error as Error).message}`);
      }
    }

    this.logger.info(`Loaded ${this.migrations.size} migrations`);
  }

  private async _createMigrationTables(): Promise<void> {
    this.logger.info('Creating migration control tables');

    const allClusters = await this._getAllClusters();

    for (const clusterId of allClusters) {
      try {
        // Tabela de migrations aplicadas
        await this.pgMultiverse.query(`
          CREATE TABLE IF NOT EXISTS ${this.config.migrationsTable} (
            id SERIAL PRIMARY KEY,
            version VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            schema_name VARCHAR(255) NOT NULL,
            cluster_id VARCHAR(255) NOT NULL,
            executed_at TIMESTAMP DEFAULT NOW(),
            execution_time INTEGER NOT NULL,
            checksum VARCHAR(255) NOT NULL,
            batch INTEGER,
            UNIQUE(version, schema_name, cluster_id)
          )
        `, [], { clusterId });

        // Tabela de locks
        await this.pgMultiverse.query(`
          CREATE TABLE IF NOT EXISTS ${this.config.lockTable} (
            id SERIAL PRIMARY KEY,
            lock_key VARCHAR(255) UNIQUE NOT NULL,
            locked_at TIMESTAMP DEFAULT NOW(),
            locked_by VARCHAR(255) NOT NULL,
            expires_at TIMESTAMP NOT NULL
          )
        `, [], { clusterId });

        this.logger.debug(`Created migration tables in cluster: ${clusterId}`);
      } catch (error) {
        this.logger.error(`Failed to create migration tables in cluster ${clusterId}:`, error);
        throw error;
      }
    }
  }

  private _calculateChecksum(migration: Migration): string {
    const content = `${migration.up.toString()}${migration.down.toString()}`;
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private _generateMigrationTemplate(version: string, name: string, options: any): string {
    return `import { Migration, MigrationContext } from 'pg-multiverse';

const migration: Migration = {
  version: '${version}',
  name: '${name}',
  description: '${options.description || ''}',
  targetSchemas: ${JSON.stringify(options.targetSchemas)},
  ${options.targetClusters ? `targetClusters: ${JSON.stringify(options.targetClusters)},` : ''}
  ${options.tags ? `tags: ${JSON.stringify(options.tags)},` : ''}
  createdAt: new Date('${new Date().toISOString()}'),

  async up(context: MigrationContext): Promise<void> {
    // TODO: Implement your migration logic here
    context.logger.info(\`Applying migration \${context.version} to \${context.schema} on \${context.cluster}\`);
    
    // Example:
    // await context.query(\`
    //   CREATE TABLE example_table (
    //     id SERIAL PRIMARY KEY,
    //     name VARCHAR(255) NOT NULL,
    //     created_at TIMESTAMP DEFAULT NOW()
    //   )
    // \`);
  },

  async down(context: MigrationContext): Promise<void> {
    // TODO: Implement your rollback logic here
    context.logger.info(\`Rolling back migration \${context.version} from \${context.schema} on \${context.cluster}\`);
    
    // Example:
    // await context.query(\`DROP TABLE IF EXISTS example_table\`);
  }
};

export default migration;
`;
  }

  // ==================== MÉTODOS DE CONTROLE ====================

  private async _getTargetSchemas(schemas?: string[]): Promise<string[]> {
    if (schemas && schemas.length > 0) {
      return schemas;
    }

    // Obtém todos os schemas configurados nos clusters
    const clusterManager = (this.pgMultiverse as any).clusterManager;
    if (!clusterManager) {
      throw new Error('ClusterManager not available');
    }

    const allSchemas = new Set<string>();
    const clusters = clusterManager.getClusters();
    
    for (const [clusterId, cluster] of clusters.entries()) {
      if (cluster.config.schemas) {
        cluster.config.schemas.forEach((schema: string) => allSchemas.add(schema));
      }
    }

    return Array.from(allSchemas);
  }

  private async _getTargetClusters(clusters?: string[]): Promise<string[]> {
    if (clusters && clusters.length > 0) {
      return clusters;
    }

    const clusterManager = (this.pgMultiverse as any).clusterManager;
    if (!clusterManager) {
      throw new Error('ClusterManager not available');
    }

    return Array.from(clusterManager.getClusters().keys());
  }

  private async _getAllSchemas(): Promise<string[]> {
    return this._getTargetSchemas();
  }

  private async _getAllClusters(): Promise<string[]> {
    const clusterManager = (this.pgMultiverse as any).clusterManager;
    if (!clusterManager) {
      this.logger.warn('ClusterManager not available, returning empty cluster list');
      return [];
    }
    return Array.from(clusterManager.getClusters().keys());
  }

  private async _getPendingMigrations(
    schemas: string[], 
    clusters: string[], 
    targetVersion?: string
  ): Promise<Array<{migration: Migration, schema: string, cluster: string}>> {
    const pendingMigrations: Array<{migration: Migration, schema: string, cluster: string}> = [];
    
    // Para cada combinação schema/cluster, verifica migrations pendentes
    for (const schema of schemas) {
      const clusterForSchema = await this._getClusterForSchema(schema);
      const targetClusters = clusters.includes(clusterForSchema) ? [clusterForSchema] : 
                           clusters.length > 0 ? clusters.filter(c => c === clusterForSchema) : [clusterForSchema];

      for (const cluster of targetClusters) {
        // Obtém migrations já aplicadas
        const appliedVersions = await this._getAppliedMigrations(schema, cluster);
        const appliedSet = new Set(appliedVersions.map(r => r.version));

        // Filtra migrations pendentes
        for (const migration of this.migrations.values()) {
          if (!migration.targetSchemas.includes(schema)) continue;
          if (migration.targetClusters && !migration.targetClusters.includes(cluster)) continue;
          if (appliedSet.has(migration.version)) continue;
          if (targetVersion && migration.version > targetVersion) continue;

          pendingMigrations.push({ migration, schema, cluster });
        }
      }
    }

    // Ordena por versão
    return pendingMigrations.sort((a, b) => a.migration.version.localeCompare(b.migration.version));
  }

  private async _getMigrationsToRollback(
    schemas: string[],
    clusters: string[],
    targetVersion?: string,
    steps?: number
  ): Promise<MigrationRecord[]> {
    const migrationsToRollback: MigrationRecord[] = [];

    for (const schema of schemas) {
      const clusterForSchema = await this._getClusterForSchema(schema);
      const targetClusters = clusters.includes(clusterForSchema) ? [clusterForSchema] : 
                           clusters.length > 0 ? clusters.filter(c => c === clusterForSchema) : [clusterForSchema];

      for (const cluster of targetClusters) {
        const appliedMigrations = await this._getAppliedMigrations(schema, cluster);
        
        let migrationsForRollback = appliedMigrations.sort((a, b) => 
          b.version.localeCompare(a.version) // Ordem decrescente
        );

        if (targetVersion) {
          migrationsForRollback = migrationsForRollback.filter(m => m.version > targetVersion);
        }

        if (steps && !targetVersion) {
          migrationsForRollback = migrationsForRollback.slice(0, steps);
        }

        migrationsToRollback.push(...migrationsForRollback);
      }
    }

    return migrationsToRollback;
  }

  private async _getAppliedMigrations(schema: string, cluster: string): Promise<MigrationRecord[]> {
    try {
      const result = await this.pgMultiverse.query(`
        SELECT version, name, schema_name, cluster_id, executed_at, execution_time, checksum, batch
        FROM ${this.config.migrationsTable}
        WHERE schema_name = $1 AND cluster_id = $2
        ORDER BY version ASC
      `, [schema, cluster], { clusterId: cluster });

      return result.rows.map(row => ({
        version: row.version,
        name: row.name,
        schema: row.schema_name,
        cluster: row.cluster_id,
        executedAt: new Date(row.executed_at),
        executionTime: row.execution_time,
        checksum: row.checksum,
        batch: row.batch,
      }));
    } catch (error) {
      this.logger.error(`Failed to get applied migrations for ${schema}@${cluster}:`, error);
      return [];
    }
  }

  private async _getClusterForSchema(schema: string): Promise<string> {
    const clusterManager = (this.pgMultiverse as any).clusterManager;
    if (!clusterManager || !clusterManager.schemaClusterMap) {
      throw new Error('Schema cluster mapping not available');
    }

    const cluster = clusterManager.schemaClusterMap.get(schema);
    if (!cluster) {
      throw new Error(`No cluster found for schema: ${schema}`);
    }

    return cluster;
  }

  private async _validateDependencies(migrations: Array<{migration: Migration, schema: string, cluster: string}>): Promise<void> {
    const migrationVersions = new Set(migrations.map(m => m.migration.version));

    for (const { migration } of migrations) {
      if (migration.dependencies) {
        for (const dependency of migration.dependencies) {
          if (!this.migrations.has(dependency)) {
            throw new Error(`Migration ${migration.version} depends on missing migration: ${dependency}`);
          }
          if (!migrationVersions.has(dependency)) {
            // Verifica se a dependência já está aplicada
            const dependencyApplied = await this._isDependencyApplied(dependency, migration.targetSchemas);
            if (!dependencyApplied) {
              throw new Error(`Migration ${migration.version} depends on unapplied migration: ${dependency}`);
            }
          }
        }
      }
    }
  }

  private async _isDependencyApplied(version: string, schemas: string[]): Promise<boolean> {
    for (const schema of schemas) {
      try {
        const cluster = await this._getClusterForSchema(schema);
        const result = await this.pgMultiverse.query(`
          SELECT COUNT(*) as count
          FROM ${this.config.migrationsTable}
          WHERE version = $1 AND schema_name = $2 AND cluster_id = $3
        `, [version, schema, cluster], { clusterId: cluster });

        if (result.rows[0].count === 0) {
          return false;
        }
      } catch (error) {
        return false;
      }
    }
    return true;
  }

  private async _executeSequential(
    migrations: Array<{migration: Migration, schema: string, cluster: string}>, 
    continueOnError: boolean, 
    errors: Error[]
  ): Promise<number> {
    let executed = 0;

    for (const { migration, schema, cluster } of migrations) {
      try {
        await this._executeMigration(migration, schema, cluster);
        executed++;
      } catch (error) {
        this.logger.error(`Migration ${migration.version} failed:`, error);
        errors.push(error as Error);
        if (!continueOnError) break;
      }
    }

    return executed;
  }

  private async _executeParallel(
    migrations: Array<{migration: Migration, schema: string, cluster: string}>, 
    maxParallel: number, 
    continueOnError: boolean, 
    errors: Error[]
  ): Promise<number> {
    let executed = 0;
    const batches: Array<Array<{migration: Migration, schema: string, cluster: string}>> = [];
    
    // Agrupa por schema/cluster para execução paralela
    const groups = new Map<string, Array<{migration: Migration, schema: string, cluster: string}>>();
    
    for (const item of migrations) {
      const key = `${item.schema}@${item.cluster}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }

    // Cria batches respeitando maxParallel
    const groupValues = Array.from(groups.values());
    for (let i = 0; i < groupValues.length; i += maxParallel) {
      batches.push(groupValues.slice(i, i + maxParallel).flat());
    }

    for (const batch of batches) {
      const promises = batch.map(async ({ migration, schema, cluster }) => {
        try {
          await this._executeMigration(migration, schema, cluster);
          return 1;
        } catch (error) {
          this.logger.error(`Migration ${migration.version} failed:`, error);
          errors.push(error as Error);
          if (!continueOnError) throw error;
          return 0;
        }
      });

      try {
        const results = await Promise.all(promises);
        executed += results.reduce((sum: number, count: number) => sum + count, 0);
      } catch (error) {
        if (!continueOnError) break;
      }
    }

    return executed;
  }

  private async _executeMigration(migration: Migration, schema: string, cluster: string): Promise<void> {
    const startTime = Date.now();
    
    this.emit('migrationStarted', { 
      version: migration.version, 
      name: migration.name, 
      schema, 
      cluster 
    });

    try {
      // Obter lock
      await this._acquireLock(`${migration.version}-${schema}-${cluster}`);

      const context: MigrationContext = {
        query: async (sql: string, params?: QueryParam[]) => {
          return this.pgMultiverse.query(sql, params || [], { schema, clusterId: cluster });
        },
        schema,
        cluster,
        version: migration.version,
        logger: this.logger,
      };

      // Executar migration
      await migration.up(context);

      // Registrar execução
      const executionTime = Date.now() - startTime;
      const checksum = this._calculateChecksum(migration);

      await this.pgMultiverse.query(`
        INSERT INTO ${this.config.migrationsTable} 
        (version, name, schema_name, cluster_id, execution_time, checksum)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        migration.version,
        migration.name,
        schema,
        cluster,
        executionTime,
        checksum
      ], { clusterId: cluster });

      // Liberar lock
      await this._releaseLock(`${migration.version}-${schema}-${cluster}`);

      this.emit('migrationCompleted', { 
        version: migration.version, 
        name: migration.name, 
        schema, 
        cluster,
        duration: executionTime
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Liberar lock em caso de erro
      try {
        await this._releaseLock(`${migration.version}-${schema}-${cluster}`);
      } catch (lockError) {
        this.logger.warn(`Failed to release lock:`, lockError);
      }

      this.emit('migrationFailed', { 
        version: migration.version, 
        name: migration.name, 
        schema, 
        cluster,
        error: error as Error,
        duration
      });

      throw error;
    }
  }

  private async _rollbackMigration(record: MigrationRecord, force: boolean): Promise<void> {
    const migration = this.migrations.get(record.version);
    if (!migration && !force) {
      throw new Error(`Migration ${record.version} not found for rollback`);
    }

    if (!migration) {
      this.logger.warn(`Skipping rollback of missing migration: ${record.version}`);
      return;
    }

    const startTime = Date.now();
    
    this.emit('rollbackStarted', { 
      version: record.version, 
      name: record.name, 
      schema: record.schema, 
      cluster: record.cluster
    });

    try {
      // Obter lock
      await this._acquireLock(`rollback-${record.version}-${record.schema}-${record.cluster}`);

      const context: MigrationContext = {
        query: async (sql: string, params?: QueryParam[]) => {
          return this.pgMultiverse.query(sql, params || [], { 
            schema: record.schema, 
            clusterId: record.cluster 
          });
        },
        schema: record.schema,
        cluster: record.cluster,
        version: record.version,
        logger: this.logger,
      };

      // Executar rollback
      await migration.down(context);

      // Remover registro da tabela
      await this.pgMultiverse.query(`
        DELETE FROM ${this.config.migrationsTable}
        WHERE version = $1 AND schema_name = $2 AND cluster_id = $3
      `, [record.version, record.schema, record.cluster], { 
        clusterId: record.cluster 
      });

      // Liberar lock
      await this._releaseLock(`rollback-${record.version}-${record.schema}-${record.cluster}`);

      const duration = Date.now() - startTime;
      this.emit('rollbackCompleted', { 
        version: record.version, 
        name: record.name, 
        schema: record.schema, 
        cluster: record.cluster,
        duration
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Liberar lock em caso de erro
      try {
        await this._releaseLock(`rollback-${record.version}-${record.schema}-${record.cluster}`);
      } catch (lockError) {
        this.logger.warn(`Failed to release rollback lock:`, lockError);
      }

      this.emit('rollbackFailed', { 
        version: record.version, 
        name: record.name, 
        schema: record.schema, 
        cluster: record.cluster,
        error: error as Error,
        duration
      });

      throw error;
    }
  }

  private async _acquireLock(lockKey: string): Promise<void> {
    const expiresAt = new Date(Date.now() + this.config.lockTimeout);
    const lockedBy = `${process.pid}-${Date.now()}`;

    try {
      const clusters = await this._getAllClusters();
      
      for (const cluster of clusters) {
        await this.pgMultiverse.query(`
          INSERT INTO ${this.config.lockTable} (lock_key, locked_by, expires_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (lock_key) DO UPDATE SET
            locked_by = EXCLUDED.locked_by,
            expires_at = EXCLUDED.expires_at,
            locked_at = NOW()
          WHERE ${this.config.lockTable}.expires_at < NOW()
        `, [lockKey, lockedBy, expiresAt], { clusterId: cluster });
      }
    } catch (error) {
      throw new Error(`Failed to acquire lock ${lockKey}: ${(error as Error).message}`);
    }
  }

  private async _releaseLock(lockKey: string): Promise<void> {
    try {
      const clusters = await this._getAllClusters();
      
      for (const cluster of clusters) {
        await this.pgMultiverse.query(`
          DELETE FROM ${this.config.lockTable} WHERE lock_key = $1
        `, [lockKey], { clusterId: cluster });
      }
    } catch (error) {
      this.logger.warn(`Failed to release lock ${lockKey}:`, error);
    }
  }

  private async _generateStatus(schemas: string[], clusters: string[]): Promise<MigrationStatus> {
    const status: MigrationStatus = {
      totalMigrations: this.migrations.size,
      appliedMigrations: 0,
      pendingMigrations: 0,
      failedMigrations: 0,
      bySchema: {},
      byCluster: {},
    };

    for (const schema of schemas) {
      status.bySchema[schema] = {
        applied: 0,
        pending: 0,
        failed: 0,
      };

      try {
        const cluster = await this._getClusterForSchema(schema);
        if (!status.byCluster[cluster]) {
          status.byCluster[cluster] = {
            applied: 0,
            pending: 0,
            failed: 0,
          };
        }

        const appliedMigrations = await this._getAppliedMigrations(schema, cluster);
        const appliedSet = new Set(appliedMigrations.map(m => m.version));

        status.bySchema[schema].applied = appliedMigrations.length;
        status.byCluster[cluster].applied += appliedMigrations.length;
        
        if (appliedMigrations.length > 0) {
          status.bySchema[schema].lastApplied = appliedMigrations[appliedMigrations.length - 1].version;
          status.byCluster[cluster].lastApplied = appliedMigrations[appliedMigrations.length - 1].version;
        }

        // Calcula pendentes
        for (const migration of this.migrations.values()) {
          if (migration.targetSchemas.includes(schema) && !appliedSet.has(migration.version)) {
            status.bySchema[schema].pending++;
            status.byCluster[cluster].pending++;
          }
        }

      } catch (error) {
        this.logger.error(`Failed to get status for schema ${schema}:`, error);
      }
    }

    // Calcula totais
    status.appliedMigrations = Object.values(status.bySchema).reduce((sum, s) => sum + s.applied, 0);
    status.pendingMigrations = Object.values(status.bySchema).reduce((sum, s) => sum + s.pending, 0);

    return status;
  }
}