import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);

it('matches the accepted building light across actor and building cameras', async () => {
  const { stdout } = await execute('python3', [
    '-c',
    `
import sys,math,json
sys.path.insert(0,'tools/art-pipeline/authoring/shared')
from shadow_lighting import load_lighting,incoming_for_camera,screen_shadow_offset
profile=load_lighting()
results=[]
for elevation in [15,28.5,45]:
 for azimuth in [-22.5,0,22.5,90]:
  e,a=math.radians(elevation),math.radians(azimuth)
  r=(math.cos(a),math.sin(a),0)
  u=(-math.sin(e)*math.sin(a),math.sin(e)*math.cos(a),math.cos(e))
  x,y,z=incoming_for_camera(r,u,profile)
  results.append([elevation,azimuth,x,y,z,(r[0]*x+r[1]*y)/u[2],-(u[0]*x+u[1]*y)/u[2]])
print(json.dumps({'target':screen_shadow_offset(profile),'rays':results,'shadow':profile['shadow']}))
`,
  ]);
  const result = JSON.parse(stdout) as {
    target: number[];
    rays: number[][];
    shadow: { rgb: number[]; opacity: number };
  };
  expect(result.target[0]).toBeCloseTo(0.624286, 6);
  expect(result.target[1]).toBeCloseTo(-0.212436, 6);
  for (const ray of result.rays) {
    expect(ray[5]).toBeCloseTo(result.target[0] ?? 0, 10);
    expect(ray[6]).toBeCloseTo(result.target[1] ?? 0, 10);
    expect(ray[4]).toBe(-1);
  }
  const reference = result.rays.find((ray) => ray[0] === 28.5 && ray[1] === 22.5);
  expect(reference?.[2]).toBeCloseTo(5 / 14, 10);
  expect(reference?.[3]).toBeCloseTo(8 / 14, 10);
  expect(result.shadow.rgb).toEqual([0, 0, 0]);
  expect(result.shadow.opacity).toBe(0.48);
});
