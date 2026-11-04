// Checks whether USDA and FatSecret match the foods you log, using the app's own
// search and matching code and the keys in your .env. Makes ~2 API calls per food;
// no AI calls, nothing is saved.
//
//   node scripts/check-food-db.js                     (built-in list of foods)
//   node scripts/check-food-db.js "chicken breast" "turkish bread"
//
// Run it from the app folder on the server, so it picks up the real .env.

const path = require('path');
const { usdaSearch, fsSearch, isRelevantMatch } = require(path.join(__dirname, '..', 'server.js'));

const foods = process.argv.slice(2).length ? process.argv.slice(2) : [
  'chicken breast', 'raw chicken breast', 'white potato', 'red potato',
  'pork chop', 'chicken drumstick', 'eggs', 'white bread', 'cheese slice', 'turkish bread',
];

const show = r => r
  ? `${r.name}${r.brand ? ` (${r.brand})` : ''} · ${r.kcal_100g ?? r.kcal_per_serving} kcal ${r.kcal_100g ? '/100g' : '/serving'}`
  : 'no result';

(async () => {
  console.log(`USDA key: ${process.env.USDA_API_KEY ? 'set' : 'MISSING'} · FatSecret keys: ${process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET ? 'set' : 'MISSING'}\n`);
  for (const food of foods) {
    const [usda, fs] = await Promise.all([
      usdaSearch(food).catch(e => ({ error: e.message })),
      fsSearch(food).catch(e => ({ error: e.message })),
    ]);
    const line = (label, r) => {
      if (r && r.error) return `  ${label}: ERROR ${r.error}`;
      const ok = r && isRelevantMatch(food, r.name);
      return `  ${label}: ${show(r)}${r ? (ok ? '  ✓ used' : '  ✗ rejected as not relevant') : ''}`;
    };
    console.log(food);
    console.log(line('USDA     ', usda));
    console.log(line('FatSecret', fs));
  }
  process.exit(0);
})();
