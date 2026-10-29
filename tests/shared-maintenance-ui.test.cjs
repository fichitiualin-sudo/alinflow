const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { harness, noop, source } = require('./helpers.cjs');
const h = harness();
const shared = h.load('src/lib/alinflow/shared-maintenance.ts');
const privacy = h.load('src/lib/alinflow/privacy-notice.ts');
const reports = h.load('src/lib/alinflow/work-report.ts');
const scopes = h.load('src/lib/alinflow/report-scope.ts');
const item = {
  grantId:'grant-source',installationId:'source-installation',sourceWorkspaceId:'source-workspace',sourceWorkspaceName:'Source business',
  customer:{name:'Synthetic customer',phone:'+3612345',email:'test@example.invalid',postalCode:'1234',city:'Test City',address:'New Work Street 2'},
  installationDate:'2024-01-01',installationTime:'08:00',climates:[{productName:'Test AC',quantity:2}],
  latitude:47,longitude:19,lastMaintenanceDate:null,maintenanceCount:0,
};

test('shared display IDs cannot be mistaken for source customer/appointment IDs; no prices or document IDs copied', () => {
  const point = shared.sharedMaintenanceMapPoint(item);
  assert.match(point.customer.id,/^shared:/); assert.match(point.appointmentId,/^shared:/);
  assert.equal(point.customer.activeAppointmentId,undefined); assert.equal(point.customer.activeQuoteId,undefined);
  assert.equal(point.customer.activeWorkReportId,undefined);
  assert.equal(point.customer.quoteItems[0].customPrice,0); assert.equal(point.customer.quoteItems[0].customInstallPrice,0);
  assert.equal(point.sharedMaintenance,item); assert.equal(point.maintenanceOrigin,'external');
});

function acceptance(overrides={}) {
  const opened=[],errors=[],calls=[];
  const context={
    currentWorkspaceId:()=> 'target-workspace',beginAction:()=>true,endAction:noop,
    acceptMaintenanceOrder:async value=>{calls.push(['accept',value]);return {customerId:'target-customer',installationId:'target-new-installation',created:true};},
    loadCustomersFromDb:async ()=>calls.push(['reload']),lastCustomerLoadRef:{current:{workspaceId:'target-workspace',customers:[{
      id:'target-customer',name:'Synthetic customer',address:'OLD OTHER JOB ADDRESS',workAddress:'OLD OTHER JOB ADDRESS',
      activeAppointmentId:'target-old-installation',quoteItems:[{productId:'old',quantity:1,customPrice:999}],source:'Karbantartási átvétel',
    }]}},
    sharedMaintenanceMapPoint:shared.sharedMaintenanceMapPoint,setSharedMaintenanceSelection:noop,
    startMaintenanceForCustomer:(...args)=>opened.push(args),setMessage:(...args)=>errors.push(args),
    persistCustomerToDb:()=>{throw Error('Shared DTO must never enter generic persistence');},...overrides,
  };
  return {...h.functions(['startSharedMaintenance'],context),opened,errors,calls};
}
test('accepted order opens only returned target installation with its requested site, not stale primary work',async()=>{
  const run=acceptance();await run.startSharedMaintenance(item,'target-workspace');
  assert.equal(run.opened.length,1);
  const [customer,explicit]=run.opened[0];
  assert.equal(customer.id,'target-customer');assert.equal(customer.activeAppointmentId,'target-new-installation');
  assert.equal(customer.address,item.customer.address);assert.equal(customer.workAddress,item.customer.address);
  assert.equal(customer.activeQuoteId,undefined);assert.equal(customer.activeWorkReportId,undefined);
  assert.equal(explicit.length,1);assert.equal(explicit[0],customer);
  assert.equal(customer.quoteItems[0].customPrice,0);
});
test('revoked or rejected order never navigates to a local work or starts persistence',async()=>{
  const run=acceptance({acceptMaintenanceOrder:async()=>{throw Error('Access revoked');}});
  await run.startSharedMaintenance(item,'target-workspace');
  assert.equal(run.opened.length,0);assert.equal(run.calls.length,0);assert.match(run.errors[0][0],/revoked/);
});
test('workspace change during accepted-order RPC cannot open results in another tenant',async()=>{
  let resolve,workspace='target-workspace';
  const run=acceptance({currentWorkspaceId:()=>workspace,acceptMaintenanceOrder:()=>new Promise(done=>{resolve=done;})});
  const pending=run.startSharedMaintenance(item,'target-workspace');workspace='different-workspace';
  resolve({customerId:'target-customer',installationId:'target-new-installation',created:true});await pending;
  assert.equal(run.opened.length,0);assert.equal(run.calls.length,0);
});
test('explicit handoff selection bypasses stale same-customer installation history',()=>{
  const selected=[],quoteItems=[];
  const target={...item.customer,id:'target-customer',activeAppointmentId:'target-new-installation',appointmentType:'installation',
    quoteItems:[{productId:'manual',quantity:2,customPrice:0}],date:item.installationDate,time:item.installationTime};
  const {startMaintenanceForCustomer}=h.functions(['startMaintenanceForCustomer'],{
    maintenanceReturnRef:{current:null},selected:{id:'different'},cleanQuoteItems:items=>items,climateQuoteItems:items=>items.filter(item=>item.itemType!=="extra"),
    customerInstallationWorks:()=>{throw Error('Stale history must not override explicit selected installation');},
    setSelected:value=>selected.push(value),setQuoteItems:value=>quoteItems.push(value),setScheduleDate:noop,setScheduleTime:noop,
    setScheduleAppointmentType:noop,setSendAppointmentNotice:noop,setAllowWorkResourceEdit:noop,setMessage:noop,navigateToView:noop,
    todayIso:()=> '2026-10-11',EMPTY_QUOTE_ITEMS:[],
  });
  startMaintenanceForCustomer(target,[target]);
  assert.deepEqual(Array.from(selected[0].maintenanceInstallationIds),['target-new-installation']);
  assert.equal(selected[0].id,'target-customer');assert.equal(selected[0].activeAppointmentId,undefined);
  assert.equal(selected[0].appointmentType,'maintenance');assert.equal(quoteItems[0][0].quantity,2);
});

