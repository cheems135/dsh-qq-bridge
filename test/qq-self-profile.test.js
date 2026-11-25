import assert from 'node:assert/strict';
import test from 'node:test';
import {boundSelfProfileScope,createSelfProfileReader} from '../qq-self-profile.js';

const first = '123456789', second = '987654321';
function socket(account = 'desk', self = first) {
  return {ready: true, qqAccountId: account, qqSenderId: self, qqReceiverRevision: 1};
}
function fixture(answer) {
  const env = {accountId:'desk', connection:socket(), paused:false, stopped:false};
  const calls = [];
  let time = 1000;
  const read = createSelfProfileReader({getScope:()=>boundSelfProfileScope(env), now:()=>time,
    request:async (name,params) => {
      calls.push({name,params});
      return answer(name, params);
    }});
  return {read, env, calls, advance(ms) { time += ms; }};
}
function upstream(self = first) {
  return {user_id:self, nickname:'小鱼', long_nick:'一会儿见', status:10, extStatus:1018,
    avatarUrl:'https://example.org/tracker', backgroundUrl:'https://example.org/banner.svg',
    qzone_cover:'https://qq.com/space-cover.jpg', phoneNum:'private', eMail:'private'};
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve=r; });
  return {promise,resolve};
}

test('homepage reads just the bound self once and projects only public profile fields', async () => {
  const f=fixture((_name,params)=>upstream(params.user_id));
  const p=await f.read();
  assert.deepEqual(f.calls,[{name:'get_stranger_info',params:{user_id:first}}]);
  assert.deepEqual(p,{state:'ready',accountId:'desk',selfId:first,nickname:'小鱼',signature:'一会儿见',
    avatarUrl:'https://q.qlogo.cn/headimg_dl?dst_uin='+first+'&spec=640&img_type=jpg',onlineStatus:'学习中',updatedAt:1000});
  await f.read();
  f.advance(299999);
  await f.read();
  assert.equal(f.calls.length,1);
  f.advance(1);
  await f.read();
  assert.equal(f.calls.length,2);
});

test('parallel visitors share a pending read, failures respect a short TTL and cannot imply online', async () => {
  const wait=deferred();
  const f=fixture((name)=>name==='get_stranger_info'?wait.promise:Promise.reject(new Error('unsupported')));
  const a=f.read(), b=f.read();
  assert.equal(f.calls.length,1);
  wait.resolve({user_id:first,nickname:'A',long_nick:'',status:999});
  const [p,q]=await Promise.all([a,b]);
  assert.equal(p.state,'partial');
  assert.equal(p.onlineStatus,'');
  assert.deepEqual(p,q);
  assert.deepEqual(f.calls.map(x=>x.name),['get_stranger_info','nc_get_user_status']);
  f.advance(59999); await f.read();
  assert.equal(f.calls.length,2);
  f.advance(1); await f.read();
  assert.equal(f.calls.length,4);
});

test('custom wording is read only for a matching custom online status and not shown while offline', async () => {
  const f=fixture(()=>({...upstream(),extStatus:2000,customStatus:{wording:'在片场'}}));
  assert.equal((await f.read()).onlineStatus,'在片场');
  const g=fixture(()=>({...upstream(),status:20,extStatus:2000,customStatus:{wording:'陈旧自定义'}}));
  assert.equal((await g.read()).onlineStatus,'离线');
  const h=fixture((name)=>name==='get_stranger_info'?{...upstream(),status:0}:{status:70,ext_status:0});
  assert.equal((await h.read()).onlineStatus,'请勿打扰');
  assert.equal(h.calls[1].params.user_id,first);
  const i=fixture(()=>({...upstream(),extStatus:42345}));
  assert.equal((await i.read()).onlineStatus,'在线（扩展状态 42345）');
});

test('offline, paused, standby, closed and unbound connections issue no QQ requests', async () => {
  const f=fixture(()=>upstream());
  for (const [patch,state] of [
    [{connection:null},'offline'], [{connection:{...socket(),ready:false}},'offline'],
    [{connection:socket(),stopped:true},'offline'], [{stopped:false,paused:true},'paused'],
    [{paused:false,connection:socket('other')},'unbound'], [{connection:socket('desk','a/b')},'unbound'],
  ]) {
    Object.assign(f.env,patch);
    const p=await f.read();
    assert.equal(p.state,state);
    assert.equal(p.selfId,'');
    assert.equal(p.avatarUrl,'');
  }
  assert.equal(f.calls.length,0);
});

test('late replies are discarded when a connection closes, is held, or is rebound to another receiver', async () => {
  for (const after of [
    env=>{env.connection=null;}, env=>{env.paused=true;},
    env=>{env.connection.qqSenderId=second;env.connection.qqReceiverRevision++;},
    env=>{env.connection=socket();},
    env=>{env.accountId='other';env.connection=socket('other',second);},
  ]) {
    const wait=deferred();
    const f=fixture(()=>wait.promise);
    const p=f.read();
    after(f.env);
    wait.resolve({...upstream(),status:0});
    const value=await p;
    assert.equal(value.nickname,'');
    assert.equal(value.signature,'');
    assert.equal(value.updatedAt,0);
    assert.equal(f.calls.length,1);
  }
});

test('neither wrong-identity replies nor a previous socket’s captured login name leak into the card', async () => {
  const f=fixture((name)=>name==='get_stranger_info'?upstream(second):{});
  f.env.connection.qqProfileLogin={revision:1,selfId:first,nickname:'本人'};
  const a=await f.read();
  assert.equal(a.nickname,'本人');
  assert.equal(a.signature,'');
  assert.equal(a.onlineStatus,'');
  f.env.connection.qqReceiverRevision++;
  const b=await f.read();
  assert.equal(b.nickname,'');
  assert.equal(b.updatedAt,0);
});

test('another account may load before the previous request settles without inheriting its cache', async () => {
  const wait=deferred();
  const f=fixture((_name,{user_id})=>user_id===first?wait.promise:{...upstream(second),nickname:'新账号'});
  const a=f.read();
  f.env.accountId='mobile';
  f.env.connection=socket('mobile',second);
  assert.equal((await f.read()).nickname,'新账号');
  wait.resolve(upstream());
  const old=await a;
  assert.equal(old.selfId,second);
  assert.equal(old.nickname,'');
  assert.equal((await f.read()).nickname,'新账号');
  assert.equal(f.calls.length,2);
});
