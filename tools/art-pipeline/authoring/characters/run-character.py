import argparse
import json
import os
import subprocess
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
FACINGS = ['SW', 'W', 'NW', 'NE', 'E', 'SE', 'S', 'N']
GRID = ['SW', 'W', 'NW', 'N', 'NE', 'E', 'SE', 'S']
STAGES = ['facings', 'paint', 'project', 'render', 'pack', 'preview']
PROPORTIONS = {'head_scale':1,'widen':1,'upper_scale':1,'foot_scale':1,'hunch':0}
DEFAULT = {
    'angle':15, 'frames':12, 'power':3,
    'projection':{'view_selection':'strongest','texsize':2048,'eps':0.03},
    'render':{'unlit':True,'toon':0,'size':512},
    'paint':PROPORTIONS, 'sprite':PROPORTIONS, 'post':'strong-separation',
    'clips':[{'name':'walk','file':'walk.glb','facings':FACINGS,'duration':1.0333333333333332}],
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run', type=Path)
    parser.add_argument('model', type=Path)
    parser.add_argument('stages', nargs='+', choices=STAGES)
    parser.add_argument('--clips', help='Comma-separated clip names to render')
    args = parser.parse_args()
    run, model = args.run.resolve(), args.model.resolve()
    run.mkdir(parents=True, exist_ok=True)
    recipe_file = run / 'recipe.json'
    if not recipe_file.exists():
        recipe_file.write_text(json.dumps(DEFAULT, indent=2)+'\n')
    recipe = json.loads(recipe_file.read_text())
    work = run / '.work'
    work.mkdir(exist_ok=True)
    angle, count = str(recipe['angle']), str(recipe['frames'])
    blender = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
    pose = model / recipe.get('pose', 'walk.glb')

    def execute(command):
        subprocess.run([str(arg) for arg in command], check=True)

    def node(script, *options):
        execute(['node', SCRIPTS/script, *options])

    def render_script(script, *options):
        log_file = work / (script+'.log')
        with log_file.open('w') as log:
            result = subprocess.run([str(arg) for arg in [blender,'--background','--python',SCRIPTS/script,'--',*options]], stdout=log, stderr=subprocess.STDOUT)
        log = log_file.read_text()
        if result.returncode or 'Traceback' in log or 'Error:' in log:
            raise RuntimeError(f'Blender failed; inspect {log_file}')

    def knobs(section):
        return [arg for key,value in recipe[section].items() for arg in ('--'+key.replace('_','-'),str(value))]

    for stage in args.stages:
        print(stage, flush=True)
        if stage == 'facings':
            render_script('render_dirs.py','--glb',pose,'--out',run/'facings','--angles',angle,'--frame','0','--frames',count,*knobs('paint'))
            (run/'restyle').mkdir(exist_ok=True)
            files = ','.join(str(run/'facings'/f'{angle}deg'/f'{f}.png') for f in GRID)
            node('restyle-sheet.mjs','--out',run/'restyle/in-facings.png','--files',files,'--cols','4','--rows','2','--cell','384x512','--feet','440','--height','264')
        elif stage == 'paint':
            paint = run/'restyle/out-facings.png'
            if not paint.exists():
                raise RuntimeError('Generate restyle/out-facings.png with imagegen using docs/art/characters/PIPELINE.md first')
            node('key-background.mjs',paint,work/'paint.png')
            node('restyle-cut.mjs','--sheet',work/'paint.png','--out',work/'cut','--cols','4','--rows','2','--cell','384x512','--facings','--angle',angle)
            node('restyle-align.mjs','--cells',work/'cut','--renders',run/'facings','--angle',angle,'--out',work/'views')
        elif stage == 'project':
            guard = recipe.get('material_guard')
            destination = work/'projected' if guard else run/'projected'
            render_script('project_texture.py','--glb',pose,'--views',work/'views','--out',destination,'--angle',angle,'--frame','0','--frames',count,'--power',str(recipe['power']),*[arg for key,value in recipe.get('projection',DEFAULT['projection']).items() for arg in ('--'+key.replace('_','-'),str(value))],*knobs('paint'))
            if guard:
                node('guard-materials.mjs',run/guard['base_texture'],destination,run/'projected')
            if not (run/'projected/texture-N.png').exists():
                raise RuntimeError('Projection did not create all facing textures')
        elif stage == 'render':
            if recipe.get('sampleSource'):
                raise ValueError('Sampled recipes use sample-character.mjs; rendering uniformly would discard authored poses')
            for clip in recipe['clips']:
                if args.clips and clip['name'] not in args.clips.split(','):
                    continue
                clip_count = str(clip.get('frames', recipe['frames']))
                for facing in clip['facings']:
                    name = f"{clip['name']}-{facing}"
                    out = work/'render'/name
                    out.mkdir(parents=True,exist_ok=True)
                    for old in out.glob('f[0-9]*.png'):
                        old.unlink()
                    options = ['--glb',model/clip['file'],'--out',out,'--facing',facing,'--angle',angle,'--frames',clip_count,'--toon',str(recipe.get('render',DEFAULT['render'])['toon']),'--size',str(recipe.get('render',DEFAULT['render'])['size']),'--texture',run/recipe.get('texture_dir','projected')/f'texture-{facing}.png',*knobs('sprite')]
                    if recipe.get('render',DEFAULT['render'])['unlit']:
                        options += ['--unlit']
                    if clip.get('prop'):
                        options += ['--prop',clip['prop']]
                    if clip.get('equipment'):
                        options += ['--equipment',run/clip['equipment']]
                    if clip.get('limb_texture'):
                        options += ['--limb-texture',run/clip['limb_texture']]
                    if clip.get('range'):
                        options += ['--range',','.join(map(str,clip['range']))]
                    if clip.get('fix_root'):
                        options += ['--fix-root']
                    if clip.get('samplePhases'):
                        options += ['--sample-phases', ','.join(map(str, clip['samplePhases']))]
                    if recipe.get('camera_reference'):
                        options += ['--camera-reference',run/recipe['camera_reference']/f'{name}.json']
                    if recipe.get('camera_cache'):
                        options += ['--camera-cache',run/recipe['camera_cache']/f'{name}.json']
                    if recipe.get('head'):
                        options += ['--head-model', run/recipe['head']['model'], '--head-config', run/recipe['head']['config']]
                    render_script('render_walk.py',*options)
                    if not (out/f'f{int(clip_count)-1:02d}.png').exists():
                        raise RuntimeError(f'Incomplete clip: {name}')
                    print(name,flush=True)
        elif stage == 'pack':
            node('pack-character.mjs',run,work/'render',recipe.get('post','strong-separation'))
        elif stage == 'preview':
            directory = run/'orig-compare'
            directory.mkdir(exist_ok=True)
            facings = list(dict.fromkeys(f for c in recipe['clips'] for f in c['facings']))
            backgrounds = []
            for name, file in [('Trawa','grass-base.png'),('Ziemia','soil.png')]:
                source = SCRIPTS.parents[3]/'docs/art/terrain/grass'/file
                if source.exists():
                    backgrounds.append({'name':name,'file':str(source)})
            rows = []
            for clip in recipe['clips']:
                if not clip.get('duration') or clip['duration'] <= 0:
                    raise ValueError('Preview requires each clip duration in seconds')
                cells = [
                    {'file':str(run/'sprites'/f"{clip['name']}-{f}-88px.png"),'duration':clip['duration'],
                     **({'frameDurations':clip['frameDurations']} if clip.get('frameDurations') else {})}
                    if f in clip['facings'] else None for f in facings
                ]
                rows.append({'name':clip['name'],'cells':cells})
            manifest = {
                'title':f'{run.name} — baseline animacji',
                'catalog_url':os.path.relpath(SCRIPTS.parents[3]/'docs/art/characters/index.html', directory),
                'description':'E · Mocniejsza separacja. Projekcja 2K, unlit, ostrzejszy eksport i wewnętrzna krawędź. Kolor twarzy wymaga lokalnej korekty.',
                'note':'Aktualny eksport do oceny. Zakres zatwierdzenia opisuje README postaci. Tła są próbkami tekstur do oceny czytelności; skalę i kontakty sprawdzaj także w grze.',
                'columns':[{'name':f,'description':''} for f in facings],
                'backgrounds':backgrounds,'rows':rows,
            }
            manifest_file = work/'review.json'
            manifest_file.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
            node('review-characters.mjs',manifest_file,directory/'clip-preview.html')



if __name__ == '__main__':
    main()
