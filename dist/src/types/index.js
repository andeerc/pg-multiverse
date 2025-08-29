"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isClusterConfig = exports.isDatabaseConnection = exports.isQueryResult = void 0;
// ==================== TYPE GUARDS ====================
function isQueryResult(obj) {
    return obj &&
        Array.isArray(obj.rows) &&
        typeof obj.rowCount === 'number' &&
        typeof obj.command === 'string';
}
exports.isQueryResult = isQueryResult;
function isDatabaseConnection(obj) {
    return obj &&
        typeof obj.host === 'string' &&
        typeof obj.port === 'number' &&
        typeof obj.database === 'string' &&
        typeof obj.user === 'string' &&
        typeof obj.password === 'string';
}
exports.isDatabaseConnection = isDatabaseConnection;
function isClusterConfig(obj) {
    return obj &&
        typeof obj.id === 'string' &&
        Array.isArray(obj.schemas) &&
        isDatabaseConnection(obj.primary);
}
exports.isClusterConfig = isClusterConfig;
//# sourceMappingURL=index.js.map