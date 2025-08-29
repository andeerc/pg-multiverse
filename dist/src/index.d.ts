export { MultiClusterPostgres } from './cluster/MultiClusterPostgres';
export { ClusterManager } from './cluster/ClusterManager';
export { ClusterConfig } from './cluster/ClusterConfig';
export { ConnectionPool } from './cluster/ConnectionPool';
export { CacheProvider, CacheSetOptions, CacheProviderConfig, RedisConfig, MemoryCache, RedisCache, CacheFactory } from './cache';
export * from './types';
export { MultiClusterPostgres as default } from './cluster/MultiClusterPostgres';
export declare const VERSION = "1.0.0";
/**
 * Multi-Cluster PostgreSQL para Node.js com TypeScript
 *
 * Características:
 * - Multi-schema e multi-cluster support
 * - Read/Write splitting inteligente
 * - Load balancing com múltiplas estratégias
 * - Cache distribuído com invalidação (Redis e Memory)
 * - Transações distribuídas
 * - Health checking e failover automático
 * - Métricas detalhadas
 * - Type-safe queries com TypeScript
 *
 * @example
 * ```typescript
 * import { MultiClusterPostgres } from 'pg-multiverse';
 *
 * // Configuração com Redis cache
 * const postgres = new MultiClusterPostgres({
 *   enableCache: true,
 *   enableMetrics: true,
 *   enableTransactions: true,
 *   cache: {
 *     provider: 'redis',
 *     redis: {
 *       host: 'localhost',
 *       port: 6379,
 *       keyPrefix: 'pg-multiverse:',
 *     },
 *     fallback: {
 *       enabled: true,
 *       provider: 'memory'
 *     }
 *   }
 * });
 *
 * await postgres.initialize({
 *   users_cluster: {
 *     schemas: ['users', 'auth'],
 *     primary: {
 *       host: 'localhost',
 *       port: 5432,
 *       database: 'app_users',
 *       user: 'postgres',
 *       password: 'password'
 *     },
 *     replicas: [{
 *       host: 'replica.localhost',
 *       port: 5432,
 *       database: 'app_users',
 *       user: 'postgres',
 *       password: 'password'
 *     }]
 *   }
 * });
 *
 * // Type-safe query com cache Redis
 * interface User {
 *   id: number;
 *   email: string;
 *   name: string;
 * }
 *
 * const users = await postgres.query<User>(
 *   'SELECT * FROM users WHERE active = $1',
 *   [true],
 *   {
 *     schema: 'users',
 *     cache: true,
 *     cacheTtl: 300000 // 5 minutes
 *   }
 * );
 *
 * // Distributed transaction
 * await postgres.withTransaction(['users', 'orders'], async (tx) => {
 *   await tx.query('UPDATE users SET last_order = NOW() WHERE id = $1', [userId]);
 *   await tx.query('INSERT INTO orders (user_id, total) VALUES ($1, $2)', [userId, total]);
 * });
 *
 * // Cache invalidation
 * await postgres.invalidateCache({ schema: 'users' });
 * ```
 */ 
//# sourceMappingURL=index.d.ts.map