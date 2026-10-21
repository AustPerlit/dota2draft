"""Extracts hero abilities from dotaconstants into web/src/abilities.json.

Usage: python3 web/tools/build_abilities.py path/to/dotaconstants/build

Each ability gets tags (stun, silence, dispel, illusions, ...) derived from its
behavior fields and description. src/abilities.js turns the tags into
plain-language interactions between two heroes.
"""
import json
import pathlib
import re
import sys

TAGS = {
    'stun': r'\bstun',
    'hex': r'\bhex|harmless (beast|creature)',
    'silence': r'silenc|mute',
    'root': r'\broot|ensnar|entangl|encas\w* [^.]{0,30}in ice|prevent\w* [^.]{0,20}(moving|movement)',
    'leash': r'leash|cannot (move|teleport) away',
    'disarm': r'disarm',
    'fear': r'\bfear|terrif',
    'taunt': r'taunt|forced to attack|berserker',
    'sleep': r'\bsleep|nightmare',
    'cyclone': r'cyclone|into the air|knock(s|ed)? (back|up)',
    'slow': r'\bslow',
    'dispel': r'dispel|purge|removes? (most |all )?(negative )?(de)?buffs',
    'immune': r'spell immun|debuff immun|magic immun|immune to magic|untargetable|invulnerab|banish',
    'block': r'block(s|ing)? (and reflects? )?(any |a )?targeted|reflect(s|ing)? (any |a )?(targeted )?spell',
    'invis': r'invisib',
    'reveal': r'reveal|true sight|detect',
    'illusion': r'illusion',
    'summon': r'summon|(?<!re)spawn|creates? (a |an |\d+ |several )?(unit|ward|golem|spider|treant|wol|eidolon|familiar|zombie|skeleton|beetle|serpent|plague)',
    'break': r'\bbreak\b|disables? (their |the )?passive',
    'heal': r'\bheal|restores? (\w+ )?health|lifesteal|health regen',
    'heal_reduce': r'reduc\w*[^.]{0,40}(heal|regenerat|lifesteal)|(heal|regenerat|lifesteal)\w*[^.]{0,40}reduc',
    'evasion': r'evasion|evade|chance to miss',
    'accuracy': r'cannot miss|true strike|accuracy',
    'mobility': r'teleport|\bblink|\bleap|\bdash|\bjump|charges? (toward|at)|rushes|pounce|\bslide|swap|tunnel|burrow',
    'mana_burn': r'burns? [^.]{0,30}mana|mana burn|drains? [^.]{0,30}mana|tak\w* (\w+ )?mana|steals? [^.]{0,20}mana|mana break|destroys? [^.]{0,20}mana',
    'global': r'\bglobal|anywhere on the map|all enemy heroes|every enemy hero',
    'armor_reduce': r'(reduc|lower|decreas)\w*[^.]{0,30}armor|armor[^.]{0,30}(reduc|lower|decreas)|negative armor',
    'magic_amp': r'(reduc|lower)\w*[^.]{0,30}magic resist|magic resist\w*[^.]{0,30}(reduc|lower)|amplif\w*[^.]{0,20}(magic|spell) damage',
    'pull': r'\bpull|\bdrag|vortex|vacuum|black hole|draws? (in )?(nearby |all )?enem',
    'shield': r'\bshield|barrier|absorb',
    'area': r'nearby enem|surrounding (enem|units)|in an area|all enemies (with)?in|enemies (with)?in|around (him|her|it|the)',
}
HARD = ('stun', 'hex', 'fear', 'taunt', 'sleep', 'cyclone')

def as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]

def flat(xs):
    for a in xs:
        if isinstance(a, list):
            yield from a
        else:
            yield a

def main(src):
    src = pathlib.Path(src)
    hero_abilities = json.loads((src / 'hero_abilities.json').read_text())
    abilities = json.loads((src / 'abilities.json').read_text())
    heroes = json.loads((src / 'heroes.json').read_text())
    out = {}
    for h in heroes.values():
        entry = hero_abilities.get(h['name'])
        if not entry:
            continue
        rows = []
        for key in flat(entry['abilities']):
            a = abilities.get(key) or {}
            behavior = as_list(a.get('behavior'))
            if not a.get('dname') or 'Hidden' in behavior or key.startswith('generic') or a['dname'] == 'Invoked Spell':
                continue
            desc = (a.get('desc') or '').lower()
            tags = [t for t, rx in TAGS.items() if re.search(rx, desc)]
            team = as_list(a.get('target_team'))
            dispellable = a.get('dispellable')
            rows.append({
                'n': a['dname'],
                'p': 'Passive' in behavior,
                'c': 'Channeled' in behavior,
                'aoe': 'AOE' in behavior,
                'team': 'Friendly' if 'Friendly' in team else 'Enemy' if 'Enemy' in team else 'Both' if 'Both' in team else None,
                'd': a.get('dmg_type') if isinstance(a.get('dmg_type'), str) else None,
                'bkb': a.get('bkbpierce') == 'Yes',
                'x': {'Yes': 'basic', 'Strong Dispels Only': 'strong', 'No': 'none'}.get(dispellable),
                't': tags,
            })
        if rows:
            # Abilities are listed in slot order; the ultimate comes last.
            actives = [r for r in rows if not r['p']]
            (actives[-1] if actives else rows[-1])['u'] = True
        out[h['id']] = rows
    dest = pathlib.Path(__file__).parent.parent / 'src' / 'abilities.json'
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    # The desktop app loads the same data as a script.
    desktop = pathlib.Path(__file__).parent.parent.parent / 'desktop' / 'data' / 'abilities-data.js'
    desktop.write_text('// Generated from web/src/abilities.json by web/tools/build_abilities.py.\nwindow.ABILITIES = ' + dest.read_text() + ';\n')
    print(dest, len(out), dest.stat().st_size)

if __name__ == '__main__':
    main(sys.argv[1])