function completion(report,enabled=true) {
  const writes=[],messages=[];
  const customer={...item.customer,id:'target-customer',activeAppointmentId:'target-maintenance',appointmentType:'maintenance',quoteItems:[]};
  const context={...reports,...scopes,...privacy,selected:customer,normalizeAppointmentType:type=>type,
    workReportsByCustomer:{},maintenanceReportsByCustomer:{[customer.id]:report?[report]:[]},workReport:{},
    workspaceSettings:{documentSettings:{privacyNotice:{enabled}}},quoteItems:[],
    persistCustomerToDb:async value=>writes.push(value),logDocument:async()=>{},setSelected:noop,updateWorkHistory:noop,
    setAllowWorkResourceEdit:noop,setMessage:value=>messages.push(value),replaceView:noop,
  };
  return {...h.functions(['markInstallationDone','savedReportFor'],context),writes,messages};
}
const party={legalName:'Test EV',address:'Test HQ',email:'provider@example.invalid',phone:'',taxNumber:''};
const config={...privacy.defaultPrivacyNoticeConfig(),enabled:true,serviceProvider:party,
  retentionText:'Test retention',recipientsText:'Test recipients',internationalTransfersText:'Test transfer'};
const signed={id:'report',customerId:'target-customer',appointmentId:'target-maintenance',appointmentType:'maintenance',
  signerName:'Synthetic customer',signatureDataUrl:'data:image/png;base64,c3ludGhldGlj',signedAt:'2026-10-11T12:00:00.000Z'};
