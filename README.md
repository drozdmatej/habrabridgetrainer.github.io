# HABRA — Bridžový trenažér

Výuka pro Havířovskou bridžovou akademii: základní Lepší levná, pokročilá
Lepší levná s 2/1 GF, Epstein Precision, Precise Mr. and Mrs. Smith
a samostatný velmi pokročilý standard Matěje a Mikuláše. Aplikace nabízí
172 úloh v 26 kapitolách. Přesné dohody výukových variant najdete pod „Pravidla systému“.
Obě varianty Precision a standard Matěje a Mikuláše vycházejí z dodaných
systémových karet. Přehled podkladů a rozsahu lekcí je v [SOURCES.md](SOURCES.md).

Volitelný Cloudflare Worker a D1 přidávají přihlášení jménem a heslem, role
student/editor/správce a společný editor s přímým zveřejněním otázek pro všechny.
Editor podporuje nové systémy, úpravu pravidel a vlastní testové sady s počtem
otázek, náhodným výběrem a podmínkou dokončeného tréninku. Správce může řídit
přístup studentů k jednotlivým systémům.
Nastavení, testy a nasazení popisuje [CLOUDFLARE.md](CLOUDFLARE.md).

Potřebujete Node.js alespoň 22.13 a pnpm 11.19.0 (viz `packageManager`).

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm test:browser
pnpm build
```

`pnpm test:browser` potřebuje nainstalovaný Chromium. Můžeš nastavit `CHROMIUM_PATH`
na jeho spustitelný soubor. Test si spustí vlastní Vite na portu 5180 a po dokončení
jej ukončí. Ověřuje souběžná okna, obnovu poškozených dat, editor, mobilní rozložení
a všech deset nových kapitol včetně testů. Kontroluje také skutečný postup,
filtry kapitol, pozastavení pokusu a návaznost tréninku, testu a další kapitoly.

`pnpm-workspace.yaml` povoluje instalační skripty esbuild a Cloudflare workerd.
Sestavení spouští TypeScript a kontrolu zveřejňovaného obsahu; neplatné otázky
sestavení zastaví. Výstup pro GitHub Pages je ve verzované složce `docs`.
Pro kontrolu bez změny publikovaných souborů použijte:

```sh
pnpm build --outDir /tmp/habra-build
pnpm preview --outDir /tmp/habra-build
```

Otázky upravujte v `content/trainer.json` nebo přes správu obsahu v aplikaci.
Editor ukládá místní koncept, který lze exportovat; samotný export web nezmění.
Po nahrazení zdrojového JSON je nutné znovu sestavit `docs`.

Přihlášeným uživatelům na Cloudflare se postup, výsledky, chyby a historie
jednotlivých úloh synchronizují mezi zařízeními. Hostům a na GitHub Pages
zůstává ukládání v prohlížeči pro každý systém zvlášť. Starší postup se převádí do základní Lepší levné. Opakování chyb
neodemkne další kapitolu: k tomu je třeba úspěšný test. Mazání dat prohlížeče
odstraní místní postup a neodeslané odpovědi; synchronizované výsledky účtu
zůstanou na serveru. Přehled doporučuje další lekci nebo test a umožňuje
filtrovat odemčené, nedokončené kapitoly a kapitoly s chybami. Ukazatel postupu
počítá úspěšné testy, nikoli jen projité tréninky.

Rozpracovaný pokus lze pozastavit a obnovit při pohybu uvnitř aplikace.
Samotný pokus zůstává v paměti otevřené stránky; obnovení nebo zavření stránky
je ukončí. Již zaznamenané odpovědi a dokončené kapitoly zůstávají uložené.
Před nahrazením pokusu novým tréninkem či změnou systému aplikace upozorní.

Přehled nalezených vad, oprav a dalších doporučení je v [CODE_REVIEW.md](CODE_REVIEW.md).

Náhodné příklady míchají tréninkové otázky vybraného systému. Lze vybrat 5, 10,
20 nebo všechny otázky a všechny nebo jen odemčené kapitoly. V jedné sadě
se otázky neopakují; samostatné testové otázky se do směsi nezařazují. Odpovědi
a chyby se zaznamenají ke zdrojovým kapitolám, ale tato volná forma tréninku
nemění splnění lekcí a testů ani odemčení kapitol.

Chytré opakování používá stejný výběr počtu úloh a kapitol jako náhodné příklady.
Přednost mají aktuální chyby, následně otázky s uplynulým termínem opakování,
potom nové otázky. Správné odpovědi prodlužují interval na 1, 3, 7, 14 a 30 dní;
chyba jej vrací na okamžité opakování. Když vybraná sada potřebuje více otázek,
doplní se méně procvičené příklady. Ani chytré opakování neodemkne kapitoly.

V horní liště lze zvolit světlý či tmavý vzhled, nebo automatický režim podle zařízení. Volba zůstává uložená v prohlížeči. Mobilní editor má oddělené části Kapitoly, Úpravy a Náhled; přepínání zachovává rozpracovaný koncept. Nastavení systému, kapitoly a testu lze sbalit.

### Dražba čtyř hráčů

Nové otázky používají `auction` s rozdávajícím (`dealer`), odpovídajícím hráčem
(`player`), stavem her (`vulnerability`: `none`, `NS`, `EW`, `both`) a všemi
hláškami v pořadí (`calls`: `{ seat: "N" | "E" | "S" | "W", bid: string }`).
Partnerství jsou pevná N–S a E–W; draží se N → E → S → W → N. Příklad
s kontra soupeře, po kterém je na řadě partner zahajitele:

```json
{
  "sequence": [],
  "auction": {
    "dealer": "N",
    "player": "S",
    "vulnerability": "NS",
    "calls": [{ "seat": "N", "bid": "1H" }, { "seat": "E", "bid": "X" }]
  }
}
```

V této situaci může S pasovat, dát rekontra nebo vyšší závazek. Kontra není
legální. Pasy právo na kontra/rekontra neruší; nový závazek ruší předchozí
kontra/rekontra. Čtyři úvodní pasy nebo tři pasy po závazku/kontra/rekontra
ukončují dražbu. Po jejím konci nelze použít dražební desku; pro otázky
k výslednému závazku použij typ `choice`. Stav her se uchovává a zobrazuje,
na legalitu hlášek nemá vliv.

Všech 172 původních otázek zůstává beze změny: `sequence` je zkrácený zápis
hlášek partnerů, začínající N. Adaptér za každou hlášku vloží pas soupeře;
odpovídá další partner. Pozice N/S jsou u starých úloh konvence zobrazení,
nikoli dodatečně zjištěná původní orientace. ID, správné odpovědi, systémové
dohody a uložený postup se nemění. Zkrácený zápis nepoužívej pro zásahy ani
kontra: v editoru jej převeď tlačítkem na plnou dražbu a doplň skutečné hlášky.
Převod zachová hlášky a předpokládané pasy; zpětný ztrátový převod editor nenabízí.
Při použití `auction` musí být `sequence` prázdné, aby se nerozcházely dva zdroje.

Editor umožňuje změnit rozdávajícího, hráče a stav her, upravit každou hlášku
a přidat či odebrat poslední hlášku. Změna rozdávajícího přepočítá pozice
všech hlášek; odpovídajícího hráče zvol samostatně. Chyby lze uložit do konceptu,
ale blokují publikování i načtení aktivní úlohy do tréninku. Stejný modul
`app/auction.ts` kontroluje historii, správnou odpověď i dostupnost tlačítek.
`isHigherBid` zůstává pomocnou kontrolou pořadí závazků, nikoli legality dražby.

Pravidla vycházejí z [WBF Laws of Duplicate Bridge, pravidla 17–19 a 22](https://www.worldbridge.org/wp-content/uploads/2020/02/2017LawsofDuplicateBridge-gender_neutral_1.pdf).
Trenažér vyžaduje legální průběh dražby; neřeší nápravy nepravidelností
rozhodčím, alertování ani omezení konkrétních konvenčních dohod.
