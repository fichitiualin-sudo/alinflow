const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { harness, noop } = require('./helpers.cjs');

const h = harness({}, {react:React,'react/jsx-runtime':require('react/jsx-runtime')});
const choices = h.load('src/lib/alinflow/maintenance-contact-choice.ts');
const shared = h.load('src/lib/alinflow/shared-maintenance.ts');
const map = h.load('src/lib/alinflow/maintenance-map.ts');
const products = h.load('src/lib/alinflow/products.ts');
const format = h.load('src/lib/alinflow/format.ts');
const { MaintenanceChoiceControls } = h.load('src/components/alinflow/MaintenanceChoiceControls.tsx');
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const item = {
  grantId:'grant',installationId:'original-installation',sourceWorkspaceId:'original-workspace',sourceWorkspaceName:'Original installer',
  customer:{name:'Example customer',phone:'',email:'',postalCode:'1234',city:'Example City',address:'Example Street 1'},
  installationDate:'2020-01-01',installationTime:'08:00',climates:[{productName:'Example AC',quantity:1}],
  latitude:47,longitude:19,lastMaintenanceDate:null,maintenanceCount:0,
};
const preference = {installationId:item.installationId,sourceInstallationId:item.installationId,
  sourceWorkspaceId:item.sourceWorkspaceId,sourceWorkspaceName:item.sourceWorkspaceName,
  choice:'original_installer',updatedAt:'2026-10-29T12:00:00Z',isSource:false};
const installation = {id:'original-customer',activeAppointmentId:item.installationId,appointmentType:'installation',
  status:'Lezárva',maintenanceOrigin:'own',date:item.installationDate,time:item.installationTime,
  city:item.customer.city,address:item.customer.address,
  quoteItems:[{productId:'manual-ac',isManual:true,customName:'Example AC',quantity:1}]};
const sourcePoint = {...shared.sharedMaintenanceMapPoint(item),sharedMaintenance:undefined,appointmentId:item.installationId,
  customerId:installation.id,customer:installation,maintenanceOrigin:'own'};

test('the original installer retains due tracking while recipients get a separate original-installer status',()=>{
  const source=choices.applyMaintenanceContactPreferences([sourcePoint],[{...preference,isSource:true}])[0];
  const recipient=choices.applyMaintenanceContactPreferences([shared.sharedMaintenanceMapPoint(item)],[preference])[0];
  assert.equal(source.status,'overdue');assert.equal(source.originalInstallerAvailable,true);
  assert.equal(recipient.status,'originalInstaller');assert.equal(recipient.originalInstallerAvailable,true);
  assert.equal(recipient.maintenanceContactPreference.choice,'original_installer');
  assert.equal(map.filterMaintenanceMapPoints([recipient],{visibility:{own:true,external:true},status:'optOut'}).length,0);
  assert.equal(map.filterMaintenanceMapPoints([recipient],{visibility:{own:true,external:true},status:'originalInstaller'}).length,1);
});

test('the original-installer choice filter includes source requests without changing their maintenance status',()=>{
  const source=choices.applyMaintenanceContactPreferences([sourcePoint],[{...preference,isSource:true}])[0];
  const recipient=choices.applyMaintenanceContactPreferences([shared.sharedMaintenanceMapPoint(item)],[preference])[0];
  const regular={...sourcePoint,appointmentId:'not-requested'};
  const points=[source,recipient,regular];
  const visibility={own:true,external:true};
  const selected=map.filterMaintenanceMapPoints(points,{visibility,status:'originalInstaller'});
  assert.equal(selected.length,2);assert.equal(selected[0],source);assert.equal(selected[1],recipient);
  assert.equal(map.filterMaintenanceMapPoints(points,{visibility,status:'overdue'}).length,2);
  assert.equal(map.filterMaintenanceMapPoints(points,{visibility:{own:true,external:false},status:'originalInstaller'}).length,1);
  assert.equal(source.status,'overdue');assert.equal(recipient.status,'originalInstaller');
});