const notice=privacy.buildPrivacyNoticeSnapshot({config,customer:item.customer,...signed,consentGranted:false,appointmentType:'maintenance'});
test('maintenance closure rejects missing notice, mismatched fresh signature, and another appointment report',async()=>{
  for (const report of [signed,{...signed,privacyNotice:notice,signedAt:'2026-10-11T13:00:00.000Z'},
    {...signed,privacyNotice:notice,appointmentId:'previous-maintenance'}]) {
    const run=completion(report);await run.markInstallationDone();assert.equal(run.writes.length,0);assert.ok(run.messages.length);
  }
});
test('properly signed current maintenance closes without mutating historical notice/report',async()=>{
  const report=Object.freeze({...signed,privacyNotice:notice});const before=JSON.stringify(report);
  const run=completion(report);await run.markInstallationDone();
  assert.equal(run.writes.length,1);assert.equal(run.writes[0].activeAppointmentId,'target-maintenance');
  assert.equal(run.writes[0].status,'Lezárva');assert.equal(JSON.stringify(report),before);
});
test('ordinary own maintenance without enabled notice keeps its previous close flow',async()=>{
  const run=completion(signed,false);await run.markInstallationDone();assert.equal(run.writes.length,1);
});

test('calendar retains later own installation and maintenance for a handed-off customer, hiding only the historical mirror',()=>{
  const tree=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let initializer;
  (function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='calendarCustomers')initializer=node.initializer.getText(tree);ts.forEachChild(node,visit);})(tree);
  assert.ok(initializer);
  const base={source:'Karbantartási átvétel',date:'2026-10-11',status:'Időpont foglalva'};
  const sandbox={allWorkCustomers:[{...base,id:'reference',appointmentType:'installation',maintenanceOrigin:'external'},
    {...base,id:'real-installation',appointmentType:'installation',maintenanceOrigin:'own'},
    {...base,id:'real-maintenance',appointmentType:'maintenance',maintenanceOrigin:'own'}],
    sortCustomersBySchedule:rows=>rows,isInstallationAppointment:type=>type==='installation'};
  vm.runInNewContext(`globalThis.result = ${initializer};`,sandbox);
  assert.deepEqual(Array.from(sandbox.result,row=>row.id),['real-installation','real-maintenance']);
});
test('older partner service never takes credit for a more recent own maintenance',()=>{
  const point={appointmentId:'installation',lastMaintenanceDate:'2026-10-10',maintenanceCount:2,status:'ok'};
  const old={installationId:'installation',date:'2026-08-01',status:'Lezárva',providerName:'Earlier partner'};
  const first=shared.applySharedMaintenanceResults([point],[old])[0];
  assert.equal(first.lastMaintenanceDate,'2026-10-10');assert.equal(first.maintenanceProviderName,undefined);
  const latest=shared.applySharedMaintenanceResults([point],[{...old,date:'2026-10-11',providerName:'Latest partner'}])[0];
  assert.equal(latest.lastMaintenanceDate,'2026-10-11');assert.equal(latest.maintenanceProviderName,'Latest partner');
});
test('accepted reference keeps one marker and combines source history with newer own maintenance without changing own contact',()=>{
  const local={...shared.sharedMaintenanceMapPoint(item),appointmentId:'target-installation',customerId:'target-customer',sharedMaintenance:undefined,
    customer:{id:'target-customer',name:'Locally corrected name'},lastMaintenanceDate:'2026-09-01',maintenanceCount:1,status:'ok'};
  const received={...item,targetInstallationId:'target-installation',targetCustomerId:'target-customer',lastMaintenanceDate:'2026-08-01',maintenanceCount:3};
  const merged=shared.mergeSharedMaintenancePoints([local],[received]);
  assert.equal(merged.length,1);assert.equal(merged[0].lastMaintenanceDate,'2026-09-01');assert.equal(merged[0].maintenanceCount,4);
  assert.equal(merged[0].customer,local.customer);assert.equal(merged[0].sharedMaintenance,undefined);
  assert.equal(merged[0].maintenanceProviderName,undefined);assert.equal(merged[0].nextMaintenanceDue,'2027-09-01');
  assert.equal(local.maintenanceCount,1,'input records remain unchanged across repeated refreshes');
  assert.equal(shared.mergeSharedMaintenancePoints([local],[received])[0].maintenanceCount,4);
  const sourceNewer=shared.mergeSharedMaintenancePoints([{...local,status:'optOut'}],[{...received,lastMaintenanceDate:'2026-10-10'}])[0];
  assert.equal(sourceNewer.lastMaintenanceDate,'2026-10-10');assert.equal(sourceNewer.maintenanceProviderName,item.sourceWorkspaceName);
  assert.equal(sourceNewer.status,'optOut');
  assert.equal(shared.mergeSharedMaintenancePoints([local],[])[0],local,'revoked source summary disappears while local work remains');
  assert.equal(shared.mergeSharedMaintenancePoints([], [received]).length,1,'handoff still appears before local reload finishes');
});
// Preserve hook slots/dependencies and run effect cleanup when identity changes.
// Controlled focus/timer events and deferred RPCs exercise the actual hook.
function sharedHookHarness({visibility = "visible"} = {}) {
  const slots=[],effects=[],focusListeners=new Set(),visibilityListeners=new Set(),intervals=new Set(),receivedCalls=[],resultCalls=[],preferenceCalls=[];
  let now=0;
  class ClockDate extends Date { static now() { return now; } }
  let cursor=0,args=['workspace',true,'user'];
  const document={visibilityState:visibility,
    addEventListener:(event,fn)=>{assert.equal(event,'visibilitychange');visibilityListeners.add(fn);},
    removeEventListener:(_event,fn)=>visibilityListeners.delete(fn)};
  const sameDeps=(left,right)=>left && left.length===right.length && left.every((value,index)=>Object.is(value,right[index]));
  function deferred(calls,workspaceId) {
    const call={workspaceId};calls.push(call);
    return new Promise((resolve,reject)=>{call.resolve=resolve;call.reject=reject;});
  }
  const hookHarness=harness({document,Date:ClockDate,window:{
    addEventListener:(event,fn)=>{assert.equal(event,'focus');focusListeners.add(fn);},
    removeEventListener:(event,fn)=>focusListeners.delete(fn),
    setInterval:(fn,delay)=>{assert.equal(delay,60000);intervals.add(fn);return fn;},
    clearInterval:fn=>intervals.delete(fn),
  }},{
    react:{
      useState:initial=>{const index=cursor++;slots[index]??={value:initial};return [slots[index].value,next=>{
        slots[index].value=typeof next==='function'?next(slots[index].value):next;
      }];},
      useRef:initial=>{const index=cursor++;slots[index]??={current:initial};return slots[index];},
      useCallback:(fn,deps)=>{const index=cursor++;if(!sameDeps(slots[index]?.deps,deps))slots[index]={value:fn,deps};return slots[index].value;},
      useEffect:(fn,deps)=>{const index=cursor++;if(!sameDeps(slots[index]?.deps,deps))effects.push(()=>{
        slots[index]?.cleanup?.();slots[index]={deps,cleanup:fn()};
      });},
    },
    '@/lib/alinflow/shared-maintenance-client':{
      listReceivedMaintenance:workspaceId=>deferred(receivedCalls,workspaceId),
      listMaintenanceResults:workspaceId=>deferred(resultCalls,workspaceId),
      listMaintenanceContactPreferences:workspaceId=>deferred(preferenceCalls,workspaceId),
    },
  });
  const {useSharedMaintenance}=hookHarness.load('src/components/alinflow/useSharedMaintenance.ts');
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {document,receivedCalls,resultCalls,preferenceCalls,
    render(nextArgs=args){args=nextArgs;cursor=0;const value=useSharedMaintenance(...args);effects.splice(0).forEach(effect=>effect());return value;},
    focus(){[...focusListeners].forEach(fn=>fn());},tick(){now+=60000;[...intervals].forEach(fn=>fn());},
    advance(ms){now+=ms;},visibility(value){document.visibilityState=value;[...visibilityListeners].forEach(fn=>fn());},
    async complete(index,received=[item],results=[],preferences=[]){receivedCalls[index].resolve(received);resultCalls[index].resolve(results);preferenceCalls[index].resolve(preferences);await flush();},
    async fail(index){receivedCalls[index].reject(new Error('Network unavailable'));resultCalls[index].resolve([]);preferenceCalls[index].resolve([]);await flush();},
  };
}

