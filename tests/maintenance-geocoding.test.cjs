const assert=require('node:assert/strict');
const test=require('node:test');
const {harness}=require('./helpers.cjs');
const h=harness();
const geo=h.load('src/lib/alinflow/maintenance-geocoding.ts');
const id='10000000-0000-0000-0000-000000000001';
const version='2026-10-11T12:00:00.000Z';
const point={appointmentId:id,address:'1234 City, Old street',customer:{id:'customer',activeAppointmentId:id,workAddress:'Old street',address:'Old street',appointmentUpdatedAt:version}};
const result={appointmentId:id,status:'ok',latitude:47,longitude:19};
const saved={latitude:47,longitude:19,geocodeStatus:'ok',geocodedAt:'2026-10-11T12:10:00.000Z',updatedAt:'2026-10-11T12:10:00.000Z'};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}

test('geocode snapshots exclude shared display-only/unversioned rows and never coerce missing coordinates into zero',()=>{
  const snapshot=geo.maintenanceGeocodeTarget(point);
  assert.equal(snapshot.expectedAddress,'Old street');assert.equal(snapshot.appointmentUpdatedAt,version);
  for(const other of [{...point,sharedMaintenance:{}},{...point,appointmentId:'shared:123'}, {...point,customer:{...point.customer,appointmentUpdatedAt:undefined}}])assert.equal(geo.maintenanceGeocodeTarget(other),null);
  for(const value of [null,'',Infinity,91])assert.equal(geo.maintenanceGeocodeParameters('workspace',snapshot,{...result,latitude:value}),null);
  assert.equal(geo.maintenanceGeocodeParameters('workspace',snapshot,{...result,appointmentId:'unexpected'}),null);
  assert.equal(geo.maintenanceGeocodePatch({}),null);
  assert.equal(geo.maintenanceGeocodePatch({...saved,longitude:181}),null);
  assert.equal(geo.maintenanceGeocodePatch({...saved,geocodeStatus:'failed',latitude:null,longitude:null}).mapLatitude,undefined);
});

function flow(overrides={}){
  const scope={workspace:'workspace',user:{current:'user'},generation:{current:1}};
  const messages=[],calls=[],patches=[],busy=[];
  const context={...geo,currentWorkspaceId:()=>scope.workspace,authUserIdRef:scope.user,authLoadGenerationRef:scope.generation,
    maintenanceMapPoints:[point],hasMaintenanceMapCoordinates:()=>false,beginAction:()=>true,endAction:()=>{},
    setMessage:value=>messages.push(value),setMaintenanceMapGeocodingBusy:value=>busy.push(value),
    supabase:{auth:{getSession:async()=>({data:{session:{access_token:'synthetic',user:{id:'user'}}}})},
      rpc:async(name,args)=>{calls.push({name,args});return{data:saved,error:null};}},
    fetch:async()=>({ok:true,json:async()=>({results:[result]})}),
    isMissingMaintenanceMapSchemaError:()=>false,patchAppointmentMapData:(...args)=>patches.push(args),...overrides};
  return{...h.functions(['geocodeMissingMaintenanceMapPoints'],context),scope,messages,calls,patches,busy,context};
}
test('requested results are saved through captured scope/version RPC exactly once; no generic appointment write',async()=>{
  const run=flow({fetch:async()=>({ok:true,json:async()=>({results:[{...result,appointmentId:'unrequested'},result,result]})})});
  await run.geocodeMissingMaintenanceMapPoints();assert.equal(run.calls.length,1);assert.equal(run.patches.length,1);
  assert.equal(run.calls[0].name,'save_maintenance_geocode');assert.equal(run.calls[0].args.p_workspace_id,'workspace');
  assert.equal(run.calls[0].args.p_expected_appointment_updated_at,version);
  assert.equal(run.patches[0][1].appointmentUpdatedAt,saved.updatedAt);assert.equal(run.patches[0][2].expectedAddress,'Old street');
  assert.match(run.messages.at(-1),/1 cím mentve/);
});
test('user/workspace change during geocode drops delayed results before persistence',async()=>{
  for(const change of [scope=>scope.workspace='other',scope=>scope.user.current='other',scope=>scope.generation.current++]){
    const response=deferred(),run=flow({fetch:()=>response.promise});
    const pending=run.geocodeMissingMaintenanceMapPoints();await Promise.resolve();change(run.scope);
    response.resolve({ok:true,json:async()=>({results:[result]})});await pending;
    assert.equal(run.calls.length,0);assert.equal(run.patches.length,0);assert.equal(run.busy.includes(false),false,'old finally must not clear another scope busy flag');
  }
});
test('identity change while reading session cannot send a request with the wrong account token',async()=>{
  const session=deferred();let fetched=false;
  const run=flow({supabase:{auth:{getSession:()=>session.promise}},fetch:async()=>{fetched=true;throw Error('must not run');}});
  const pending=run.geocodeMissingMaintenanceMapPoints();run.scope.user.current='other';
  session.resolve({data:{session:{access_token:'new-account',user:{id:'other'}}}});await pending;
  assert.equal(fetched,false);assert.equal(run.patches.length,0);
});
for (const code of ['PT409', '40001']) test(`stale server rejection ${code} is skipped once without retry or coordinate patch`,async()=>{
  const run=flow();let attempts=0;
  run.context.supabase.rpc=async()=>{attempts++;return{error:{code,message:'Address changed'},data:null};};
  await run.geocodeMissingMaintenanceMapPoints();assert.equal(run.patches.length,0);assert.equal(attempts,1);
  assert.match(run.messages.at(-1),/0 cím mentve/);assert.match(run.messages.at(-1),/1 közben módosult cím kihagyva/);
});

