# Facebook Lead Ads → AlinFlow

## Működés és jelenlegi aktiválási állapot

A kapcsolat a Meta `leadgen` eseményéből lekéri a jelentkezés hiteles adatait, ellenőrzi az űrlapot és az oldalt, majd tranzakcióban menti az érdeklődést. A szerelés települése az űrlap válasza, a klíma neve a pontos hirdetésazonosítóhoz tartozó szerverbeállítás. Az import nem készít ajánlatot, nem foglal készletet és nem küld üzenetet az ügyfélnek.

**2026-10-06-i ellenőrzés:** a meglévő `Klimalin Marketing API` Meta-alkalmazás Live állapotú, de jelenleg csak hirdetéskezelési használati esetét ellenőriztük. A közös űrlap és a hozzá tartozó oldal a Meta felületén igazolt. A Lead Ads jogosultság, a szerveres titkok és a működő webhook-kézbesítés még nem igazolt. Az `Add use cases` műveletet az automatikus jóváhagyás-ellenőrzés megállította; ennek folytatásához a felhasználó jóváhagyása szükséges. A kész kód és a felület „Beolvasás elérhető” jelzése önmagában nem bizonyít éles Meta-kapcsolatot.

Az ismert, nem titkos azonosítók:

| Elem | Azonosító |
| --- | --- |
| Meta-alkalmazás | `999266106198082` |
| KLIMAlin Facebook-oldal | `107990632370445` |
| Közös Lead Ads űrlap | `1841834370148047` |
| AlinFlow-munkaterület | `a7a036c6-8ed1-4fc7-961b-cd3c2c5d41f0` |
| Polar Prime hirdetés | `120249836307730420` |
| Gree Comfort Pro hirdetés | `120249836599020420` |
| AUX Aura hirdetés | `120249836599030420` |
| Tesla Superior hirdetés | `120249836599040420` |

Az oldalazonosító a hirdetésszerkesztő `businesspage_link` hivatkozásában és az űrlap Meta-oldalkapcsolatában is megjelent. Aktiválás előtt Graph API-val is ellenőrizni kell a kiválasztott oldal és űrlap kapcsolatát. Az űrlap neve: `KLIMAlin | 4 mező | Név-Telefon-Email-Település | 2026-10`; beépített mezői a Meta felületén: Email-cím, Teljes név, Telefonszám, Település.

## 1. Adatbázis előkészítése

Friss sémaaudit és mentés után futtasd a [`sql/FACEBOOK_LEAD_IMPORT.sql`](sql/FACEBOOK_LEAD_IMPORT.sql) migrációt. Tranzakciós és ismételhető; eltérő, ismeretlen naplótábla, függvény, policy vagy trigger esetén megáll. A meglévő ügyfelek és dokumentumok adatait nem írja át.

A `facebook_lead_imports` napló olvasása aktív munkaterületi tagsághoz kötött. Az import-RPC csak `service_role` szereppel hívható. A szerver közvetlenül csak a `lead_id`, `workspace_id`, `page_id` oszlopokat olvashatja az ismételt kézbesítések előzetes ellenőrzéséhez; kontaktadatot nem írhat közvetlenül a naplótáblába. A „Feldolgozva” művelet külön, tagságot ellenőrző RPC.

## 2. Éles szerverkörnyezet

A következő változók kizárólag a Vercel **Production** környezetébe kerüljenek. Preview és helyi tesztkörnyezet ne kapja meg a működő éles kapcsolat titkait vagy konfigurációját.

