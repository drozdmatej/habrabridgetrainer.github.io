# Kontrola kódu a další úpravy

Kontrola se zaměřila na načítání obsahu, vyhodnocování úloh, ukládání postupu,
editor a rozdíly mezi dodanými systémovými kartami. Níže jsou potvrzené vady;
nejde o úplný bezpečnostní audit ani o revizi všech bridžových dohod.

| Vada | Dopad | Oprava |
| --- | --- | --- |
| Dvě okna zapisovala celý starý stav postupu | Dvě odpovědi skončily jako jediná; ztratily se výsledky prvního okna | Každá změna čte aktuální uložený stav. Web Locks serializují zápisy; události úložiště synchronizují výsledky, aniž mění systém probíhající lekce. |
| Poškozený místní koncept zablokoval načtení editoru | Učitel nemohl začít s aktuálními otázkami z webu | Přidáno výslovné načtení obsahu webu; starý koncept se nemění bez následného uložení. |
| Poškozený postup se při startu automaticky přepsal | Zmizela původní data potřebná k obnově | Samotné načtení nezapisuje. Před nahrazením poškozených dat se uchová místní záloha. |
| Náhled otázky přebíral kurzor při úpravě textu | Psaní delší otázky mohlo být přerušované | Automatická práce s fokusem běží jen v tréninku, ne v editorovém náhledu. Textová pole mají jednoznačné přístupné názvy. |
| Načítání webu kontrolovalo strukturu, ale ne správnost aktivních otázek | Například správná odpověď `8NT` prošla do tréninku, přestože ji nelze zvolit | Aktivní obsah prochází stejnou věcnou kontrolou jako sestavení. Chyba se zobrazí srozumitelně. |
| Import dovoloval ID jako `constructor` | Přístup k tabulce chyb mohl narazit na vlastnost objektu a shodit obrazovku | Kolizní ID jsou odmítnuta již ve schématu. |
| Dražba ani správná odpověď nemusela postupovat vzestupně | Editor přijal například `1♠–1♥`; deska nabízela i nižší závazky | Přidána kontrola pořadí závazků a vypnutí již nedostupných závazkových hlášek. |
| Skóre pod hranicí 80 % se zobrazovalo jako 80 % | Student viděl zdánlivě splněnou hranici u neúspěšného testu | Skóre má přesnost na dvě desetinná místa a výsledek uvádí i počet správných odpovědí. Hranice se stále posuzuje z přesného poměru. |
| Zkrácený přehled Matěj/Mikuláš neobsahoval celé podmínky 2♠ | Zadání se slabým pětilistem bylo příliš obecné | Otázka i pravidlo používají detailní oddíl: 5♠4+m, nebo příslušný slabý šestilist. |

## Ověření

- `pnpm test`: 21 testů, včetně migrace postupu, záloh, pořadí závazků,
  poškozeného obsahu, oddělení systémů a rozdílů Precision variant.
- `pnpm test:browser`: souběžná okna, zachování vybraného systému v jiné
  probíhající lekci, obnovení konceptu, zrušení načítání, psaní v editoru,
  záloha poškozeného postupu, odmítnutí vadného obsahu, provoz bez ukládání,
  deset nových kapitol včetně jejich testů a mobilní přehled/výsledky.
- `pnpm build`: TypeScript, kontrola publikovaného obsahu a výstup GitHub Pages.
- `pnpm audit --prod`: kontrola nezachytila známé zranitelnosti produkčních závislostí.

## Obsah

Každý systém získal dvě kapitoly se šesti úlohami. Celkem je 172 úloh
v 26 kapitolách. Pokročilá zadání jsou zkrácená do bridžové terminologie;
v pravidlech je přehled zkratek. Podklady a hranice pokrytí popisuje SOURCES.md.

## Co má smysl upravit dále

1. **Přesné dohody pokročilé Lepší levné 2/1.** Dodané osnovy určují témata,
   ale nikoli úplnou kartu. Pro další konkrétní sledy je potřeba systémová karta
   akademie, zejména dohody po 1M a detaily forsingového 1NT.
2. **Plná dražba pro soutěžní lekce – implementováno.** Volitelný `auction`
   uchovává rozdávajícího, hráče, stav her a všechny hlášky s pozicemi N/E/S/W.
   Sdílená kontrola ověřuje střídání, partnerství, kontra/rekontra i konec dražby.
   Editor, náhled a trénink používají stejná pravidla. Původní `sequence` se
   při čtení rozvine s pasy soupeřů; 172 otázek a systémové karty se nemění.
   Formát a pravidla převodu popisuje README.
3. **Rozlišit trénink a zkoušení.** Volitelný test bez průběžného odhalování
   správných odpovědí a s rozborem až na konci by lépe ověřoval samostatné znalosti.
4. **Záloha a přenos postupu.** Export/import postupu mezi zařízeními by navázal
   na místní ukládání. Sdílené účty by již vyžadovaly samostatnou serverovou část.
5. **Více praktických rozdání a sehrávka.** Další přínos mají kompletní ruce,
   plán sehrávky, výnosy a obrana podle ročníků HABRA. Nestačí zde jen další
   definice konvencí; je vhodné doplnit řešená rozdání z výuky.

## Úpravy rozhraní účtu a hledání

Průhlednost dialogu účtu byla potvrzena kontrolou skutečného vypočteného
pozadí v Chromium (`rgba(0, 0, 0, 0)`). Sdílený styl dialogů nyní nastavuje
plné pozadí, barvu textu a ztmavení stránky. Dialog účtu má vlastní
rozložení a posouvání pro mobil; zavírací tlačítka jsou česky.

Přibylo hledání kapitol a uživatelů bez rozlišení velikosti písmen/diakritiky,
filtr rolí uživatelů, zobrazení/skrytí hesla a potvrzení hesla při registraci
i změně. Hledání kapitol zachovává původní čísla a podmínky odemčení.
Formuláře během požadavku blokují další odeslání a editaci polí.

Ověřeno sestavením, 21 testy, prohlížečovými regresními kontrolami a
integračním testem Workeru s izolovanou D1. Kontroly zahrnují neprůhledné
pozadí na desktopu/mobilu, hledání, filtry, neshodná i platná hesla a
standardní registraci/přihlášení/správu rolí.

## Ověření dražby čtyř hráčů

- `pnpm test`: 46 úspěšných testů. Nové scénáře pokrývají čtyři rozdávající,
  zásahy, kontra a rekontra včetně dvou mezilehlých pasů, obnovení stavu po
  vyšším závazku, 7NT, konec dražby, hlavního hráče, neplatné pozice a hlášky,
  import/export a samostatnou testovou banku.
- Regrese všech 172 původních úloh: původní data se nemění, správné odpovědi
  zůstávají legální. Prochází také převod celé sady na explicitní čtyřhráčový zápis.
- `pnpm test:browser`: původní regresní kontroly, lekce a testy pěti systémů,
  mobilní tabulka čtyř pozic, nabídka kontra/rekontra, uložení nové dražby,
  blokování publikace nelegální odpovědi a vypnutí desky po ukončení dražby.
- `pnpm build` a `pnpm check:worker`: kontrola typů, publikovaného obsahu,
  sestavení statického webu a kompatibilita serverové validační logiky.
