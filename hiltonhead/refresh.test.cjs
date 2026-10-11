const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const refresh = html.match(/async function refresh\(\)\{[\s\S]*?\n\}\n\n\/\* ===== LIVE EXTRAS/)[0].split('\n\n/*')[0];
const state = {family:[{name:'Jimmy'}],picks:{top:[{id:'bikes',count:1}]}};
async function run(responses) {
  const urls=[],saved=[];
  const context={LIVE:true,API_URL:'https://example.test/exec',ME:'Removed test person',S:state,
    myProfile:{wish:'test'},myPicks:['bikes'],myDone:new Set([0]),myRoll:'in',online:true,
    SEED_FAMILY:[],SEED_EAT:[],store:{set:(...args)=>saved.push(args)},$:()=>null,
    fetch:async url=>{urls.push(url);return {json:async()=>responses.shift()};},
    render(){assert.ok(this.S.picks)},onboarding(){this.onboarded=true}};
  // Page functions use lexical globals, as the actual script does.
  context.render=()=>assert.ok(context.S.picks);
  context.onboarding=()=>{context.onboarded=true};
  vm.createContext(context);await vm.runInContext(refresh+'\nrefresh()',context);
  return {context,urls,saved};
}
(async()=>{
  const recovered=await run([{error:'Choose a name from Family'},structuredClone(state)]);
  assert.equal(recovered.context.ME,'');
  assert.equal(recovered.urls.length,2);
  assert.equal(recovered.urls[1],'https://example.test/exec?action=state');
  assert.deepEqual(recovered.saved,[['me','']]);
  assert.equal(recovered.context.onboarded,true);
  assert.equal(recovered.context.S.picks.top[0].votes,1);
  const unavailable=await run([{error:'Temporary backend failure'}]);
  assert.equal(unavailable.context.S,state);
  assert.equal(unavailable.context.online,false);
  assert.equal(unavailable.context.ME,'Removed test person');
  console.log('PASS: removed-name recovery and backend-error state preservation');
})().catch(error=>{console.error(error);process.exitCode=1});