test('explicit decline applies to either role, explicit open restores due tracking without editing stored legacy data',()=>{
  for(const isSource of [false,true]) {
    const base=isSource?sourcePoint:shared.sharedMaintenanceMapPoint(item);
    const legacy={...base,status:'optOut',customer:{...base.customer,maintenanceOptOut:true,maintenanceOptOutAt:'2025-01-01'}};
    const before=JSON.stringify(legacy);
    const declined=choices.applyMaintenanceContactPreferences([legacy],[{...preference,isSource,choice:'declined'}])[0];
    const open=choices.applyMaintenanceContactPreferences([legacy],[{...preference,isSource,choice:'open'}])[0];
    assert.equal(declined.status,'optOut');assert.equal(open.status,'overdue');
    assert.equal(open.maintenanceContactPreference.choice,'open');
    assert.equal(open.customer,legacy.customer);assert.equal(JSON.stringify(legacy),before);
    const unchanged=choices.applyMaintenanceContactPreferences([legacy],[])[0];
    assert.equal(unchanged.status,'optOut');assert.equal(unchanged.maintenanceContactPreference,undefined);
  }
});

test('a saved choice applies to accepted mirrors while preserving one marker, history and local contact details',()=>{
  const own={...sourcePoint,appointmentId:'mirror',customerId:'recipient-customer',maintenanceOrigin:'external',
    customer:{...installation,id:'recipient-customer',activeAppointmentId:'mirror',name:'Locally corrected'},
    lastMaintenanceDate:'2026-01-01',maintenanceCount:1};
  const accepted={...item,targetInstallationId:'mirror',targetCustomerId:'recipient-customer',lastMaintenanceDate:'2025-01-01',maintenanceCount:2};
  const merged=shared.mergeSharedMaintenancePoints([own],[accepted]);
  const rendered=choices.applyMaintenanceContactPreferences(merged,[{...preference,installationId:'mirror'}]);
  assert.equal(rendered.length,1);assert.equal(rendered[0].status,'originalInstaller');
  assert.equal(rendered[0].customer,own.customer);assert.equal(rendered[0].lastMaintenanceDate,'2026-01-01');
  assert.equal(rendered[0].maintenanceCount,3);assert.equal(rendered[0].originalInstallerAvailable,true);
});

test('a concurrent acceptance does not leave the old coordination card showing the previous preference',()=>{
  const point=shared.sharedMaintenanceMapPoint(item);
  const afterAcceptance={...preference,installationId:'new-mirror',choice:'declined'};
  const result=choices.applyMaintenanceContactPreferences([point],[afterAcceptance])[0];
  assert.equal(result.status,'optOut');assert.equal(result.maintenanceContactPreference,afterAcceptance);
});

test('unrelated preferences do not affect a climate and a manual external source does not invent an original installer',()=>{
  const manual={...sourcePoint,maintenanceOrigin:'external'};
  const result=choices.applyMaintenanceContactPreferences([manual],[{...preference,installationId:'different',sourceInstallationId:'different'}])[0];
  assert.equal(result.status,sourcePoint.status);assert.equal(result.originalInstallerAvailable,false);
  assert.equal(result.maintenanceContactPreference,undefined);
});

test('customer history resolves a newly accepted mirror through its actual shared provenance',()=>{
  const { maintenancePreferenceForInstallation: find }=h.functions(['maintenancePreferenceForInstallation'],{},'src/components/alinflow/WorkPagePanel.tsx');
  const received=[{...item,targetInstallationId:'mirror',targetCustomerId:'recipient-customer'}];
  assert.equal(find('mirror',[preference],received),preference,'the earlier source-view preference is still the same decision');
  assert.equal(find('mirror',[{...preference,isSource:true}],received),undefined,'source-workspace views cannot be substituted for a recipient');
  assert.equal(find('mirror',[{...preference,sourceWorkspaceId:'other'}],received),undefined);
  assert.equal(find('different',[preference],received),undefined);assert.equal(find(undefined,[preference],received),undefined);
  const local={...preference,installationId:'mirror'};assert.equal(find('mirror',[local,preference],received),local);
});

