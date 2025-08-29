/// <reference types="node" />
import { EventEmitter } from 'events';
import { ClusterHealth, ClusterManagerConfig } from '../types';
export declare class HealthChecker extends EventEmitter {
    private config;
    private clusters;
    private healthData;
    private intervalId?;
    private isRunning;
    constructor(config?: ClusterManagerConfig);
    start(clusters: Map<string, any>): Promise<void>;
    stop(): Promise<void>;
    forceCheck(clusterId: string): Promise<void>;
    getClusterHealth(clusterId: string): ClusterHealth;
    removeCluster(clusterId: string): void;
    private performHealthCheck;
    private checkClusterHealth;
    private testConnection;
    private getConnectionMetrics;
    private getQueryMetrics;
    private createInitialHealth;
}
//# sourceMappingURL=HealthChecker.d.ts.map