| Változó | Tartalom |
| --- | --- |
| `META_APP_SECRET` | Az ellenőrzött Meta-alkalmazás titka; aláírás-ellenőrzéshez és Graph `appsecret_proof` értékhez. |
| `META_WEBHOOK_VERIFY_TOKEN` | Külön, véletlen ellenőrző token; ugyanazt kell a Meta webhook-beállításában megadni. |
| `META_PAGE_ACCESS_TOKEN` | A kiválasztott oldalhoz tartozó, Lead Ads beolvasásra jogosult Page token. |
| `SUPABASE_SERVICE_ROLE_KEY` | Az AlinFlow Supabase-projektjének szerveres kulcsa. |
| `META_LEADS_CONFIG` | Az alábbi szerveroldali JSON-beállítás. |

Ezekhez ne használj `NEXT_PUBLIC_` előtagot. Ne kerüljenek repóba, klienskódba, képernyőképbe, buildnaplóba vagy hibaválaszba. A már használt `NEXT_PUBLIC_SUPABASE_URL` és `NEXT_PUBLIC_SUPABASE_ANON_KEY` továbbra is a meglévő projekt publikus kapcsolati adatai; nem helyettesítik a szerverkulcsot.

`META_LEADS_CONFIG` szerkezete:

```json
{
  "workspaceId": "a7a036c6-8ed1-4fc7-961b-cd3c2c5d41f0",
  "pageId": "107990632370445",
  "formIds": ["1841834370148047"],
  "adClimateMap": {
    "120249836307730420": "Polar Prime",
    "120249836599020420": "Gree Comfort Pro",
    "120249836599030420": "AUX Aura",
    "120249836599040420": "Tesla Superior"
  }
}
```

A `formIds` csak igazolt, numerikus azonosítókat tartalmazhat. Több űrlap esetén a korábbi jelentkezések beolvasása a lista minden elemén végigmegy. Egy telepítéshez egy munkaterület/oldal kapcsolat tartozik; ez nem általános többcéges OAuth-bevezetés.

Opcionális mező: `"cityField": "az űrlap válaszában szereplő pontos field_data.name"`. Az első tesztjelentkezés alapján add meg a szerelési település kérdésének tényleges kulcsát. A kód ennek válaszát részesíti előnyben; nélküle ismert `city`, `town`, `település`, `szerelés települése` és hasonló pontos mezőneveket ismer fel ékezetektől és elválasztóktól függetlenül. Ismeretlen kérdésszövegből nem találgat települést.

A változók beállítása vagy cseréje után új Production deploy szükséges. Az alkalmazás Graph API-verziója rögzítetten **`v26.0`**, a hívások kizárólag `https://graph.facebook.com` címre mennek, bearer tokennel; átirányítást nem követnek.

## 3. Meta-hozzáférések és két külön feliratkozás

Az alkalmazásnak és a token tulajdonosának hozzá kell férnie a KLIMAlin oldal Lead Ads jelentkezéseihez. Ellenőrizd az app használati esetét és a token tényleges jogosultságait, különösen a `leads_retrieval` és `pages_manage_metadata` hozzáférést, illetve az adott beállítás által igényelt oldal-/hirdetési jogosultságokat. A Lead Access Managerben az oldalhoz és a CRM-alkalmazáshoz való hozzáférést is ellenőrizni kell.

A Live állapot vagy egy korábbi `ads_management` engedély nem bizonyítja önmagában a leadek olvasását. Az App Review, a vállalkozás ellenőrzése és a Standard/Advanced Access szükségességét az adott alkalmazás aktuális Meta-felületén kell megállapítani; a kód nem kerüli meg ezeket. Az elsődleges webes dokumentáció ezen a napon rate limit miatt nem volt teljesen hozzáférhető, ezért nincs rögzítve egy ellenőrizetlen, minden alkalmazásra érvényes jogosultságlista.

**Alkalmazás webhook-előfizetése:** `page` objektum, `leadgen` mező, callback:

```text
https://www.alinflow.hu/api/facebook-leads/webhook
```

A Meta felületén beállítható, vagy megfelelő app access tokennel:

