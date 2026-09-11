import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out=resolve('content/local-stonemason-muted-runtime');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
await page.routeWebSocket('**',ws=>ws.close());
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const requests=[];page.on('request',r=>requests.push(r.url()));
await page.goto('http://localhost:5173/?map=magiczny_las&assets=own&intro=off&fog=off&progression=off&needs=off&sound=off&center=45,40&zoom=2');
await page.waitForFunction(()=>window.__opennorthland?.perf().tick>2,null,{timeout:60000});
await page.evaluate(()=>window.__opennorthland.sim.enqueue({v:1,origin:'admin',command:{kind:'placeBuilding',buildingType:29,tribe:1,owner:0,x:90,y:80,force:true}}));
await page.waitForTimeout(7000);
const report=await page.evaluate(()=>{const d=window.__opennorthland;d.setPaused(true);return {perf:d.perf(),families:Object.keys(d.sheet?.families??{}),binding:d.sheet?.bindings.building,buildings:d.sim.snapshot().entities.filter(e=>e.components.Building).map(e=>({id:e.id,components:e.components}))};});
const target=await page.evaluate(()=>{
 const d=window.__opennorthland;
 const e=d.sim.snapshot().entities.filter(e=>e.components.Building?.buildingType===29).at(-1);
 const b=d.renderer.entityBounds(e.id),c=d.cameraCtl.camera();
 return {x:((b.minX+b.maxX)/2)*(c.scale??1)+c.offsetX,y:((b.minY+b.maxY)/2)*(c.scale??1)+c.offsetY};
});
await page.mouse.click(target.x,target.y);
await page.waitForTimeout(1500);
await page.evaluate(()=>window.__opennorthland.renderer.app.render());
await page.waitForTimeout(1000);
await page.locator('#game').screenshot({path:resolve(out,'map.png')});
const rendered=await page.evaluate(async()=>{const app=window.__opennorthland.renderer.app;return app.renderer.extract.base64({target:app.stage,frame:app.screen.clone(),format:'png'});});
await writeFile(resolve(out,'map-render.png'),Buffer.from(rendered.split(',')[1],'base64'));
await writeFile(resolve(out,'report.json'),JSON.stringify({errors,requests,report},null,2));
console.log(JSON.stringify({errors,families:report.families,screenshot:resolve(out,'map.png'),tick:report.perf.tick}));
} finally {await browser.close();}
