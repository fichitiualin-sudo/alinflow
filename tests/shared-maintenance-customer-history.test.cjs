const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness, noop, repo, source } = require("./helpers.cjs");

const file = "src/components/alinflow/WorkPagePanel.tsx";
const h = harness({}, { "react/jsx-runtime": require("react/jsx-runtime") });
const products = h.load("src/lib/alinflow/products.ts");
const format = h.load("src/lib/alinflow/format.ts");
const appointments = h.load("src/lib/alinflow/appointments.ts");
const constants = h.load("src/lib/alinflow/constants.ts");
const ui = h.functions([
  "workIdentity", "compareWorkByDateDesc", "workDateTimeLabel", "workAddressLabel", "isCancelledWork",
  "hasInstalledClimateItems", "isInstalledClimateWork", "sharedMaintenanceHistoryRows",
  "ClimateMaintenanceHistory", "InstalledClimateMaintenanceCard", "MaintenanceHistory",
], { climateQuoteItems: products.climateQuoteItems, climateSummary: products.climateSummary,
  displayAddress: format.displayAddress, isInstallationAppointment: appointments.isInstallationAppointment,
  normalizeStatus: constants.normalizeStatus }, file);

const installation = {
  id: "customer-a", activeAppointmentId: "installation-a", appointmentType: "installation", status: "Lezárva",
  date: "2025-03-11", time: "08:00", city: "Mintaváros", address: "Példa utca 1.",
  quoteItems: [{ productId: "manual-ac", isManual: true, customName: "Minta klíma", quantity: 1 }],
};
const completed = {
  installationId: "installation-a", date: "2026-10-26", providerName: "Minta karbantartó", status: "Lezárva",
};
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const rowsFor = (results = [completed], installations = [installation]) => ui.sharedMaintenanceHistoryRows("customer-a", installations, results);
const localWork = (date, appointmentId = "own-maintenance") => ({
  id: installation.id, activeAppointmentId: appointmentId, appointmentType: "maintenance", date, time: "09:00", status: "Lezárva",
});

test("shared customer history uses only this customer's actual installations and completed dated results", () => {
  const others = [
    { ...installation, id: "customer-b", activeAppointmentId: "other-customer-installation" },
    { ...installation, activeAppointmentId: "cancelled-installation", status: "Lemondva" },
    { ...installation, activeAppointmentId: "survey", appointmentType: "survey" },
    { ...installation, activeAppointmentId: "extra-only", quoteItems: [{ itemType: "extra", customName: "Kiszállás", quantity: 1 }] },
    { ...installation, activeAppointmentId: undefined },
  ];
  const results = [completed,
    ...["unknown", "other-customer-installation", "cancelled-installation", "survey", "extra-only", undefined]
      .map(installationId => ({ ...completed, installationId })),
    { ...completed, status: "Időpont foglalva" }, { ...completed, status: "Lemondva" },
    { ...completed, date: "" }, { ...completed, date: undefined },
  ];
  const rows = rowsFor(results, [installation, ...others]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceInstallationId, "installation-a");
  assert.equal(rows[0].providerName, "Minta karbantartó");
  assert.equal(rows[0].reportDate, "2026-10-26");
  assert.equal(rows[0].reportDateLabel, "2026.10.26");
  assert.match(rows[0].relatedClimateSummary, /Minta klíma/);
  assert.match(rows[0].relatedClimateAddress, /Példa utca 1/);
  assert.equal(rows[0].reportId, undefined);
  assert.equal(rows[0].appointmentId, undefined);
  assert.equal(rows[0].reportTime, undefined, "No timestamp is invented from a date-only partner summary");
});

test("history projection is read-only, newest-first and retains separate same-day partner services", () => {
  const results = [
    { ...completed, date: "2026-01-12" }, completed, { ...completed },
    { ...completed, date: "2026-08-05", providerName: "Másik partner" },
  ];
  const before = JSON.stringify({ installation, results });
  const rows = rowsFor(results);
  assert.deepEqual(Array.from(rows, row => row.reportDate), ["2026-10-26", "2026-10-26", "2026-08-05", "2026-01-12"]);
  assert.equal(JSON.stringify({ installation, results }), before);
  assert.equal(rowsFor(results).length, 4, "Repeated display does not append or merge records");
});

test("a partner-only installation card displays the completed maintenance instead of the empty message", () => {
  const html = render(ui.InstalledClimateMaintenanceCard, { installation, works: [], sharedRows: rowsFor(),
    onOpenWorkVersion: noop, onToggleMaintenanceOptOut: noop });
  assert.match(html, /2026\.10\.26/);
  assert.match(html, /Karbantartó: .*Minta karbantartó/);
  assert.match(html, /Karbantartások ennél a klímánál/);
  assert.doesNotMatch(html, /Még nincs rögzített karbantartás/);
  assert.doesNotMatch(html, /<button|Megtekintés|Munkalap|PDF emailben/);
  assert.match(html, /type="checkbox"/, "The installation's existing opt-out control remains");
});