function fields(props) {
  const tree=MaintenanceChoiceControls({legacyOptOut:false,allowOriginalInstaller:true,onChange:noop,...props});
  return React.Children.toArray(tree.props.children).flatMap(label=>
    React.Children.toArray(label.props.children).filter(child=>child.type==='input'));
}
test('the two controls are mutually exclusive, explicitly open overrides legacy and each uncheck reopens tracking',()=>{
  for(const choice of ['open','original_installer','declined']) {
    const changes=[];const inputs=fields({choice,legacyOptOut:true,onChange:value=>changes.push(value)});
    assert.equal(inputs.filter(input=>input.props.checked).length,choice==='open'?0:1);
    assert.equal(inputs[0].props.checked,choice==='original_installer');
    assert.equal(inputs[1].props.checked,choice==='declined');
    inputs[0].props.onChange({target:{checked:true}});inputs[0].props.onChange({target:{checked:false}});
    inputs[1].props.onChange({target:{checked:true}});inputs[1].props.onChange({target:{checked:false}});
    assert.deepEqual(changes,['original_installer','open','declined','open']);
  }
  assert.equal(fields({legacyOptOut:true})[1].props.checked,true);
  assert.equal(fields({allowOriginalInstaller:false}).length,1);
  assert.ok(fields({busy:true}).every(input=>input.props.disabled));
});

test('map cards show both distinct choices without conflating original-installer requests with declines',()=>{
  const { MaintenanceMapPanel }=harness({}, {react:React,'react/jsx-runtime':require('react/jsx-runtime'),
    './GoogleMapCanvas':{GoogleMapCanvas:()=>null}}).load('src/components/alinflow/MaintenanceMapPanel.tsx');
  const points=choices.applyMaintenanceContactPreferences([shared.sharedMaintenanceMapPoint(item)],[preference]);
  const html=render(MaintenanceMapPanel,{points,googleMapsApiKey:'',geocodingBusy:false,onOpenCustomer:noop,
    onGeocodeMissing:noop,onToggleMaintenanceOptOut:()=>{throw Error('Old action must not be used');},
    onChangeMaintenancePreference:noop,maintenanceOptOutBusyIds:[points[0].appointmentId]});
  assert.match(html,/Az eredeti szerelőtől kéri/);assert.match(html,/Nem kéri a karbantartást/);
  assert.match(html,/Eredeti szerelőt kéri/);
  assert.equal((html.match(/<input[^>]*checked=""/g)||[]).length,3,'two visibility controls and only the original-installer choice are checked');
  const newGroup=html.match(/<div role="group" aria-label="Karbantartási választás"[\s\S]*?<\/div>/)[0];
  assert.equal((newGroup.match(/checked=""/g)||[]).length,1);assert.equal((newGroup.match(/disabled=""/g)||[]).length,2);
});

