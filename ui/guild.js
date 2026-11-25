export function guildView(){
  return '<section class="card"><h2>已加入的频道</h2><p class="muted">通过当前设备的 QQ 账号读取。最近一次结果只对应这次查询。</p><button id="guildRead" type="button" class="primary">读取频道列表</button><p id="guildState" role="status">尚未查询</p><div id="guildContent"></div></section>';
}
export function bindGuild(api){
  const start=document.getElementById('guildRead');
  if(!start)return;
  const state=document.getElementById('guildState'),content=document.getElementById('guildContent');
  let revision=0;
  function button(label,select){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=select;return b;}
  async function show(action,params={},parent=null){
    const version=++revision;
    state.textContent='正在读取…';content.replaceChildren();start.disabled=true;
    if(parent)content.append(button('返回上一级',parent));
    try{
      const reply=await api('POST','/im-bridge/features/guild',{action,params});
      if(version!==revision||!start.isConnected)return;
      if(!reply.ok||!Array.isArray(reply.result))throw Error(reply.error||'频道接口没有返回可用的列表');
      state.textContent=reply.coverage+' · '+new Date().toLocaleTimeString();
      const list=document.createElement('ul');
      for(const item of reply.result){
        const li=document.createElement('li');
        if(action==='get_guild_list')li.append(button(item.name||item.guild_id,()=>show('get_guild_channel_list',{guild_id:item.guild_id},()=>show('get_guild_list'))));
        else if(action==='get_guild_channel_list')li.append(button(item.name||item.channel_id,()=>show('get_topic_channel_feeds',{guild_id:item.guild_id,channel_id:item.channel_id},()=>show(action,params,parent))));
        else{const title=document.createElement('strong'),p=document.createElement('p'),author=document.createElement('small');title.textContent=item.title||'话题';p.textContent=item.text||'';author.textContent=[item.author,item.time?new Date(item.time*1000).toLocaleString():''].filter(Boolean).join(' · ');li.append(title,p,author);}
        list.append(li);
      }
      content.append(list);
    }catch(e){if(version===revision&&start.isConnected)state.textContent='查询未完成 · '+e.message;}
    finally{if(version===revision&&start.isConnected)start.disabled=false;}
  }
  start.onclick=()=>show('get_guild_list');
}
