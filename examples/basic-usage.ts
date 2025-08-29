import { MultiClusterPostgres } from '../src/cluster/MultiClusterPostgres';

// Definicoes de tipos para os exemplos
interface User {
  id: number;
  email: string;
  name: string;
  active: boolean;
  created_at: Date;
}

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  stock: number;
}

interface Order {
  id: number;
  user_id: number;
  total: number;
  status: string;
  created_at: Date;
}

/**
 * Exemplo basico de uso do Multi-Cluster PostgreSQL com TypeScript
 */
async function basicUsageExample(): Promise<void> {
  // Configuracao basica com 2 clusters
  const clusterConfig = {
    users_cluster: {
      schemas: ['users', 'auth', 'profiles'],
      priority: 1,
      readPreference: 'replica' as const,
      consistencyLevel: 'eventual' as const,
      primary: {
        host: 'localhost',
        port: 5432,
        database: 'app_users',
        user: 'postgres',
        password: 'password',
        maxConnections: 20
      },
      replicas: [
        {
          host: 'replica1.localhost',
          port: 5432,
          database: 'app_users',
          user: 'postgres',
          password: 'password',
          maxConnections: 15,
          weight: 2
        }
      ]
    },

    commerce_cluster: {
      schemas: ['products', 'orders', 'inventory'],
      priority: 2,
      readPreference: 'any' as const,
      consistencyLevel: 'strong' as const,
      primary: {
        host: 'localhost',
        port: 5433,
        database: 'app_commerce',
        user: 'postgres',
        password: 'password',
        maxConnections: 25
      }
    }
  };

  // Inicializa o Multi-Cluster PostgreSQL
  const postgres = new MultiClusterPostgres({
    enableCache: true,
    enableMetrics: true,
    enableTransactions: true,
    cache: {
      maxSize: 1000,
      ttl: 300000, // 5 minutos
      enableCompression: true
    }
  });

  try {
    console.log('🚀 Inicializando Multi-Cluster PostgreSQL...');
    await postgres.initialize(clusterConfig);
    console.log('✅ Inicializacao concluida!');

    // ==================== EXEMPLOS DE QUERIES ====================

    console.log('\n📊 Executando queries com type safety...');

    // 1. Query type-safe com schema automatico
    const users = await postgres.query<User>(
      'SELECT * FROM users WHERE active = $1 LIMIT 10',
      [true],
      {
        schema: 'users',
        cache: true,
        cacheTtl: 600000 // 10 minutos
      }
    );

    console.log(`📋 Encontrados ${users.rows.length} usuarios ativos`);
    users.rows.forEach(user => {
      // TypeScript sabe que user e do tipo User
      console.log(`  - ${user.name} (${user.email})`);
    });

    // 2. Query em cluster especifico
    const products = await postgres.query<Product>(
      'SELECT * FROM products WHERE category = $1 ORDER BY price DESC',
      ['electronics'],
      {
        schema: 'products',
        clusterId: 'commerce_cluster',
        consistencyLevel: 'strong'
      }
    );

    console.log(`🛒 Encontrados ${products.rows.length} produtos eletronicos`);

    // 3. Query com cache customizado
    const popularProducts = await postgres.query<Product>(
      'SELECT * FROM products WHERE stock > 100 ORDER BY sales DESC LIMIT 5',
      [],
      {
        schema: 'products',
        cache: true,
        cacheKey: 'popular_products',
        cacheTtl: 1800000 // 30 minutos
      }
    );

    console.log(`⭐ Top ${popularProducts.rows.length} produtos populares`);

    // ==================== TRANSACOES ====================

    console.log('\n💳 Executando transacao distribuida...');

    // Transacao cross-cluster (usuarios + pedidos)
    const orderResult = await postgres.withTransaction(
      ['users', 'orders'],
      async (tx) => {
        // Atualiza usuario
        await tx.query(
          'UPDATE users SET last_order_at = NOW() WHERE id = $1',
          [1],
          { schema: 'users' }
        );

        // Cria pedido
        const newOrder = await tx.query<Order>(
          'INSERT INTO orders (user_id, total, status) VALUES ($1, $2, $3) RETURNING *',
          [1, 99.99, 'pending'],
          { schema: 'orders' }
        );

        return newOrder.rows[0];
      },
      {
        isolationLevel: 'READ_COMMITTED',
        timeout: 30000
      }
    );

    console.log(`📦 Pedido criado: ID ${orderResult.id} - Total: $${orderResult.total}`);

    // ==================== CACHE ====================

    console.log('\n🚀 Testando cache distribuido...');

    // Query com cache (primeira vez - miss)
    console.time('Query sem cache');
    await postgres.query(
      'SELECT COUNT(*) as total FROM users WHERE active = true',
      [],
      { schema: 'users', cache: true, cacheKey: 'active_users_count' }
    );
    console.timeEnd('Query sem cache');

    // Query com cache (segunda vez - hit)
    console.time('Query com cache');
    const cachedResult = await postgres.query(
      'SELECT COUNT(*) as total FROM users WHERE active = true',
      [],
      { schema: 'users', cache: true, cacheKey: 'active_users_count' }
    );
    console.timeEnd('Query com cache');

    console.log(`👥 Total de usuarios ativos: ${cachedResult.rows[0].total}`);

    // ==================== METRICAS ====================

    console.log('\n📈 Metricas do sistema:');
    const metrics = postgres.getMetrics();

    console.log(`  Total de queries: ${metrics.totalQueries}`);
    console.log(`  Tempo medio de resposta: ${metrics.avgResponseTime.toFixed(2)}ms`);
    console.log(`  Taxa de erro: ${metrics.errorRate.toFixed(2)}%`);

    if (metrics.cache) {
      console.log(`  Cache hit rate: ${metrics.cache.hitRate.toFixed(2)}%`);
      console.log(`  Itens em cache: ${metrics.cache.itemCount}`);
    }

    // Metricas por cluster
    for (const [clusterId, clusterMetrics] of Object.entries(metrics.clusters)) {
      console.log(`  Cluster ${clusterId}:`);
      console.log(`    Queries: ${clusterMetrics.queries.total}`);
      console.log(`    Erros: ${clusterMetrics.queries.errors}`);
      console.log(`    Conexoes ativas: ${clusterMetrics.connections.active}`);
    }

    // ==================== HEALTH CHECK ====================

    console.log('\n🏥 Verificando saude dos clusters...');
    const health = await postgres.healthCheck();

    for (const [clusterId, clusterHealth] of Object.entries(health)) {
      const status = clusterHealth.healthy ? '✅ Saudavel' : '❌ Com problemas';
      console.log(`  ${clusterId}: ${status} (${clusterHealth.responseTime}ms)`);

      if (!clusterHealth.healthy && clusterHealth.error) {
        console.log(`    Erro: ${clusterHealth.error}`);
      }
    }

    // ==================== INVALIDACAO DE CACHE ====================

    console.log('\n🧹 Limpando cache...');

    // Invalida cache por schema
    const invalidatedBySchema = await postgres.invalidateCache({ schema: 'users' });
    console.log(`  Invalidadas ${invalidatedBySchema} entradas do schema 'users'`);

    // Invalida cache por tags
    const invalidatedByTags = await postgres.invalidateCache({ tags: ['products'] });
    console.log(`  Invalidadas ${invalidatedByTags} entradas com tag 'products'`);

  } catch (error) {
    console.error('❌ Erro durante execucao:', error);

    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
  } finally {
    // Fecha conexoes
    console.log('\n🔚 Fechando conexoes...');
    await postgres.close();
    console.log('✅ Conexoes fechadas com sucesso!');
  }
}

