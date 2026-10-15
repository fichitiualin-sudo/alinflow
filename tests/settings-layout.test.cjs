const assert = require("node:assert/strict");
const test = require("node:test");
const { jsx } = require("react/jsx-runtime");
const { harness } = require("./helpers.cjs");

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PARTNER_USER = "22222222-2222-4222-8222-222222222222";
const PARTNER_WORKSPACE = "33333333-3333-4333-8333-333333333333";
const NEXT_USER = "44444444-4444-4444-8444-444444444444";
const NEXT_WORKSPACE = "55555555-5555-4555-8555-555555555555";
const clone = value => JSON.parse(JSON.stringify(value));
const model = harness().load("src/lib/alinflow/workspace-settings.ts");

function party(name) {
  return { legalName: `${name} business`, address: `${name} synthetic address`, email: `${name}@example.test`, phone: `${name}-phone`, taxNumber: `${name}-tax` };
}

function settingsFixture() {
  const settings = clone(model.normalizeWorkspaceSettings({}, model.defaultWorkspaceSettings({ id: WORKSPACE, name: "Synthetic workspace", slug: "synthetic" })));
  for (const [section, values] of Object.entries(settings)) {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string") values[key] = `${section}.${key}`;
    }
  }
  settings.companyProfile.email = "business@example.test";
  settings.companyProfile.manualCalendarEmail = "calendar@example.test";
  settings.quoteSettings.validityDays = 17;
  settings.billingSettings.transferDueDays = 23;
  settings.billingSettings.defaultPaymentMethod = "transfer";
  settings.billingSettings.invoiceMode = "single";
  settings.documentSettings.privacyNotice = {
    enabled: true, serviceProvider: party("provider"), deviceSeller: party("seller"), partner: party("partner"),
    partnerUserId: PARTNER_USER, partnerWorkspaceId: PARTNER_WORKSPACE,
    retentionText: "Synthetic retention policy", recipientsText: "Synthetic recipients policy", internationalTransfersText: "Synthetic transfer policy",
  };
  return settings;
}

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

// Run actual form/section handlers with keyed hook lifetimes. Only network-facing
// children are substituted; their received props and React keys remain observable.
function settingsUI(initialSettings = settingsFixture()) {
  const frames = new Map();
  let currentFrame, pendingEffects = [], dirty = false, nextId = 0, tree, components = [];
  const react = {
    useState(initial) {
      const frame = currentFrame, index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = typeof initial === "function" ? initial() : initial;
      return [frame.slots[index], next => {
        const value = typeof next === "function" ? next(frame.slots[index]) : next;
        if (!Object.is(value, frame.slots[index])) { frame.slots[index] = value; dirty = true; }
      }];
    },
    useEffect(effect, deps) {
      const frame = currentFrame, index = frame.cursor++, previous = frame.slots[index];
      if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) {
        frame.slots[index] = { deps };
        pendingEffects.push(effect);
      }
    },
    useId() {
      const frame = currentFrame, index = frame.cursor++;
      return frame.slots[index] ??= `settings-test-${++nextId}`;
    },
  };
  function GoogleCalendarSettingsPanel() { return jsx("div", { "data-test": "calendar" }); }
  function GoogleContactsSettingsPanel() { return jsx("div", { "data-test": "contacts" }); }
  function MaintenanceAccessSettings() { return jsx("div", { "data-test": "access" }); }
  function PrivacyPartnerPicker() { return jsx("div", { "data-test": "partner-picker" }); }
  const { SettingsPanel } = harness({}, {
    react, "react/jsx-runtime": require("react/jsx-runtime"),
    "@/components/alinflow/GoogleCalendarSettingsPanel": { GoogleCalendarSettingsPanel },
    "@/components/alinflow/GoogleContactsSettingsPanel": { GoogleContactsSettingsPanel },
    "@/components/alinflow/MaintenanceAccessSettings": { MaintenanceAccessSettings },
    "./PrivacyPartnerPicker": { PrivacyPartnerPicker },
  }).load("src/components/alinflow/SettingsPanel.tsx");
  const saves = [];
  const props = {
    activeWorkspace: { id: WORKSPACE, name: "Synthetic workspace", slug: "synthetic" }, userId: "synthetic-user",
    googleCalendar: { status: null, loading: false, error: "", returnMessage: "" },
    settings: initialSettings, schemaAvailable: true, saving: false, onBack() {}, onSave: value => saves.push(clone(value)),
  };
  let visited;
  function resolve(element, path = "root") {
    if (Array.isArray(element)) return element.map((child, index) => resolve(child, `${path}/${child?.key ?? index}`));
    if (!element || typeof element !== "object") return element;
    if (typeof element.type === "function") {
      components.push(element);
      const identity = `${path}/${element.type.name}:${element.key ?? ""}`;
      visited.add(identity);
      if (!frames.has(identity)) frames.set(identity, { slots: [], cursor: 0 });
      const previous = currentFrame;
      currentFrame = frames.get(identity);
      currentFrame.cursor = 0;
      const rendered = element.type(element.props);
      currentFrame = previous;
      return resolve(rendered, identity);
    }
    return { ...element, props: { ...element.props, children: resolve(element.props?.children, `${path}/${String(element.type)}`) } };
  }
  function render(changes = {}) {
    Object.assign(props, changes);
    let passes = 0;
    do {
      assert.ok(++passes < 10, "Settings effects must settle");
      dirty = false; pendingEffects = []; components = []; visited = new Set();
      tree = resolve(jsx(SettingsPanel, { ...props }));
      for (const identity of frames.keys()) if (!visited.has(identity)) frames.delete(identity);
      pendingEffects.forEach(effect => effect());
    } while (dirty);
  }
  render();
  const component = name => components.filter(element => element.type.name === name);
  return {
    render, saves, component,
    nodes: predicate => nodes(tree, predicate),
    field(label) {
      const labels = nodes(tree, element => element.type === "label" && text(element.props.children?.[0]) === label);
      assert.equal(labels.length, 1, `Expected one ${label} field`);
      return nodes(labels[0], element => ["input", "textarea", "select"].includes(element.type))[0];
    },
    section(title) {
      const matches = nodes(tree, element => element.type === "button" && element.props["aria-controls"] && text(element).startsWith(title));
      assert.equal(matches.length, 1, `Expected one ${title} section`);
      return matches[0];
    },
    save() {
      const buttons = nodes(tree, element => element.type === "button" && text(element) === "Beállítások mentése");
      assert.equal(buttons.length, 1);
      return buttons[0];
    },
  };
}

