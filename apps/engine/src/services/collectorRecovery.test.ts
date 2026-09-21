import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {it,expect} from 'vitest';
import {harness} from './tradingQualityTestHarness.js';
import {TradingQualityCollector} from './tradingQualityCollector.js';
import {EventBus} from '../events/eventBus.js';

it('collector restart uses a new counter identity; reporting legacy databases remains read-only compatible',()=>{
  const dir=mkdtempSync(join(tmpdir(),'v396-collector-')),file=join(dir,'test.sqlite'),h=harness(),bus=new EventBus();
  let collector:TradingQualityCollector|null=null;
  try{
    collector=new TradingQualityCollector(file,h.state,bus);bus.publish('AUDIT_TEST',{});collector.tick(10000);collector.close();collector=null;
    collector=new TradingQualityCollector(file,h.state,bus);collector.tick(20000);
    const report=collector.report();expect(report.collectorMetric).toBe('OBSERVED_DOMAIN_EVENTS_NOT_EXCHANGE_REQUESTS');
    expect(report.collectorWindow).toMatchObject({reset:true,reason:'IDENTITY_CHANGED',sampleCount:1,ratePerHour:null});
    const db=new DatabaseSync(file);try{db.exec('DROP TABLE tq_collector_samples');}finally{db.close();}
    expect(collector.report().collectorWindow.reason).toBe('NO_VALID_SAMPLES');
  }finally{collector?.close();rmSync(dir,{recursive:true,force:true});}
});

