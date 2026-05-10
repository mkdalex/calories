// ---------- Educational content (single source of truth) ----------
const EDU_PROTEIN_HTML = `
  <h4>What it does to your physique</h4>
  <p>When you lift, you tear muscle fibers. <strong>Protein is the raw material your body uses to repair them bigger.</strong> On a cut, eating enough protein is what makes the difference between losing fat and losing muscle.</p>
  <p>Hit calories but skip protein: <span class="bad">~40% of what you lose is muscle</span>, not fat. You end up lighter but soft and weaker.<br/>
  Hit both: <span class="good">~85% fat loss</span>, gym strength stays, you look leaner — not just smaller. Hitting your protein target ≈ keeping the gym progress you've already paid for.</p>
  <h4>How to hit your target</h4>
  <p>Anchor each meal with a protein source. ~30g protein × 4 meals = 120g. Don't try to cram it all into dinner — it doesn't absorb as well in one hit.</p>
  <h4>What counts — tap to fill input</h4>
  <div class="macro-food-chips" id="proteinChips"></div>
`;

const EDU_FAT_HTML = `
  <h4>What it does to your physique</h4>
  <p><strong>Fat keeps your testosterone, recovery, and joints working.</strong> Drop below 50g for weeks on a cut and you'll notice: low energy, bad sleep, lifts going soft. It's not about being scared of fat — it's about keeping the hormones that make the gym actually productive.</p>
  <p>The catch: fat is 9 kcal/g (protein and carbs are 4 kcal/g). A couple of extra tablespoons of oil = 250 kcal you didn't notice. <strong>It's the easiest macro to accidentally overshoot.</strong></p>
  <h4>How to hit your target</h4>
  <p>Fat shows up in most real food — eggs, meat, dairy, nuts. You usually don't need to "try" to eat fat; the main job is not going over by accident. Measure oils and nut butter — they add up fast.</p>
  <h4>What counts — tap to fill input</h4>
  <div class="macro-food-chips" id="fatChips"></div>
`;

const EDU_CARBS_HTML = `
  <h4>What it does to your physique</h4>
  <p><strong>Carbs are your gym fuel.</strong> When you lift, your muscles run on glycogen — which is stored carbs. Empty glycogen = weaker sets, slower rep speed, harder recovery between sessions. If your lifts have been feeling heavy lately, low carbs is often why.</p>
  <p>Eat carbs around your workout for the biggest effect. Your carb target is whatever calories are left after protein and fat are covered — on a cut it can feel low, but it's calculated so you're still fuelled.</p>
  <h4>How to hit your target</h4>
  <p>Oats before training, rice or potato with dinner. Don't skip carbs entirely trying to be "clean" — you'll just have worse sessions.</p>
  <h4>What counts — tap to fill input</h4>
  <div class="macro-food-chips" id="carbChips"></div>
`;

const EDU_FIBER_HTML = `
  <h4>What it does to your physique</h4>
  <p><strong>Fiber slows digestion</strong> — which means you stay full for hours longer per meal. That's huge when you're in a calorie deficit, because hunger is the #1 thing that derails a cut. More fiber = less white-knuckling it at 9pm.</p>
  <p>It also keeps your gut healthy, which matters for nutrient absorption from all that protein you're eating.</p>
  <h4>How to hit your target</h4>
  <p>~14g per 1,000 kcal. On 2,300 kcal that's about 32g. Stack 2–3 of these per day and you're there: oats, apple, broccoli, lentils, chia.</p>
  <h4>What counts — tap to fill input</h4>
  <div class="macro-food-chips" id="fiberChips"></div>
`;

const MACRO_FOODS = {
  protein: [
    { text: '100g chicken breast', label: '31g protein' },
    { text: '3 eggs', label: '18g protein' },
    { text: '200g greek yogurt', label: '20g protein' },
    { text: '1 scoop whey protein', label: '24g protein' },
    { text: '100g lean beef mince', label: '26g protein' },
    { text: '1 can tuna', label: '25g protein' }
  ],
  fat: [
    { text: '1 tbsp olive oil', label: '14g fat' },
    { text: '30g almonds', label: '15g fat' },
    { text: '1 avocado', label: '22g fat' },
    { text: '100g salmon', label: '13g fat' },
    { text: '1 tbsp peanut butter', label: '8g fat' },
    { text: '2 eggs', label: '10g fat' }
  ],
  carb: [
    { text: '1 cup cooked rice', label: '45g carbs' },
    { text: '1 cup oats', label: '54g carbs' },
    { text: '1 medium banana', label: '27g carbs' },
    { text: '1 medium potato', label: '37g carbs' },
    { text: '1 slice bread', label: '13g carbs' },
    { text: '1 cup cooked pasta', label: '43g carbs' }
  ],
  fiber: [
    { text: '1 cup oats', label: '8g fiber' },
    { text: '1 cup lentils', label: '15g fiber' },
    { text: '1 medium apple', label: '4g fiber' },
    { text: '1 cup broccoli', label: '5g fiber' },
    { text: '30g chia seeds', label: '10g fiber' },
    { text: '1 cup raspberries', label: '8g fiber' }
  ]
};

function renderMacroFoodChips(containerId, macroKey) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const foods = MACRO_FOODS[macroKey] || [];
  el.innerHTML = foods.map(f =>
    `<button class="macro-food-chip" data-text="${escapeHtml(f.text)}">${escapeHtml(f.text)} <span style="color:var(--accent);">${f.label}</span></button>`
  ).join('');
  el.querySelectorAll('.macro-food-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const logModal = $('#logModal');
      const logText = $('#logText');
      if (logText) {
        logText.value = btn.dataset.text;
        logModal.classList.remove('hidden');
        logText.focus();
      }
    });
  });
}
