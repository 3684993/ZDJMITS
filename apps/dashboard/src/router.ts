import { createRouter,createWebHistory } from 'vue-router';
import Shell from './layouts/AppShell.vue';
import { dashboardRouteComponent as page } from './routePreload';

const routes=[{path:'/',component:Shell,children:[
  {path:'',name:'overview',component:page('overview')},
  {path:'universe',name:'universe',component:page('universe')},
  {path:'temporal',name:'temporal',component:page('temporal')},
  {path:'intelligence',name:'intelligence',component:page('intelligence')},
  {path:'brain',name:'brain',component:page('brain')},
  {path:'performance',name:'performance',component:page('performance')},
  {path:'positions',name:'positions',component:page('positions')},
  {path:'human-managed',name:'human-managed',component:page('human-managed')},
  {path:'orders',name:'orders',component:page('orders')},
  {path:'trade-records',name:'trade-records',component:page('trade-records')},
  {path:'memory',name:'memory',component:page('memory')},
  {path:'operations',name:'operations',component:page('operations')},
  {path:'settings',name:'settings',component:page('settings')},
]}];

export default createRouter({history:createWebHistory(),routes});