test('focus/interval refresh retains marker data and source summaries in flight and after unchanged response',async()=>{
  const hook=sharedHookHarness();hook.render();
  const results=[{installationId:'own-installation',date:'2026-10-11',status:'Lezárva',providerName:'Partner'}];
  await hook.complete(0,[item],results);const initial=hook.render();
  const markerId=shared.sharedMaintenanceMapPoint(initial.received[0]).appointmentId;
  hook.advance(15000);hook.focus();const loading=hook.render();
  assert.equal(loading.loading,true);assert.equal(loading.received,initial.received);assert.equal(loading.results,initial.results);
  assert.equal(shared.sharedMaintenanceMapPoint(loading.received[0]).appointmentId,markerId);
  hook.tick();hook.focus();await loading.refresh();
  assert.equal(hook.receivedCalls.length,2,'overlapping focus, timer and manual refresh share the ongoing check');
  assert.equal(hook.resultCalls.length,2);
  await hook.complete(1,JSON.parse(JSON.stringify([item])),JSON.parse(JSON.stringify(results)));
  const unchanged=hook.render();assert.equal(unchanged.loading,false);
  assert.equal(unchanged.received,initial.received,'unchanged data does not rebuild markers');
  assert.equal(unchanged.results,initial.results,'unchanged source results do not rebuild own markers');
});