test("settings keeps one editor/calendar/access instance and every existing editable value inside collapsed sections", () => {
  const settings = settingsFixture(), ui = settingsUI(settings);
  for (const name of ["PrivacyNoticeSettings", "PrivacyPartnerPicker", "GoogleCalendarSettingsPanel", "GoogleContactsSettingsPanel", "MaintenanceAccessSettings"]) {
    assert.equal(ui.component(name).length, 1, name);
  }
  assert.equal(ui.component("PartyFields").length, 2, "Provider and seller remain separate editable identities");
  assert.equal(ui.nodes(element => element.type === "button" && element.props["aria-controls"]).length, 7, "All seven settings sections remain present once");
  const values = ui.nodes(element => ["input", "textarea", "select"].includes(element.type)).map(element => element.props.value);
  for (const [section, fields] of Object.entries(settings)) {
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "object" || typeof value === "boolean" || ["emailSettings.appointmentHeaderText", "documentSettings.quoteFooterText"].includes(`${section}.${key}`)) continue;
      assert.equal(values.filter(current => current === value).length, 1, `${section}.${key} remains editable once`);
    }
  }
  for (const partyName of ["serviceProvider", "deviceSeller"]) {
    for (const value of Object.values(settings.documentSettings.privacyNotice[partyName])) assert.equal(values.filter(current => current === value).length, 1);
  }
  for (const key of ["retentionText", "recipientsText", "internationalTransfersText"]) assert.equal(values.filter(value => value === settings.documentSettings.privacyNotice[key]).length, 1);
  assert.equal(ui.nodes(element => element.type === "input" && element.props.type === "checkbox").length, 2);
  assert.equal(ui.save().props.disabled, false);
  for (const title of ["Google Naptár", "Google Névjegyek", "Árajánlat", "Emailek és dokumentumok", "Számlázás", "Adatkezelés és karbantartók"]) {
    assert.equal(ui.section(title).props["aria-expanded"], false);
    ui.section(title).props.onClick(); ui.render();
    ui.section(title).props.onClick(); ui.render();
    assert.equal(ui.component("PrivacyPartnerPicker").length, 1, "Collapsing must retain the partner lookup instance");
    assert.equal(ui.component("GoogleCalendarSettingsPanel").length, 1, "Collapsing must retain calendar connection state");
    assert.equal(ui.component("MaintenanceAccessSettings").length, 1, "Collapsing must retain the access form");
  }
});

