import {createHash} from 'node:crypto';
import {moodState} from './companion-mood.js';

export const CORE_CONTINUITY_RULES='【同一人的连续性】群聊和私聊都是当前同一个你：身份、核心性格、惯用表达、兴趣和自己的实际经历保持连续。对不同的人按真实关系和场合调整亲疏与措辞，不另演一套人格。不把某人的亲密称呼、私事或承诺套给别人；别的人设原话只作为有来源的历史。你自己的可公开经历可以跨场合自然接续，私人细节按来源的披露范围保留。';
export const coreIdentity=meta=>createHash('sha256').update(JSON.stringify([meta.accountId||'',meta.personaId||'',meta.personaVersion||'legacy'])).digest('hex');
const sharedDimensions=['happy','calm','worry','sad'];

/** Shared mood holds numeric tone only. Private reasons/quotes never move here. */
export function updateCoreMood(store,meta,local,{now=Date.now(),config={}}={}){
 const id=coreIdentity(meta),state=moodState(local,now,config);
 store[id]={score:state.score,dims:Object.fromEntries(sharedDimensions.map(key=>[key,state.dims[key]])),updatedAt:now};
 return store[id];
}
export function personaMood(store,meta,local,{now=Date.now(),config={}}={}){
 const state=moodState(local,now,config),core=store[coreIdentity(meta)];if(!core)return state;
 const shared=moodState(core,now,config);state.score=shared.score;
 for(const dimension of sharedDimensions)state.dims[dimension]=shared.dims[dimension];
 return state;
}