test('map filter counts include original-workspace requests once and the selected filter displays them',()=>{
  const source={...choices.applyMaintenanceContactPreferences([sourcePoint],[{...preference,isSource:true}])[0],customerName:'Source request'};
  const recipient={...choices.applyMaintenanceContactPreferences([shared.sharedMaintenanceMapPoint(item)],[preference])[0],customerName:'Recipient request'};
  const regular={...sourcePoint,appointmentId:'not-requested',customerName:'No installer preference'};
  const props={points:[source,recipient,regular],googleMapsApiKey:'',geocodingBusy:false,onOpenCustomer:noop,
    onGeocodeMissing:noop,onToggleMaintenanceOptOut:noop,onChangeMaintenancePreference:noop};
  const load=react=>harness({}, {react,'react/jsx-runtime':require('react/jsx-runtime'),
    './GoogleMapCanvas':{GoogleMapCanvas:()=>null}}).load('src/components/alinflow/MaintenanceMapPanel.tsx').MaintenanceMapPanel;
  const html=render(load(React),props);
  const filterButtons=html.match(/<button[^>]*>[\s\S]*?<\/button>/g)||[];
  const choiceButton=filterButtons.find(button=>button.includes('Eredeti szerelőt kéri'));
  const overdueButton=filterButtons.find(button=>button.includes('Esedékes'));
  const text=html=>html.replace(/<[^>]*>/g,'');
  assert.match(text(choiceButton),/Eredeti szerelőt kéri \(2\)/);
  assert.match(text(overdueButton),/Esedékes \(2\)/);
  const filtered=render(load({...React,useState:initial=>React.useState(initial==='all'?'originalInstaller':initial)}),props);
  assert.match(filtered,/Source request/);assert.match(filtered,/Recipient request/);assert.doesNotMatch(filtered,/No installer preference/);
});

test('customer installation card uses the same explicit choice, preserving partner history and the original record',()=>{
  const ui=h.functions(['workDateTimeLabel','workAddressLabel','workIdentity','ClimateMaintenanceHistory','InstalledClimateMaintenanceCard'],
    {climateSummary:products.climateSummary,displayAddress:format.displayAddress,MaintenanceChoiceControls},
    'src/components/alinflow/WorkPagePanel.tsx');
  const legacy={...installation,maintenanceOptOut:true};const before=JSON.stringify(legacy);
  const html=render(ui.InstalledClimateMaintenanceCard,{installation:legacy,works:[],
    sharedRows:[{action:'SharedMaintenance',reportDate:'2026-10-26',reportDateLabel:'2026.10.26',status:'Lezárva',providerName:'Partner'}],
    onOpenWorkVersion:noop,onToggleMaintenanceOptOut:noop,onChangeMaintenancePreference:noop,
    maintenanceContactPreference:{...preference,isSource:true,choice:'open'},originalInstallerAvailable:true});
  assert.equal((html.match(/checked=""/g)||[]).length,0);assert.match(html,/2026\.10\.26/);assert.match(html,/Karbantartó: .*Partner/);
  assert.match(html,/Az eredeti szerelőtől kéri/);assert.match(html,/Nem kéri a karbantartást/);
  assert.doesNotMatch(html,/Még nincs rögzített karbantartás/);assert.equal(JSON.stringify(legacy),before);
});

function client(response=preference) {
  const calls=[];const state={response,error:null};
  const api=harness({}, {'@/lib/supabase':{supabase:{rpc:async(name,args)=>{
    calls.push({name,args});return {data:state.response,error:state.error};
  }}}}).load('src/lib/alinflow/shared-maintenance-client.ts');
  return {api,calls,state};
}
test('choice client sends only workspace, actual installation, specific choice, expected version and optional grant',async()=>{
  const c=client();await c.api.setMaintenanceContactPreference('recipient',item.installationId,'original_installer',null,item.grantId);
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls[0])),{name:'set_maintenance_contact_preference',args:{
    p_workspace_id:'recipient',p_installation_id:item.installationId,p_choice:'original_installer',p_expected_updated_at:null,p_grant_id:item.grantId}});
  c.state.response={...preference,installationId:'mirror',choice:'open'};
  await c.api.setMaintenanceContactPreference('recipient','mirror','open',preference.updatedAt);
  assert.equal(c.calls[1].args.p_expected_updated_at,preference.updatedAt);assert.equal(c.calls[1].args.p_grant_id,null);
});

