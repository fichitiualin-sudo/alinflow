"use client";

export function LoginScreen({ email, password, message, loading, onEmail, onPassword, onSubmit }: { email: string; password: string; message: string; loading: boolean; onEmail: (value: string) => void; onPassword: (value: string) => void; onSubmit: () => void }) {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
        <div className="w-full rounded-[2rem] border border-white/10 bg-slate-900/90 p-6 shadow-2xl">
          <div className="mb-6 text-center">
            <p className="mb-3 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-200">AlinFlow admin</p>
            <h1 className="text-4xl font-black">Bejelentkezés</h1>
            <p className="mt-2 text-sm text-slate-400">Csak bejelentkezés után látható az ügyfél- és munkaadatbázis.</p>
          </div>
          <div className="space-y-4">
            <div><label className="mb-2 block text-sm font-black text-slate-300">Email</label><input className="input" value={email} onChange={(event) => onEmail(event.target.value)} placeholder="email@pelda.hu" /></div>
            <div><label className="mb-2 block text-sm font-black text-slate-300">Jelszó</label><input className="input" type="password" value={password} onChange={(event) => onPassword(event.target.value)} placeholder="••••••••" onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }} /></div>
            {message ? <div className="rounded-2xl border border-red-300/30 bg-red-400/10 p-4 text-sm font-bold text-red-100">{message}</div> : null}
            <button onClick={onSubmit} disabled={loading} className="w-full rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950 shadow-xl transition hover:scale-[1.01] disabled:cursor-wait disabled:opacity-60">{loading ? "Beléptetés..." : "Belépés"}</button>
          </div>
        </div>
      </div>
    </main>
  );
}