test("editing company identity and saving preserves independent privacy parties and all legacy settings", () => {
  const original = settingsFixture(), before = clone(original), ui = settingsUI(original);
  ui.field("Vállalkozás hivatalos neve").props.onChange({ target: { value: "Updated synthetic brand business" } });
  ui.render();
  ui.section("Vállalkozás adatai").props.onClick(); ui.render();
  ui.save().props.onClick();
  const expected = clone(original);
  expected.companyProfile.legalName = "Updated synthetic brand business";
  assert.deepEqual(ui.saves, [expected]);
  assert.deepEqual(original, before, "Draft editing must not mutate loaded settings");
  assert.equal(ui.saves[0].documentSettings.quoteFooterText, "documentSettings.quoteFooterText");
  assert.deepEqual(ui.saves[0].documentSettings.privacyNotice, before.documentSettings.privacyNotice);
});

test("unsaved partner selection cannot retarget access; saving a new partner changes the access component key", () => {
  const original = settingsFixture(), ui = settingsUI(original);
  const firstAccess = ui.component("MaintenanceAccessSettings")[0];
  const nextParty = party("next-partner");
  ui.component("PrivacyPartnerPicker")[0].props.onSelect({ userId: NEXT_USER, workspaceId: NEXT_WORKSPACE, workspaceName: "Next synthetic partner", party: nextParty, issues: [] });
  ui.render();
  assert.equal(ui.component("PrivacyPartnerPicker")[0].props.partnerUserId, NEXT_USER);
  const unsavedAccess = ui.component("MaintenanceAccessSettings")[0];
  assert.equal(unsavedAccess.props.privacy.partnerUserId, PARTNER_USER);
  assert.equal(unsavedAccess.props.privacy.partnerWorkspaceId, PARTNER_WORKSPACE);
  assert.equal(unsavedAccess.key, firstAccess.key);
  assert.equal(ui.nodes(element => element.props?.role === "status" && text(element).includes("karbantartó módosítását előbb mentsd")).length, 1);
  ui.save().props.onClick();
  ui.render({ settings: ui.saves[0] });
  const savedAccess = ui.component("MaintenanceAccessSettings")[0];
  assert.equal(savedAccess.props.privacy.partnerUserId, NEXT_USER);
  assert.equal(savedAccess.props.privacy.partnerWorkspaceId, NEXT_WORKSPACE);
  assert.notEqual(savedAccess.key, firstAccess.key, "A different saved partner must remount and clear the previous agreement confirmation");
  assert.equal(ui.nodes(element => element.props?.role === "status" && text(element).includes("karbantartó módosítását előbb mentsd")).length, 0);
});

test("invalid values open their sections and disable saving without removing hidden editors", () => {
  const settings = settingsFixture(), ui = settingsUI(settings);
  ui.field("Google-fiók a kézi mentéshez").props.onChange({ target: { value: "invalid-email" } }); ui.render();
  assert.equal(ui.section("Google Naptár").props["aria-expanded"], true);
  assert.equal(ui.save().props.disabled, true);
  ui.field("Google-fiók a kézi mentéshez").props.onChange({ target: { value: "valid@example.test" } }); ui.render();
  assert.equal(ui.save().props.disabled, false);
  const providerEmail = ui.nodes(element => element.type === "input" && element.props.value === "provider@example.test")[0];
  providerEmail.props.onChange({ target: { value: "invalid-provider" } }); ui.render();
  assert.equal(ui.section("Adatkezelés és karbantartók").props["aria-expanded"], true);
  assert.equal(ui.save().props.disabled, true);
  assert.ok(ui.nodes(element => element.props?.role === "alert" && text(element).includes("Munkát végző vállalkozás")).length);
  assert.equal(ui.component("PartyFields").length, 2);
  assert.equal(ui.saves.length, 0);
});


test("Contacts OAuth cannot navigate away from an unsaved settings draft", () => {
  const ui=settingsUI();
  assert.equal(ui.component("GoogleContactsSettingsPanel")[0].props.canConnect,true);
  ui.field("Vállalkozás hivatalos neve").props.onChange({ target:{ value:"Új szintetikus cégnév" } }); ui.render();
  assert.equal(ui.component("GoogleContactsSettingsPanel")[0].props.canConnect,false);
  ui.save().props.onClick(); ui.render({ settings:ui.saves[0] });
  assert.equal(ui.component("GoogleContactsSettingsPanel")[0].props.canConnect,true);
});
