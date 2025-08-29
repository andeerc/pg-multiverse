"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = exports.default = exports.CacheFactory = exports.RedisCache = exports.MemoryCache = exports.ConnectionPool = exports.ClusterConfig = exports.ClusterManager = exports.MultiClusterPostgres = void 0;
// Exportações principais
var MultiClusterPostgres_1 = require("./cluster/MultiClusterPostgres");
Object.defineProperty(exports, "MultiClusterPostgres", { enumerable: true, get: function () { return MultiClusterPostgres_1.MultiClusterPostgres; } });
var ClusterManager_1 = require("./cluster/ClusterManager");
Object.defineProperty(exports, "ClusterManager", { enumerable: true, get: function () { return ClusterManager_1.ClusterManager; } });
var ClusterConfig_1 = require("./cluster/ClusterConfig");
Object.defineProperty(exports, "ClusterConfig", { enumerable: true, get: function () { return ClusterConfig_1.ClusterConfig; } });
var ConnectionPool_1 = require("./cluster/ConnectionPool");
Object.defineProperty(exports, "ConnectionPool", { enumerable: true, get: function () { return ConnectionPool_1.ConnectionPool; } });
// Exportações de cache
var cache_1 = require("./cache");
Object.defineProperty(exports, "MemoryCache", { enumerable: true, get: function () { return cache_1.MemoryCache; } });
Object.defineProperty(exports, "RedisCache", { enumerable: true, get: function () { return cache_1.RedisCache; } });
Object.defineProperty(exports, "CacheFactory", { enumerable: true, get: function () { return cache_1.CacheFactory; } });
// Re-exporta todos os tipos
__exportStar(require("./types"), exports);
// Exportações de utilitários (se houver)
// export * from './utils';
// Default export
var MultiClusterPostgres_2 = require("./cluster/MultiClusterPostgres");
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return MultiClusterPostgres_2.MultiClusterPostgres; } });
// Versão do pacote
exports.VERSION = '1.0.0';
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
//# sourceMappingURL=index.js.map