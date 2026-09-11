# Heads, materials and equipment

Runtime atlases contain complete body/head/tool sprites. Independent runtime layers and semantic
tint masks are not implemented. Assembly happens in Blender before export.

## Heads

Use `appearances/man-silver/socket.json` as the male fit reference. Socket coordinates are
body-specific; fit new heads by skull/face landmarks, not hair or beard height.

- Remove the body's temporary head completely; retain a clean collar.
- Fit the head once in rest space, with neutral animated bone scales.
- Preserve `head_pivot`. `HeadSocket` follows the neck position and animated Head rotation.
- Blend the neck overlap from the torso through neck to socket. Its lower rings must follow the torso.
- Keep the rear neck cap below the collar during idle turns; tune the rear blend radius separately from the beard-facing front radius.
- Review beard/ponytail clearance and both profiles during walk and turned idle.

Use the painted body arms as the skin palette. The head's `model/painted-base.png` overrides its
source UV texture; preserve UV landmarks, facial shading and fractional alpha.

## Materials

Use the matching rigged texture: remeshing can repack UVs. The projection guard is an approximate
colour filter, not a material-membership mask. Future recolouring needs consistent mesh assignments
or UV masks for skin, hair, cloth and equipment, shared across all poses and directions.
Retain shading and painted detail when recolouring. Silhouette changes require geometry and rerendering.

## Equipment

Each tool owns its textured model and hand socket. Import it after head replacement, then render
with the body for correct occlusion. Fit the grip relative to the visible palm; the long exported
hand-bone tail is not the grip location. Two-handed tools need a second hand constraint.

[Construction](shared/motions/hammer/README.md) binds the hammer to atomic 39. Its limb texture override
uses blended arm weights and includes cuffs; it is not a skin-only mask. Check raised arms for
paint leakage, palm contact, beard collisions and the actual work point on a playable map.

Deforming garments reuse the body rig with fitted weights. Use shared cameras and saved layouts
for every variant; per-frame bounds fitting changes apparent body scale.
