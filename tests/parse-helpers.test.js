const test = require('node:test');
const assert = require('node:assert/strict');

const { initialFinals, applyCustomFood, applySanityCaps } = require('../server.js');

// Helper: a minimal "AI parsed item" shape.
const aiItem = (overrides = {}) => ({
  name: 'apple', qty: 1, unit: 'serving',
  kcal_total: 95, protein_g: 0.5, fat_g: 0.3, carb_g: 25, fiber_g: 4,
  confidence: 'medium', kcal_low: 80, kcal_high: 110,
  ...overrides
});

test('initialFinals', async (t) => {
  await t.test('rounds AI macro values to whole kcal and 1-dp grams', () => {
    const f = initialFinals(aiItem({ kcal_total: 95.7, protein_g: 0.55, fiber_g: 4.04 }));
    assert.equal(f.kcal, 96);
    assert.equal(f.protein, 0.6);
    assert.equal(f.fiber, 4);
  });

  await t.test('starts as ai-estimate source with default null usda/flagged', () => {
    const f = initialFinals(aiItem());
    assert.equal(f.source, 'ai-estimate');
    assert.equal(f.usda, null);
    assert.equal(f.flagged, null);
  });

  await t.test('falls back to medium confidence when item omits it', () => {
    const f = initialFinals(aiItem({ confidence: undefined }));
    assert.equal(f.confidence, 'medium');
  });

  await t.test('coerces missing macros to 0', () => {
    const f = initialFinals({ name: 'mystery' });
    assert.equal(f.kcal, 0);
    assert.equal(f.protein, 0);
    assert.equal(f.fat, 0);
    assert.equal(f.carb, 0);
    assert.equal(f.fiber, 0);
  });
});

test('applyCustomFood', async (t) => {
  const banana = { kcal: 105, protein: 1.3, fat: 0.4, carb: 27, fiber: 3.1 };

  await t.test('multiplies all macros by qty', () => {
    const f = initialFinals(aiItem({ name: 'banana' }));
    applyCustomFood(banana, aiItem({ name: 'banana', qty: 2 }), f);
    assert.equal(f.kcal, 210);
    assert.equal(f.protein, 2.6);
    assert.equal(f.carb, 54);
    assert.equal(f.fiber, 6.2);
    assert.equal(f.source, 'custom');
    assert.equal(f.confidence, 'high');
  });

  await t.test('qty=0 produces zero kcal (uses ?? not || to coerce)', () => {
    const f = initialFinals(aiItem({ name: 'banana' }));
    applyCustomFood(banana, aiItem({ name: 'banana', qty: 0 }), f);
    assert.equal(f.kcal, 0, 'qty=0 must mean zero, not silently fall back to qty=1');
    assert.equal(f.protein, 0);
  });

  await t.test('qty=undefined falls back to 1 serving', () => {
    const f = initialFinals(aiItem({ name: 'banana' }));
    applyCustomFood(banana, aiItem({ name: 'banana', qty: undefined }), f);
    assert.equal(f.kcal, 105);
    assert.equal(f.protein, 1.3);
  });

  await t.test('qty=null falls back to 1 serving', () => {
    const f = initialFinals(aiItem({ name: 'banana' }));
    applyCustomFood(banana, aiItem({ name: 'banana', qty: null }), f);
    assert.equal(f.kcal, 105);
  });

  await t.test('treats missing fat/carb/fiber on the custom record as 0', () => {
    const f = initialFinals(aiItem());
    applyCustomFood({ kcal: 50, protein: 10 }, aiItem({ qty: 1 }), f);
    assert.equal(f.kcal, 50);
    assert.equal(f.fat, 0);
    assert.equal(f.carb, 0);
    assert.equal(f.fiber, 0);
  });

  await t.test('fractional qty scales correctly', () => {
    const f = initialFinals(aiItem({ name: 'banana' }));
    applyCustomFood(banana, aiItem({ name: 'banana', qty: 0.5 }), f);
    assert.equal(f.kcal, 53); // Math.round(105*0.5)
    assert.equal(f.protein, 0.7); // round1(1.3*0.5) = round1(0.65) = 0.7
  });
});

test('applySanityCaps', async (t) => {
  await t.test('caps physically impossible kcal/100g (>900) by falling back to AI mid-range', () => {
    const item = aiItem({ qty: 50, unit: 'g', kcal_low: 100, kcal_high: 150, kcal_total: 125 });
    const f = initialFinals(item);
    f.kcal = 600; // 1200 kcal/100g — impossible
    applySanityCaps(item, f);
    assert.equal(f.kcal, 125); // midpoint of 100 and 150
    assert.equal(f.source, 'ai-estimate');
    assert.equal(f.flagged, 'sanity-cap');
  });

  await t.test('does not cap for non-gram units even with extreme kcal', () => {
    const item = aiItem({ qty: 1, unit: 'serving' });
    const f = initialFinals(item);
    f.kcal = 5000;
    applySanityCaps(item, f);
    // 5000 kcal/serving > 1500 → flagged high-kcal, but NOT capped
    assert.equal(f.kcal, 5000);
    assert.equal(f.flagged, 'high-kcal');
  });

  await t.test('flags high-kcal (>1500 per qty) without capping', () => {
    const item = aiItem({ qty: 1, unit: 'piece' });
    const f = initialFinals(item);
    f.kcal = 2000;
    applySanityCaps(item, f);
    assert.equal(f.flagged, 'high-kcal');
    assert.equal(f.kcal, 2000); // not modified
  });

  await t.test('caps protein > 0.45 × kcal (pure protein is 4 kcal/g)', () => {
    const item = aiItem();
    const f = initialFinals(item);
    f.kcal = 100;
    f.protein = 80; // implies 320 kcal of protein alone — impossible
    applySanityCaps(item, f);
    assert.equal(f.protein, 25); // round1(100 * 0.25)
    assert.equal(f.flagged, 'protein-capped');
  });

  await t.test('does nothing when values are reasonable', () => {
    const item = aiItem({ qty: 100, unit: 'g' });
    const f = initialFinals(item);
    f.kcal = 165; // chicken breast — 165 kcal / 100g
    f.protein = 31;
    applySanityCaps(item, f);
    assert.equal(f.kcal, 165);
    assert.equal(f.protein, 31);
    assert.equal(f.flagged, null);
  });

  await t.test('preserves earlier flag when a later rule also fires', () => {
    // sanity-cap fires first, then protein-cap could overwrite — must not
    const item = aiItem({ qty: 10, unit: 'g', kcal_low: 50, kcal_high: 70 });
    const f = initialFinals(item);
    f.kcal = 200; // 2000 kcal/100g — triggers sanity-cap (recomputes kcal to 60)
    f.protein = 50; // also impossible vs the original 200 kcal
    applySanityCaps(item, f);
    assert.equal(f.flagged, 'sanity-cap', 'first-set flag wins');
  });

  await t.test('skips kcal/qty division when qty is 0 (no NaN)', () => {
    const item = aiItem({ qty: 0, unit: 'g' });
    const f = initialFinals(item);
    f.kcal = 100;
    f.protein = 5;
    applySanityCaps(item, f);
    // qty=0 means we can't compute kcal/qty — guarded by qty > 0 in the rules
    assert.equal(f.flagged, null);
  });
});