test('client accepts only confirmed matching choice replies, including server-resolved acceptance mirrors',async()=>{
  const c=client();
  for(const invalid of [null,{},false,{...preference,choice:'declined'},{...preference,sourceInstallationId:'other'},
    {...preference,isSource:true},{...preference,updatedAt:null},{...preference,sourceWorkspaceName:''}]) {
    c.state.response=invalid;
    await assert.rejects(c.api.setMaintenanceContactPreference('recipient',item.installationId,'original_installer',null,item.grantId),/nem igazolható/);
  }
  c.state.response={...preference,installationId:'newly-created-mirror'};
  const saved=await c.api.setMaintenanceContactPreference('recipient',item.installationId,'original_installer',null,item.grantId);
  assert.equal(saved.installationId,'newly-created-mirror');
  await assert.rejects(c.api.setMaintenanceContactPreference('recipient','different-mirror','original_installer',null),/nem igazolható/);
});

test('malformed lists, stale saves and revoked access become actionable errors rather than successful choices',async()=>{
  const c=client([preference]);const listed=await c.api.listMaintenanceContactPreferences('recipient');assert.equal(listed.length,1);
  assert.equal(c.calls[0].name,'list_maintenance_contact_preferences');assert.equal(c.calls[0].args.p_workspace_id,'recipient');
  for(const malformed of [null,{},[{}],[{...preference,choice:'unknown'}]]) {
    c.state.response=malformed;await assert.rejects(c.api.listMaintenanceContactPreferences('recipient'),/nem olvasható/);
  }
  for(const [code,expected] of [['40001',/közben megváltozott/],['42501',/nincs aktív jogosultságod/],['PGRST202',/nincs bekapcsolva/]]) {
    c.state.error={code,message:'Synthetic failure'};
    await assert.rejects(c.api.setMaintenanceContactPreference('recipient',item.installationId,'open',preference.updatedAt,item.grantId),expected);
  }
});

function saveAction(overrides={}) {
  const calls=[],applied=[],patched=[],messages=[],started=[],ended=[];
  let refreshes=0;
  const context={
    currentWorkspaceId:()=> 'recipient',authUserIdRef:{current:'user'},authLoadGenerationRef:{current:1},
    beginAction:key=>{started.push(key);return true;},endAction:key=>ended.push(key),
    setMessage:(...args)=>messages.push(args),patchAppointmentMapData:(...args)=>patched.push(args),
    sharedMaintenance:{preferences:[preference],received:[],loading:false,error:'',applyPreference:row=>applied.push(row),refresh:async()=>{refreshes++;}},
    setMaintenanceContactPreference:async(...args)=>{calls.push(args);return {...preference,choice:args[2]};},
    toggleAppointmentMaintenanceOptOut:()=>{throw Error('New choice must not use the legacy update');},
    persistCustomerToDb:()=>{throw Error('Preference is not customer persistence');},
    ...overrides,
  };
  const functions=h.functions(['saveMaintenancePreference','changeMapMaintenancePreference','changeCustomerMaintenancePreference'],context);
  return {...functions,calls,applied,patched,messages,started,ended,context,get refreshes(){return refreshes;}};
}

test('map saves send the source ID with its grant while customer saves send only their own appointment ID',async()=>{
  const run=saveAction();await run.changeMapMaintenancePreference(shared.sharedMaintenanceMapPoint(item),'original_installer');
  assert.deepEqual(Array.from(run.calls[0]),['recipient',item.installationId,'original_installer',preference.updatedAt,item.grantId]);
  assert.match(run.started[0],/^maintenance-option:shared:/);assert.equal(run.applied.length,1);assert.equal(run.patched.length,0);
  run.context.sharedMaintenance.preferences=[{...preference,installationId:'mirror'}];
  await run.changeCustomerMaintenancePreference({...installation,activeAppointmentId:'mirror'},'declined');
  assert.deepEqual(Array.from(run.calls[1]),['recipient','mirror','declined',preference.updatedAt,undefined]);
  assert.equal(run.started[1],'maintenance-option:mirror');assert.equal(run.ended.length,2);
});

