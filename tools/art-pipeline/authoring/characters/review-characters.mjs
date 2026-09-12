import fs from 'node:fs/promises';
import sharp from 'sharp';

const [manifestFile, output] = process.argv.slice(2);
if (!manifestFile || !output)
  throw new Error('usage: node review-characters.mjs <manifest.json> <output.html>');
const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
const uri = (buffer) => 'data:image/png;base64,' + buffer.toString('base64');
for (const background of manifest.backgrounds ?? []) {
  background.uri = uri(await sharp(background.file).resize(128, 128).png().toBuffer());
  delete background.file;
}
for (const row of manifest.rows) {
  for (const cell of row.cells) {
    if (!cell) continue;
    const metadata = await sharp(cell.file).metadata();
    cell.frames = metadata.width / 192;
    if (metadata.height !== 144 || !Number.isInteger(cell.frames) || !(cell.duration > 0))
      throw new Error('Invalid strip or duration: ' + cell.file);
    if (
      cell.frameDurations &&
      (cell.frameDurations.length !== (cell.frameOrder?.length ?? cell.frames) ||
        cell.frameDurations.some((duration) => !(duration > 0)) ||
        Math.abs(cell.frameDurations.reduce((sum, duration) => sum + duration, 0) - cell.duration) > 1e-6)
    )
      throw new Error('Invalid pose holds: ' + cell.file);
    cell.uri = uri(await fs.readFile(cell.file));
    delete cell.file;
  }
}
const data = JSON.stringify(manifest).replaceAll('<', '\\u003c');
await fs.writeFile(
  output,
  `<!doctype html>
<html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Postacie — proporcje i czytelność</title><link rel="icon" href="data:,">
<style>
body{margin:0;background:#202322;color:#eee;font:14px system-ui,sans-serif}header{padding:18px 24px}h1{font-size:21px;margin:0 0 8px}p{color:#c4cbc7;max-width:1000px;line-height:1.5;margin:8px 0}
.controls{position:sticky;top:0;z-index:2;background:#303632;padding:12px 24px;display:flex;gap:20px;align-items:center;flex-wrap:wrap}label{display:flex;gap:8px;align-items:center}select,button{background:#454e48;color:white;padding:5px;border:1px solid #718078;border-radius:4px}
.scroll{overflow:auto}table{border-collapse:collapse;margin:12px 24px}th,td{border:1px solid #48524a;padding:10px;text-align:left;vertical-align:top}th{background:#303632}th small{display:block;font-weight:normal;color:#bec8c0;max-width:260px;margin-top:5px}.rowname{min-width:130px}canvas{display:block;image-rendering:pixelated}.empty{color:#89958c;min-width:140px}
</style>
<header><h1></h1><p id="description"></p><p id="note"></p></header>
<div class="controls"><label>Tło <select id="background"><option value="plain">Szare</option></select></label><label>Skala <select id="zoom"><option value="1">½× — porównanie 44 px</option><option value="2" selected>1× — cel 88 px</option><option value="3">1,5×</option><option value="4">2×</option></select></label><button id="pause">Pauza</button><button id="restart">Od początku</button><label>Pozycja w klipie <input id="position" type="range" min="0" max="1000" value="0"></label></div>
<div class="scroll"><table><thead></thead><tbody></tbody></table></div>
<script>
const M=${data};
document.title=M.title;
document.querySelector('h1').textContent=M.title;
document.querySelector('#description').textContent=M.description;
document.querySelector('#note').textContent=M.note;
if(M.catalog_url){const link=document.createElement('a');link.href=M.catalog_url;link.textContent='Wszystkie animacje i głowy →';link.style.color='#c4dfb6';document.querySelector('header').append(link);}
const controls={background:document.querySelector('#background'),zoom:document.querySelector('#zoom'),pause:document.querySelector('#pause'),position:document.querySelector('#position')};
const backgrounds=new Map();
for(const b of M.backgrounds??[]){const option=new Option(b.name,b.name);controls.background.add(option);const img=new Image();img.src=b.uri;backgrounds.set(b.name,img);}
if(M.backgrounds?.length)controls.background.value=M.backgrounds[0].name;
const head=document.createElement('tr');head.appendChild(document.createElement('th'));
for(const col of M.columns){const th=document.createElement('th');th.textContent=col.name;const sub=document.createElement('small');sub.textContent=col.description;th.appendChild(sub);head.appendChild(th);}document.querySelector('thead').appendChild(head);
const cells=[];
for(const row of M.rows){const tr=document.createElement('tr');const th=document.createElement('th');th.textContent=row.name;th.className='rowname';tr.appendChild(th);
for(const cell of row.cells){const td=document.createElement('td');tr.appendChild(td);if(!cell){td.className='empty';td.textContent='—';continue;}const canvas=document.createElement('canvas');td.appendChild(canvas);const img=new Image();img.src=cell.uri;cells.push({...cell,canvas,img});}
document.querySelector('tbody').appendChild(tr);}
let playing=true,time=0,last=0,scrub=null;
controls.pause.onclick=()=>{playing=!playing;scrub=null;controls.pause.textContent=playing?'Pauza':'Odtwórz';};
document.querySelector('#restart').onclick=()=>{time=0;scrub=null;controls.position.value=0;};
controls.position.oninput=()=>{playing=false;scrub=Number(controls.position.value)/1000;controls.pause.textContent='Odtwórz';};
function tick(now){if(last&&playing)time+=(now-last)/1000;last=now;const zoom=Number(controls.zoom.value);const ground=backgrounds.get(controls.background.value);
for(const c of cells){const w=144,h=112;if(c.canvas.width!==w*zoom){c.canvas.width=w*zoom;c.canvas.height=h*zoom;}const ctx=c.canvas.getContext('2d');ctx.setTransform(zoom,0,0,zoom,0,0);ctx.imageSmoothingEnabled=false;ctx.fillStyle='#6e6e6e';ctx.fillRect(0,0,w,h);
if(ground?.complete&&ground.naturalWidth){const pattern=ctx.createPattern(ground,'repeat');ctx.fillStyle=pattern;ctx.fillRect(0,0,w,h);}
const phase=scrub??((time%c.duration)/c.duration);let frame=Math.min(c.frames-1,Math.floor(phase*c.frames));if(c.frameDurations){let end=0;frame=c.frameDurations.length-1;for(let i=0;i<c.frameDurations.length;i++){end+=c.frameDurations[i];if(phase*c.duration<end){frame=i;break;}}}frame=c.frameOrder?.[frame]??frame;if(c.img.complete&&c.img.naturalWidth)ctx.drawImage(c.img,frame*192,0,192,144,24,20,96,72);}
requestAnimationFrame(tick);}requestAnimationFrame(tick);
</script></html>`,
);
console.log(output, manifest.rows.length + ' rows, ' + manifest.columns.length + ' columns');
