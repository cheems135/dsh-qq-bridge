import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunningHubAudioPreviews} from '../runninghub-audio.js';
import {scheduledMusicSilence,proactiveShareReply} from '../social-sharing.js';

test('RunningHub preview returns immediately and preserves the original job through a slow render',async()=>{
  let time=0,account='a',release,issued=0;
  const jobs=createRunningHubAudioPreviews({makeId:()=> 'job-1',scope:()=>account,now:()=>time});
  const result=jobs.start('private:one','sing',({onTask})=>{
    issued++;
    onTask('1010');
    return new Promise(resolve=>{release=resolve;});
  });
  assert.equal(result.status,'running');
  assert.equal(result.taskId,'1010');
  time=6*60_000;
  assert.equal(jobs.status(result.jobId).status,'running');
  assert.equal(issued,1);
  release('song.wav');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(jobs.status(result.jobId).name,'song.wav');
  account='b';
  assert.throws(()=>jobs.status(result.jobId),/账号/);
});

test('scheduled listening does not interrupt conversation or reuse a progress report',async()=>{
  const scene={activity:'听几首歌'};
  assert.equal(scheduledMusicSilence('想起刚才那句，有首歌想一起听。',{scene,kind:'listen',active:true}),true);
  assert.equal(scheduledMusicSilence('日程：听音乐已完成，活动记录已更新。',{scene,kind:'listen'}),true);
  assert.equal(scheduledMusicSilence('这首副歌让我想起咱们上次聊的事。',{scene,kind:'listen'}),false);
  assert.equal(scheduledMusicSilence('我刚看到窗边那张画。',{scene:{activity:'画画'},active:true}),false);
  let calls=0;
  assert.equal(await proactiveShareReply('日程：听音乐已完成，活动记录已更新。',{scene,ask:async()=>{calls++;}}),'[skip]');
  assert.equal(calls,0);
});