```text
POST https://graph.facebook.com/v26.0/999266106198082/subscriptions
Authorization: Bearer <APP_ACCESS_TOKEN>

object=page
fields=leadgen
callback_url=https://www.alinflow.hu/api/facebook-leads/webhook
verify_token=<META_WEBHOOK_VERIFY_TOKEN>
```

A Meta GET kérésének `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge` paramétereit a fogadó kezeli. Jó tokenre a challenge változatlan szöveges válasza érkezik; hibás tokenre 403. Ez csak a callback ellenőrzése, nem egy valódi lead átadásának bizonyítéka.

**A Facebook-oldal feliratkozása az alkalmazásra:** a fenti app webhook-beállítás mellett külön szükséges:

```text
POST https://graph.facebook.com/v26.0/107990632370445/subscribed_apps
Authorization: Bearer <META_PAGE_ACCESS_TOKEN>

subscribed_fields=leadgen
```

Módosítás előtt olvasd vissza a meglévő `/999266106198082/subscriptions` és `/107990632370445/subscribed_apps` állapotot. Ha az alkalmazásnak más mezőkre is van működő feliratkozása, az új `leadgen` mezőt a meglévők megtartásával add hozzá. A beállítás után mindkét oldalt ellenőrizd újra.

## 4. Aktiválási ellenőrzés

1. Igazold a közös űrlap azonosítóját és a `GET /v26.0/{form_id}?fields=id,page,page_id,questions` válaszban az oldalhoz tartozását. Ellenőrizd a négy hirdetés tényleges, aktív azonosítóját.
2. AlinFlow-ba bejelentkezve a Facebook-panelben legyen olvasható a napló. A „Beolvasás elérhető” csak a szerverváltozók jelenlétét jelenti; a Meta-token működését még tesztelni kell.
3. A Meta Lead Ads teszteszközével hozz létre egy egyértelműen tesztnek jelölt jelentkezést, saját ellenőrzött tesztelérhetőséggel és településsel. A webhook-dashboard által küldött kitalált leadazonosító nem helyettesíti a Graph API-val visszaolvasható tesztleadet.
4. Ellenőrizd, hogy a valódi POST kérés SHA256-aláírása érvényes, a válasz 200, és pontosan egy naplóbejegyzés keletkezik. Új, nem létező tesztkontakt esetén egy „Visszahívandó” ügyfél jön létre, a jelentkezés eredeti idejével.
5. Ellenőrizd a település pontos értékét és egy valódi, konfigurált hirdetésből érkező lead klímáját. A hirdetésazonosító nélküli teszt/organikus leadnél a „Klíma nincs azonosítva” helyes eredmény; abból a négy hirdetés párosítása még nem igazolható.
6. Ugyanazon lead ismételt kézbesítése és a kézi visszaolvasás se hozzon újabb ügyfelet vagy naplóbejegyzést. Már létező tesztkontakt új leadazonosítóval „Ismételt érdeklődés” legyen; a korábbi ügyféladatok ne változzanak.
7. Csak ezután dokumentáld, hogy az automatikus kapcsolat élesben működik. Az ellenőrzés nem küld emailt vagy más üzenetet a jelentkezőnek.

## 5. Korábbi jelentkezések és mindennapi kezelés

A Dashboard **Facebook-érdeklődők** paneljében a „Korábbi jelentkezések beolvasása” minden beállított űrlapot bejár. Egy szerverkérés legfeljebb 20 jelentkezést dolgoz fel. A böngésző legfeljebb 100 oldalt kér egy menetben; utána a „Beolvasás folytatása” gombbal tovább lehet menni. A megállítás vagy megszakadás nem törli a már mentett sorokat. A folytatási állapot a megnyitott panelben él; oldalújratöltés után az import az elejéről újraindítható, a Meta-azonosítók alapján biztonságosan kihagyja a már beolvasottakat.

A korábbi beolvasás csak a Meta által akkor még elérhető leadeket tudja átvenni. Nincs garantált teljes történeti archívum és nincs külön időzített Meta-polling; webhookhiba után a kézi beolvasás pótolhatja az elérhető kimaradt jelentkezéseket.

