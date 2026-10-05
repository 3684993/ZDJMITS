import type { DashboardRouteName } from './navigation';

const viewLoaders:Record<DashboardRouteName,()=>Promise<any>>={
  overview:()=>import('./views/OverviewView.vue'),
  universe:()=>import('./views/UniverseView.vue'),
  temporal:()=>import('./views/TemporalIntelligenceView.vue'),
  intelligence:()=>import('./views/IntelligenceView.vue'),
  brain:()=>import('./views/BrainView.vue'),
  positions:()=>import('./views/PositionsView.vue'),
  'human-managed':()=>import('./views/HumanManagedView.vue'),
  orders:()=>import('./views/OrdersView.vue'),
  'trade-records':()=>import('./views/TradeRecordsView.vue'),
  memory:()=>import('./views/MemoryView.vue'),
  operations:()=>import('./views/OperationsView.vue'),
  settings:()=>import('./views/SettingsView.vue'),
};

const cache=new Map<DashboardRouteName,Promise<any>>();

export function preloadDashboardRoute(name:string){
  const routeName=name as DashboardRouteName;
  const loader=viewLoaders[routeName];
  if(!loader)return Promise.resolve(null);
  const cached=cache.get(routeName);
  if(cached)return cached;
  const promise=loader().catch(error=>{cache.delete(routeName);throw error;});
  cache.set(routeName,promise);
  return promise;
}

export async function preloadDashboardRoutes(current?:string){
  for(const name of Object.keys(viewLoaders) as DashboardRouteName[]){
    if(name===current)continue;
    try{await preloadDashboardRoute(name);}catch{/* Navigation surfaces real chunk failures. */}
    await new Promise(resolve=>setTimeout(resolve,0));
  }
}

export const dashboardRouteComponent=(name:DashboardRouteName)=>()=>preloadDashboardRoute(name);
