const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFsServingDescription, pickFsFood, pickUsdaFood, matchScore, isRelevantMatch,
  servingMatches, dbTotals, applyDbSources, initialFinals
} = require('../server.js');

const fs = (food_name, food_description, brand_name) => ({ food_name, food_description, brand_name, food_id: food_name });
const usda = (description, dataType = 'SR Legacy') => ({ description, dataType });

test('FatSecret serving descriptions keep what the serving is', () => {
  const per100 = parseFsServingDescription('Per 100g - Calories: 172kcal | Fat: 8.5g | Carbs: 0g | Protein: 23.4g');
  assert.equal(per100.per100g, true);
  assert.equal(per100.serving_g, 100);
  const piece = parseFsServingDescription('Per 1 medium drumstick - Calories: 112kcal | Fat: 5.8g | Carbs: 0g | Protein: 14g');
  assert.equal(piece.label, '1 medium drumstick');
  assert.equal(piece.count, 1);
  assert.equal(piece.serving_g, null);
  const slices = parseFsServingDescription('Per 2 slices - Calories: 220kcal | Fat: 3g | Carbs: 38g | Protein: 9g');
  assert.equal(slices.count, 2);
  const grams = parseFsServingDescription('Per 1 serving (85g) - Calories: 340kcal | Fat: 20g | Carbs: 1g | Protein: 30g');
  assert.equal(grams.serving_g, 85);
  assert.equal(grams.label, '1 serving');
});

test('matching requires the main food word, not just any shared word', () => {
  assert.equal(matchScore('chicken drumstick', 'Chicken Breast'), 0);
  assert.equal(isRelevantMatch('chicken drumstick', 'Chicken Breast'), false);
  assert.equal(isRelevantMatch('chicken drumsticks', 'Chicken Drumstick (Skin Eaten)'), true);
  assert.equal(isRelevantMatch('wholegrain bread', 'Whole Grain Bread'), true);
  assert.equal(isRelevantMatch('grilled chicken breast', 'Chicken Breast'), true);
});

test('FatSecret: picks the best result, not the first, and avoids unasked-for frying', () => {
  const pick = pickFsFood('chicken drumstick', [
    fs('Chicken Breast', 'Per 100g - Calories: 165kcal | Fat: 3.6g | Carbs: 0g | Protein: 31g'),
    fs('Fried Chicken Drumstick (Battered)', 'Per 100g - Calories: 268kcal | Fat: 16g | Carbs: 8g | Protein: 22g'),
    fs('Chicken Drumstick', 'Per 100g - Calories: 172kcal | Fat: 8.5g | Carbs: 0g | Protein: 23.4g'),
  ]);
  assert.equal(pick.name, 'Chicken Drumstick');
  assert.equal(pick.kcal_100g, 172);
  // ...but frying is fine when the user asked for it
  assert.match(pickFsFood('fried chicken drumstick', [
    fs('Chicken Drumstick', 'Per 100g - Calories: 172kcal | Fat: 8.5g | Carbs: 0g | Protein: 23.4g'),
    fs('Fried Chicken Drumstick', 'Per 100g - Calories: 268kcal | Fat: 16g | Carbs: 8g | Protein: 22g'),
  ]).name, /Fried/);
  assert.equal(pickFsFood('chicken drumstick', [fs('Beef Mince', 'Per 100g - Calories: 250kcal | Fat: 17g | Carbs: 0g | Protein: 24g')]), null);
});

test('USDA: prefers cooked for foods eaten cooked, raw for fruit, and respects what was asked', () => {
  const chicken = [usda('Chicken, broilers or fryers, breast, meat only, raw', 'Foundation'), usda('Chicken, broilers or fryers, breast, meat only, cooked, roasted')];
  assert.match(pickUsdaFood('chicken breast', chicken).description, /roasted/);
  assert.match(pickUsdaFood('raw chicken breast', chicken).description, /raw/);
  assert.match(pickUsdaFood('apple', [usda('Apples, cooked, boiled'), usda('Apples, raw, with skin')]).description, /raw/);
  // "wings" used to be penalised even when the user asked for wings
  assert.match(pickUsdaFood('chicken wings', [usda('Chicken, breast, meat only, cooked, roasted'), usda('Chicken, wing, meat and skin, cooked, roasted')]).description, /wing/);
});