test('successful empty refresh removes revoked shared installations instead of preserving stale access',async()=>{
  const hook=sharedHookHarness();hook.render();await hook.complete(0);const initial=hook.render();
  hook.tick();assert.equal(hook.render().received,initial.received);
  await hook.complete(1,[]);const revoked=hook.render();
  assert.equal(revoked.received.length,0);assert.equal(revoked.loading,false);assert.equal(revoked.error,'');
});

test('failed or malformed permission refresh clears previously visible shared data and summaries',async()=>{
  for(const malformed of [false,true]) {
    const hook=sharedHookHarness();hook.render();await hook.complete(0,[item],[{installationId:'own-installation',date:'2026-10-11'}]);
    hook.advance(15000);hook.focus();assert.equal(hook.render().received.length,1);
    if(malformed)await hook.complete(1,{invalid:true});else await hook.fail(1);
    const failed=hook.render();assert.equal(failed.received.length,0);assert.equal(failed.results.length,0);
    assert.equal(failed.loading,false);assert.ok(failed.error);
  }
});

test('user or workspace switches hide data before effects and discard prior identity responses',async()=>{
  for(const nextArgs of [['workspace',true,'new-user'],['other-workspace',true,'user']]) {
    const hook=sharedHookHarness();hook.render();await hook.complete(0);hook.render();hook.advance(15000);hook.focus();
    const switched=hook.render(nextArgs);assert.equal(switched.received.length,0);assert.equal(switched.results.length,0);
    assert.equal(hook.receivedCalls.length,3);
    await hook.complete(2,[]);await hook.complete(1,[item]);
    const current=hook.render();assert.equal(current.received.length,0);assert.equal(current.loading,false);
  }
});

test('disabled hook hides data immediately, cancels timers and ignores an outstanding response',async()=>{
  const hook=sharedHookHarness();hook.render();await hook.complete(0);hook.render();hook.advance(15000);hook.focus();
  const disabled=hook.render(['workspace',false,'user']);assert.equal(disabled.received.length,0);
  hook.focus();hook.tick();assert.equal(hook.receivedCalls.length,2);
  await hook.complete(1,[item]);assert.equal(hook.render().received.length,0);
  assert.equal(hook.render(['workspace',true,undefined]).received.length,0,'signed-out identity cannot reuse cached data');
});

