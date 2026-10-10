import {describe,it,expect,vi,afterEach} from 'vitest';
import {OpenAiCompatibleClient,classifyAiProbeError} from './OpenAiCompatibleClient.js';
afterEach(()=>vi.unstubAllGlobals());
describe('model health is separate from process identity and inference',()=>{
  it('separates refusal from timeout and unknown network errors',()=>{
    expect(classifyAiProbeError({cause:{code:'ECONNREFUSED'}})).toBe('AI_CONNECTION_REFUSED');
    expect(classifyAiProbeError({name:'AbortError'})).toBe('AI_PROBE_TIMEOUT');
    expect(classifyAiProbeError(new Error('fetch failed'))).toBe('AI_UNREACHABLE_UNKNOWN');
  });
  it('requires a valid health body and never submits inference or an extra props request',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'ok'})));vi.stubGlobal('fetch',fetcher);
    expect(await new OpenAiCompatibleClient().probe('http://127.0.0.1:8084/v1')).toMatchObject({ok:true});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8084/health');
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({status:'loading'})));
    expect(await new OpenAiCompatibleClient().probe('http://127.0.0.1:8084/v1')).toMatchObject({ok:false,reason:'AI_HEALTH_BODY_UNKNOWN'});
  });
});
