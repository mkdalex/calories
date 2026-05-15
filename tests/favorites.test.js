const test = require('node:test');
const assert = require('node:assert/strict');

const { computeFavorites } = require('../server.js');

// Build a fake log keyed by date — same shape as data/users/<id>/log.json.
const e = (overrides) => ({
  id: Math.random().toString(36).slice(2),
  name: 'apple', kcal: 95, protein: 0.5, fat: 0.3, carb: 25, fiber: 4,
  time: '2026-05-15T08:00:00.000Z', source: 'manual',
  ...overrides
});

test('computeFavorites', async (t) => {
  await t.test('counts repeated foods and ranks by frequency', () => {
    const log = {
      '2026-05-10': [e({ name: 'apple' }), e({ name: 'apple' }), e({ name: 'rice' })],
      '2026-05-11': [e({ name: 'apple' }), e({ name: 'rice' }), e({ name: 'eggs' })]
    };
    const favs = computeFavorites(log);
    assert.equal(favs[0].name, 'apple');
    assert.equal(favs[0].count, 3);
    assert.equal(favs[1].name, 'rice');
    assert.equal(favs[1].count, 2);
    assert.equal(favs[2].name, 'eggs');
    assert.equal(favs[2].count, 1);
  });

  await t.test('returns at most 8 favorites', () => {
    const log = { '2026-05-15': [] };
    for (let i = 0; i < 12; i++) {
      log['2026-05-15'].push(e({ name: `food-${i}` }));
    }
    assert.equal(computeFavorites(log).length, 8);
  });

  await t.test('groups case-insensitively by name', () => {
    const log = {
      '2026-05-15': [
        e({ name: 'Apple' }),
        e({ name: 'apple' }),
        e({ name: 'APPLE' })
      ]
    };
    const favs = computeFavorites(log);
    assert.equal(favs.length, 1);
    assert.equal(favs[0].count, 3);
  });

  await t.test('averages kcal/protein across occurrences', () => {
    const log = {
      '2026-05-15': [
        e({ name: 'apple', kcal: 100, protein: 0.5 }),
        e({ name: 'apple', kcal: 90, protein: 0.7 }),
        e({ name: 'apple', kcal: 110, protein: 0.6 })
      ]
    };
    const fav = computeFavorites(log)[0];
    assert.equal(fav.kcal, 100); // (100+90+110)/3 = 100
    assert.equal(fav.protein, 0.6); // round1((0.5+0.7+0.6)/3) = round1(0.6) = 0.6
  });

  await t.test('last_* fields reflect the most recent entry', () => {
    const log = {
      '2026-05-10': [e({ name: 'apple', kcal: 100, protein: 0.5 })],
      '2026-05-15': [e({ name: 'apple', kcal: 200, protein: 1.5, fat: 0.4, carb: 30, fiber: 5 })]
    };
    const fav = computeFavorites(log)[0];
    assert.equal(fav.last_kcal, 200);
    assert.equal(fav.last_protein, 1.5);
    assert.equal(fav.last_fat, 0.4);
    assert.equal(fav.last_carb, 30);
    assert.equal(fav.last_fiber, 5);
  });

  await t.test('skips entries with no name', () => {
    const log = {
      '2026-05-15': [e({ name: '' }), e({ name: null }), e({ name: 'rice' })]
    };
    const favs = computeFavorites(log);
    assert.equal(favs.length, 1);
    assert.equal(favs[0].name, 'rice');
  });

  await t.test('empty log → empty result', () => {
    assert.deepEqual(computeFavorites({}), []);
  });

  await t.test('preserves the original display name (not lowercased)', () => {
    const log = {
      '2026-05-15': [e({ name: 'Greek Yogurt' }), e({ name: 'greek yogurt' })]
    };
    const fav = computeFavorites(log)[0];
    assert.equal(fav.count, 2);
    // First-seen casing wins (because the key is normalized but display name is set once)
    assert.equal(fav.name, 'Greek Yogurt');
  });
});
