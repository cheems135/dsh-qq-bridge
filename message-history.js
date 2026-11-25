import {createHash, randomUUID} from 'node:crypto';
import {constants, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

const keyPattern = /^(private|group):(\d{5,20})$/;
const shardPattern = /^\d{2}-[0-3]\.json$/;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const timeOf = row => Number.isSafeInteger(row.time) && row.time >= 0 && row.time < 253402300800000 ? row.time : 0;
const accountKey = account => hash(['account', account || '']);
const order = (a, b) => timeOf(a) - timeOf(b) || messageKey(a).localeCompare(messageKey(b), 'en');

export function messageKey(row) {
  const identity = row.localId ? ['local', row.localId] : row.messageId ? ['qq', String(row.messageId)] :
    row.historyEventId ? ['event',row.historyEventId] : ['legacy', timeOf(row), row.speakerId || '', row.text || '', row.file || '', row.files || []];
  return hash([row.accountId || '', row.chat, row.dir, identity]);
}

function entries(dir) {
  try {
    if (lstatSync(dir).isSymbolicLink()) throw Error('聊天归档目录不能是外部链接');
    return readdirSync(dir, {withFileTypes:true});
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function jsonRows(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(value)) throw new TypeError('消息索引格式无效');
  return value;
}

export function writeRecentIndex(file, rows) {
  mkdirSync(dirname(file), {recursive:true});
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify(rows), {flag:'wx', mode:0o600});
    renameSync(temp, file);
  } catch (err) {
    try { unlinkSync(temp); } catch {}
    throw err;
  }
}

// A parse error and a missing index are different. Keep the exact damaged bytes
// before rebuilding. An access failure propagates and the caller suspends index writes.
export function readRecentIndex(file) {
  try { return {rows:jsonRows(file), missing:false}; }
  catch (err) {
    if (err.code === 'ENOENT') return {rows:[], missing:true};
    if (!(err instanceof SyntaxError || err instanceof TypeError)) throw err;
    const original=readFileSync(file);
    const preserved=file+'.damaged-'+createHash('sha256').update(original).digest('hex');
    try{copyFileSync(file,preserved,constants.COPYFILE_EXCL);}catch(copyError){if(copyError.code!=='EEXIST')throw copyError;}
    if(!readFileSync(preserved).equals(original))throw Error('损坏索引原件尚未核验，暂停重建');
    return {rows:[], damaged:true, preserved};
  }
}

