import { LoadBalancingStrategy, LoadBalancerStats } from '../types';
export declare class LoadBalancer {
    private strategy;
    private currentIndex;
    private stats;
    setStrategy(strategy: LoadBalancingStrategy): void;
    selectReplica(replicas: any[], options?: any): number;
    getStats(): LoadBalancerStats;
    private roundRobinSelect;
    private weightedSelect;
    private leastConnectionsSelect;
    private responseTimeSelect;
    private healthAwareSelect;
    private calculateHealthScore;
    private getConnectionCount;
    private getResponseTime;
    private updateStats;
}
//# sourceMappingURL=LoadBalancer.d.ts.map