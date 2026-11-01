/**
 * The script our server puts into a shared document's frame. The frame runs with an opaque origin
 * next to the document's own scripts, which could forge any of this, so the page treats every
 * message as untrusted (docs/file-sharing.md 9.2). It reports what is under the cursor and what is
 * selected, follows links, and shows what the page tells it. Written for any browser's `<script>`,
 * without `</script` anywhere in it.
 */
export const SHARE_BRIDGE = String.raw`(function(){
var MODE='__MODE__';
var parentWin=window.parent;
function send(m){m.alma=1;parentWin.postMessage(m,'*');}
function rectOf(el){var r=el.getBoundingClientRect();return{top:r.top,left:r.left,width:r.width,height:r.height};}
function style(){
  var s=document.createElement('style');
  s.setAttribute('data-alma-ui','1');
  s.textContent='[data-alma-gone]{display:block;height:0;margin:10px 0;border-top:2px dashed #b0232a}'+
    '[data-alma-change]{outline:1.5px dashed #0f8b8d;outline-offset:3px;border-radius:3px}'+
    '[data-alma-pending]{outline:1.5px dashed #0f8b8d;outline-offset:3px;border-radius:3px}'+
    '[data-alma-c]{background:#fdf0c0;cursor:pointer}'+
    '[data-alma-c].on{background:#f7d774}'+
    '[data-alma-el]{outline:2px solid #e0b93b;outline-offset:2px}';
  (document.head||document.documentElement).appendChild(s);
}
document.addEventListener('click',function(e){
  var t=e.target;if(!t||!t.closest)return;
  var mark=t.closest('[data-alma-c],[data-alma-el]');
  if(mark){send({type:'comment-click',id:mark.getAttribute('data-alma-c')||mark.getAttribute('data-alma-el')});}
  var link=t.closest('a[href]');
  if(!link)return;
  if(MODE!=='read'&&String(window.getSelection())){e.preventDefault();return;}
  var href=link.getAttribute('href')||'';
  e.preventDefault();
  if(href.charAt(0)==='#'){
    var target=document.getElementById(href.slice(1));
    if(!target)return;
    for(var up=target.parentElement;up;up=up.parentElement){if(up.localName==='details')up.setAttribute('open','');}
    target.scrollIntoView();
    return;
  }
  if(/^(https?:|mailto:|tel:)/i.test(href))window.open(href,'_blank','noopener,noreferrer');
});
if(MODE==='read'){return;}
var hovered=null;
var originals={};
function blockOf(t){return t&&t.closest?t.closest('[data-alma-b],[data-alma-gone],[data-alma-change]'):null;}
function report(el){
  if(!el){send({type:'hover',block:null});return;}
  var gone=el.getAttribute('data-alma-gone');
  send({type:'hover',
    block:el.hasAttribute('data-alma-b')?Number(el.getAttribute('data-alma-b')):null,
    change:gone||el.getAttribute('data-alma-change'),
    editable:el.getAttribute('data-alma-e')==='1',
    tag:el.localName,
    src:el.localName==='img'?el.getAttribute('src'):null,
    text:gone?null:(el.innerText||el.textContent||'').slice(0,20000),
    parent:!!(el.parentElement&&el.parentElement.closest('[data-alma-b]')),
    rect:rectOf(el)});
}
function setHover(el){hovered=el;report(el);}
document.addEventListener('mousemove',function(e){
  var el=blockOf(e.target);
  if(el!==hovered)setHover(el);
},true);
document.addEventListener('mouseleave',function(){send({type:'hover-out'});});
document.addEventListener('touchstart',function(e){var el=blockOf(e.target);if(el!==hovered)setHover(el);},{passive:true,capture:true});
function sendRects(){if(hovered&&hovered.isConnected)send({type:'rect',rect:rectOf(hovered)});sendSelection();}
window.addEventListener('scroll',sendRects,true);
window.addEventListener('resize',sendRects);
function textAround(range){
  var body=document.body;
  var before=document.createRange();before.selectNodeContents(body);before.setEnd(range.startContainer,range.startOffset);
  var after=document.createRange();after.selectNodeContents(body);after.setStart(range.endContainer,range.endOffset);
  return{prefix:String(before).slice(-60),suffix:String(after).slice(0,60)};
}
function sendSelection(){
  var s=window.getSelection();
  if(!s||s.isCollapsed||!s.rangeCount||!String(s).trim()){send({type:'selection',text:null});return;}
  var range=s.getRangeAt(0);
  var around=textAround(range);
  var start=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  var b=start&&start.closest('[data-alma-b]');
  var r=range.getBoundingClientRect();
  send({type:'selection',text:String(s).slice(0,2000),prefix:around.prefix,suffix:around.suffix,
    block:b?Number(b.getAttribute('data-alma-b')):null,
    rect:{top:r.top,left:r.left,width:r.width,height:r.height}});
}
document.addEventListener('mouseup',function(){setTimeout(sendSelection,0);});
document.addEventListener('keyup',function(e){if(e.shiftKey)sendSelection();});
function findBlock(n){return document.querySelector('[data-alma-b="'+Number(n)+'"]');}
function markText(id,anchor){
  var quote=anchor.quote;
  var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null);
  var nodes=[],text='',node;
  while((node=walker.nextNode())){
    var p=node.parentElement;
    if(p&&/^(script|style|noscript)$/i.test(p.localName))continue;
    nodes.push({node:node,at:text.length});text+=node.nodeValue;
  }
  var at=-1,from=0,best=-1,bestScore=-1;
  while((at=text.indexOf(quote,from))!==-1){
    var score=0;
    if(anchor.prefix&&text.slice(Math.max(0,at-anchor.prefix.length),at)===anchor.prefix)score+=2;
    if(anchor.suffix&&text.slice(at+quote.length,at+quote.length+anchor.suffix.length)===anchor.suffix)score+=2;
    if(score>bestScore){best=at;bestScore=score;}
    from=at+1;
  }
  if(best<0)return null;
  var end=best+quote.length,first=null;
  nodes.forEach(function(n){
    var len=n.node.nodeValue.length,a=Math.max(best,n.at),b=Math.min(end,n.at+len);
    if(a>=b)return;
    var r=document.createRange();r.setStart(n.node,a-n.at);r.setEnd(n.node,b-n.at);
    var mark=document.createElement('mark');mark.setAttribute('data-alma-c',id);mark.style.color='inherit';
    try{r.surroundContents(mark);if(!first)first=mark;}catch(err){}
  });
  return first;
}
function markElement(id,anchor,sameVersion){
  var el=null;
  if(anchor.src){
    var all=document.getElementsByTagName(anchor.tag||'img');
    for(var i=0;i<all.length;i++){if(all[i].getAttribute('src')===anchor.src){el=all[i];break;}}
  }else if(sameVersion&&anchor.block!==null){el=findBlock(anchor.block);}
  if(el)el.setAttribute('data-alma-el',id);
  return el;
}
var marked={};
function showComments(list){
  document.querySelectorAll('mark[data-alma-c]').forEach(function(m){
    var parent=m.parentNode;while(m.firstChild)parent.insertBefore(m.firstChild,m);parent.removeChild(m);parent.normalize();
  });
  document.querySelectorAll('[data-alma-el]').forEach(function(e){e.removeAttribute('data-alma-el');});
  marked={};
  var unplaced=[];
  list.forEach(function(c){
    var a=c.anchor,el=null;
    if(!a){unplaced.push(c.id);return;}
    el=a.quote?(markText(c.id,a)||markElement(c.id,a,c.sameVersion)):markElement(c.id,a,c.sameVersion);
    if(el)marked[c.id]=el;else unplaced.push(c.id);
  });
  var order=Object.keys(marked).sort(function(a,b){
    return marked[a].compareDocumentPosition(marked[b])&Node.DOCUMENT_POSITION_FOLLOWING?-1:1;
  });
  send({type:'comments-placed',unplaced:unplaced,order:order});
}
function focusComment(id){
  document.querySelectorAll('[data-alma-c].on').forEach(function(m){m.classList.remove('on');});
  document.querySelectorAll('[data-alma-c="'+String(id).replace(/[^0-9a-f-]/g,'')+'"]').forEach(function(m){m.classList.add('on');});
  if(marked[id])marked[id].scrollIntoView({block:'center'});
}
window.addEventListener('message',function(e){
  if(e.source!==parentWin||!e.data||typeof e.data!=='object')return;
  var m=e.data,el;
  if(m.type==='comments')showComments(m.list||[]);
  else if(m.type==='focus-comment')focusComment(m.id);
  else if(m.type==='focus-change'){
    el=document.querySelector('[data-alma-change="'+m.id+'"],[data-alma-gone="'+m.id+'"]');
    if(el)el.scrollIntoView({block:'center'});
  }
  else if(m.type==='parent'){
    el=findBlock(m.block);
    var up=el&&el.parentElement&&el.parentElement.closest('[data-alma-b]');
    if(up)setHover(up);
  }
  else if(m.type==='apply'){
    el=originals[m.block]?originals[m.block].live:findBlock(m.block);
    if(!el)return;
    if(!originals[m.block])originals[m.block]={node:el.cloneNode(true)};
    var holder=document.createElement('div');
    if(m.html===null){
      holder.innerHTML='<div data-alma-gone="'+Number(m.block)+'"></div>';
    }else{holder.innerHTML=m.html;}
    var fresh=holder.firstElementChild;
    if(!fresh)return;
    if(m.html!==null){fresh.setAttribute('data-alma-b',String(Number(m.block)));fresh.setAttribute('data-alma-pending','1');if(m.editable)fresh.setAttribute('data-alma-e','1');}
    else{fresh.setAttribute('data-alma-b',String(Number(m.block)));}
    var after=fresh;
    el.parentNode.insertBefore(fresh,el);el.parentNode.removeChild(el);
    while(holder.firstChild){after.parentNode.insertBefore(holder.firstChild,after.nextSibling);after=after.nextSibling;}
    originals[m.block].live=fresh;
    hovered=null;send({type:'hover',block:null});
  }
  else if(m.type==='restore'){
    var o=originals[m.block];
    if(!o||!o.live)return;
    o.live.parentNode.replaceChild(o.node,o.live);
    delete originals[m.block];
    hovered=null;send({type:'hover',block:null});
  }
});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){style();send({type:'ready'});});
else{style();send({type:'ready'});}
})();`;