test('hidden tabs skip background polling and resume a single check on visible focus',async()=>{
  const hook=sharedHookHarness();hook.render();await hook.complete(0);hook.render();
  hook.document.visibilityState='hidden';hook.tick();hook.focus();assert.equal(hook.receivedCalls.length,1);
  hook.document.visibilityState='visible';hook.focus();hook.tick();assert.equal(hook.receivedCalls.length,2);
  await hook.complete(1);assert.equal(hook.render().received.length,1);
});


test('a confirmed opt-out survives an older in-flight refresh and remains reversible',async()=>{
  const hook=sharedHookHarness();hook.render();await hook.complete(0);const initial=hook.render();
  hook.advance(15000);hook.focus();assert.equal(hook.render().loading,true);
  initial.applyOptOut(item,{maintenanceOptOut:true,maintenanceOptOutAt:'2026-10-27T07:00:00Z',targetInstallationId:null});
  assert.equal(hook.render().received[0].maintenanceOptOut,true);
  await hook.complete(1,[item]);
  const saved=hook.render();assert.equal(saved.received[0].maintenanceOptOut,true);assert.equal(saved.loading,false);
  assert.equal(shared.sharedMaintenanceMapPoint(saved.received[0]).status,'optOut');
  saved.applyOptOut(item,{maintenanceOptOut:false,maintenanceOptOutAt:null,targetInstallationId:null});
  assert.equal(hook.render().received[0].maintenanceOptOut,false);
  hook.advance(15000);hook.focus();await hook.complete(2,[{...item,maintenanceOptOut:false,maintenanceOptOutAt:null}]);
  assert.equal(hook.render().received[0].maintenanceOptOut,false);
});

test('received history credits the actual earlier provider and schedules from its completed service',()=>{
  const history={...item,lastMaintenanceDate:'2026-10-01',maintenanceCount:3,lastMaintenanceProviderName:'Previous independent provider'};
  const point=shared.sharedMaintenanceMapPoint(history);
  assert.equal(point.maintenanceProviderName,'Previous independent provider');
  assert.equal(point.nextMaintenanceDue,'2027-10-01');
  const local={...point,appointmentId:'target-installation',lastMaintenanceDate:'2026-08-01',maintenanceCount:1,maintenanceProviderName:undefined};
  const merged=shared.mergeSharedMaintenancePoints([local],[{...history,targetInstallationId:'target-installation'}])[0];
  assert.equal(merged.maintenanceCount,4);assert.equal(merged.maintenanceProviderName,'Previous independent provider');
  assert.equal(merged.nextMaintenanceDue,'2027-10-01');
});


test('completed shared-map focus/visibility checks deduplicate for 15 seconds but manual refresh bypasses the cooldown',async()=>{
  const hook=sharedHookHarness();hook.render();await hook.complete(0);hook.render();
  hook.focus();hook.visibility('visible');assert.equal(hook.receivedCalls.length,1);
  hook.advance(14999);hook.focus();assert.equal(hook.receivedCalls.length,1);
  hook.advance(1);hook.focus();assert.equal(hook.receivedCalls.length,2);
  await hook.complete(1);const current=hook.render();
  hook.visibility('visible');hook.focus();assert.equal(hook.receivedCalls.length,2);
  const pending=current.refresh();assert.equal(hook.receivedCalls.length,3,'manual refresh is immediate');
  await hook.complete(2,[]);await pending;
  assert.equal(hook.render().received.length,0,'a forced permission refresh still removes revoked access');
});

test('hidden initial shared-map mount defers requests until visible and merges focus with the visibility check',async()=>{
  const hook=sharedHookHarness({visibility:'hidden'});hook.render();hook.tick();hook.focus();
  assert.equal(hook.receivedCalls.length,0);
  hook.visibility('visible');hook.focus();assert.equal(hook.receivedCalls.length,1);
  await hook.complete(0);assert.equal(hook.render().received.length,1);
  hook.render(['workspace',false,'user']);hook.visibility('hidden');hook.visibility('visible');hook.focus();hook.tick();
  assert.equal(hook.receivedCalls.length,1,'cleanup removes visibility/focus listeners and the periodic timer');
});

