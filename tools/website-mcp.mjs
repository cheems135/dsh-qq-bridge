// MCP stdio: stdout contains JSON-RPC only; no model or GPU service is started.
import {readFileSync,appendFileSync,existsSync,statSync,renameSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createWebsiteMcp} from '../website-mcp.js';
import {createWebsiteMcpProtocol} from '../website-mcp-protocol.js';
import {redactInvocation} from '../invocation-journal.js';
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
if(!args.includes('--manifest')||!value('--manifest')){process.stderr.write('Missing --manifest\n');process.exit(1);}
const manifest=value('--manifest'),scope={accountId:args.includes('--account')?value('--account'):''};
const manager=createWebsiteMcp({storage:{read:()=>{if(!existsSync(manifest))return {version:1,sites:[]};if(statSync(manifest).size>4*1024*1024)throw Error('Manifest too large');return JSON.parse(readFileSync(manifest,'utf8'));},write:()=>{throw Error('MCP transport cannot modify website registrations');}},onRecord:(event)=>{try{const log=manifest+'.calls.ndjson';if(existsSync(log)&&statSync(log).size>2*1024*1024)renameSync(log,log+'.previous');appendFileSync(log,JSON.stringify(redactInvocation({...event,...scope,backend:'mcp'}))+'\n');}catch{process.stderr.write('Could not save MCP call record\n');}}});
const dispatch=createWebsiteMcpProtocol({manager,scope});
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
let chain=Promise.resolve();
lines.on('line',line=>{
  chain=chain.then(async()=>{
    let response;
    if(Buffer.byteLength(line)>65536)response={jsonrpc:'2.0',id:null,error:{code:-32600,message:'Request too large'}};
    else try{response=await dispatch(JSON.parse(line));}catch{response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}
    if(response)process.stdout.write(JSON.stringify(response)+'\n');
  }).catch(()=>process.stderr.write('MCP request failed\n'));
});
lines.on('close',()=>{void chain;});
