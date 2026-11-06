import {localMediaText} from './local-media-task.js';

// An explicit search needs a search receipt. Never infer its query parameters
// here: the configured model must supply them through the permitted tool.
export function localSearchRequired(request=''){
 const raw=String(request).trim(),text=localMediaText(raw);
 if(/^(?:他说|她说|引用|转发|例如|假如|教程)/.test(raw)||/(?:不要|不用|别|无需|不需要|停止|取消|先别).{0,8}(?:搜索|搜|查找|联网)|(?:搜索|工具).{0,12}(?:报错|失效|没用|没有执行|没有进行|没进行|不工作|不能用|支持吗|功能|原理|提示词)|为什么|如何(?:使用|实现|调用)|怎么(?:使用|实现|调用)/.test(text))return false;
 return /(?:帮我|替我|给我|请|麻烦).{0,8}(?:搜索|搜一下|搜搜|查找)|^(?:搜索|搜一下|帮忙搜|查找|联网查|上网查)|(?:去|用工具|上网|联网).{0,5}(?:搜索|搜一下)|\b(?:search (?:for|the web)|look up)\b/i.test(text);
}

// Require reading only when the current request explicitly asks for it.
export function localRequiredDataTools(request=''){
 if(!localSearchRequired(request))return [];
 const text=localMediaText(String(request));
 const read=/(?:再|然后|并|接着|之后|同时).{0,12}(?:打开|阅读|读取|读一下|读一读)|(?:打开|阅读|读取).{0,30}(?:网页|页面|全文|官方|文档)|\b(?:then\s+(?:open|read)|and\s+(?:open|read))\b/i.test(text);
 const noRead=/(?:不要|不用|别|无需|不需要|先别).{0,6}(?:打开|阅读|读取|读网页)|只(?:要|给|需).{0,8}(?:链接|网址|搜索结果)/.test(text);
 return read&&!noRead?['bridge_search','bridge_read']:['bridge_search'];
}
