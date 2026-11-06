// Existing adapter Markdown fragment semantics, shared by the fight evidence reader.
export function sectionText(text,fragment){
  const anchors=[...text.matchAll(/<a\s+id=(["'])(.*?)\1\s*>\s*<\/a>/gi)];
  const incomingTrim=(start,end)=>{for(const anchor of anchors){if(anchor.index>=start&&anchor.index+anchor[0].length<=end&&!text.slice(anchor.index+anchor[0].length,end).trim())return anchor.index}return end};
  const anchor=anchors.find(item=>item[2]===fragment);
  if(anchor){
    const start=anchor.index+anchor[0].length,rest=text.slice(start),heading=rest.match(/^\s*(#{1,6})[ \t]+[^\r\n]+(?:\r?\n|$)/);
    if(heading){const searchStart=start+heading[0].length,boundary=text.slice(searchStart).match(new RegExp('^#{1,'+heading[1].length+'}[ \\t]+','m'));return text.slice(start,boundary?incomingTrim(start,searchStart+boundary.index):text.length)}
    const next=text.slice(start).search(/<a\s+id=/i);return next>=0?text.slice(start,start+next):text.slice(start);
  }
  for(const heading of text.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)){
    const slug=heading[2].toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu,'').replaceAll(' ','-');
    if(fragment!==heading[2]&&fragment!==slug)continue;
    const start=heading.index+heading[0].length,boundary=text.slice(start).match(new RegExp('^#{1,'+heading[1].length+'}\\s+','m'));
    return text.slice(start,boundary?incomingTrim(start,start+boundary.index):text.length);
  }
  throw new Error(`Source fragment: cannot locate explicit fragment #${fragment}; use a precise heading/anchor or a dedicated source file.`);
}
