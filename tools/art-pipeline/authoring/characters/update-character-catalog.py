import json
import hashlib
import struct
import subprocess
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[4] / 'docs/art/characters'
    catalog_file = root / 'catalog.json'
    catalog = json.loads(catalog_file.read_text())
    actions = {a['id']: a for a in catalog['actions']}
    previous = {a['id']: a['variants'] for a in catalog['actions']}
    for action in actions.values():
        action['variants'] = {}
    total = 0
    for head in catalog['heads']:
        run = root / head['run']
        recipe_file = run / 'recipe.json'
        if not recipe_file.exists():
            continue
        recipe = json.loads(recipe_file.read_text())
        stored = {clip['name']: clip for clip in recipe['clips'] if not clip.get('poses')}
        for clip in recipe['clips']:
            name = clip['name']
            action = actions.setdefault(name, {'id': name, 'name': name, 'description': '', 'variants': {}})
            source = stored[clip['poses']] if clip.get('poses') else clip
            for facing in source['facings']:
                sprite = run / 'sprites' / f"{source['name']}-{facing}-88px.png"
                if not sprite.exists():
                    continue
                with sprite.open('rb') as file:
                    header = file.read(24)
                width, height = struct.unpack('>II', header[16:24])
                frames = clip.get('frames', recipe['frames'])
                if header[:8] != b'\x89PNG\r\n\x1a\n' or width != frames*192 or height != 144:
                    raise ValueError(f'Invalid strip: {sprite}')
                if clip['duration'] <= 0:
                    raise ValueError(f'Invalid duration: {sprite}')
                old = previous.get(name, {}).get(head['id'], {}).get(facing, {})
                status = old.get('status', 'review')
                digest = hashlib.sha256(sprite.read_bytes()).hexdigest()
                if old.get('sha256') and old['sha256'] != digest:
                    status = 'review'
                if old.get('duration') != clip['duration'] or old.get('frameDurations') != clip.get('frameDurations') or old.get('frameOrder') != clip.get('frameOrder'):
                    status = 'review'
                if status not in ('approved', 'review'):
                    raise ValueError(f'Invalid review status: {sprite}')
                action['variants'].setdefault(head['id'], {})[facing] = {
                    'file': str(sprite.relative_to(root)), 'frames': frames,
                    'duration': clip['duration'], 'status': status, 'sha256': digest,
                    **({'frameDurations':clip['frameDurations']} if clip.get('frameDurations') else {}),
                    **({'frameOrder':clip['frameOrder']} if clip.get('frameOrder') else {}),
                }
                total += 1
    catalog['actions'] = list(actions.values())
    catalog_file.write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n')
    subprocess.run(['npx', 'biome', 'format', '--write', str(catalog_file)], check=True, capture_output=True)
    print(f'Character board: {total} directional clips, {len(catalog["heads"])} heads')


if __name__ == '__main__':
    main()