test('servings only scale when they describe the unit eaten', () => {
  const drum = { name: 'chicken drumsticks', search_name: 'chicken drumstick', qty: 4, unit: 'piece' };
  assert.equal(servingMatches(drum, { serving_label: '1 medium drumstick' }), true);
  assert.equal(servingMatches(drum, { serving_label: '1 large drumstick' }), false);
  assert.equal(servingMatches({ ...drum, name: 'large chicken drumsticks' }, { serving_label: '1 large drumstick' }), true);
  assert.equal(servingMatches(drum, { serving_label: '1 cup, diced' }), false);
  assert.equal(servingMatches(drum, { serving_label: '1 serving' }), false);
  assert.equal(servingMatches({ name: 'bread', qty: 2, unit: 'slice' }, { serving_label: '2 slices' }), true);
});

test('per-100g x estimated grams is preferred over per-serving', () => {
  const drum = { name: 'chicken drumsticks', search_name: 'chicken drumstick', qty: 4, unit: 'piece', grams: 300 };
  const db = { kcal_100g: 172, protein_100g: 23.4, fat_100g: 8.5, carb_100g: 0, kcal_per_serving: 216, serving_label: '1 drumstick', serving_count: 1 };
  assert.equal(dbTotals(drum, db).kcal, 516);
  assert.equal(dbTotals({ ...drum, grams: null }, db).kcal, 864);
  assert.equal(dbTotals({ ...drum, grams: null }, { ...db, kcal_100g: null, serving_label: '1 cup' }), null);
  const slices = { name: 'bread', qty: 4, unit: 'slice' };
  assert.equal(dbTotals(slices, { kcal_per_serving: 220, protein_per_serving: 9, serving_label: '2 slices', serving_count: 2 }).kcal, 440);
});

function aiItem(o) {
  return { name: 'chicken drumsticks', search_name: 'chicken drumstick', qty: 4, unit: 'piece', grams: 300, category: 'whole-food',
    kcal_total: 680, kcal_low: 560, kcal_high: 800, protein_g: 80, fat_g: 38, carb_g: 0, fiber_g: 0, ...o };
}
const lookups = (fsResult, usdaResult = null) => ({ fsSearch: async () => fsResult, usdaSearch: async () => usdaResult });

test('FatSecret far outside the AI range is not trusted; close agreement is used', async () => {
  const wrong = { name: 'Chicken Drumstick', kcal_100g: 400, protein_100g: 20, fat_100g: 35, carb_100g: 0 };
  let f = initialFinals(aiItem());
  await applyDbSources(aiItem(), f, lookups(wrong));
  assert.equal(f.source, 'ai-estimate');
  assert.equal(f.kcal, 680);
  assert.equal(f.fatsecret.status, 'conflict');
  const right = { name: 'Chicken Drumstick', kcal_100g: 215, protein_100g: 27, fat_100g: 11, carb_100g: 0 };
  f = initialFinals(aiItem());
  await applyDbSources(aiItem(), f, lookups(right));
  assert.equal(f.source, 'fatsecret');
  assert.equal(f.kcal, 645);
  assert.equal(f.fatsecret.status, 'confirmed');
});

test('USDA now works for piece items when the AI gave grams', async () => {
  const usdaHit = { name: 'Chicken, drumstick, meat and skin, cooked, roasted', kcal_100g: 216, protein_100g: 27, fat_100g: 11, carb_100g: 0, fiber_100g: 0 };
  const f = initialFinals(aiItem());
  await applyDbSources(aiItem(), f, lookups(null, usdaHit));
  assert.equal(f.source, 'usda+ai');
  assert.equal(f.kcal, 648);
  assert.match(f.usda.method, /300g/);
});
