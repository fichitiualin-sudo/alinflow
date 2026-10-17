const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { harness, database } = require("./helpers.cjs");
const w = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
const c = "20000000-0000-4000-8000-000000000001", a = "30000000-0000-4000-8000-000000000001", q = "40000000-0000-4000-8000-000000000001";
const userId = "90000000-0000-4000-8000-000000000001";
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ["2026-10-17T10:00:00Z"])); } static now() { return new Date("2026-10-17T10:00:00Z").getTime(); } }
function fixture(options = {}) {
  const queries=[], writes=[];
  const data={
    workspaces:[{id:w,name:"Test Klíma",slug:"synthetic",active:true}],
    workspace_members:[{workspace_id:w,user_id:userId,active:true}],
    workspace_settings:[{workspace_id:w,company_profile:{displayName:"Test Klíma"}}],
    appointments:[{id:a,workspace_id:w,customer_id:c,quote_id:q,appointment_type:"installation",scheduled_date:"2026-10-18",scheduled_time:"08:00",status:"Időpont foglalva",cancelled_at:null,updated_at:"2026-10-17T08:00:00Z"}],
    customers:[{id:c,workspace_id:w,name:"Teszt Anna",phone:"06 30 123 4567",updated_at:"2026-10-17T07:00:00Z"}],
    quotes:[{id:q,workspace_id:w,customer_id:c,appointment_id:a,notes:""}],
    quote_items:[{id:"item",workspace_id:w,quote_id:q,product_name:"Teszt klíma",description:"manual",quantity:2}],
    documents:[],maintenance_appointment_items:[],appointment_sms_receipts:[],...options.data,
  };
  const db=database(op=>{
    queries.push(op);
    assert.equal(op.method,"select","API must never mutate business records");
    if(options.failTable===op.table)return {error:{message:"private database detail"},data:null};
    if(!Object.hasOwn(data,op.table))throw Error("Unexpected table "+op.table);
    let result=data[op.table].filter(row=>Object.entries(op.filters).every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value));
    return {data:op.single?(result[0]||null):result,error:null};
  });
  db.auth={getUser:async()=>({data:{user:options.signedOut?null:{id:userId}},error:null})};
  db.rpc=async(name,args)=>{
    writes.push({name,args});
    if(options.rpcError)return {data:null,error:{code:options.rpcError}};
    const row={workspace_id:w,customer_id:c,appointment_id:a,content_key:args.p_content_key,acknowledged_at:"2026-10-17T10:00:01Z"};
    data.appointment_sms_receipts.push(row);return {data:row,error:null};
  };
  const h=harness({Date:FixedDate,process:{env:{NEXT_PUBLIC_SUPABASE_URL:"https://example.invalid",NEXT_PUBLIC_SUPABASE_ANON_KEY:"test-public"}}},{"node:crypto":crypto,"@supabase/supabase-js":{createClient:()=>db}});
  const route=h.load("src/app/api/sms-reminders/route.ts");
  const get=(suffix="&days=1",workspace=w,headers={Authorization:"Bearer test"})=>route.GET(new Request(`https://example.test/api/sms-reminders?workspaceId=${workspace}${suffix}`,{headers}));
  const post=(body,headers={})=>route.POST(new Request("https://example.test/api/sms-reminders",{method:"POST",headers:{Authorization:"Bearer test","Content-Type":"application/json",...headers},body:JSON.stringify(body)}));
  return {data,queries,writes,get,post,route};
}
async function entry(f){const r=await f.get();assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/no-store/);return (await r.json()).entries[0];}
test("fresh appointment preview uses its quantity, one-hour arrival and saved workspace identity",async()=>{
 const f=fixture(), e=await entry(f);
 assert.equal(e.appointmentId,a);assert.equal(e.customerId,c);assert.equal(e.phone,"+36301234567");assert.match(e.text,/klímáit/);assert.match(e.arrivalWindow,/8.*9/);assert.match(e.text,/Test Klíma$/);assert.equal(e.contentKey.length,64);assert.equal(e.acknowledgedAt,null);assert.equal(f.writes.length,0);
 assert.ok(f.queries.every(op=>["workspaces"].includes(op.table)||op.filters.workspace_id===w));
});
test("day tabs select exact dates, and unsupported offsets fail",async()=>{
 const f=fixture();const r=await f.get("&days=2");assert.deepEqual((await r.json()).entries,[]);assert.ok(f.queries.some(op=>op.table==="appointments"&&op.filters.scheduled_date==="2026-10-19"));
 assert.equal((await f.get("&days=4")).status,400);
});
test("missing auth, expired session and foreign workspace never expose customers",async()=>{
 let f=fixture();assert.equal((await f.get("&days=1",w,{})).status,401);assert.equal(f.queries.length,0);
 f=fixture({signedOut:true});assert.equal((await f.get()).status,401);
 f=fixture();assert.equal((await f.get("&days=1",other)).status,403);assert.equal(f.queries.some(op=>op.table==="customers"),false);
});
test("completion only hides its exact appointment; nullable legacy documents cannot hide another visit",async()=>{
 const f=fixture();f.data.documents=[{workspace_id:w,customer_id:c,appointment_id:a,document_type:"survey_done"}];assert.equal((await (await f.get()).json()).entries.length,0);
 f.data.documents[0].appointment_id=null;assert.ok(await entry(f));
});
test("cancelled, finished, past and other appointments are excluded",async()=>{
 for(const change of [{status:"Lezárva"},{stock_deducted_at:"2026-10-17T10:00:00Z"},{cancelled_at:"2026-10-17"},{appointment_type:"other"},{scheduled_date:"2026-10-17"},{scheduled_time:"wrong"}]){
  const f=fixture();Object.assign(f.data.appointments[0],change);const r=await f.get(`&appointmentId=${a}&customerId=${c}`);assert.equal(r.status,404);
 }
});
test("maintenance uses selected installations, not customer's unrelated history or extra items",async()=>{
 const f=fixture();const installation="30000000-0000-4000-8000-000000000002";const installationQuote="40000000-0000-4000-8000-000000000002";
 f.data.appointments[0].appointment_type="maintenance";
 f.data.appointments.push({...f.data.appointments[0],id:installation,appointment_type:"installation",quote_id:installationQuote,scheduled_date:"2025-01-01"});
 f.data.quotes.push({id:installationQuote,workspace_id:w,customer_id:c,appointment_id:installation,notes:""});
 f.data.quote_items.push({workspace_id:w,quote_id:installationQuote,product_name:"Másik klíma",description:"manual",quantity:1},{workspace_id:w,quote_id:installationQuote,product_name:"Extra",description:"|item_type=extra",quantity:8});
 f.data.maintenance_appointment_items.push({workspace_id:w,customer_id:c,maintenance_appointment_id:a,installation_appointment_id:installation});
 const e=await entry(f);assert.match(e.text,/klímája karbantartását/);assert.doesNotMatch(e.text,/klímái/);
});
test("invalid or multiple recipient phone stays visible but cannot be acknowledged",async()=>{
 const f=fixture();f.data.customers[0].phone="06301234567;06701234567";const e=await entry(f);assert.equal(e.phone,null);
 const r=await f.post({workspaceId:w,customerId:c,appointmentId:a,contentKey:e.contentKey});assert.equal(r.status,400);assert.equal(f.writes.length,0);
});
test("only explicit POST acknowledges, payload cannot replace stored recipient or brand",async()=>{
 const f=fixture(),e=await entry(f);assert.equal(f.writes.length,0);
 const r=await f.post({workspaceId:w,customerId:c,appointmentId:a,contentKey:e.contentKey,text:"forged",phone:"+19999999999",brand:"Other"});assert.equal(r.status,200);
 assert.equal(f.writes[0].name,"acknowledge_appointment_sms");assert.equal(f.writes[0].args.p_content_key,e.contentKey);assert.equal(Object.hasOwn(f.writes[0].args,"text"),false);
 assert.ok((await entry(f)).acknowledgedAt);
});
test("changed appointment or phone rejects stale confirmation and retains old history",async()=>{
 for(const field of ["time","phone"]){const f=fixture(),e=await entry(f);await f.post({workspaceId:w,customerId:c,appointmentId:a,contentKey:e.contentKey});
 if(field==="time")f.data.appointments[0].scheduled_time="11:00";else f.data.customers[0].phone="06701234567";
 const fresh=await entry(f);assert.notEqual(fresh.contentKey,e.contentKey);assert.equal(fresh.changedSinceAcknowledgement,true);assert.equal(fresh.acknowledgedAt,null);
 const r=await f.post({workspaceId:w,customerId:c,appointmentId:a,contentKey:e.contentKey});assert.equal(r.status,409);assert.equal(f.writes.length,1);}
});
test("foreign customer/appointment binding is denied without mutation",async()=>{
 const f=fixture(),e=await entry(f);const r=await f.post({workspaceId:w,customerId:other,appointmentId:a,contentKey:e.contentKey});assert.equal(r.status,409);assert.equal(f.writes.length,0);
});
test("RPC stale-version and revoked-access outcomes are surfaced, never retried",async()=>{
 for(const [code,status] of [["PT409",409],["42501",403],["PT400",409],["unknown",503]]){
 const f=fixture({rpcError:code}),e=await entry(f);const r=await f.post({workspaceId:w,customerId:c,appointmentId:a,contentKey:e.contentKey});assert.equal(r.status,status);assert.equal(f.writes.length,1);}
});
test("schema or database failure never pretends preview or save succeeded",async()=>{
 const f=fixture({failTable:"appointment_sms_receipts"});const r=await f.get();assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private database detail/);assert.equal(f.writes.length,0);
});

test("maintenance does not sum alternative climate choices on a linked installation",async()=>{
 const f=fixture();const installation="30000000-0000-4000-8000-000000000002",iq="40000000-0000-4000-8000-000000000002";
 f.data.appointments[0].appointment_type="maintenance";
 f.data.appointments.push({...f.data.appointments[0],id:installation,appointment_type:"installation",quote_id:iq,scheduled_date:"2025-01-01"});
 f.data.quotes.push({id:iq,workspace_id:w,customer_id:c,appointment_id:installation,notes:"quote_pricing_mode:alternatives"});
 for(const name of ["Option A","Option B"]) f.data.quote_items.push({workspace_id:w,quote_id:iq,product_name:name,description:"manual",quantity:1});
 f.data.maintenance_appointment_items.push({workspace_id:w,customer_id:c,maintenance_appointment_id:a,installation_appointment_id:installation});
 const e=await entry(f);assert.match(e.text,/klímája karbantartását/);
});
