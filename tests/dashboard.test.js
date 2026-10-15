const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const policy=require('../public/js/goal-policy');
function view(file, responses={}) {
  const elements=new Map();
  function element(key) {
    if(!elements.has(key))elements.set(key,{innerHTML:'',value:'',textContent:'',addEventListener(){},querySelectorAll(){return [];}});
    return elements.get(key);
  }
  const context=vm.createContext({GoalPolicy:policy,Date,console,escapeHtml:String,
    fmtDate:d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),
    $:element,$$:()=>[],document:{getElementById:id=>element('#'+id)},
    api:async route=>{if(!(route in responses))throw Error('Unexpected route '+route);return responses[route];}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js',file),'utf8'),context);
  return { context,element,run:code=>vm.runInContext(code,context) };
}
test('all goals render a finite intake bar without weight-change forecasts',()=>{
  for(const [goal,delta] of [['steady',-500],['maintain',0],['gain',300],['reset',0]]) {
    const v=view('today.js');
    v.context.input={entries:[{}],totals:{kcal:1150,protein:96},stats:{goal,tdee:2870,kcal_goal:2870+delta,protein_g:141,target_source:'formula',goal_meta:{delta,label:goal}}};
    v.run('renderZoneBar(input)');
    const html=v.element('#zoneWrap').innerHTML;
    assert.match(html,new RegExp(policy.LABELS[goal]));
    assert.doesNotMatch(html,/Losing zone|kg\/week|NaN|Infinity|width:-/);
    assert.match(v.run('todayFeedback(input)'),goal==='reset'?/Reset week/:/in progress/);
  }
});
test('a stale weigh-in renders with its actual date without a forward projection',async()=>{
  const v=view('history.js',{'/api/weight':[{date:'2026-06-01',kg:83},{date:'2026-09-08',kg:80}],'/api/profile':{profile:{goal:'gain'},stats:{goal:'gain'}}});
  await v.run('renderWeightCard()');
  const html=v.element('#weightHistory').innerHTML;
  assert.doesNotMatch(html,/kg today|ideal cut|lean bulk|projection/);
  assert.match(html,/Sep/);
  assert.match(html,/Historical weigh-ins/);
});
test('one partial day is visible in the chart but produces no past-day average or success',()=>{
  const v=view('history.js');
  v.run("const now=fmtDate(new Date()); renderKcalTrend(now,now,{[now]:{kcal:1150,goal:3170,assessment:'in_progress'}})");
  const stats=v.element('#kcalTrendStats').innerHTML;
  assert.match(stats,/No past-day average yet/);
  assert.doesNotMatch(stats,/1\/1/);
  assert.match(v.element('#kcalTrendChart').innerHTML,/<circle/);
});
test('calendar does not colour an unfinished gaining day as a success',()=>{
  const v=view('history.js');
  v.run("calRangeData={[fmtDate(new Date())]:{kcal:1150,goal:3170,protein:96,protein_goal:141,goal_mode:'gain',assessment:'in_progress'}}; renderCalendar()");
  const html=v.element('#calGrid').innerHTML;
  assert.match(html,/in-progress/);
  assert.doesNotMatch(html,/on-target|cal-day-protein miss/);
});
