const inputAction=args=>/input|text|set.?value|fill|type|payment-input/i.test([args.action,args.capability,args.arguments?.action].filter(Boolean).join(' '));
function bounds(value){
 if(Array.isArray(value)&&value.length===4)return value.map(Number);
 if(typeof value==='string'){const m=value.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);if(m)return m.slice(1).map(Number);}
 if(value&&typeof value==='object'){const left=Number(value.left??value.x),top=Number(value.top??value.y);return [left,top,Number(value.right??left+Number(value.width)),Number(value.bottom??top+Number(value.height))];}
 return null;
}
export function phoneOperationObservation(args={},observation={}){
 let data=observation.data||{},rows=[];
 const ui=String(observation.ui||'').slice(0,40000);
 if(ui.startsWith('{'))try{data=JSON.parse(ui);}catch{}
 function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}if(['text','label','contentDescription','content-desc','bounds','nodeId','ref'].some(k=>node[k]!==undefined))rows.push(node);for(const [k,v]of Object.entries(node))if(v&&typeof v==='object'&&k!=='bounds')visit(v);}
 visit(data);
 if(ui.startsWith('<'))for(const match of ui.matchAll(/<node\b([^>]*)>/g)){const row={};for(const m of match[1].matchAll(/([\w-]+)="([^"]*)"/g))row[m[1]]=m[2];rows.push(row);}
 const values=args.arguments||{},ref=String(args.ref||values.ref||values.nodeId||values.id||''),x=Number(args.x??values.x),y=Number(args.y??values.y);
 const picked=rows.filter(row=>{
  if(ref)return ['id','ref','nodeId','resourceId','resource-id'].some(k=>String(row[k]||'')===ref);
  if(Number.isFinite(x)&&Number.isFinite(y)){const b=bounds(row.bounds||row.rect);return b&&x>=b[0]&&y>=b[1]&&x<=b[2]&&y<=b[3];}
  return inputAction(args)&&(row.focused===true||row.focused==='true'||row.isFocused===true);
 }).sort((a,b)=>{const area=r=>{const v=bounds(r.bounds||r.rect);return v?Math.max(0,v[2]-v[0])*Math.max(0,v[3]-v[1]):Infinity;};return area(a)-area(b);});
 const label=row=>[row?.text,row?.label,row?.contentDescription,row?.['content-desc']].filter(Boolean).join(' ').slice(0,400),selected=picked[0],page=rows.map(label).join(' ');
 const payment=inputAction(args)&&/支付密码|付款密码|payment.?pin|payment.?password/i.test(page)||/确认(?:付款|支付|购买)|立即(?:付款|支付|购买)|提交订单|pay\s*now|complete.?purchase/i.test(label(selected));
 return {...(selected?{label:label(selected),password:selected.password===true||selected.password==='true'}:{}),...(payment?{risk:'payment'}:{})};
}
