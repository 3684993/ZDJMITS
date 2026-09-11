import {describe,expect,it} from 'vitest';
import {reactive} from 'vue';
import {candidateBlacklistDto} from './candidateBlacklistDto';

describe('candidate blacklist plain DTO',()=>{
  const candidate=reactive({symbol:'BUSDT',underlyingAsset:'B'}) as any;
  it('builds a Symbol DTO from a Vue proxy without cloning it',()=>{const dto=candidateBlacklistDto(candidate,'SYMBOL');expect(dto).toEqual({symbol:'BUSDT',underlying:'B',scope:'SYMBOL',reason:'USER_BLACKLIST'});expect(()=>structuredClone(dto)).not.toThrow();});
  it('builds an Underlying DTO without passing the reactive candidate',()=>{const dto=candidateBlacklistDto(candidate,'UNDERLYING');expect(dto).toEqual({underlying:'B',scope:'UNDERLYING',reason:'USER_BLACKLIST'});expect(()=>structuredClone(dto)).not.toThrow();});
});
