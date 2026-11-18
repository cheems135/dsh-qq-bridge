// Visible lettering is picture content, not the language of the scene description.
const quoted = /"([^"\r\n]{1,200})"|“([^”\r\n]{1,200})”|'([^'\r\n]{1,200})'|「([^」\r\n]{1,200})」/g;
export function requestedImageText(request='') {
  const text=String(request), result=[];
  for(const match of text.matchAll(quoted)) {
    const before=text.slice(Math.max(0,match.index-60),match.index);
    if(/(?:写|题字|文字|标语|字样|印|刻|标注|text|lettering|caption|reads?|says?)[^。！？!?\n]{0,40}$/i.test(before))result.push(match.slice(1).find(value=>value!==undefined));
  }
  return [...new Set(result)];
}
export function maskRequestedImageText(value,literalText=[]) {
  const allowed=new Set(literalText);
  return String(value??'').replace(quoted,(match,...args)=>allowed.has(args.slice(0,4).find(value=>value!==undefined))?'"requested lettering"':match);
}
