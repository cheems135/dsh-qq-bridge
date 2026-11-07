import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('embedded panel uses remaining viewport height and responds to its parent and visual viewport',()=>{
 const code=readFileSync(new URL('../client.js',import.meta.url),'utf8');let factory,Panel,effect,cleanup,observerCallback,observed,disconnected=false;
 const heights=[],listeners=new Map(),visualListeners=new Map();
 const React={createElement:(type,props,children)=>({type,props,children}),useState:()=>[760,value=>heights.push(value)],useRef:()=>({current:null}),useEffect:fn=>{effect=fn;}};
 const window={innerHeight:900,visualViewport:{height:700,addEventListener:(name,fn)=>visualListeners.set(name,fn),removeEventListener:name=>visualListeners.delete(name)},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),__ModuleLoader__:{load:value=>{factory=value.factory;}}};
 const ResizeObserver=class{constructor(fn){observerCallback=fn;}observe(node){observed=node;}disconnect(){disconnected=true;}};
 vm.runInNewContext(code,{window,ResizeObserver});const plugin=factory(()=>React);
 plugin.apply({slots:{inject:(_name,fn)=>fn(),register:(_descriptor,render)=>{Panel=render().type;}}});
 const view=Panel(),iframe=view.children.find(child=>child.type==='iframe');
 assert.equal(view.props.style.minWidth,0);assert.equal(iframe.props.style.maxWidth,'100%');assert.equal(iframe.props.style.display,'block');
 const parent={};iframe.props.ref.current={parentElement:parent,getBoundingClientRect:()=>({top:190})};cleanup=effect();assert.equal(heights.at(-1),494);assert.equal(observed,parent);
 window.visualViewport.height=500;visualListeners.get('resize')();assert.equal(heights.at(-1),294);
 window.visualViewport.height=250;observerCallback();assert.equal(heights.at(-1),240);
 cleanup();assert.equal(listeners.size,0);assert.equal(visualListeners.size,0);assert.equal(disconnected,true);
});
