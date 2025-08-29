# Contributing to PG Multiverse

Thank you for your interest in contributing to **pg-multiverse**! We welcome contributions from the community and appreciate your help in making this project better.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Style Guide](#style-guide)
- [Issue Reporting](#issue-reporting)
- [Feature Requests](#feature-requests)

## 🤝 Code of Conduct

This project adheres to a Code of Conduct that we expect all contributors to follow:

- **Be respectful** and inclusive of all contributors
- **Be constructive** in discussions and code reviews
- **Focus on what's best** for the community and the project
- **Show empathy** towards other community members

## 🚀 Getting Started

### Prerequisites

- **Node.js** 16.0.0 or higher
- **npm** 8.0.0 or higher
- **Docker** and **Docker Compose** (for testing)
- **PostgreSQL** knowledge is helpful

### Fork and Clone

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
```bash
git clone https://github.com/YOUR-USERNAME/pg-multiverse.git
cd pg-multiverse
```

3. **Add the upstream** remote:
```bash
git remote add upstream https://github.com/andeerc/pg-multiverse.git
```

## 🛠️ Development Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Project
```bash
npm run build
```

### 3. Set up Test Environment
```bash
# Start PostgreSQL test containers
npm run test:setup

# Run tests
npm run test:integration

# Clean up
npm run test:teardown
```

### 4. Run Linting
```bash
npm run lint        # Fix linting issues
npm run lint:check  # Check for linting issues
```

### 5. Format Code
```bash
npm run format      # Format all code
npm run format:check # Check formatting
```

## 🔄 Making Changes

### Branch Naming

Use descriptive branch names:
- **Features**: `feature/add-connection-retry`
- **Bug fixes**: `fix/connection-pool-leak`
- **Documentation**: `docs/update-readme`
- **Performance**: `perf/optimize-query-routing`

### Commit Messages

Follow the [Conventional Commits](https://conventionalcommits.org/) format:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `ci`: CI/CD changes

**Examples:**
```bash
feat(cluster): add automatic failover support
fix(pool): resolve connection leak in retry logic
docs(readme): update installation instructions
test(integration): add multi-schema transaction tests
```

### Keep Changes Focused

- Make **small, focused commits** that do one thing well
- **Separate concerns** - don't mix refactoring with new features
- **Write descriptive commit messages** explaining the "why"

## 🧪 Testing

### Test Types

1. **Integration Tests**: Test with real PostgreSQL instances
```bash
npm run test:integration
```

2. **Full Test Suite**: Complete test cycle with Docker
```bash
npm run test:docker
```

### Writing Tests

- **Test new features** you add
- **Test edge cases** and error conditions
- **Use descriptive test names** that explain what's being tested
- **Follow existing test patterns** in the codebase

### Test Guidelines

```typescript
describe('Feature Name', () => {
  beforeAll(async () => {
    // Setup code
  });

  afterAll(async () => {
    // Cleanup code
  });

  it('should handle specific scenario correctly', async () => {
    // Arrange
    const input = createTestInput();
    
    // Act
    const result = await functionUnderTest(input);
    
    // Assert
    expect(result).toMatchExpected();
  });
});
```

## 📤 Submitting Changes

### Before Submitting

1. **Sync with upstream**:
```bash
git fetch upstream
git rebase upstream/main
```

2. **Run the full check**:
```bash
npm run lint:check
npm run build
npm run test:docker
```

3. **Update documentation** if needed

### Pull Request Process

1. **Create a Pull Request** from your fork to the main repository
2. **Fill out the PR template** completely
3. **Reference any related issues** using `Fixes #123` or `Closes #456`
4. **Add screenshots** for UI changes (if applicable)
5. **Wait for review** and address feedback

### Pull Request Template

Your PR should include:

```markdown
## Description
Brief description of what this PR does.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tests pass locally
- [ ] Added new tests for changes
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or clearly documented)
```

## 🎨 Style Guide

### TypeScript Guidelines

- Use **TypeScript strict mode**
- **Export interfaces** that other packages might use
- **Prefer interfaces** over type aliases for object shapes
- **Use generics** for reusable components
- **Document complex types** with TSDoc comments

### Code Style

- **2 spaces** for indentation
- **Single quotes** for strings
- **Trailing commas** in multi-line structures
- **Semicolons** at the end of statements
- **100 character** line limit

### File Organization

```
src/
├── cluster/           # Core cluster management
├── types/            # TypeScript type definitions
└── index.ts          # Main export file

tests/
├── integration.test.ts # Integration tests
└── fixtures/         # Test data and helpers
```

### Documentation

- **TSDoc comments** for public APIs
- **README updates** for new features  
- **Inline comments** for complex logic
- **Examples** for new functionality

### Example Code Style

```typescript
/**
 * Manages connection pool for a PostgreSQL cluster
 */
export class ConnectionPool extends EventEmitter {
  private readonly config: ConnectionPoolConfig;
  private pool!: Pool;

  constructor(config: ConnectionPoolConfig) {
    super();
    this.config = {
      min: 2,
      max: 20,
      ...config,
    };
  }

  /**
   * Gets a connection from the pool
   * @throws {Error} When pool is closed or connection fails
   */
  async getConnection(): Promise<PoolClient> {
    if (this.isClosed) {
      throw new Error('Connection pool is closed');
    }
    
    return this.pool.connect();
  }
}
```

## 🐛 Issue Reporting

### Before Creating an Issue

1. **Search existing issues** to avoid duplicates
2. **Check the documentation** and examples
3. **Try the latest version** of the package

### Bug Reports

Include:
- **Clear description** of the problem
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Environment details** (Node.js version, OS, etc.)
- **Code examples** or minimal reproduction case
- **Error messages** and stack traces

### Bug Report Template

```markdown
## Bug Description
A clear description of what the bug is.

## Reproduction Steps
1. Step 1
2. Step 2
3. Step 3

## Expected Behavior
What you expected to happen.

## Actual Behavior
What actually happened.

## Environment
- Node.js version: 
- npm version:
- pg-multiverse version:
- OS:
- PostgreSQL version:

## Additional Context
Any other relevant information.
```

## 💡 Feature Requests

### Before Requesting

- **Check if it already exists** in issues or roadmap
- **Consider if it fits** the project scope
- **Think about alternatives** that might already exist

### Feature Request Template

```markdown
## Feature Description
Clear description of the proposed feature.

## Problem Statement
What problem does this solve?

## Proposed Solution
How should this feature work?

## Alternatives Considered
What other approaches did you consider?

## Additional Context
Any other relevant information, mockups, or examples.
```

## 📚 Development Resources

### Useful Commands

```bash
# Development
npm run dev               # Watch mode development
npm run build:watch       # Watch mode build

# Testing
npm run test:setup        # Start test databases
npm run test:integration  # Run integration tests
npm run test:teardown     # Stop test databases

# Code Quality
npm run lint             # Fix linting issues
npm run format           # Format code
npm run clean            # Clean build artifacts

# Release (maintainers only)
npm run release          # Patch release
npm run release:minor    # Minor release
npm run release:major    # Major release
```

### Project Architecture

- **Multi-cluster**: Supports multiple PostgreSQL clusters
- **Schema routing**: Automatic routing based on schema
- **Connection pooling**: Efficient connection management
- **Load balancing**: Multiple load balancing strategies
- **Health monitoring**: Automatic health checks and failover
- **Distributed caching**: Built-in caching layer
- **Distributed transactions**: Cross-cluster transaction support

### Key Files

- `src/cluster/MultiClusterPostgres.ts` - Main entry point
- `src/cluster/ClusterManager.ts` - Cluster management
- `src/cluster/ConnectionPool.ts` - Connection pooling
- `src/types/index.ts` - TypeScript definitions
- `docker-compose.test.yml` - Test environment setup

## 🏆 Recognition

Contributors are recognized in:
- **CHANGELOG.md** for each release
- **README.md** contributors section
- **GitHub contributors** graph
- **Release notes** for significant contributions

## 📞 Getting Help

- **GitHub Issues** - For bugs and feature requests
- **GitHub Discussions** - For questions and general discussion
- **Documentation** - Check the README and examples
- **Code Review** - Ask questions in your PR

## 🎉 Thank You!

Every contribution, no matter how small, is valuable to the project. Thank you for taking the time to contribute to **pg-multiverse**!

---

**Happy Contributing!** 🚀