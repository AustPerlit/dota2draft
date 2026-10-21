// Small synthetic dataset: 1 counters 2, 3 and 4 are strong together,
// 5 and 6 win their lane together. Everything else is neutral.
function dataset() {
  const ids = [1, 2, 3, 4, 5, 6];
  const heroes = {};
  for (const id of ids) heroes[id] = { id, name: `h${id}`, localized: `Hero ${id}`, roles: id % 2 ? ['Carry'] : ['Support'] };
  const vs = {};
  const withT = {};
  const lane = {};
  for (const a of ids) {
    vs[a] = {};
    withT[a] = {};
    lane[a] = {};
    for (const b of ids) {
      if (a === b) continue;
      vs[a][b] = { games: 1000, wins: 500 };
      withT[a][b] = { games: 1000, wins: 500 };
      lane[a][b] = { games: 1000, wins: 400, losses: 400 };
    }
  }
  vs[1][2] = { games: 1000, wins: 600 };
  vs[2][1] = { games: 1000, wins: 400 };
  withT[3][4] = withT[4][3] = { games: 1000, wins: 600 };
  lane[5][6] = lane[6][5] = { games: 1000, wins: 650, losses: 200 };
  return { heroes, vs, with: withT, lane, minGames: 0 };
}
module.exports = { dataset };
