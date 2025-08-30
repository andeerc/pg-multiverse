#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';
import { PgMultiverse, MigrationManager } from '../index';

interface CLIConfig {
  configPath?: string;
  migrationsPath?: string;
  enableMigrations: boolean;
  verbose: boolean;
}

class MigrationCLI {
  private config: CLIConfig;
  private pgMultiverse: PgMultiverse | null = null;

  constructor() {
    this.config = {
      enableMigrations: true,
      verbose: false,
    };
  }

  async initialize(configPath?: string): Promise<void> {
    // Carrega configuração se fornecida
    let clusterConfig = {};
    let migrationConfig = {};

    if (configPath && fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      clusterConfig = config.clusters || config;
      migrationConfig = config.migrations || {};
    }

    this.pgMultiverse = new PgMultiverse({
      enableMigrations: true,
      migrations: {
        migrationsPath: this.config.migrationsPath,
        ...migrationConfig,
      },
    } as any);

    await this.pgMultiverse.initialize(clusterConfig);
    
    if (this.config.verbose) {
      console.log('✅ PgMultiverse initialized successfully');
    }
  }

  private ensureInitialized(): PgMultiverse {
    if (!this.pgMultiverse) {
      throw new Error('CLI not initialized. Run initialize() first.');
    }
    return this.pgMultiverse;
  }

  async createMigration(name: string, options: {
    schemas: string[];
    clusters?: string[];
    description?: string;
  }): Promise<void> {
    const pg = this.ensureInitialized();

    try {
      const filePath = await pg.createMigration(name, {
        targetSchemas: options.schemas,
        targetClusters: options.clusters,
        description: options.description,
      });

      console.log(`✅ Migration created: ${filePath}`);
    } catch (error) {
      console.error('❌ Failed to create migration:', (error as Error).message);
      process.exit(1);
    }
  }

  async migrate(options: {
    targetVersion?: string;
    schemas?: string[];
    clusters?: string[];
    dryRun?: boolean;
    parallel?: boolean;
  }): Promise<void> {
    const pg = this.ensureInitialized();

    try {
      console.log('🚀 Starting migration process...');
      
      const status = await pg.migrate({
        targetVersion: options.targetVersion,
        targetSchemas: options.schemas,
        targetClusters: options.clusters,
        dryRun: options.dryRun,
        parallel: options.parallel,
      });

      console.log('\n📊 Migration Status:');
      console.log(`  Total migrations: ${status.totalMigrations}`);
      console.log(`  Applied: ${status.appliedMigrations}`);
      console.log(`  Pending: ${status.pendingMigrations}`);
      console.log(`  Failed: ${status.failedMigrations}`);

      if (this.config.verbose) {
        console.log('\n📋 By Schema:');
        for (const [schema, stats] of Object.entries(status.bySchema)) {
          console.log(`  ${schema}: ${stats.applied} applied, ${stats.pending} pending`);
        }

        console.log('\n🏛️ By Cluster:');
        for (const [cluster, stats] of Object.entries(status.byCluster)) {
          console.log(`  ${cluster}: ${stats.applied} applied, ${stats.pending} pending`);
        }
      }

      if (options.dryRun) {
        console.log('\n🔍 DRY RUN - No changes were applied');
      } else {
        console.log('\n✅ Migration process completed');
      }
    } catch (error) {
      console.error('❌ Migration failed:', (error as Error).message);
      process.exit(1);
    }
  }

  async rollback(options: {
    targetVersion?: string;
    steps?: number;
    schemas?: string[];
    clusters?: string[];
    dryRun?: boolean;
  }): Promise<void> {
    const pg = this.ensureInitialized();

    try {
      console.log('↩️ Starting rollback process...');
      
      const status = await pg.rollback({
        targetVersion: options.targetVersion,
        steps: options.steps,
        targetSchemas: options.schemas,
        targetClusters: options.clusters,
        dryRun: options.dryRun,
      });

      console.log('\n📊 Rollback Status:');
      console.log(`  Total migrations: ${status.totalMigrations}`);
      console.log(`  Applied: ${status.appliedMigrations}`);
      console.log(`  Pending: ${status.pendingMigrations}`);

      if (options.dryRun) {
        console.log('\n🔍 DRY RUN - No rollbacks were performed');
      } else {
        console.log('\n✅ Rollback process completed');
      }
    } catch (error) {
      console.error('❌ Rollback failed:', (error as Error).message);
      process.exit(1);
    }
  }

  async status(options: {
    schemas?: string[];
    clusters?: string[];
  }): Promise<void> {
    const pg = this.ensureInitialized();

    try {
      const status = await pg.getMigrationStatus();

      console.log('📊 Migration Status:');
      console.log(`  Total migrations: ${status.totalMigrations}`);
      console.log(`  Applied: ${status.appliedMigrations}`);
      console.log(`  Pending: ${status.pendingMigrations}`);
      console.log(`  Failed: ${status.failedMigrations}`);

      console.log('\n📋 By Schema:');
      for (const [schema, stats] of Object.entries(status.bySchema)) {
        console.log(`  ${schema}:`);
        console.log(`    Applied: ${stats.applied}`);
        console.log(`    Pending: ${stats.pending}`);
        if (stats.lastApplied) {
          console.log(`    Last applied: ${stats.lastApplied}`);
        }
      }

      console.log('\n🏛️ By Cluster:');
      for (const [cluster, stats] of Object.entries(status.byCluster)) {
        console.log(`  ${cluster}:`);
        console.log(`    Applied: ${stats.applied}`);
        console.log(`    Pending: ${stats.pending}`);
        if (stats.lastApplied) {
          console.log(`    Last applied: ${stats.lastApplied}`);
        }
      }

      if (status.pendingMigrations > 0) {
        console.log('\n💡 Run "pgm migrate" to apply pending migrations');
      }
    } catch (error) {
      console.error('❌ Failed to get status:', (error as Error).message);
      process.exit(1);
    }
  }

