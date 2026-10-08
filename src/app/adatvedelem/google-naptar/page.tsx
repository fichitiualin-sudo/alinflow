import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Google Naptár adatkezelési tájékoztató | AlinFlow",
  description: "Az AlinFlow Google Naptár-kapcsolata által használt adatok, a szinkronizálás és a hozzáférés kezelése.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function GoogleCalendarPrivacyPage() {
  const configuredEmail = (process.env.EMAIL_REPLY_TO || "").trim();
  const supportEmail = configuredEmail.length <= 254
    && /^[A-Z0-9][A-Z0-9._%+-]{0,63}@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i.test(configuredEmail)
    ? configuredEmail : null;
  const linkClass = "font-semibold text-cyan-200 underline decoration-cyan-200/40 underline-offset-4 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4";
  const headingClass = "mb-3 text-xl font-bold text-white sm:text-2xl";

  return (
    <main className="min-h-screen bg-[#08111F] px-5 py-8 text-slate-200 sm:px-8 sm:py-12">
      <article className="mx-auto max-w-3xl break-words text-base leading-7">
        <a href="/" className={`${linkClass} inline-flex min-h-11 items-center`}>← Vissza az AlinFlow-hoz</a>
        <header className="mb-10 mt-6 border-b border-white/10 pb-8">
          <p className="mb-3 text-sm font-bold uppercase tracking-wide text-cyan-200">AlinFlow</p>
          <h1 className="text-3xl font-black leading-tight text-white sm:text-4xl">Google Naptár adatkezelési tájékoztató</h1>
          <p className="mt-5">Ez a tájékoztató az AlinFlow opcionális Google Naptár-kapcsolatának működését és az ehhez használt adatokat írja le.</p>
        </header>

        <div className="space-y-9">
          <section aria-labelledby="purpose">
            <h2 id="purpose" className={headingClass}>Mire használjuk a kapcsolatot?</h2>
            <p>A munkaterület tulajdonosa vagy adminisztrátora a Google engedélyező oldalán kapcsolhatja össze a saját Google-fiókját. A kapcsolat célja, hogy az AlinFlow-ban ezután létrehozott szerelési, felmérési és karbantartási időpontok automatikusan megjelenjenek a kapcsolt fiók elsődleges naptárában.</p>
            <p className="mt-3">A mentett adatok változása frissíti a hozzájuk tartozó eseményt; az időpont lemondása vagy törlése eltávolítja azt. A kapcsolat létrehozása előtti időpontokat nem töltjük át automatikusan. A korábban, kézzel felvitt Google-eseményeket nem alakítjuk át AlinFlow-eseménnyé.</p>
          </section>

          <section aria-labelledby="permission">
            <h2 id="permission" className={headingClass}>Milyen Google-hozzáférést kérünk?</h2>
            <p>A Google által ellenőrzött email-címet és a fiók egyedi azonosítóját használjuk a megfelelő fiók összekapcsolásához. A kért naptárengedély a saját tulajdonú Google-naptárak eseményeinek megtekintését, létrehozását, módosítását és törlését teszi lehetővé.</p>
            <p className="mt-3">Az AlinFlow ezen belül az elsődleges naptárban, az időpontjaihoz rendelt eseményazonosítókkal dolgozik. Módosítás előtt ellenőrzi az esemény AlinFlow-azonosítóit. A teljes Google-naptár tartalmáról nem készít AlinFlow-másolatot, és a Google-ban végzett szerkesztést nem másolja vissza a CRM-be.</p>
            <p className="mt-3 text-sm">A Google engedélyének részletei: <a href="https://developers.google.com/workspace/calendar/api/auth" className={linkClass}>Google Naptár jogosultságok</a>.</p>
          </section>

          <section aria-labelledby="event-data">
            <h2 id="event-data" className={headingClass}>Milyen adatok kerülnek a Google Naptárba?</h2>
            <p>A mentett időponthoz az AlinFlow a következő adatokat használja, ha azok szerepelnek a CRM-ben:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-cyan-200">
              <li>az ügyfél neve, telefonszáma és email-címe;</li>
              <li>a munkavégzés helyszíne, a dátum, a kezdési és befejezési idő, valamint az időpont típusa és állapota;</li>
              <li>az ügyfélnél rögzített igény és megjegyzés;</li>
              <li>szerelésnél az ajánlati klímák neve, mennyisége és szereléssel együtt értendő eladási ára; alternatív ajánlatnál az egyes lehetőségek külön árai;</li>
              <li>az összerendeléshez szükséges belső munkaterület- és időpontazonosító az esemény technikai mezőiben.</li>
            </ul>
            <p className="mt-3">A beszerzési árakat, munkafotókat, aláírásokat és dokumentumcsatolmányokat ez a funkció nem továbbítja. Nem ad hozzá vendégeket, és nem indít külön Google-meghívót az ügyfélnek. Az esemény láthatóságát a Google-naptár megosztási beállításai is befolyásolják.</p>
          </section>

          <section aria-labelledby="stored-data">
            <h2 id="stored-data" className={headingClass}>Mit tárol az AlinFlow a kapcsolathoz?</h2>
            <p>A kapcsolat adatai között szerepel a Google-fiók ellenőrzött email-címe és egyedi azonosítója, a naptár azonosítója, a kapcsoló AlinFlow-felhasználó és munkaterület azonosítója, az engedélyek, a kapcsolás ideje és a kapcsolat állapota.</p>
            <p className="mt-3">Az ismételt hozzáféréshez szükséges Google-frissítőtokent titkosítva tároljuk a szerveroldali adatbázisban. Az AlinFlow nem kéri el a Google-jelszót. A frissítőtoken nem kerül a böngészőnek visszaadott kapcsolati adatok közé; a rövid életű hozzáférési token a szerver memóriájában is átmenetileg megmaradhat.</p>
            <p className="mt-3">A szinkronizálási sor az időpont és a Google-esemény azonosítóját, a változatokat, a feldolgozás és újrapróbálás időpontjait, a törlés állapotát és általános hibaüzeneteket tárol. Ebben a sorban nincs külön másolat az ügyfél nevéről vagy az esemény leírásáról.</p>
            <p className="mt-3">Az összekapcsoláshoz átmeneti biztonsági állapotot és böngészős sütit is használunk, tízperces érvényességgel. A feldolgozott állapotot eltávolítjuk; a fennmaradó lejárt állapotok a következő összekapcsolás indításakor törlődnek.</p>
          </section>

          <section aria-labelledby="services">
            <h2 id="services" className={headingClass}>Mely szolgáltatások vesznek részt?</h2>
            <p>A Supabase az AlinFlow adatbázisát és a kapcsolati adatokat kezeli. A Vercelen futó AlinFlow-szerver végzi a Google-hitelesítést és a szinkronizálást. A Google fogadja és tárolja a naptáreseményeket, valamint kezeli a Google-fiók engedélyeit.</p>
            <p className="mt-3">A naptárkapcsolat nem használja ezeket az adatokat hirdetések célzására vagy mesterséges intelligencia tanítására, és ilyen célból nem továbbítja őket más szolgáltatáshoz.</p>
          </section>

          <section aria-labelledby="pause-revoke">
            <h2 id="pause-revoke" className={headingClass}>Szüneteltetés és a hozzáférés visszavonása</h2>
            <p>Az AlinFlow Beállítások oldalán a szinkronizálás szüneteltethető. Ez leállítja az új feldolgozásokat, de megtartja a kapcsolat adatait, a titkosított frissítőtokent és a várakozó változásokat. Újraengedélyezés után a várakozó változások is feldolgozhatók.</p>
            <p className="mt-3">A Google-hozzáférést a <a href="https://myaccount.google.com/connections" className={linkClass}>Google-fiók összekapcsolt alkalmazásai között</a> vonhatod vissza. A szüneteltetés önmagában nem vonja vissza ezt az engedélyt. A Google oldalán végzett visszavonás önmagában nem törli az AlinFlow-ban már tárolt kapcsolati adatokat. Részletes lépések a <a href="https://support.google.com/accounts/answer/13533235?hl=hu" className={linkClass}>Google súgójában</a>.</p>
            <p className="mt-3">A szüneteltetés és a hozzáférés visszavonása nem törli a már létrehozott Google-eseményeket. Ezek a Google Naptárban külön kezelhetők. A már folyamatban lévő szinkronizálás eredményét érdemes ott ellenőrizni.</p>
          </section>

          <section aria-labelledby="retention-contact">
            <h2 id="retention-contact" className={headingClass}>Megőrzés és kapcsolattartás</h2>
            <p>A tartós kapcsolati adatokhoz és a szinkronizálási sorhoz jelenleg nincs automatikus, időalapú törlés. Ezek szüneteltetés után is megmaradnak; az időpont törlése után a naptáresemény eltávolításához és az ismételt feldolgozás elkerüléséhez szükséges technikai bejegyzés is megmaradhat.</p>
            <p className="mt-3">A funkcióban kezelt adatokkal kapcsolatos kérdést, helyesbítési vagy törlési kérelmet a saját AlinFlow-munkaterületed tulajdonosának jelezheted. A kapcsolati adatok teljes törlésére jelenleg nincs önkiszolgáló gomb.</p>
            {supportEmail ? <p className="mt-3">Az AlinFlow beállított kapcsolattartási címe: <a href={`mailto:${encodeURIComponent(supportEmail)}`} className={`${linkClass} break-all`}>{supportEmail}</a>.</p> : null}
          </section>
        </div>

        <footer className="mt-10 border-t border-white/10 pt-6 text-sm text-slate-400">
          <p>A tájékoztató a Google Naptár-kapcsolat jelenlegi működésére vonatkozik; az AlinFlow más funkcióinak adatkezelését nem ismerteti.</p>
        </footer>
      </article>
    </main>
  );
}
