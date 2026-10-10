<script setup lang="ts">
import {onMounted,onBeforeUnmount,watch,ref} from 'vue';
import * as echarts from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent,TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
echarts.use([LineChart,GridComponent,TooltipComponent,CanvasRenderer]);
const props=defineProps<{points:Array<{ts:number;value:number|null}>;unit:string;label:string}>();
const canvas=ref<HTMLDivElement|null>(null);
let chart:echarts.ECharts|null=null,observer:ResizeObserver|null=null;
function draw(){
  if(!canvas.value)return;
  if(!chart)chart=echarts.init(canvas.value);
  const points=props.points.filter(p=>Number.isFinite(p.ts));
  chart.setOption({
    animation:false,grid:{top:15,left:8,right:14,bottom:26,containLabel:true},
    tooltip:{trigger:'axis',valueFormatter:(v:unknown)=>v==null?'UNKNOWN':String(v)+' '+props.unit},
    xAxis:{type:'time',axisLabel:{color:'#7b879a',fontSize:10},axisLine:{lineStyle:{color:'#dce5ef'}}},
    yAxis:{type:'value',scale:true,name:props.unit,nameTextStyle:{color:'#7b879a',fontSize:10},axisLabel:{color:'#7b879a',fontSize:10},splitLine:{lineStyle:{color:'#e8edf4'}}},
    series:[{name:props.label,type:'line',showSymbol:false,connectNulls:false,areaStyle:{opacity:0.09},lineStyle:{width:2},data:points.map(p=>[p.ts,p.value])}],
  },true);
  chart.resize();
}
onMounted(()=>{draw();if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>chart?.resize());if(canvas.value)observer.observe(canvas.value);}});
watch(()=>props.points,draw,{deep:true});
onBeforeUnmount(()=>{observer?.disconnect();chart?.dispose();chart=null;});
</script>
<template><div class="metric-chart" role="img" :aria-label="label+'，样本数'+points.length+'，单位'+unit"><div ref="canvas" class="metric-chart-canvas"></div><small v-if="!points.some(p=>p.value!==null)" class="metric-chart-empty">暂无真实采样 · UNKNOWN</small></div></template>
<style scoped>
.metric-chart{position:relative;min-width:0}.metric-chart-canvas{height:180px;width:100%}.metric-chart-empty{position:absolute;inset:45% 0 auto;text-align:center;color:var(--muted);pointer-events:none;font-size:12px}
</style>