  async list(): Promise<void> {
    const pg = this.ensureInitialized();

    try {
      const migrations = pg.getMigrations();

      if (migrations.length === 0) {
        console.log('No migrations found');
        return;
      }

      console.log('📋 Available Migrations:');
      for (const migration of migrations) {
        console.log(`  ${migration.version} - ${migration.name}`);
        if (this.config.verbose) {
          console.log(`    Schemas: ${migration.targetSchemas.join(', ')}`);
          if (migration.targetClusters) {
            console.log(`    Clusters: ${migration.targetClusters.join(', ')}`);
          }
          if (migration.description) {
            console.log(`    Description: ${migration.description}`);
          }
          console.log(`    Created: ${migration.createdAt.toISOString()}`);
        }
        console.log();
      }
    } catch (error) {
      console.error('❌ Failed to list migrations:', (error as Error).message);
      process.exit(1);
    }
  }

  async close(): Promise<void> {
    if (this.pgMultiverse) {
      await this.pgMultiverse.close();
    }
  }
}

// CLI Setup
const cli = new MigrationCLI();

program
  .name('pgm')
  .description('PgMultiverse Migration CLI')
  .version('1.0.0')
  .option('-c, --config <path>', 'Configuration file path')
  .option('-m, --migrations <path>', 'Migrations directory path')
  .option('-v, --verbose', 'Verbose output')
  .hook('preAction', async (thisCommand, actionCommand) => {
    const options = thisCommand.opts();
    
    (cli as any).config.configPath = options.config;
    (cli as any).config.migrationsPath = options.migrations;
    (cli as any).config.verbose = options.verbose;

    await cli.initialize(options.config);
  });

program
  .command('create')
  .description('Create a new migration')
  .argument('<name>', 'Migration name')
  .option('-s, --schemas <schemas>', 'Target schemas (comma-separated)', (value) => value.split(','))
  .option('-c, --clusters <clusters>', 'Target clusters (comma-separated)', (value) => value.split(','))
  .option('-d, --description <description>', 'Migration description')
  .action(async (name, options) => {
    if (!options.schemas) {
      console.error('❌ --schemas is required');
      process.exit(1);
    }
    
    await cli.createMigration(name, {
      schemas: options.schemas,
      clusters: options.clusters,
      description: options.description,
    });
    
    await cli.close();
  });

program
  .command('migrate')
  .description('Run pending migrations')
  .option('-t, --target <version>', 'Target migration version')
  .option('-s, --schemas <schemas>', 'Target schemas (comma-separated)', (value) => value.split(','))
  .option('-c, --clusters <clusters>', 'Target clusters (comma-separated)', (value) => value.split(','))
  .option('-d, --dry-run', 'Dry run - show what would be migrated without applying')
  .option('-p, --parallel', 'Run migrations in parallel where possible')
  .action(async (options) => {
    await cli.migrate({
      targetVersion: options.target,
      schemas: options.schemas,
      clusters: options.clusters,
      dryRun: options.dryRun,
      parallel: options.parallel,
    });
    
    await cli.close();
  });

program
  .command('rollback')
  .description('Rollback migrations')
  .option('-t, --target <version>', 'Target migration version to rollback to')
  .option('-n, --steps <steps>', 'Number of steps to rollback', parseInt)
  .option('-s, --schemas <schemas>', 'Target schemas (comma-separated)', (value) => value.split(','))
  .option('-c, --clusters <clusters>', 'Target clusters (comma-separated)', (value) => value.split(','))
  .option('-d, --dry-run', 'Dry run - show what would be rolled back without applying')
  .action(async (options) => {
    await cli.rollback({
      targetVersion: options.target,
      steps: options.steps,
      schemas: options.schemas,
      clusters: options.clusters,
      dryRun: options.dryRun,
    });
    
    await cli.close();
  });

program
  .command('status')
  .description('Show migration status')
  .option('-s, --schemas <schemas>', 'Filter by schemas (comma-separated)', (value) => value.split(','))
  .option('-c, --clusters <clusters>', 'Filter by clusters (comma-separated)', (value) => value.split(','))
  .action(async (options) => {
    await cli.status({
      schemas: options.schemas,
      clusters: options.clusters,
    });
    
    await cli.close();
  });

program
  .command('list')
  .description('List all available migrations')
  .action(async () => {
    await cli.list();
    await cli.close();
  });

// Handle errors and cleanup
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT. Cleaning up...');
  await cli.close();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await cli.close();
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('Unhandled Rejection:', reason);
  await cli.close();
  process.exit(1);
});

// Parse CLI arguments
program.parse();