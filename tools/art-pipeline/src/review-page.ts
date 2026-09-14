export function reviewPage(data: unknown) {
  const payload = JSON.stringify(data).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="pl"><meta charset="utf-8"><title>Przegląd eksportu assetów</title>
<style>body{font:16px system-ui;margin:24px;background:#202522;color:#e3e8df}label{margin-right:20px}select,input,button{font:inherit}main{display:flex;gap:24px;overflow:auto}section{min-width:320px}canvas{background:repeating-conic-gradient(#777 0% 25%,#aaa 0% 50%) 0/24px 24px}pre{white-space:pre-wrap;max-width:70ch}small{display:block;margin:12px 0}details{margin:16px 0}</style>
<h1>Porównanie eksportu</h1><p id="title"></p>
<label>Obraz <select id="image"></select></label><label>Klatka <input id="frame" type="number" min="0" value="0" style="width:70px"></label>
<label>Zoom świata <select id="zoom"><option>1</option><option selected>2</option></select></label>
<label><input id="atlas" type="checkbox">Cały atlas</label>
<label>Tło <input id="background" type="color" value="#596344"></label><button id="checker">Szachownica</button>
<small id="stats"></small><main><section><h2>Obecnie w grze</h2><canvas id="before"></canvas></section><section><h2>Kandydat</h2><canvas id="after"></canvas></section></main>
<details><summary>Parametry prezentacji</summary><main><pre id="oldmeta"></pre><pre id="newmeta"></pre></main></details>
<h2>Metadane dostawy</h2><p>Pełne manifesty i powiązania; null oznacza brak pliku w danej wersji.</p><div id="metadata"></div>
<p>Sprawdź krawędzie na jasnym, ciemnym i terenowym tle. Ten widok nie zastępuje oceny wejścia, skali postaci i sortowania na mapie przy zoomie ×2.</p>
<details><summary>Identyfikator wersji do zatwierdzenia</summary><pre id="receipt"></pre></details>
<script type="module">
const data=${payload};const el=id=>document.getElementById(id);el('title').textContent=data.id;
for(const item of data.metadata){const details=document.createElement('details');const title=document.createElement('summary');title.textContent=item.path;details.append(title);const columns=document.createElement('main');for(const [label,value] of [['Obecnie w grze',item.previous],['Kandydat',item.next]]){const section=document.createElement('section');const heading=document.createElement('h3');heading.textContent=label;const pre=document.createElement('pre');pre.textContent=JSON.stringify(value,null,2);section.append(heading,pre);columns.append(section);}details.append(columns);el('metadata').append(details);}
for(const [i,item] of data.items.entries()){const option=document.createElement('option');option.value=i;option.textContent=item.path;el('image').append(option);}
el('receipt').textContent=data.digest;
function geometry(m,image,path){if(m?.shadow && path.endsWith('/'+m.shadow.sprite))m={...m,...m.shadow};if(el('atlas').checked||!m)return {x:0,y:0,width:image.width,height:image.height,scale:m?.scale??1};
const i=Math.max(0,Math.trunc(Number(el('frame').value))||0);if(m.frames){const f=m.frames[Math.min(i,m.frames.length-1)];return {...f,scale:m.scale};}
if(m.cellWidth){const count=8*(m.walkFrames+m.idleFrames+[...m.atomicClips??[],...m.carryClips??[]].reduce((n,c)=>n+c.frames,0));const f=Math.min(i,count-1);return {x:f%m.columns*m.cellWidth,y:Math.floor(f/m.columns)*m.cellHeight,width:m.cellWidth,height:m.cellHeight,scale:m.scale};}
return {x:0,y:0,width:image.width,height:image.height,scale:m.scale??1};}
let revision=0;
async function render(){const token=++revision;const item=data.items[Number(el('image').value)];if(!item)return;
el('stats').textContent=!item.next?'Obraz zostanie usunięty':item.changedPixels===null?'Nowy obraz lub zmienione wymiary':item.changedPixels+' zmienionych pikseli RGBA';
el('oldmeta').textContent=JSON.stringify(item.beforeManifest,null,2);el('newmeta').textContent=JSON.stringify(item.manifest,null,2);
for(const [id,base64,m] of [['before',item.previous,item.beforeManifest],['after',item.next,item.manifest]]){const canvas=el(id);if(!base64){canvas.width=1;canvas.height=1;continue;}const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();if(token!==revision)return;
const g=geometry(m,image,item.path);canvas.width=g.width;canvas.height=g.height;canvas.style.width=g.width*g.scale*Number(el('zoom').value)+'px';canvas.style.height=g.height*g.scale*Number(el('zoom').value)+'px';canvas.getContext('2d').drawImage(image,g.x,g.y,g.width,g.height,0,0,g.width,g.height);}}
for(const id of ['image','frame','zoom','atlas'])el(id).onchange=()=>{if(id==='image')el('frame').value=0;render();};
el('background').oninput=()=>{for(const id of ['before','after'])el(id).style.background=el('background').value;};el('checker').onclick=()=>{for(const id of ['before','after'])el(id).style.background='';};render();
</script></html>`;
}