A napló tízesével lapozható, legutóbbi beérkezés szerint. Alapértelmezésben a „Feldolgozandó” sorok látszanak; az „Összes” a feldolgozottakat is megőrzi. A panel látható böngészőlapnál percenként, illetve visszatéréskor frissít. Az „Ügyfél megnyitása” a kapcsolt ügyfélhez visz. A „Feldolgozva” kizárólag a napló jelölése: nem zár le ügyfelet, nem módosít értékesítési státuszt és nem töröl sort.

Hiányzó név, használható elérhetőség vagy többértelmű kontakt-egyezés esetén „Ellenőrizendő” sor marad ügyfél automatikus létrehozása/összevonása nélkül. A felhasználó az adatokat ellenőrzi, szükség szerint a meglévő ügyfelet megkeresi vagy kézzel rögzíti, majd a beérkezést feldolgozottnak jelöli. Jelenleg nincs külön, naplósort új ügyfélhez átkapcsoló művelet.

## Korlátok és hibaelhárítás

- **Új/másolt hirdetés:** új azonosítója külön bejegyzést igényel az `adClimateMap` objektumban. A hirdetés neve alapján nincs automatikus találgatás. Ismeretlen vagy hiányzó ad ID mellett az érdeklődés megmarad, a panel „Klíma nincs azonosítva” jelzést ad.
- **Korábbi pillanatkép:** az új párosítás nem írja át a már mentett naplókat vagy ügyfél-igényeket. A hiányzó régi információ kézi egyeztetést igényel.
- **Ismételt érdeklődés:** normalizált telefonszám vagy email alapján egyetlen létező ügyfélhez kapcsolódik; annak neve, települése, igénye és státusza nem íródik felül. Az új kérés külön naplósorban látható.
- **Törölt ügyfél:** a leadazonosító megmarad; az ismételt kézbesítés nem hozza létre újra a szándékosan törölt ügyfelet.
- **Érvénytelen aláírás:** 403; nincs Meta-lekérés vagy import. A POST aláírás kulcsa az app secret, nem a Page token és nem a verify token.
- **Másik oldal vagy nem engedélyezett űrlap:** a fogadó kihagyja, ügyfelet nem készít. A feldolgozott lead kanonikus Graph-űrlapját és annak oldalát is ellenőrzi.
- **Lejárt token, Meta-/adatbázishiba:** 5xx válasz; a fogadó nem nyugtáz nem mentett jelentkezést. A már mentett rész újraküldéskor kimarad. A Meta újraküldési idejére a rendszer nem vállal garanciát.
- **Idő-/méretkorlát:** bejövő JSON legfeljebb 256 KiB, olvasása 10 másodperc; egy Graph-válasz legfeljebb 2 MiB és 10 másodperc. A feldolgozásnak 45 másodperces kerete van. A titkok és a Meta nyers hibaszövege nem kerülnek a kliensnek visszaadott diagnosztikába.

Leállításhoz a Meta `leadgen` feliratkozása és az éles szerverkapcsolat célzottan kikapcsolható, a többi működő Meta-funkció megtartásával. A napló és a már importált ügyfelek megmaradnak; az adatokat visszaállításkor sem kell törölni.

## Elsődleges technikai források

- [Meta Business SDK API-verzió](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py)
- [Lead mezők](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/lead.py)
- [LeadgenForm: oldal, kérdések és leadlista](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/leadgenform.py)
- [Meta saját webhook- és feliratkozási mintája](https://github.com/fbsamples/lead-ads-webhook-sample/blob/main/postman/FB%20Lead%20Ads%20%28Part%201%20-%20The%20Webhook%29.postman_collection.json)
- [Meta leadlekérési dokumentáció](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/)
- [Meta webhook-dokumentáció](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)