// One day has four independent shards. A late delivery or withdrawal only rewrites
// the affected shard. A page cursor includes the ID so equal timestamps stay stable.
export function createMessageHistory(getRoot) {
  function recallFile(account,chat,id){
    return join(getRoot(),accountKey(account),chat.replace(':','-'),'withdraw-'+hash(id)[0]+'.json');
  }
  function withdrawn(row,cache){
    if(row.retracted)return true;
    for(const id of new Set([row.messageId,...(Array.isArray(row.sourceMessageIds)?row.sourceMessageIds:[])].filter(Boolean).map(String))){
      const path=recallFile(row.accountId,row.chat,id);
      if(!cache.has(path)){
        try{cache.set(path,new Set(jsonRows(path)));}catch(error){if(error.code!=='ENOENT')throw error;cache.set(path,new Set());}
      }
      if(cache.get(path).has(id))return true;
    }
    return false;
  }
  function shardPath(row) {
    if (!keyPattern.test(row.chat)) throw Error('聊天归档的对话标识无效');
    const day = new Date(timeOf(row)).toISOString().slice(0, 10);
    const num = parseInt(messageKey(row)[0], 16) % 4;
    return join(getRoot(), accountKey(row.accountId), row.chat.replace(':','-'), day.slice(0,7), day.slice(8)+'-'+num+'.json');
  }
  function putMany(rows,{transactional=false}={}) {
    const batches = new Map();
    const occurrences=new Map(),undo=new Map();
    for (const row of rows) {
      if(!row.localId&&!row.messageId&&!row.historyEventId){
        const key=messageKey(row),n=occurrences.get(key)||0;
        row.historyEventId=hash([key,n]);occurrences.set(key,n+1);
      }
      const file = shardPath(row);
      if (!batches.has(file)) batches.set(file, []);
      batches.get(file).push(row);
    }
    function rollback(){
      for(const [file,rows] of undo){if(rows===null)unlinkSync(file);else writeRecentIndex(file,rows);}
    }
    try{for (const [file, incoming] of batches) {
      let saved = [], missing=false;
      try { saved = jsonRows(file); } catch (err) { if (err.code !== 'ENOENT') throw err; missing=true; }
      const merged = new Map(saved.map(row => [messageKey(row), row]));
      let changed = false;
      for (const row of incoming) {
        const id = messageKey(row), previous = merged.get(id);
        const next = previous ? {...previous, ...row} : row;
        if (previous?.retracted) next.retracted = true;
        if (previous && JSON.stringify(previous) === JSON.stringify(next)) continue;
        merged.set(id, next);
        changed = true;
      }
      if (changed) {
        writeRecentIndex(file, [...merged.values()].sort(order));
        if(transactional)undo.set(file,missing?null:saved);
      }
    }}catch(error){rollback();throw error;}
    return rollback;
  }
  function chats(account) {
    return entries(join(getRoot(), accountKey(account))).filter(e => e.isDirectory())
      .map(e => e.name.replace('-',':')).filter(key => keyPattern.test(key));
  }
  function filesByDate(account, keys) {
    const dates = new Map();
    for (const key of keys) {
      if (!keyPattern.test(key)) continue;
      const dir = join(getRoot(), accountKey(account), key.replace(':','-'));
      for (const month of entries(dir)) {
        if (!month.isDirectory() || !/^\d{4}-\d{2}$/.test(month.name)) continue;
        const folder = join(dir, month.name);
        for (const shard of entries(folder)) {
          if (!shard.isFile() || !shardPattern.test(shard.name)) continue;
          const date = month.name+'-'+shard.name.slice(0,2);
          if (!dates.has(date)) dates.set(date, []);
          dates.get(date).push(join(folder, shard.name));
        }
      }
    }
    return dates;
  }
  function page({account, allowed, chat, before, limit=100}) {
    const cursor = before ? parseHistoryCursor(before) : null;
    const keys = (chat ? [chat] : chats(account)).filter(key => keyPattern.test(key) && allowed(key));
    const dates = filesByDate(account, keys);
    const cutoff = cursor && new Date(cursor.time).toISOString().slice(0,10);
    const found = [], recalls=new Map();
    for (const date of [...dates.keys()].sort().reverse()) {
      if (cutoff && date > cutoff) continue;
      const batch = [];
      for (const file of dates.get(date)) {
        for (const row of jsonRows(file)) {
          if ((row.accountId || '') !== account || !keys.includes(row.chat) || !allowed(row.chat)) continue;
          const time = timeOf(row);
          if (cursor && (time > cursor.time || (time === cursor.time && messageKey(row) >= cursor.id))) continue;
          batch.push(withdrawn(row,recalls)?{...row,retracted:true}:row);
        }
      }
      batch.sort((a,b) => order(b,a));
      found.push(...batch.slice(0, limit + 1 - found.length));
      if (found.length > limit) break;
    }
    const rows = found.slice(0,limit);
    return {rows, next:found.length > limit ? historyCursor(rows.at(-1)) : ''};
  }
  function findImage(account, chat, time, id) {
    if (!keyPattern.test(chat) || !/^[0-9a-f]{64}$/.test(id) || !Number.isSafeInteger(time)) return null;
    const date = new Date(time);
    if (!Number.isFinite(date.getTime()) || timeOf({time}) !== time) return null;
    const day = date.toISOString().slice(0,10);
    const file = join(getRoot(),accountKey(account),chat.replace(':','-'),day.slice(0,7),day.slice(8)+'-'+(parseInt(id[0],16)%4)+'.json');
    try { return jsonRows(file).find(r => (r.accountId||'')===account && r.chat===chat && messageKey(r)===id && !withdrawn(r,new Map())); }
    catch (err) { if (err.code==='ENOENT') return null; throw err; }
  }
  function recall(account, chat, id) {
    if (!keyPattern.test(chat)||typeof id!=='string'||!id||id.length>160) return;
    const file=recallFile(account,chat,id);
    let ids=[];
    try{ids=jsonRows(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!ids.includes(id))writeRecentIndex(file,[...ids,id]);
  }
  function clear(account) {
    const root=join(getRoot(),accountKey(account));
    function removeEmpty(dir){
      try{rmdirSync(dir);}catch(error){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;}
    }
    for(const chat of chats(account)){
      const dir=join(root,chat.replace(':','-'));
      for(const entry of entries(dir)){
        const path=join(dir,entry.name);
        if(entry.isFile()&&/^withdraw-[a-f0-9]\.json$/.test(entry.name))unlinkSync(path);
        if(!entry.isDirectory()||!/^\d{4}-\d{2}$/.test(entry.name))continue;
        for(const shard of entries(path))if(shard.isFile()&&shardPattern.test(shard.name))unlinkSync(join(path,shard.name));
        removeEmpty(path);
      }
      removeEmpty(dir);
    }
    removeEmpty(root);
  }
  function exportRows(allowed, accountFilter, byteLimit=45*1024*1024) {
    const rows = [],recalls=new Map();
    let bytes = 0;
    for (const account of entries(getRoot())) {
      if (!account.isDirectory() || !/^[a-f0-9]{64}$/.test(account.name) ||
          accountFilter !== undefined && account.name !== accountKey(accountFilter)) continue;
      const root = join(getRoot(),account.name);
      for (const chat of entries(root)) {
        const key = chat.name.replace('-',':');
        if (!chat.isDirectory() || !keyPattern.test(key)) continue;
        for (const month of entries(join(root,chat.name))) {
          if (!month.isDirectory() || !/^\d{4}-\d{2}$/.test(month.name)) continue;
          const folder=join(root,chat.name,month.name);
          for (const shard of entries(folder)) {
            if (!shard.isFile() || !shardPattern.test(shard.name)) continue;
            for (const row of jsonRows(join(folder,shard.name))) {
              if (row.chat!==key || accountKey(row.accountId)!==account.name || !allowed(key,row.accountId||'')) continue;
              bytes+=Buffer.byteLength(JSON.stringify(row))+1;
              if (bytes>byteLimit) throw Error('聊天归档超过单份 JSON 备份容量。可通过设备同步或复制整个数据目录保留所有记录。');
              rows.push(withdrawn(row,recalls)?{...row,retracted:true}:row);
            }
          }
        }
      }
    }
    return rows.sort(order);
  }
  return {putMany, chats, page, recall, clear, findImage, exportRows};
}

export function historyCursor(row) {
  return row ? timeOf(row)+'.'+messageKey(row) : '';
}
export function parseHistoryCursor(value) {
  const match = /^(\d{1,15})\.([a-f0-9]{64})$/.exec(value);
  if (!match || timeOf({time:Number(match[1])}) !== Number(match[1])) throw Error('历史分页位置无效，请重新打开会话');
  return {time:Number(match[1]), id:match[2]};
}
