const assert = require('node:assert/strict');
const test = require('node:test');
const { harness } = require('./helpers.cjs');
const schedule = {
  installationId:'00000000-0000-0000-0000-000000000001',sourceWorkspaceId:'00000000-0000-0000-0000-000000000002',
  sourceInstallationId:'00000000-0000-0000-0000-000000000003',maintenanceAppointmentId:'00000000-0000-0000-0000-000000000004',
  date:'2026-11-20',time:'09:30',selectedDevices:[{productName:'Test AC',unitNumber:1}],providerName:'Test provider',
};
function client(response) {
  const calls=[];
  const api=harness({}, {'@/lib/supabase':{supabase:{rpc:async(name,args)=>{calls.push({name,args});return response;}}}})
    .load('src/lib/alinflow/shared-maintenance-client.ts');
  return {...api,calls};
}
test('schedule RPC reads only the requested workspace and preserves its validated device/date provenance',async()=>{
  const api=client({data:[schedule],error:null});
  assert.deepEqual(await api.listMaintenanceSchedules('workspace'),[schedule]);
  assert.equal(api.calls[0].name,'list_shared_maintenance_schedules');
  assert.equal(api.calls[0].args.p_workspace_id,'workspace');
  assert.equal(api.isSharedMaintenanceSchedule({...schedule,date:'2028-02-29'}),true);
  assert.equal(api.isSharedMaintenanceSchedule({...schedule,time:'09:30:45'}),true);
});
test('malformed or ambiguous shared bookings fail closed rather than color unrelated installations',async()=>{
  for(const value of [null,{},[{...schedule,date:'2026-02-29'}],[{...schedule,date:'2026-04-31'}],
    [{...schedule,date:'2026-11-20T09:30:00Z'}],[{...schedule,time:'24:00'}],[{...schedule,time:undefined}],
    [{...schedule,installationId:''}],[{...schedule,selectedDevices:null}],[{...schedule,selectedDevices:[]}],
    [{...schedule,selectedDevices:[{productName:'Test AC',unitNumber:0}]}],
    [{...schedule,selectedDevices:[schedule.selectedDevices[0],schedule.selectedDevices[0]]}]]) {
    await assert.rejects(client({data:value,error:null}).listMaintenanceSchedules('workspace'),/nem olvasható/);
  }
});
test('missing server support and revoked permissions remain explicit schedule errors',async()=>{
  for(const code of ['PGRST202','42883']) await assert.rejects(client({error:{code}}).listMaintenanceSchedules('workspace'),/még nincs bekapcsolva/);
  await assert.rejects(client({error:{code:'42501'}}).listMaintenanceSchedules('workspace'),/nincs aktív jogosultságod/);
  await assert.rejects(client({error:{code:'500'}}).listMaintenanceSchedules('workspace'),/betöltése nem sikerült/);
});
