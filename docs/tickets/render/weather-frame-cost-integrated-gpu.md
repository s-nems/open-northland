# Cut the weather's frame cost on integrated GPUs

**Area:** render · **Focus:** weather · **Priority:** P2

Weather adds a quarter to a third of the frame on integrated GPUs at 1920x1080 with xBR, dense
`magiczny_las` town at tick 100000. On the UHD 770 (`bench:gpu`, speed 3, min of three p50s): clear
9.8 ms; rain 13.1; thunderstorm 13.4; sandstorm 14.7; snow 14.8; blizzard 15.1, measured before the
sand wisps moved to a half-resolution target. On a Radeon Vega 7 (paused GPU-bound loop, weather on
minus off, the whole clear scene about 4.7-4.9 ms) weather costs 3.2-3.4 ms in rain, 3.8-4.1 in snow
and 3.4-3.7 in sand, and splits as:

| part | rain | snow | sand |
| --- | --- | --- | --- |
| terrain cover hook (`gpu/weather/ground-cover-shading.ts`, `ground-weather.ts`) | 2.1 | 2.25 | 1.3-1.4 |
| grade pass (full-screen multiply) | 0.48 | 0.48-0.52 | 0.50 |
| veil pass (full-screen over) | 0.51 | 0.46-0.57 | 0.42 |
| particles | 0.25-0.3 | 0.1-0.3 | 1.1-1.3 |
| decor cover and ground reactions | 0.16 or less | 0.13 or less | 0.1 or less |

In snow the cover hook's neighbourhood taps cost 0.34 ms and its drift noise at least 0.73 ms; the
rest is shading arithmetic.

## Scope

- Merge the grade and the veil into one full-screen pass with dual-source blending
  (`WEBGL_blend_func_extended`, exposed by Chrome on ANGLE D3D11), keeping today's two passes where the
  extension is missing; about 0.47 ms in every weather on the Vega 7. The picture stays the same.
- Find a cut for the terrain cover hook's drift noise and taps; a change to its picture needs the
  owner's sign-off before merging.

## Verify

`npm run bench:gpu-settings` rain and snow rows plus a `?weather=sand` paused loop on the Vega 7 or the
UHD 770, base and branch, two runs each; a pixel diff of each weather view against the current pictures
with every changed part named.
