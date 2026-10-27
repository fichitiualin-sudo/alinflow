const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { harness, noop } = require('./helpers.cjs');
const h = harness();
const shared = h.load('src/lib/alinflow/shared-maintenance.ts');
const map = h.load('src/lib/alinflow/maintenance-map.ts');
const item = {
  grantId:'grant',installationId:'source-installation',sourceWorkspaceId:'source',sourceWorkspaceName:'Source business',
  customer:{name:'Synthetic customer',phone:'',email:'',postalCode:'',city:'Test City',address:'Test Street'},
  installationDate:'2020-01-01',installationTime:'08:00',climates:[{productName:'Test AC',quantity:1}],
  latitude:47,longitude:19,lastMaintenanceDate:null,maintenanceCount:0,
};

test('a declined shared installation stays in all/opt-out views and returns to due tracking when unchecked',()=>{
  const point=shared.sharedMaintenanceMapPoint({...item,maintenanceOptOut:true,maintenanceOptOutAt:'2026-10-27T07:00:00Z'});
  assert.equal(point.status,'optOut'); assert.equal(point.customer.maintenanceOptOut,true);
  assert.equal(point.maintenanceCount,0); assert.equal(point.nextMaintenanceDue,'2021-01-01');
  const visibility={own:true,external:true};
  assert.equal(map.filterMaintenanceMapPoints([point],{visibility}).length,1);
  assert.equal(map.filterMaintenanceMapPoints([point],{visibility,status:'optOut'}).length,1);
  assert.equal(map.filterMaintenanceMapPoints([point],{visibility,status:'overdue'}).length,0);
  assert.equal(map.groupMaintenanceMapPoints([point])[0].status,'optOut');
  assert.equal(shared.sharedMaintenanceMapPoint({...item,maintenanceOptOut:false}).status,'overdue');
  assert.equal(item.maintenanceOptOut,undefined);
});

test('both coordination-only and local cards render the same checkbox, with pending shared save disabled',()=>{
  const ui=harness({}, {react:React,'react/jsx-runtime':require('react/jsx-runtime'),
    './GoogleMapCanvas':{GoogleMapCanvas:()=>null}}).load('src/components/alinflow/MaintenanceMapPanel.tsx');
  const pending=shared.sharedMaintenanceMapPoint({...item,maintenanceOptOut:true});
  const local={...shared.sharedMaintenanceMapPoint(item),appointmentId:'local',sharedMaintenance:undefined};
  const html=renderToStaticMarkup(React.createElement(ui.MaintenanceMapPanel,{points:[pending,local],
    googleMapsApiKey:'',geocodingBusy:false,onOpenCustomer:noop,onGeocodeMissing:noop,onToggleMaintenanceOptOut:noop,
    maintenanceOptOutBusyIds:[pending.appointmentId]}));
  assert.equal((html.match(/Nem kéri a karbantartást/g)||[]).length,2);
  assert.match(html,/<input[^>]*disabled=""[^>]*checked=""/);
  assert.match(html,/Egyeztetés Source business nevében/);
});

function action(overrides={}) {
  const calls=[],applied=[],patched=[],messages=[];
  const context={currentWorkspaceId:()=> 'target',authUserIdRef:{current:'partner'},authLoadGenerationRef:{current:1},
    beginAction:()=>true,endAction:noop,setMessage:(...value)=>messages.push(value),
    toggleAppointmentMaintenanceOptOut:async(...args)=>calls.push(['local',...args]),
    setSharedMaintenanceOptOut:async(row,checked)=>{calls.push(['shared',row,checked]);return {
      maintenanceOptOut:checked,maintenanceOptOutAt:checked?'2026-10-27T07:00:00Z':null,targetInstallationId:null};},
    sharedMaintenance:{applyOptOut:(...args)=>applied.push(args)},patchAppointmentMapData:(...args)=>patched.push(args),
    ...overrides};
  return {...h.functions(['toggleMaintenanceOptOut'],context),calls,applied,patched,messages,context};
}
test('shared saves never send a synthetic ID through the ordinary appointment updater',async()=>{
  const run=action(); await run.toggleMaintenanceOptOut(shared.sharedMaintenanceMapPoint(item),true);
  assert.equal(run.calls.length,1); assert.equal(run.calls[0][0],'shared'); assert.equal(run.calls[0][1],item);
  assert.equal(run.applied.length,1);assert.equal(run.patched.length,0);assert.match(run.messages.at(-1)[0],/^Mentve:/);
  await run.toggleMaintenanceOptOut({appointmentId:'local'},false);
  assert.deepEqual(run.calls[1],['local','local',false]);
});
test('failed saves preserve the displayed choice and report a failure',async()=>{
  const run=action({setSharedMaintenanceOptOut:async()=>{throw Error('Access revoked');}});
  await run.toggleMaintenanceOptOut(shared.sharedMaintenanceMapPoint(item),true);
  assert.equal(run.applied.length,0);assert.equal(run.patched.length,0);assert.match(run.messages.at(-1)[0],/hiba:/);
});
test('late save response cannot change state after user/workspace or auth-generation change',async()=>{
  for(const change of [r=>r.context.authUserIdRef.current='other',r=>r.context.authLoadGenerationRef.current++,
    r=>{r.workspace='other';}]) {
    let finish; const run=action({setSharedMaintenanceOptOut:()=>new Promise(resolve=>{finish=resolve;}),
      currentWorkspaceId:()=>run.workspace});run.workspace='target';
    const pending=run.toggleMaintenanceOptOut(shared.sharedMaintenanceMapPoint(item),true); change(run);
    finish({maintenanceOptOut:true,maintenanceOptOutAt:null,targetInstallationId:null});await pending;
    assert.equal(run.applied.length,0);assert.equal(run.messages.length,1);
  }
});
test('an acceptance racing with a checkbox save patches only the returned own mirror',async()=>{
  const run=action({setSharedMaintenanceOptOut:async()=>({maintenanceOptOut:true,
    maintenanceOptOutAt:'2026-10-27T07:00:00Z',targetInstallationId:'own-mirror'})});
  await run.toggleMaintenanceOptOut(shared.sharedMaintenanceMapPoint(item),true);
  assert.equal(run.patched.length,1);assert.equal(run.patched[0][0],'own-mirror');
});
test('pending repeat clicks do not start another request',async()=>{
  const run=action({beginAction:()=>false});await run.toggleMaintenanceOptOut(shared.sharedMaintenanceMapPoint(item),true);
  assert.equal(run.calls.length,0);assert.equal(run.messages.length,0);
});
test('client validates saved state and sends only the specific grant, installation and boolean',async()=>{
  let result={maintenanceOptOut:true,maintenanceOptOutAt:null,targetInstallationId:null},captured;
  const api=harness({}, {'@/lib/supabase':{supabase:{rpc:async(name,args)=>{captured={name,args};return {data:result,error:null};}}}})
    .load('src/lib/alinflow/shared-maintenance-client.ts');
  await api.setSharedMaintenanceOptOut(item,true);
  assert.equal(captured.name,'set_shared_maintenance_opt_out');
  assert.equal(JSON.stringify(captured.args),JSON.stringify({p_grant_id:'grant',p_installation_id:'source-installation',p_opt_out:true}));
  for(const invalid of [null,{},false,{...result,maintenanceOptOut:false},{...result,targetInstallationId:42}]) {
    result=invalid;await assert.rejects(api.setSharedMaintenanceOptOut(item,true),/nem igazolható/);
  }
});
