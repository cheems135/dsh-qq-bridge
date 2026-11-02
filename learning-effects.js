import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const privatePattern=/\b\d{5,}\b|https?:\/\/|@\S|(?:住在|住址|手机号|身份证|密码|密钥|账号是|名字叫|我(?:爸|妈|朋友|同学|对象)|他(?:爸|妈)|她(?:爸|妈)|(?:张|王|李|赵|刘|陈|杨|黄|周|吴)[\u4e00-\u9fff]{1,3}(?:喜欢|讨厌|住|是|有|说|今天|昨天)|(?:他|她|某人|对方)(?:的(?:生日|家|工作)|住|叫)|(?:今天|昨天|上次|刚才).{0,12}(?:告诉|答应|喜欢|讨厌))/i;
export const learningActor=meta=>hash([meta.accountId||'',meta.personaId||'']);

/** Transfer general knowledge or reviewed expression patterns, never source quotes. */
export function portableLearning(item,{redact=value=>value}={}){
  const fields=['summary','when','avoid','example'];
  const text=fields.map(field=>String(item[field]||'')).join('\n');
  if(!text.trim()||privatePattern.test(text)||redact(text)!==text)return false;
  if(['web','video'].includes(item.source?.type))return true;
  return item.portable===true&&['social','expression','meme'].includes(item.kind);
}

export function learningEffectScore(item){
  const effects=item.effects||{},positive=Number(effects.positive)||0,negative=Number(effects.negative)||0;
  return Math.max(-4,Math.min(2,positive*.3-negative*.8));
}

export function applyLearningFeedback(item,{id,rating,at,source='owner',note=''}={}){
  if(!id||![-1,1].includes(rating)||!['owner','user-correction'].includes(source))throw Error('反馈必须对应真实评价和具体记录');
  const effects=item.effects||(item.effects={positive:0,negative:0,events:[]});effects.events||=[];
  const previous=effects.events.find(event=>event.id===id);
  if(previous?.rating===rating)return false;
  if(previous){effects[previous.rating>0?'positive':'negative']=Math.max(0,(Number(effects[previous.rating>0?'positive':'negative'])||0)-1);effects.events=effects.events.filter(event=>event.id!==id);}
  effects[rating>0?'positive':'negative']=(Number(effects[rating>0?'positive':'negative'])||0)+1;
  effects.events.push({id,rating,at,source,note:String(note).slice(0,300)});effects.events=effects.events.slice(-30);
  effects.suspended=effects.negative>=3&&effects.negative>effects.positive+1;
  return true;
}