/**
 * Exemplo de uso avancado com configuracao dinamica
 */
async function advancedConfigExample(): Promise<void> {
  console.log('\n🔧 Exemplo de configuracao avancada...');

  const postgres = new MultiClusterPostgres({
    configPath: './cluster-config.json', // Carrega config de arquivo
    enableCache: true,
    enableMetrics: true,
    enableTransactions: true
  });

  try {
    await postgres.initialize();

    // Registra schema dinamicamente
    postgres.registerSchema('analytics', 'analytics_cluster', {
      cacheStrategy: 'aggressive',
      priority: 3
    });

    // Query no novo schema
    const analyticsData = await postgres.query(
      'SELECT event_type, COUNT(*) as total FROM events GROUP BY event_type',
      [],
      {
        schema: 'analytics',
        cache: true,
        cacheTtl: 3600000 // 1 hora
      }
    );

    console.log(`📊 Dados de analytics: ${analyticsData.rows.length} tipos de eventos`);

  } catch (error) {
    console.error('❌ Erro no exemplo avancado:', error);
  } finally {
    await postgres.close();
  }
}

// Executa os exemplos
if (require.main === module) {
  (async () => {
    console.log('🎯 Multi-Cluster PostgreSQL - Exemplos TypeScript\n');

    try {
      await basicUsageExample();
      await advancedConfigExample();
    } catch (error) {
      console.error('❌ Erro fatal:', error);
      process.exit(1);
    }

    console.log('\n🎉 Todos os exemplos executados com sucesso!');
  })();
}

export {
  basicUsageExample,
  advancedConfigExample,
  type User,
  type Product,
  type Order
};