test('only a confirmed original-workspace reopen clears that source installation legacy exclusion locally',async()=>{
  const run=saveAction({setMaintenanceContactPreference:async(_workspace,id,choice)=>({...preference,installationId:id,choice,isSource:true})});
  await run.changeCustomerMaintenancePreference(installation,'declined');assert.equal(run.patched.length,0);
  await run.changeCustomerMaintenancePreference(installation,'open');assert.equal(run.patched.length,1);
  assert.equal(run.patched[0][0],installation.activeAppointmentId);assert.equal(run.patched[0][1].maintenanceOptOut,false);
  assert.equal(run.applied.length,2);assert.match(run.messages.at(-1)[0],/^Mentve:/);
});

test('a newly accepted customer mirror saves with the existing canonical version and its own client ID',async()=>{
  const run=saveAction();run.context.sharedMaintenance.received=[{...item,targetInstallationId:'mirror',targetCustomerId:'recipient-customer'}];
  await run.changeCustomerMaintenancePreference({...installation,id:'recipient-customer',activeAppointmentId:'mirror'},'declined');
  assert.deepEqual(Array.from(run.calls[0]),['recipient','mirror','declined',preference.updatedAt,undefined]);
  assert.equal(run.applied.length,1);assert.equal(run.refreshes,0);assert.equal(run.patched.length,0);
});

test('unloaded, failed, duplicate or unsaved selections do not create an unversioned choice',async()=>{
  const loading=saveAction();loading.context.sharedMaintenance.loading=true;
  await loading.changeCustomerMaintenancePreference(installation,'declined');assert.equal(loading.calls.length,0);assert.match(loading.messages[0][0],/töltődnek/);
  const failed=saveAction();failed.context.sharedMaintenance.error='Permission refresh failed';
  await failed.changeCustomerMaintenancePreference(installation,'open');assert.equal(failed.calls.length,0);assert.equal(failed.refreshes,1);
  const busy=saveAction({beginAction:()=>false});await busy.changeCustomerMaintenancePreference(installation,'declined');assert.equal(busy.calls.length,0);
  const unsaved=saveAction();await unsaved.changeCustomerMaintenancePreference({...installation,activeAppointmentId:undefined},'declined');
  assert.equal(unsaved.calls.length,0);assert.match(unsaved.messages[0][0],/előbb mentsd/);
});

test('failed or stale saves leave the displayed decision unchanged and request a fresh authorized view',async()=>{
  const run=saveAction({setMaintenanceContactPreference:async()=>{throw Error('The choice changed in another workspace');}});
  await run.changeMapMaintenancePreference(shared.sharedMaintenanceMapPoint(item),'declined');
  assert.equal(run.applied.length,0);assert.equal(run.patched.length,0);assert.equal(run.refreshes,1);
  assert.equal(run.context.sharedMaintenance.preferences[0],preference);
  assert.match(run.messages.at(-1)[0],/hiba:.*choice changed/);assert.equal(run.ended.length,1);
});

test('late save results cannot update another workspace, another user or a renewed auth generation',async()=>{
  for(const mutate of [run=>{run.workspace='different';},run=>{run.context.authUserIdRef.current='different';},
    run=>{run.context.authLoadGenerationRef.current++;}]) {
    let resolve;const run=saveAction({currentWorkspaceId:()=>run.workspace,
      setMaintenanceContactPreference:()=>new Promise(done=>{resolve=done;})});run.workspace='recipient';
    const pending=run.changeMapMaintenancePreference(shared.sharedMaintenanceMapPoint(item),'declined');mutate(run);
    resolve({...preference,choice:'declined'});await pending;
    assert.equal(run.applied.length,0);assert.equal(run.patched.length,0);assert.equal(run.messages.length,1);assert.equal(run.refreshes,0);
    assert.equal(run.ended.length,1);
  }
});
