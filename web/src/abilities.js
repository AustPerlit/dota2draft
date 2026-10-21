// Ability-level analysis of a hero pair. Works on the tagged ability lists
// produced by tools/build_abilities.py:
//   { [heroId]: [{ n: name, p: passive, c: channeled, aoe, team, d: damage type,
//                  bkb: pierces debuff immunity, x: dispellable by, t: [tags], u: ultimate }] }
// Every sentence names the abilities it is based on, so the reader can judge it.
(function (root) {
  const HARD = ['stun', 'hex', 'fear', 'taunt', 'sleep', 'cyclone'];
  const DISABLE = [...HARD, 'silence', 'root', 'leash'];

  const q = (names) => names.map((n) => `«${n}»`).join(', ');
  // Verb agreement with a list of ability names: «Hex» не даёт, «Hex», «Silence» не дают.
  const v = (names, one, many) => (names.length > 1 ? many : one);
  const uniq = (xs) => [...new Set(xs)];
  const has = (a, ...tags) => tags.some((t) => a.t.includes(t));
  const selfOrAlly = (a) => a.team !== 'Enemy';

  function profile(list, hero = {}) {
    const ab = list || [];
    const pick = (fn) => uniq(ab.filter(fn).map((a) => a.n));
    const actives = ab.filter((a) => !a.p);
    const dmg = { Magical: 0, Physical: 0, Pure: 0 };
    for (const a of actives) if (a.d) dmg[a.d]++;
    // Carries deal most of their damage with right clicks, which no ability lists.
    if ((hero.roles || []).includes('Carry')) dmg.Physical += 2;
    return {
      ult: (ab.find((a) => a.u) || {}).n,
      hard: pick((a) => has(a, ...HARD)),
      silence: pick((a) => has(a, 'silence', 'hex')),
      disables: ab.filter((a) => has(a, ...DISABLE) && a.team !== 'Friendly'),
      interrupt: pick((a) => !a.p && has(a, ...HARD, 'silence')),
      channel: pick((a) => a.c),
      bigChannel: pick((a) => a.c && (a.u || a.d)),
      spellcaster: actives.filter((a) => a.d || has(a, ...DISABLE)).length >= 3,
      passives: pick((a) => a.p && !has(a, 'slow') && a.n !== 'Invoke'),
      invis: pick((a) => has(a, 'invis') && !has(a, 'reveal') && selfOrAlly(a)),
      reveal: pick((a) => has(a, 'reveal')),
      units: pick((a) => has(a, 'illusion', 'summon') && !has(a, 'pull') && a.team !== 'Enemy'),
      aoeDamage: pick((a) => (a.aoe || has(a, 'area')) && a.d && a.team !== 'Friendly'),
      breaks: pick((a) => has(a, 'break')),
      dispel: pick((a) => has(a, 'dispel') && selfOrAlly(a)),
      immune: pick((a) => has(a, 'immune', 'block') && selfOrAlly(a)),
      manaBurn: pick((a) => has(a, 'mana_burn')),
      heal: pick((a) => has(a, 'heal') && !has(a, 'heal_reduce') && selfOrAlly(a)),
      healReduce: pick((a) => has(a, 'heal_reduce')),
      mobility: pick((a) => has(a, 'mobility') && selfOrAlly(a)),
      hold: pick((a) => has(a, 'root', 'leash', 'hex', 'stun')),
      evasion: pick((a) => has(a, 'evasion') && selfOrAlly(a)),
      accuracy: pick((a) => has(a, 'accuracy')),
      armorReduce: pick((a) => has(a, 'armor_reduce')),
      magicAmp: pick((a) => has(a, 'magic_amp')),
      gather: pick((a) => a.team !== 'Friendly' && (has(a, 'pull', 'taunt') || (a.aoe && has(a, 'sleep', 'fear')))),
      save: pick((a) => !a.p && a.team === 'Friendly' && has(a, 'dispel', 'immune', 'heal', 'shield', 'mobility')),
      nukes: pick((a) => !a.p && a.d && a.team !== 'Friendly'),
      laneHard: pick((a) => !a.u && has(a, ...HARD)),
      laneNukes: pick((a) => !a.u && !a.p && a.d && a.team !== 'Friendly'),
      dmg,
      main: Object.entries(dmg).sort((x, y) => y[1] - x[1])[0],
    };
  }

  // Reasons x has the upper hand over y, as sentences.
  function edges(xName, x, yName, y, ab) {
    const out = [];
    if (x.silence.length && y.spellcaster)
      out.push(`${q(x.silence)} ${v(x.silence, 'не даёт', 'не дают')} ${yName} колдовать, а ${yName} сильно зависит от заклинаний${y.ult ? ` (в том числе ${q([y.ult])})` : ''}.`);
    if (x.interrupt.length && y.channel.length)
      out.push(`${q(x.interrupt)} ${v(x.interrupt, 'сбивает', 'сбивают')} канал ${q(y.channel)}.`);
    if (y.invis.length && x.reveal.length) out.push(`${q(x.reveal)} ${v(x.reveal, 'раскрывает', 'раскрывают')} невидимость ${yName} (${q(y.invis)}).`);
    if (x.invis.length && !y.reveal.length)
      out.push(`${xName} уходит в невидимость (${q(x.invis)}), а у ${yName} нет своих средств обнаружения: понадобятся Dust или Sentry Ward.`);
    if (x.aoeDamage.length && y.units.length)
      out.push(`Урон по площади (${q(x.aoeDamage)}) быстро чистит иллюзии и призванных существ ${yName} (${q(y.units)}).`);
    if (x.breaks.length && y.passives.length)
      out.push(`${q(x.breaks)} ${v(x.breaks, 'отключает', 'отключают')} пассивные способности ${yName}: ${q(y.passives)}.`);
    const dispellable = y.disables.filter((a) => a.x === 'basic').map((a) => a.n);
    if (x.dispel.length && dispellable.length)
      out.push(`${xName} может развеять ${q(uniq(dispellable))} с помощью ${q(x.dispel)}.`);
    const blocked = y.disables.filter((a) => !a.bkb).map((a) => a.n);
    if (x.immune.length && blocked.length)
      out.push(`${q(x.immune)} ${v(x.immune, 'защищает', 'защищают')} ${xName} от ${q(uniq(blocked))}.`);
    const piercing = x.disables.filter((a) => a.bkb).map((a) => a.n);
    if (y.immune.length && piercing.length)
      out.push(`${q(uniq(piercing))} ${v(uniq(piercing), 'пробивает', 'пробивают')} защиту ${yName} (${q(y.immune)}).`);
    if (x.manaBurn.length && (y.spellcaster || ab.yAttr === 'int'))
      out.push(`${q(x.manaBurn)} ${v(x.manaBurn, 'отнимает', 'отнимают')} ману, без которой ${yName} не сможет колдовать.`);
    if (x.healReduce.length && y.heal.length)
      out.push(`${q(x.healReduce)} ${v(x.healReduce, 'режет', 'режут')} лечение, на котором держится ${yName} (${q(y.heal)}).`);
    if (x.hold.length && y.mobility.length)
      out.push(`${q(x.hold)} ${v(x.hold, 'держит', 'держат')} ${yName} на месте и ${v(x.hold, 'не даёт', 'не дают')} уйти через ${q(y.mobility)}.`);
    if (x.evasion.length && !y.accuracy.length && y.main && y.main[0] === 'Physical')
      out.push(`Уклонение ${xName} (${q(x.evasion)}) мешает ${yName}, который бьёт в основном физическим уроном.`);
    if (x.accuracy.length && y.evasion.length)
      out.push(`${q(x.accuracy)} ${v(x.accuracy, 'позволяет', 'позволяют')} ${xName} не промахиваться по ${yName} несмотря на ${q(y.evasion)}.`);
    return out;
  }

  // Why x helps y when they are on the same team.
  function support(xName, x, yName, y) {
    const out = [];
    if (x.gather.length && y.aoeDamage.length)
      out.push(`${q(x.gather)} ${v(x.gather, 'собирает', 'собирают')} врагов в кучу, а ${yName} добивает их уроном по площади (${q(y.aoeDamage)}).`);
    if (x.hard.length && y.bigChannel.length)
      out.push(`Контроль ${xName} (${q(x.hard)}) даёт ${yName} спокойно прочитать канал ${q(y.bigChannel)}.`);
    if (x.armorReduce.length && y.main && y.main[0] === 'Physical')
      out.push(`${q(x.armorReduce)} ${v(x.armorReduce, 'снижает', 'снижают')} броню врагов и усиливает физический урон ${yName}.`);
    if (x.magicAmp.length && y.main && y.main[0] === 'Magical')
      out.push(`${q(x.magicAmp)} ${v(x.magicAmp, 'усиливает', 'усиливают')} магический урон ${yName}.`);
    if (x.save.length) out.push(`${q(x.save)} ${v(x.save, 'может', 'могут')} выручить ${yName} в драке.`);
    return out;
  }

  function lanePlay(xName, x, yName, y) {
    const out = [];
    if (x.laneHard.length && y.laneNukes.length)
      out.push(`${q(x.laneHard)} (${xName}) плюс урон ${yName} (${q(y.laneNukes.slice(0, 2))}) дают реальную угрозу убийства на линии.`);
    const allyHeal = x.save.filter((n) => x.heal.includes(n));
    if (allyHeal.length) out.push(`${q(allyHeal)} ${v(allyHeal, 'лечит', 'лечат')} ${yName} и ${v(allyHeal, 'помогает', 'помогают')} выстоять на линии.`);
    return out;
  }

  const DMG_RU = { Magical: 'магический', Physical: 'физический', Pure: 'чистый' };

  function analyzePair(abilities, heroes, a, b) {
    const ha = heroes[a];
    const hb = heroes[b];
    if (!abilities[a] || !abilities[b]) return null;
    const pa = profile(abilities[a], ha);
    const pb = profile(abilities[b], hb);
    const na = ha.localized;
    const nb = hb.localized;

    const together = [...support(na, pa, nb, pb), ...support(nb, pb, na, pa)];
    if (pa.main && pb.main && pa.main[1] && pb.main[1]) {
      if (pa.main[0] === pb.main[0])
        together.push(`Оба наносят в основном ${DMG_RU[pa.main[0]]} урон: противнику проще собрать одну защиту против вас.`);
      else together.push(`Урон смешанный (${DMG_RU[pa.main[0]]} и ${DMG_RU[pb.main[0]]}): от такой пары сложнее защититься предметами.`);
    }
    if (!pa.hard.length && !pb.hard.length) together.push('У пары нет жёсткого контроля (оглушений, хекса), его стоит взять у других героев.');

    return {
      aOverB: edges(na, pa, nb, pb, { yAttr: hb.attr }),
      bOverA: edges(nb, pb, na, pa, { yAttr: ha.attr }),
      together,
      lane: [...lanePlay(na, pa, nb, pb), ...lanePlay(nb, pb, na, pa)],
      abilitiesA: (abilities[a] || []).map((x) => x.n),
      abilitiesB: (abilities[b] || []).map((x) => x.n),
    };
  }

  const api = { profile, analyzePair };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AbilityAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