test("climate history interleaves local and partner entries chronologically without turning partner summaries into buttons", () => {
  const local = [localWork("2026-11-01", "newer-local"), localWork("2026-01-01", "older-local")];
  const before = JSON.stringify(local);
  const html = render(ui.ClimateMaintenanceHistory, { works: local, sharedRows: rowsFor(), onOpenWorkVersion: noop });
  assert.ok(html.indexOf("2026.11.01") < html.indexOf("2026.10.26"));
  assert.ok(html.indexOf("2026.10.26") < html.indexOf("2026.01.01"));
  assert.equal((html.match(/<button\b/g) || []).length, 2);
  assert.equal((html.match(/Karbantartó:/g) || []).length, 1);
  assert.equal(JSON.stringify(local), before);
});

test("the partner-only maintenance log contains date, provider and climate but exposes no document action", () => {
  const html = render(ui.MaintenanceHistory, { selected: installation, rows: rowsFor(), canStartMaintenance: false,
    onOpenDocumentPreview: noop, onOpenWorkReportFor: noop, onStartMaintenanceForCustomer: noop, onSendPdf: noop });
  assert.match(html, /Karbantartási napló/);
  assert.match(html, /2026\.10\.26/);
  assert.match(html, /Minta karbantartó/);
  assert.match(html, /Klíma: .*Minta klíma/);
  assert.doesNotMatch(html, /Még nincs karbantartási bejegyzés/);
  assert.doesNotMatch(html, /<button|Megtekintés|Munkalap|PDF emailben|Összes munkalap/);
});

test("local document actions are retained alongside read-only partner history", () => {
  const own = { action: "MaintenanceReport", title: "Saját karbantartás", status: "Aláírva", reportId: "own-report",
    appointmentId: "own-maintenance", reportDate: "2026-11-01", reportDateLabel: "2026.11.01" };
  const html = render(ui.MaintenanceHistory, { selected: installation, rows: [own, ...rowsFor()], canStartMaintenance: true,
    onOpenDocumentPreview: noop, onOpenWorkReportFor: noop, onStartMaintenanceForCustomer: noop, onSendPdf: noop });
  assert.equal((html.match(/>Megtekintés</g) || []).length, 1);
  assert.equal((html.match(/>PDF emailben</g) || []).length, 1);
  assert.equal((html.match(/>Összes munkalap</g) || []).length, 1);
  assert.equal((html.match(/>Új karbantartás</g) || []).length, 1);
  assert.match(html, /Minta karbantartó/);
});

test("installations without any local or shared maintenance retain their existing empty states", () => {
  const card = render(ui.InstalledClimateMaintenanceCard, { installation, works: [], sharedRows: [],
    onOpenWorkVersion: noop, onToggleMaintenanceOptOut: noop });
  assert.match(card, /Még nincs rögzített karbantartás ennél a klímánál/);
  const log = render(ui.MaintenanceHistory, { selected: installation, rows: [], canStartMaintenance: true,
    onStartMaintenanceForCustomer: noop });
  assert.match(log, /Még nincs karbantartási bejegyzés/);
});

test("the source keeps the existing identity-scoped hook enabled on direct work entry and map-to-work navigation", () => {
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let hookCall, panelAttribute;
  (function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useSharedMaintenance") hookCall = node;
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === "WorkPagePanel") {
      panelAttribute = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === "sharedMaintenanceResults");
    }
    ts.forEachChild(node, visit);
  })(ast);
  assert.ok(hookCall); assert.ok(panelAttribute);
  assert.equal(hookCall.arguments[0].getText(ast), "activeWorkspace?.id");
  assert.equal(hookCall.arguments[2].getText(ast), "user?.id");
  const enabled = hookCall.arguments[1].getText(ast);
  const value = (view, mapMode) => vm.runInNewContext(enabled, { view, mapMode });
  assert.equal(value("work", "callbacks"), true, "Direct customer entry loads summaries without visiting a maintenance map first");
  assert.equal(value("maintenanceMap", "maintenance"), true);
  assert.equal(value("work", "maintenance"), true, "Map-to-work transition must not disable/clear the hook");
  assert.equal(value("maintenanceMap", "callbacks"), false);
  assert.equal(value("dashboard", "maintenance"), false);
  assert.equal(panelAttribute.initializer.expression.getText(ast), "sharedMaintenance.results");
});

test("each rendered climate receives only its own shared summary rows", () => {
  const panelSource = fs.readFileSync(path.join(repo, file), "utf8");
  const ast = ts.createSourceFile(file, panelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let sharedRows;
  (function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "InstalledClimateMaintenanceCard") {
      sharedRows = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === "sharedRows");
    }
    ts.forEachChild(node, visit);
  })(ast);
  assert.ok(sharedRows);
  const secondInstallation = { ...installation, activeAppointmentId: "installation-a2" };
  const partnerMaintenanceRows = rowsFor([completed, { ...completed, installationId: "installation-a2" }], [installation, secondInstallation]);
  const renderedRows = vm.runInNewContext(sharedRows.initializer.expression.getText(ast), { partnerMaintenanceRows, installation });
  assert.equal(renderedRows.length, 1);
  assert.equal(renderedRows[0].sourceInstallationId, installation.activeAppointmentId);
});