test('workspace change during RPC and unconfirmed response never patch local markers',async()=>{
  const reply=deferred(),run=flow();run.context.supabase.rpc=()=>reply.promise;
  const pending=run.geocodeMissingMaintenanceMapPoints();await new Promise(done=>setImmediate(done));
  run.scope.workspace='other';reply.resolve({data:saved,error:null});await pending;assert.equal(run.patches.length,0);
  const malformed=flow();malformed.context.supabase.rpc=async()=>({data:{},error:null});await malformed.geocodeMissingMaintenanceMapPoints();
  assert.equal(malformed.patches.length,0);assert.match(malformed.messages.at(-1),/nem igazolható/);
});
test('local geocode patch preserves a newer or edited selected address',()=>{
  const fresh={...point.customer,appointmentUpdatedAt:'2026-10-11T12:09:00.000Z'},edited={...point.customer,address:'Unsaved new street'};
  let customers=[point.customer,fresh],works={customer:[point.customer]},selected=edited;
  const run=h.functions(['patchAppointmentMapData'],{setCustomers:fn=>customers=fn(customers),setWorkHistoryByCustomer:fn=>works=fn(works),setSelected:fn=>selected=fn(selected)});
  run.patchAppointmentMapData(id,geo.maintenanceGeocodePatch(saved),geo.maintenanceGeocodeTarget(point));
  assert.equal(customers[0].mapLatitude,47);assert.equal(customers[1],fresh);assert.equal(selected,edited);
  assert.equal(works.customer[0].appointmentUpdatedAt,saved.updatedAt);
});

test('stale geocode does not block the next valid address in the same batch',async()=>{
  const secondId='10000000-0000-0000-0000-000000000002';
  const secondPoint={...point,appointmentId:secondId,customer:{...point.customer,activeAppointmentId:secondId}};
  const run=flow({maintenanceMapPoints:[point,secondPoint],fetch:async()=>({ok:true,json:async()=>({results:[result,{...result,appointmentId:secondId}]})})});
  const attempted=[];
  run.context.supabase.rpc=async(name,args)=>{attempted.push(args.p_appointment_id);return args.p_appointment_id===id
    ?{error:{code:'PT409',message:'Address changed'},data:null}:{error:null,data:saved};};
  await run.geocodeMissingMaintenanceMapPoints();
  assert.deepEqual(attempted,[id,secondId]);assert.equal(run.patches.length,1);assert.equal(run.patches[0][0],secondId);
  assert.match(run.messages.at(-1),/1 cím mentve, 1 közben módosult cím kihagyva/);
});
