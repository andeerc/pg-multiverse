# Testing Guide for PG Multiverse

Este guia explica como executar os testes do **pg-multiverse** usando Docker para criar um ambiente de teste completo com múltiplas instâncias PostgreSQL.

## 📋 Pré-requisitos

- **Docker** e **Docker Compose** instalados
- **Node.js** 16+ e **npm** 8+
- **Portas disponíveis**: 5432-5436 (ou ajuste no docker-compose.test.yml)

## 🚀 Executando os Testes

### Testes Completos (Recomendado)
```bash
# Executa todos os testes (unitários + integração com Docker)
npm run test:all
```

### Testes de Integração com Docker
```bash
# Executa apenas os testes de integração com PostgreSQL real
npm run test:docker
```

### Testes Unitários
```bash
# Executa apenas os testes unitários com mocks
npm run test:unit
```

### Comandos Individuais
```bash
# Configura ambiente Docker
npm run test:setup

# Executa testes de integração
npm run test:integration

# Remove ambiente Docker
npm run test:teardown
```

## 🐳 Ambiente Docker

O arquivo `docker-compose.test.yml` cria 5 instâncias PostgreSQL:

### Cluster 1 - Usuários e Autenticação
- **Primary**: `localhost:5432` - `test_db`
- **Replica**: `localhost:5437` - `test_db`
- **Schemas**: `users`, `auth`

### Cluster 2 - Produtos e Pedidos  
- **Primary**: `localhost:5438` - `test_commerce`
- **Replica**: `localhost:5439` - `test_commerce`
- **Schemas**: `products`, `orders`

### Cluster 3 - Failover
- **Primary**: `localhost:5440` - `test_failover`
- **Schemas**: `analytics`, `logs`

### Credenciais
- **Usuário**: `test_user`
- **Senha**: `test_password`

## 🗄️ Estrutura do Banco de Dados

### Cluster 1 (Users & Auth)
```sql
-- Schema: users
users.users           -- Tabela de usuários
users.user_profiles    -- Perfis dos usuários

-- Schema: auth  
auth.sessions         -- Sessões ativas
auth.login_attempts   -- Tentativas de login
```

### Cluster 2 (Commerce)
```sql
-- Schema: products
products.categories   -- Categorias de produtos
products.products     -- Produtos
products.product_images -- Imagens dos produtos

-- Schema: orders
orders.orders        -- Pedidos
orders.order_items   -- Itens dos pedidos  
orders.payments      -- Pagamentos
```

### Cluster 3 (Analytics & Logs)
```sql
-- Schema: analytics
analytics.events     -- Eventos de usuário
analytics.page_views -- Visualizações de página

-- Schema: logs
logs.application_logs -- Logs da aplicação
logs.database_logs   -- Logs do banco
```

## 🧪 Tipos de Teste

### Testes Unitários (`tests/multi-cluster.test.ts`)
- Usam **mocks** e **stubs**
- Testam lógica sem conexões reais
- Executam rapidamente
- Não dependem do Docker

### Testes de Integração (`tests/integration.test.ts`)
- Usam **PostgreSQL real** via Docker
- Testam funcionalidade completa
- Verificam multi-cluster, cache, transações
- Requerem ambiente Docker

## 📊 Cobertura de Testes

Os testes cobrem:

- ✅ **Conexões Multi-Cluster**: Roteamento por schema
- ✅ **Read/Write Splitting**: Primary vs Replica 
- ✅ **Transações Distribuídas**: Single e multi-cluster
- ✅ **Cache Distribuído**: Hit/miss, invalidação
- ✅ **Health Monitoring**: Status dos clusters
- ✅ **Load Balancing**: Diferentes estratégias
- ✅ **Schema Management**: Registro dinâmico
- ✅ **Error Handling**: Reconexão e failover

## 🛠️ Configuração Personalizada

### Modificar Portas
Edite `docker-compose.test.yml`:
```yaml
services:
  postgres-primary-1:
    ports:
      - "5432:5432"  # Mude para porta disponível
```

### Adicionar Dados de Teste
Edite os arquivos SQL em `test/sql/`:
- `init-cluster-1.sql` - Dados do cluster 1
- `init-cluster-2.sql` - Dados do cluster 2  
- `init-failover.sql` - Dados do failover

### Configurar Clusters
Edite `test/config/test-clusters.json`:
```json
{
  "test_cluster_1": {
    "schemas": ["users", "auth"],
    "primary": {
      "host": "localhost",
      "port": 5432
    }
  }
}
```

## 🚨 Troubleshooting

### Erro: "Port already in use"
```bash
# Verifique portas em uso
netstat -tulpn | grep :5432

# Use portas diferentes no docker-compose.test.yml
```

### Erro: "Docker not found"
```bash
# Instale Docker
# Windows: https://docs.docker.com/desktop/windows/
# macOS: https://docs.docker.com/desktop/mac/
# Linux: https://docs.docker.com/engine/install/
```

### Timeout nos Testes
```bash
# Aumente o timeout no package.json
"test:integration": "jest tests/integration.test.ts --testTimeout=120000"
```

### Containers não iniciam
```bash
# Limpe containers antigos
docker-compose -f docker-compose.test.yml down -v --remove-orphans

# Recrie do zero
npm run test:setup
```

## 📈 Performance

### Testes Unitários
- **Tempo**: ~10-15 segundos
- **Memória**: ~50MB
- **Dependências**: Nenhuma

### Testes de Integração
- **Tempo**: ~2-3 minutos (inclui setup Docker)
- **Memória**: ~500MB (containers)
- **Dependências**: Docker

### Otimização
```bash
# Mantenha containers rodando entre testes
npm run test:setup
npm run test:integration
# Deixe rodando para próximos testes
# npm run test:teardown quando terminar
```

## 📝 Adicionando Novos Testes

### Teste Unitário
```typescript
// tests/my-feature.test.ts
describe('My Feature', () => {
  it('should work with mocks', () => {
    // Use mocks/stubs
  });
});
```

### Teste de Integração
```typescript  
// tests/integration.test.ts
describe('My Integration', () => {
  it('should work with real database', async () => {
    const result = await postgres.query('SELECT 1');
    expect(result.rows[0]).toEqual({ '?column?': 1 });
  });
});
```

## 🎯 Comandos Úteis

```bash
# Status dos containers
docker-compose -f docker-compose.test.yml ps

# Logs dos containers  
docker-compose -f docker-compose.test.yml logs

# Conectar ao PostgreSQL
docker exec -it pg-multiverse-primary-1 psql -U test_user -d test_db

# Executar SQL manualmente
docker exec -it pg-multiverse-primary-1 psql -U test_user -d test_db -c "SELECT * FROM users.users;"

# Monitorar recursos
docker stats
```