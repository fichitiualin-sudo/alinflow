const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const clone = value => JSON.parse(JSON.stringify(value));
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}
const status = (extra = {}) => ({ configured: true, canManage: true, connected: true, email: "owner@example.test", status: "active",
  linkedCount: 0, pendingCount: 0, errorCount: 0, lastSyncedAt: null, lastError: null, ...extra });
const item = (index, extra = {}) => ({ customerId: `customer-${index}`, name: `Szintetikus ügyfél ${index}`, phone: `+3630000${String(index).padStart(4,"0")}`,
  email: "", address: `Szintetikus cím ${index}`, notes: `Telepítés ${index}`, sourceHash: String(index).padStart(64,"0"),
  state: "new", resourceName: null, candidates: [], ...extra });
const preview = (items = Array.from({ length: 12 }, (_, index) => item(index + 1))) => ({ previewId: "preview-fixture",
  expiresAt: new Date(Date.now() + 600000).toISOString(), googleEmail: "owner@example.test", items });
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; }

function contactsUI(options = {}) {
  const slots = [], effects = [], requests = [], navigations = [], timers = new Map(), listeners = new Map();
  let cursor = 0, dirty = false, tree, nextTimer = 0;
  const props = { workspaceId: "workspace-one", userId: "user-one", ...options.props };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => { const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(slots[index],value)) { slots[index]=value; dirty=true; } }];
    },
    useRef(initial) { const index=cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect,deps) {
      const index=cursor++, previous=slots[index];
      if (!previous || deps.some((value,position) => !Object.is(value,previous.deps[position]))) {
        const record={ deps, cleanup:null }; slots[index]=record;
        effects.push(() => { previous?.cleanup?.(); record.cleanup=effect(); });
      }
    },
  };
  const requestGoogleContacts = async (path,workspaceId,userId,signal,body = {}) => {
    const request = { path,workspaceId,userId,signal,body }; requests.push(request);
    if (options.request) return options.request(request);
    if (path === "status") return options.status || status();
    if (path === "preview") return options.preview || preview();
    if (path === "approve") return { approved: body.items.length };
    if (path === "connect") return { url: "https://accounts.google.com/o/oauth2/v2/auth?fixture=true" };
    if (path === "sync") return { processed: 1, synced: 1, failed: 0 };
    if (path === "disconnect") return { paused: true };
    throw Error("Unexpected request " + path);
  };
  const { GoogleContactsSettingsPanel } = harness({ AbortController, document:{ visibilityState:"visible" }, window: {
    setInterval(fn) { const id=++nextTimer; timers.set(id,fn); return id; }, clearInterval(id) { timers.delete(id); },
    addEventListener(name,fn) { listeners.set(name,fn); }, removeEventListener(name,fn) { if (listeners.get(name)===fn) listeners.delete(name); },
    location:{ assign(value) { navigations.push(value); } },
  } }, { react, "react/jsx-runtime":require("react/jsx-runtime"), "./GoogleContactsSync":{ requestGoogleContacts } })
    .load("src/components/alinflow/GoogleContactsSettingsPanel.tsx");
  function render(changes = {}) {
    Object.assign(props,changes); let passes=0;
    do { assert.ok(++passes<12,"Effects must settle"); dirty=false; cursor=0; tree=GoogleContactsSettingsPanel(props);
      for (const run of effects.splice(0)) run();
    } while(dirty);
  }
  async function settle() { for (let i=0;i<6;i++) { await new Promise(resolve => setImmediate(resolve)); render(); } }
  function button(match) {
    const found=nodes(tree,node => node.type==="button" && (match instanceof RegExp ? match.test(text(node)) : text(node)===match));
    assert.equal(found.length,1,`Expected one button matching ${match}`); return found[0];
  }
  render();
  return { render,settle,requests,navigations,timers,listeners,button, nodes: predicate => nodes(tree,predicate), text: () => text(tree),
    async click(match) { const control=button(match); assert.equal(Boolean(control.props.disabled),false,"Button must be enabled"); control.props.onClick(); await settle(); },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("preview is read-only, displays ten rows, and never preselects customers", async () => {
  const ui=contactsUI(); await ui.settle();
  assert.deepEqual(ui.requests.map(request => request.path),["status"]);
  await ui.click("Ügyfelek áttöltése · előnézet");
  assert.deepEqual(ui.requests.map(request => request.path),["status","preview"]);
  assert.equal(ui.nodes(node => node.type==="article").length,10);
  assert.ok(ui.nodes(node => node.type==="select").every(node => node.props.value===""));
  assert.equal(ui.button(/0 kiválasztott ügyfél áttöltésének jóváhagyása/).props.disabled,true);
  await ui.click("Következő →");
  assert.equal(ui.nodes(node => node.type==="article").length,2);
  assert.ok(ui.text().includes("Szintetikus ügyfél 12"));
  assert.equal(ui.requests.some(request => ["approve","sync"].includes(request.path)),false);
  ui.cleanup(); assert.equal(ui.timers.size,0);
});

test("approval sends only explicitly selected current-page IDs, source hashes and remote choices", async () => {
  const records=[item(1),item(2,{ state:"match",candidates:[{ resourceName:"people/match",name:"Meglévő ügyfél",phones:["+36301234567"],emails:[],evidence:["phone"] }] }),
    item(3,{ state:"ambiguous",candidates:[{ resourceName:"people/ambiguous",name:"Kétértelmű",phones:["+36301234567"],emails:[],evidence:["phone"] }] })];
  const ui=contactsUI({ preview:preview(records) }); await ui.settle(); await ui.click("Ügyfelek áttöltése · előnézet");
  await ui.click("Az oldal egyértelmű tételeinek kijelölése");
  const selectors=ui.nodes(node => node.type==="select");
  assert.deepEqual(selectors.map(node => node.props.value),["new","people/match",""]);
  await ui.click("2 kiválasztott ügyfél áttöltésének jóváhagyása");
  const writes=ui.requests.filter(request => request.path==="approve"); assert.equal(writes.length,1);
  assert.deepEqual(clone(writes[0].body),{ previewId:"preview-fixture",items:[
    { customerId:records[0].customerId,sourceHash:records[0].sourceHash,resourceName:null },
    { customerId:records[1].customerId,sourceHash:records[1].sourceHash,resourceName:"people/match" },
  ] });
  assert.equal(writes[0].workspaceId,"workspace-one"); assert.equal(writes[0].userId,"user-one");
  assert.ok(!JSON.stringify(writes[0].body).includes("Szintetikus"));
  assert.equal(ui.nodes(node => node.type==="article").length,0);
  assert.match(ui.text(),/2 ügyfél összerendelése jóváhagyva/);
});

test("page changes clear choices and expired previews cannot be approved", async () => {
  const ui=contactsUI(); await ui.settle(); await ui.click("Ügyfelek áttöltése · előnézet");
  await ui.click("Az oldal egyértelmű tételeinek kijelölése"); await ui.click("Következő →"); await ui.click("← Előző");
  assert.ok(ui.nodes(node => node.type==="select").every(node => node.props.value===""));
  const stale=preview([item(1)]); stale.expiresAt="2020-01-01T00:00:00Z";
  const old=contactsUI({ preview:stale }); await old.settle(); await old.click("Ügyfelek áttöltése · előnézet");
  assert.equal(old.button("Az oldal egyértelmű tételeinek kijelölése").props.disabled,true);
  assert.ok(old.nodes(node => node.type==="select").every(node => node.props.disabled));
  assert.match(old.text(),/Az előnézet lejárt/);
});

test("OAuth requires explicit connect click and never starts preview or approval automatically", async () => {
  const ui=contactsUI({ status:status({ connected:false,email:"",status:null }) }); await ui.settle();
  const input=ui.nodes(node => node.type==="input" && node.props.type==="email")[0];
  input.props.onChange({ target:{ value:"OWNER@EXAMPLE.TEST" } }); ui.render();
  await ui.click("Google Névjegyek összekapcsolása");
  assert.deepEqual(ui.requests.map(request => request.path),["status","connect"]);
  assert.equal(ui.requests[1].body.email,"owner@example.test");
  assert.equal(ui.navigations.length,1); assert.ok(ui.navigations[0].startsWith("https://accounts.google.com/"));
});

test("stale preview response after switching workspace is aborted and cannot reveal prior data", async () => {
  const pending=deferred();
  const ui=contactsUI({ request: request => request.path==="preview" ? pending.promise : Promise.resolve(status({ email:`${request.workspaceId}@example.test` })) });
  await ui.settle(); ui.button("Ügyfelek áttöltése · előnézet").props.onClick();
  const oldRequest=ui.requests.find(request => request.path==="preview");
  ui.render({ workspaceId:"workspace-two",userId:"user-two" }); await ui.settle();
  assert.equal(oldRequest.signal.aborted,true);
  pending.resolve(preview([item(99,{ name:"Régi munkaterület bizalmas ügyfele" })])); await ui.settle();
  assert.equal(ui.nodes(node => node.type==="article").length,0);
  assert.ok(!ui.text().includes("Régi munkaterület"));
  assert.ok(ui.text().includes("workspace-two@example.test"));
});

test("rapid duplicate approval clicks enqueue one request only", async () => {
  const gate=deferred();
  const ui=contactsUI({ request: request => request.path==="status" ? Promise.resolve(status()) : request.path==="preview" ? Promise.resolve(preview([item(1)])) : gate.promise });
  await ui.settle(); await ui.click("Ügyfelek áttöltése · előnézet"); await ui.click("Az oldal egyértelmű tételeinek kijelölése");
  const button=ui.button("1 kiválasztott ügyfél áttöltésének jóváhagyása");
  button.props.onClick(); button.props.onClick();
  assert.equal(ui.requests.filter(request => request.path==="approve").length,1);
  gate.resolve({ approved:1 }); await ui.settle();
});

test("request helper does not send a stale or different user's token", async () => {
  let session=deferred(); const calls=[];
  const client=harness({ DOMException,fetch:async (...args) => { calls.push(args); return Response.json({ ok:true }); } },{
    react:{},"@/lib/supabase":{ supabase:{ auth:{ getSession:() => session.promise } } },
  }).load("src/components/alinflow/GoogleContactsSync.tsx");
  const controller=new AbortController(); const result=client.requestGoogleContacts("preview","workspace-one","user-one",controller.signal);
  controller.abort(); session.resolve({ data:{ session:{ user:{ id:"user-one" },access_token:"fixture" } },error:null });
  await assert.rejects(result,error => error.name==="AbortError"); assert.equal(calls.length,0);
  session=deferred(); const mismatched=client.requestGoogleContacts("preview","workspace-one","user-one",new AbortController().signal);
  session.resolve({ data:{ session:{ user:{ id:"user-other" },access_token:"fixture" } },error:null });
  await assert.rejects(mismatched,/bejelentkezés lejárt/); assert.equal(calls.length,0);
});

test("unsaved settings prevent OAuth navigation until saved", async () => {
  const ui=contactsUI({ props:{ canConnect:false },status:status({ connected:false,email:"owner@example.test",status:"paused" }) });
  await ui.settle();
  assert.equal(ui.button("Google-kapcsolat újraengedélyezése").props.disabled,true);
  assert.match(ui.text(),/összekapcsolás előtt mentsd/);
  assert.equal(ui.requests.some(request => request.path==="connect"),false);
  ui.render({ canConnect:true });
  assert.equal(ui.button("Google-kapcsolat újraengedélyezése").props.disabled,false);
});
