export const mobilePrimaryRouteNames=['overview','trade-records','positions','settings'] as const;
export const mobileMoreRouteNames=['universe','temporal','intelligence','brain','orders','memory','operations'] as const;
export type DashboardRouteName=typeof mobilePrimaryRouteNames[number]|typeof mobileMoreRouteNames[number];
export const isPrimaryMobileRoute=(name:string)=>mobilePrimaryRouteNames.includes(name as typeof mobilePrimaryRouteNames[number]);
export const routePath=(name:string)=>name==='overview'?'/':`/${name}`;
