import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {naturalBubbleParts} from '../chat-bubbles.js';
import {cleanLocalReply} from '../local-reply.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {listenLocalServer} from './local-server-listen.js';

const continuous='今天先去楼下走一小圈就好，别一开始把目标定得太满。走到路口看看树，回来喝点水，慢慢找到舒服的节奏。偶尔漏一天也没关系，第二天照常出门就好。你更喜欢早上出去，还是傍晚凉快的时候？';

test('local dialogue keeps one line across punctuation, inline links and literal newline escapes',()=>{
  const singleLine=continuous+'～ 然后看看 https://example.org/walk，记一下\\n这个符号。';
  assert.deepEqual(naturalBubbleParts(cleanLocalReply(singleLine)),[singleLine]);
});

test('local dialogue filters leaked dividers around real line breaks',()=>{
  const text='先关窗||然后泡茶\r\n‖\r稍等｜｜马上就好\n最后留灯';
  assert.deepEqual(naturalBubbleParts(cleanLocalReply(text)),['先关窗 然后泡茶','稍等 马上就好','最后留灯']);
});

test('actual local gateway preserves authored newlines using a single model call per turn',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'qq-bridge-newline-'));
  const configFile=join(dir,'config.json');
  writeFileSync(configFile,JSON.stringify({voiceEnabled:false,fastDialogue:false}));
  const modelReplies=[continuous,'先关窗||然后泡茶\r\n明天再出去'];
  let models=0;
  const service=createLocalModelServer({
    configFile,
    env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'test.log')},
    logger:()=>{},
    model:async()=>modelReplies[models++],
    runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true})},
  });
  try{
    const base=await listenLocalServer(service);
    for(const [index,expected] of [[continuous],['先关窗 然后泡茶','明天再出去']].entries()){
      const res=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'我想开始散步，漏了一天怎么办？'}]})});
      const out=await res.json();
      assert.equal(res.status,200,JSON.stringify(out));
      assert.equal(models,index+1);
      assert.deepEqual(naturalBubbleParts(out.text),expected);
      assert.equal(out.qqDelivered,false);
    }
  }finally{
    service.server.closeAllConnections();
    await service.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
