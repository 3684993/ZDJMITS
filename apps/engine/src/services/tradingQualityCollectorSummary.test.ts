import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {harness} from './tradingQualityTestHarness.js';
import {TradingQualityCollector} from './tradingQualityCollector.js';

it('projects a bounded HTTP summary without materialising raw evidence payloads',()=>{
  const h=harness(),dir=mkdtempSync(path.join(tmpdir(),'tq-http-summary-'));
  const collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus);
  try{
    const summary=collector.summary() as any;
    expect(summary).toMatchObject({schemaVersion:'TQ-HTTP-SUMMARY-1',status:'READY',fullReportAvailableOffline:true,authorization:'NONE'});
    expect(summary.counts).toMatchObject({episodes:0,episodeWork:0,dirtyEpisodeWork:0,marks:0,collectorSamples:0});
    expect(summary.factsByKind).toEqual({});
    expect(summary).not.toHaveProperty('episodes');
    expect(summary).not.toHaveProperty('facts');
  }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
});
