// An enumerable symbol survives local object spreads without adding forum rows to
// JSON tool results, model context, or ordinary message history.
export const publicForumReplies = Symbol('public forum replies');

const postId = value => (typeof value === 'string' || Number.isSafeInteger(value)) &&
  /^[1-9]\d{0,19}$/.test(String(value)) ? String(value) : '';
const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
function threadId(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'tieba.baidu.com' || u.port || u.username || u.password) return '';
    if ([...u.searchParams.keys()].some(k => /token|secret|password|auth|key|session|cookie|credential|code/i.test(k))) return '';
    return /^\/p\/([1-9]\d{0,19})\/?$/.exec(u.pathname)?.[1] || '';
  } catch { return ''; }
}

// Follow native post containers and their declared IDs. Content outside the
// post body (author cards, signatures, controls, neighbours) has no speaker.
export function tiebaReplies(url, html, decode) {
  const tid = threadId(url);
  if (!tid) return [];
  const nodes = new Map(), ambiguous = new Set(), stack = [];
  const stream = String(html).slice(0, 1_500_000)
    .replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  const tokens = stream.matchAll(/<\/?([a-z][\w:-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>|([^<]+)/gi);
  let count = 0;
  for (const [raw, name, words] of tokens) {
    if (++count > 60_000 || stack.length > 150 || nodes.size > 500) break;
    const parent = stack.at(-1);
    if (words !== undefined) {
      if (parent?.body && parent.body.text.length < 600) parent.body.text += decode(words.slice(0, 800));
      continue;
    }
    const tag = name.toLowerCase();
    if (raw.startsWith('</')) {
      const i = stack.findLastIndex(el => el.tag === tag);
      if (i >= 0) stack.length = i;
      continue;
    }
    if (voidTags.has(tag) || raw.endsWith('/>')) {
      if (tag === 'br' && parent?.body) parent.body.text += ' ';
      continue;
    }
    let floor = parent?.floor, reply = parent?.reply, body = parent?.body;
    if (/\s(?:class|id|data-field)\s*=/i.test(raw)) {
      const attrs = Object.fromEntries([...raw.matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
        .map(([,k,a,b,c]) => [k.toLowerCase(), decode(a ?? b ?? c)]));
      const classes = (attrs.class || '').split(/\s+/);
      const isFloor = classes.includes('l_post'), isReply = classes.includes('lzl_single_post');
      if (isFloor || isReply) {
        let data;
        try { data = JSON.parse(attrs['data-field']); } catch {}
        body = undefined;
        if (isFloor) { floor = undefined; reply = undefined; }
        const meta = isFloor ? data?.content : data;
        const id = postId(isFloor ? meta?.post_id : meta?.spid);
        const pid = postId(meta?.pid);
        if (id && (isFloor || (floor && (!pid || pid === floor.id)))) {
          const parentRef = meta?.reply_to_spid || meta?.parent_id;
          const record = {id, floorId:floor?.id, number:Number(meta?.post_no),
            parentId:postId(parentRef), invalidParent:!!parentRef && String(parentRef)!=='0' && !postId(parentRef), child:isReply, text:''};
          if (nodes.has(id)) ambiguous.add(id);
          nodes.set(id,record);
          if (isFloor) floor = record;
          else reply = record;
        } else if (isReply) reply = undefined;
      }
      if (floor && !reply && attrs.id === 'post_content_'+floor.id && classes.includes('d_post_content')) body = floor;
      if (reply && classes.includes('lzl_content_main')) body = reply;
    }
    stack.push({tag, floor, reply, body});
  }
  const records = [...nodes.values()].filter(r => !ambiguous.has(r.id));
  for (const row of records) row.text = row.text.replace(/\s+/g,' ').trim();
  const roots = records.filter(r => !r.child && r.number === 1 && r.text);
  const root = roots.length === 1 ? roots[0] : null;
  const samples = [];
  for (const row of records) {
    if (!row.text || row === root || row.invalidParent || ambiguous.has(row.floorId)) continue;
    let parent, relation;
    const addressed = /^(?:回复|回覆|引用|@)/u.test(row.text);
    let text = row.text;
    if (row.parentId) {
      parent = nodes.get(row.parentId);
      if (!parent || parent === row || ambiguous.has(parent.id) ||
          (row.child && (parent.child ? parent.floorId : parent.id) !== row.floorId)) continue;
      // Remove the visible addressee; only the structural ID selects the parent.
      if (addressed) {
        const match = /^(?:回复|回覆)\s*@?[^:：]{1,48}\s*[:：]\s*(.+)$/u.exec(text);
        if (!match) continue;
        text = match[1];
      }
      relation = 'direct';
    } else {
      if (addressed) continue;
      parent = row.child ? nodes.get(row.floorId) : root;
      if (!parent || ambiguous.has(parent.id) || (!row.child && !(row.number > 1))) continue;
      relation = row.child ? 'floor' : 'thread';
    }
    if (!parent.text || !text) continue;
    samples.push({id:tid+':'+row.id, text:text.slice(0,200), context:parent.text.slice(0,100), relation});
    if (samples.length === 12) break;
  }
  return samples;
}
