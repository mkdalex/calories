const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const policy = require('../public/js/goal-policy');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calories-goals-'));
process.env.CALORIES_DATA_DIR = tmp;
process.env.SESSION_SECRET = 'goal-tests';
process.env.AI_DISABLED = '1';
const { app, createTestSession, todayStr, recordGoalContext, computeStats } = require('../server');
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening',r)); base='http://127.0.0.1:'+server.address().port; });
test.after(async () => { await new Promise(r => server.close(r)); fs.rmSync(tmp,{recursive:true,force:true}); });
const tz='Australia/Sydney', req={headers:{'x-client-tz':tz}};
const today=todayStr(req), yesterday=policy.shiftDate(today,-1);
const profile={height_cm:178,weight_kg:80,age:25,sex:'male',activity:'light',goal:'maintain'};
let next=0;
function user() {
  const id='goals-'+ ++next, cookie=createTestSession({id,username:id});
  const dir=path.join(tmp,'users',id); fs.mkdirSync(dir,{recursive:true});
  return { dir, async call(method,route,body) {
    const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-Client-TZ':tz},body:body?JSON.stringify(body):undefined});
    return {status:r.status,data:await r.json()};
  }, write(name,value) {fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(value));} };
}
test('legacy profiles get a dated baseline without assigning current targets to old records',async () => {
  const u=user(); u.write('profile',profile); u.write('log',{[yesterday]:[{name:'old',kcal:1000}]});
  const p=await u.call('GET','/api/profile');
  assert.equal(p.data.profile.goal_started,today);
  assert.equal(p.data.profile.goal_history[0].effective_from,today);
  const range=await u.call('GET','/api/log-range?start='+yesterday+'&end='+today);
  assert.equal(range.data[yesterday].goal,null);
  assert.equal(range.data[yesterday].assessment,'unknown');
  assert.equal(range.data[yesterday].kcal,1000);
});
test('goal and target changes retain prior dated targets; unrelated edits retain the goal start', () => {
  let p=recordGoalContext({}, {...profile,goal:'steady'},'2026-10-01',req);
  p=recordGoalContext(p,{...p,goal:'gain'},'2026-10-10',req);
  p=recordGoalContext(p,{...p,height_cm:179},'2026-10-11',req);
  assert.equal(p.goal_started,'2026-10-10');
  assert.equal(policy.contextAt(p.goal_history,'2026-10-05').goal,'steady');
  assert.equal(policy.contextAt(p.goal_history,'2026-10-10').goal,'gain');
  assert.equal(p.goal_history.length,3);
});
test('saved override remains active and is flagged when its date or context is unknown',async () => {
  const u=user(); u.write('profile',{...profile,tdee_override:2870,goal:'gain'});
  const {data}=await u.call('GET','/api/profile');
  assert.equal(data.stats.kcal_goal,3170);
  assert.equal(data.stats.target_source,'saved_override');
  assert.equal(data.stats.override_review,true);
  const reset=await u.call('POST','/api/profile',{tdee_override:null});
  assert.equal(reset.data.stats.kcal_goal,reset.data.stats.tdee_predicted+300);
  assert.equal(reset.data.stats.target_source,'formula');
});
for (const goal of ['steady','maintain','gain','reset']) {
  test(goal+': weekly, calendar and protein summaries exclude today and agree on eligibility',async () => {
    const u=user();
    const p=recordGoalContext({}, {...profile,goal},policy.shiftDate(today,-20),req);
    const target=computeStats(p,req).kcal_goal;
    u.write('profile',p);
    u.write('log',{[yesterday]:[{name:'past',kcal:target-500,protein:100}],
      [today]:[{name:'partial',kcal:500,protein:20}]});
    const week=(await u.call('GET','/api/weekly-review')).data;
    assert.equal(week.days_logged,1);
    assert.equal(week.avg_kcal,target-500);
    assert.equal(week.days_hit_goal,0);
    assert.equal(week.days_assessed,goal==='reset'?0:1);
    const range=(await u.call('GET','/api/log-range?start='+yesterday+'&end='+today)).data;
    assert.equal(range[today].assessment,'in_progress');
    assert.equal(range[yesterday].assessment,goal==='reset'?'reset':'below');
    const protein=(await u.call('GET','/api/protein-adherence')).data;
    assert.equal(protein.days_logged,1);
    assert.equal(protein.days_assessed,goal==='reset'?0:1);
    const log=(await u.call('GET','/api/log')).data;
    assert.equal(log.date,today);
    assert.equal(log.weekly_avg_kcal,target-500);
  });
}
test('returning users cannot recalibrate using sparse historical records',async () => {
  const u=user();
  const old=policy.shiftDate(today,-134);
  u.write('profile',{...profile,goal_started:old});
  u.write('weight',[{date:old,kg:83.55},{date:policy.shiftDate(today,-100),kg:79},{date:policy.shiftDate(today,-80),kg:77},{date:today,kg:80}]);
  const log={}; for(let i=0;i<62;i++)log[policy.shiftDate(old,i)]=[{kcal:2054}]; u.write('log',log);
  assert.equal((await u.call('GET','/api/calibrate')).data.can_calibrate,false);
});
test('today alone cannot unlock an AI review; reset remains focused on logging',async () => {
  const u=user(); await u.call('POST','/api/profile',profile);
  u.write('log',{[today]:[{name:'partial',kcal:500}]});
  assert.equal((await u.call('GET','/api/debrief')).data.unlocked,false);
  await u.call('POST','/api/profile',{goal:'reset'});
  assert.equal((await u.call('GET','/api/debrief')).data.unlocked,false);
});

test('explicitly reapplying the same override refreshes its review context',async () => {
  const u=user();u.write('profile',{...profile,tdee_override:2870});
  const saved=(await u.call('POST','/api/profile',{tdee_override:2870})).data;
  assert.equal(saved.stats.tdee,2870);
  assert.equal(saved.stats.override_review,false);
  assert.equal(saved.stats.override_set_at,today);
});

test('recent eligible calibration is provisional until explicitly applied and a goal switch starts a fresh period',async () => {
  const u=user(), start=policy.shiftDate(today,-21);
  const p=recordGoalContext({}, {...profile,goal:'gain',tdee_override:2870},start,req);
  u.write('profile',p);
  const log={};
  for(let i=0;i<21;i++)log[policy.shiftDate(start,i)]=[{name:'Food',kcal:2500,protein:145}];
  log[today]=[{name:'Today is partial',kcal:500}];
  u.write('log',log);
  u.write('weight',[0,7,14,21].map(i=>({date:policy.shiftDate(start,i),kg:80})));
  const candidate=(await u.call('GET','/api/calibrate')).data;
  assert.equal(candidate.can_calibrate,true);
  assert.equal(candidate.tdee_implied,2500);
  assert.equal(candidate.days_logged,21);
  assert.equal((await u.call('GET','/api/profile')).data.stats.tdee,2870);
  await u.call('POST','/api/profile',{tdee_override:2500});
  assert.equal((await u.call('GET','/api/profile')).data.stats.tdee,2500);
  const switched=(await u.call('POST','/api/profile',{goal:'maintain'})).data;
  assert.equal(switched.profile.goal_started,today);
  const range=(await u.call('GET','/api/log-range?start='+yesterday+'&end='+today)).data;
  assert.equal(range[yesterday].goal_mode,'gain');
  assert.equal(range[yesterday].goal,3170);
  assert.equal(range[today].goal_mode,'maintain');
  assert.equal(range[today].goal,2500);
  assert.equal((await u.call('GET','/api/calibrate')).data.can_calibrate,false);
});
