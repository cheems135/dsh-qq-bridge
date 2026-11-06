import test from 'node:test';
import assert from 'node:assert/strict';
import {feedsComments,feedsPost} from '../qzone-feeds.js';
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
test('feeds3 skips real-shaped malformed entries without dropping the valid exact-post comment',()=>{
 const r=feedsComments({data:{data:[null,{html:marker+root},null,{},'junk',17]}},post);
 assert.equal(r.matched,true);assert.equal(r.rows.length,1);
 assert.deepEqual(r.rows[0],{id:'1',uin:'87654321',name:'小明',text:'好看 & 喜欢[笑]',at:0,source:'feeds3-preview'});
});
test('feeds3 ignores array entries and non-string html',()=>{
 const r=feedsComments({data:{data:[[marker+root],{html:[marker+root]},marker+root]}},post);
 assert.equal(r.matched,false);assert.equal(r.rows.length,0);
});

test('feeds3 handles nested roots and replies with a shared id, distinct authors, decoded prefixes and exact parent scope',()=>{
 const nested=marker+
  '<li data-type="commentroot" data-tid="42" data-uin="87654321" data-nick="甲&amp;乙"><div class="comments-content"><a href="?a=1&amp;b=2">甲&amp;乙</a>&nbsp;:&nbsp;根 &amp; 文字</div>'+
  '<ul class="comments-list"><li data-type="replyroot" data-tid="42" data-uin="12345678" data-nick="我"><div class="comments-content"><a>我</a>&nbsp;回复&nbsp;<a>甲&amp;乙</a>&#xFF1A;&nbsp;子级 &quot;保留&quot;</div></li></ul></li>'+
  '<li data-type="commentroot" data-tid="43" data-uin="87654322" data-nick="丙"><div class="comments-content"><a>丙</a>：另一根</div></li>'+
  '<li data-type="replyroot" data-tid="44" data-uin="12345678" data-nick="我"><div class="comments-content"><a>我</a> 回复 <a>丙</a>: 另一子级</div></li>';
 const result=feedsComments({data:{data:[null,{html:nested},null]}},{...post,includeReplies:true});
 assert.equal(result.matched,true);
 assert.deepEqual(result.rows.map(row=>[row.id,row.uin,row.text,row.depth,row.parentId,row.parentUin]),[
  ['42','87654321','根 & 文字',0,null,null],
  ['42','12345678','子级 "保留"',1,'42','87654321'],
  ['43','87654322','另一根',0,null,null],
  ['44','12345678','另一子级',1,'43','87654322'],
 ]);
});

test('feedsPost reads exact own text and counts only image items inside that post body',()=>{
 const imageItem=count=>`<div class="img-box">${Array.from({length:count},()=>'<a class="img-item" data-type="popup"><img src="image"></a>').join('')}</div>`;
 const own=marker+
  '<div class="f-info">完整 &amp; 目标正文</div>'+
  imageItem(2)+
  `<div class="f-single-foot"><div class="comments-list">${imageItem(3)}</div></div>`;
 const avatar='<a class="user-avatar"><img src="avatar"></a>';
 const other=`<i name="feed_data" data-tid="other-post" data-uin="12345678"></i><div class="f-info">其他动态</div>${imageItem(4)}`;
 const result=feedsPost({data:{data:[avatar+other,null,{html:avatar+own},null]}},post);
 assert.equal(result.matched,true);
 assert.equal(result.text,'完整 & 目标正文');
 assert.equal(result.imageCount,2);
});

test('feedsPost leaves image count unknown for malformed media and returns zero only for a clean text post',()=>{
 const unknown=marker+'<div class="f-info">正文</div><div class="img-box"><a class="img-item">not an image</a></div>';
 assert.equal(feedsPost({data:{data:[{html:unknown}]}},post).imageCount,null);
 const plain=feedsPost({data:{data:[{html:marker+'<div class="f-info">正文</div>'}]}},post);
 assert.equal(plain.matched,true);
 assert.equal(plain.imageCount,0);
 const ambiguous=feedsPost({data:{data:[{html:marker+marker+'<div class="img-box"><a class="img-item"><img></a></div>'}]}},post);
 assert.equal(ambiguous.matched,false);
});

test('real-shaped comment controls and HTML line breaks do not pollute full reply text',()=>{
 const html=marker+'<li data-type="commentroot" data-tid="1" data-uin="87654321" data-nick="读者"><div class="comments-content"><a>读者</a>: 根评论<div class="comments-op"><span>10:00</span><a>回复</a></div></div></li><li data-type="replyroot" data-tid="1" data-uin="12345678" data-nick="我"><div class="comments-content"><a>我</a>: 第一行<br/>第二行<div class="comments-op"><span>10:01</span><a>回复</a></div></div></li>';
 const result=feedsComments({data:{data:[{html}]}},{...post,includeReplies:true});assert.equal(result.rows[1].text,'第一行 第二行');assert.equal(result.rows[1].parentId,'1');
});

test('compact wupfeed post uses full text instead of like-event label and tolerates repeated class attributes',()=>{
 const html=marker+'<div class="f-info">赞了我的说说</div><div class="img-box"><a class="img-item" class="with-sign"><img src="image"></a></div><p class="txt-box-title ellipsis-one"><a class="nickname name">角色名</a><span class="state">的说说：</span><br/>第一行<br/>第二行</p><div class="f-single-foot"><img src="avatar"></div>';
 const result=feedsPost({data:{data:[{html}]}},post);assert.equal(result.text,'第一行 第二行');assert.equal(result.imageCount,1);
});
