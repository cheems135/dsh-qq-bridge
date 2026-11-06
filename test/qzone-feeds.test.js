import test from 'node:test';
import assert from 'node:assert/strict';
import {feedsComments} from '../qzone-feeds.js';
const post={tid:'post_ab12',uin:'12345678'};
const marker=`<i name="feed_data" data-tid="post_ab12" data-uin="12345678"></i>`;
const root=`<li class="comments-item" data-type="commentroot" data-tid="1" data-uin="87654321" data-nick="小明"><div class="comments-content"><a>小明</a>&nbsp;:&nbsp;好看 &amp; 喜欢<img alt="[笑]" src="x"></div></li>`;
test('feeds3 returns only observed exact post root comments with decoded text',()=>{
 const result=feedsComments({data:{data:[{html:marker+root}]}},post);
 assert.equal(result.matched,true);assert.equal(result.rows.length,1);
 assert.deepEqual(result.rows[0],{id:'1',uin:'87654321',name:'小明',text:'好看 & 喜欢[笑]',at:0,source:'feeds3-preview'});
 assert.match(result.coverage,/可能不含全部/);
});
test('another post, author, ambiguous multi-post fragment or nested reply cannot become a target',()=>{
 for(const html of [marker.replace('post_ab12','other')+root,marker.replace('12345678','99999999')+root,marker+root+marker,marker+root.replace('commentroot','replyroot')])assert.equal(feedsComments({data:{data:[{html}]}},post).rows.length,0);
});
test('feeds3 retains text rather than HTML executable instructions and does not guess missing IDs',()=>{
 const r=feedsComments({data:{data:[{html:marker+root.replace('好看','<script>secret()</script>好看')+root.replace('data-tid="1"','data-tid="invalid"')}]}},post);
 assert.equal(r.rows.length,1);assert.doesNotMatch(r.rows[0].text,/secret|script/);
});