test('shared-map periodic permission checking remains one minute despite focus throttling',async()=>{
  const hook=sharedHookHarness();hook.render();await hook.complete(0);hook.render();
  hook.advance(15000);hook.focus();await hook.complete(1);hook.render();
  hook.tick();assert.equal(hook.receivedCalls.length,3);
  await hook.complete(2,[]);assert.equal(hook.render().received.length,0);
});

const preference = {installationId:item.installationId,sourceInstallationId:item.installationId,
  sourceWorkspaceId:item.sourceWorkspaceId,sourceWorkspaceName:item.sourceWorkspaceName,
  choice:'original_installer',updatedAt:'2026-10-29T12:00:00Z',isSource:false};

test('contact choices load with the scoped data and unchanged refresh preserves their identity',async()=>{
  const hook=sharedHookHarness();hook.render();
  assert.equal(hook.preferenceCalls[0].workspaceId,'workspace');
  await hook.complete(0,[item],[],[preference]);const initial=hook.render();
  hook.tick();const pending=hook.render();assert.equal(pending.preferences,initial.preferences);
  await hook.complete(1,[item],[],JSON.parse(JSON.stringify([preference])));
  assert.equal(hook.render().preferences,initial.preferences);
  assert.equal(hook.preferenceCalls.length,hook.receivedCalls.length);
});

test('empty or malformed preference refresh cannot leave a stale cross-workspace decision visible',async()=>{
  for(const next of [[],{invalid:true}]) {
    const hook=sharedHookHarness();hook.render();await hook.complete(0,[item],[],[preference]);hook.render();
    hook.tick();await hook.complete(1,[],[],next);const result=hook.render();
    assert.equal(result.preferences.length,0);assert.equal(result.loading,false);
    assert.equal(Boolean(result.error),!Array.isArray(next));
  }
});

test('confirmed contact choices supersede older refreshes, preserve unrelated choices and remain reversible',async()=>{
  const other={...preference,installationId:'other',sourceInstallationId:'other'};
  const hook=sharedHookHarness();hook.render();await hook.complete(0,[item],[],[other]);const initial=hook.render();
  hook.tick();initial.applyPreference(preference);
  await hook.complete(1,[item],[],[other]);const saved=hook.render();
  assert.equal(saved.preferences.length,2);
  assert.equal(saved.preferences.find(row=>row.installationId===item.installationId).choice,'original_installer');
  saved.applyPreference({...preference,choice:'open',updatedAt:'2026-10-29T12:01:00Z'});
  const reopened=hook.render();assert.equal(reopened.preferences.length,2);
  assert.equal(reopened.preferences.find(row=>row.installationId===item.installationId).choice,'open');
  assert.equal(reopened.preferences.find(row=>row.installationId==='other'),other);
});

test('contact choices and late save callbacks are isolated on workspace, user and enabled changes',async()=>{
  for(const nextArgs of [['another',true,'user'],['workspace',true,'another'],['workspace',false,'user'],['workspace',true,undefined]]) {
    const hook=sharedHookHarness();hook.render();await hook.complete(0,[item],[],[preference]);const previous=hook.render();
    hook.tick();const switched=hook.render(nextArgs);assert.equal(switched.preferences.length,0);
    previous.applyPreference({...preference,choice:'declined'});
    await hook.complete(1,[item],[],[preference]);
    assert.equal(hook.render().preferences.length,0);
    if(nextArgs[1]&&nextArgs[2]) { await hook.complete(2,[],[],[]);assert.equal(hook.render().preferences.length,0); }
  }
});

test('an acceptance racing a confirmed preference save replaces the same canonical choice, not a second history entry',async()=>{
  const hook=sharedHookHarness();hook.render();await hook.complete(0,[item],[],[preference]);const initial=hook.render();
  initial.applyPreference({...preference,installationId:'owned-mirror',choice:'declined',updatedAt:'2026-10-29T12:01:00Z'});
  const saved=hook.render();assert.equal(saved.preferences.length,1);
  assert.equal(saved.preferences[0].installationId,'owned-mirror');assert.equal(saved.preferences[0].choice,'declined');
});
