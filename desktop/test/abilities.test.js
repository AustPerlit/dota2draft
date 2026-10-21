const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/abilities');
const abilities = require('../../web/src/abilities.json');
const heroes = {};
for (const h of require('../../web/src/heroes.json')) heroes[h.id] = h;
const id = (name) => Object.values(heroes).find((h) => h.localized === name).id;
const pair = (a, b) => A.analyzePair(abilities, heroes, id(a), id(b));
const any = (list, re) => list.some((s) => re.test(s));

test('disables interrupt channeled ultimates', () => {
  assert.ok(any(pair('Lion', 'Crystal Maiden').aOverB, /сбива\S+ канал «Freezing Field»/));
});

test('silence and hex punish spell-reliant heroes', () => {
  assert.ok(any(pair('Lion', 'Crystal Maiden').aOverB, /«Hex» не даёт Crystal Maiden колдовать/));
});

test('Counterspell protects Anti-Mage from targeted disables', () => {
  assert.ok(any(pair('Lion', 'Anti-Mage').bOverA, /«Counterspell» защищает Anti-Mage/));
});

test('area damage clears illusions', () => {
  assert.ok(any(pair('Earthshaker', 'Phantom Lancer').aOverB, /иллюзии/));
});

test('detection counters invisibility', () => {
  assert.ok(any(pair('Slardar', 'Riki').aOverB, /раскрывает невидимость Riki/));
});

test('teammate synergy: Black Hole sets up area damage', () => {
  assert.ok(any(pair('Enigma', 'Crystal Maiden').together, /«Black Hole» собирает врагов/));
});

test('sentences are symmetric when heroes are swapped', () => {
  const ab = pair('Lion', 'Anti-Mage');
  const ba = pair('Anti-Mage', 'Lion');
  assert.deepStrictEqual(ab.aOverB, ba.bOverA);
});

test('unknown hero gives no analysis', () => {
  assert.strictEqual(A.analyzePair(abilities, heroes, id('Lion'), 99999), null);
});
