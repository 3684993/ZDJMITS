<script setup lang="ts">
import {computed} from 'vue';
const props=defineProps<{rows:Array<{label:string;value:number|null;color?:string;offset?:number}>;unit:string;label:string}>();
const scale=computed(()=>Math.max(1,...props.rows.map(r=>Math.max(Math.abs(r.value??0),Math.abs((r.offset??0)+(r.value??0))))));
const width=(v:number|null)=>v===null?0:Math.abs(v)/scale.value*145;
</script>
<template><figure class="fact-bars" role="img" :aria-label="label+' · '+rows.map(r=>r.label+': '+(r.value??'—')).join(' · ')">
<svg viewBox="0 0 460 110" preserveAspectRatio="xMidYMid meet"><g v-for="(row,i) in rows" :key="row.label" :transform="'translate(0,'+(i*100/Math.max(1,rows.length))+')'">
<text x="2" y="17">{{row.label}}</text><line x1="250" y1="0" x2="250" y2="25" stroke="#8795a8"/>
<rect :x="250+Math.min(row.offset??0,(row.offset??0)+(row.value??0))/scale*145" y="5" :width="width(row.value)" height="15" rx="3" :fill="row.color??(row.value!==null&&row.value<0?'#d94c52':'#3182b7')"/>
<text x="457" y="17" text-anchor="end">{{row.value===null?'—':row.value.toLocaleString('en-US',{maximumFractionDigits:2})}}</text></g></svg><figcaption>{{unit}} · 当前有据数值，非历史曲线</figcaption></figure></template>
<style scoped>.fact-bars{margin:0;min-width:0}.fact-bars svg{display:block;width:100%;height:auto;max-height:115px}.fact-bars text{fill:var(--text);font-size:11px}.fact-bars figcaption{font-size:10px;color:var(--muted)}</style>
