// Simulated archive for route tests. The SQL test executes the real migration and RLS.
function quoteArchiveFixture(now = () => new Date().toISOString()) {
  const snapshots = new Map();
  const state = { failPrepare: false, failConfirm: false };
  function rpc(name, params) {
    if (name === "prepare_quote_delivery") {
      if (state.failPrepare) return { error: { code: "PGRST202" } };
      const row = snapshots.get(params.p_id);
      if (row && JSON.stringify(row.snapshot) !== JSON.stringify(params)) return { error: { code: "23505" } };
      if (row?.confirmed) return { data: { state: "sent", ...row.confirmed } };
      if (!row) snapshots.set(params.p_id, { snapshot: params });
      return { data: { state: "ready" } };
    }
    if (name === "confirm_quote_delivery") {
      if (state.failConfirm) return { error: { code: "503" } };
      const row = snapshots.get(params.p_id);
      row.confirmed ||= { provider_id: params.p_provider_id, sent_at: now() };
      return { data: row.confirmed.sent_at };
    }
    throw Error("Unexpected archive RPC " + name);
  }
  return { rpc, snapshots, state };
}
module.exports = { quoteArchiveFixture };
