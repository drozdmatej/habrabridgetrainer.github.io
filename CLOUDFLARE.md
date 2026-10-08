# Účty a společný editor na Cloudflare

Produkční web: https://habra-editor.drozdmatej09.workers.dev

Worker obsluhuje web i API na jedné doméně. Binding `DB` odkazuje na existující
Cloudflare D1 `habra-bridge-auth` (`52484814-e319-43da-a95f-ae460f158227`).
Účty a historie obsahu jsou v databázi. Výsledky tréninku jsou zatím místní,
oddělené pro přihlášené účty a hosta; mezi zařízeními se nesynchronizují.
GitHub Pages dál podporují dosavadní trénink a místní editor/export, ale samotné
GitHub Pages neumějí provozovat přihlášení ani společné ukládání.

| Role | Pravomoci |
| --- | --- |
| Student | Trénink, vlastní účet, změna hesla |
| Editor | Navíc společný koncept, historie, obnova konceptu a zveřejňování otázek |
| Správce | Navíc přidělování rolí a přístupů k systémům |

Nová registrace má vždy roli studenta. API čte aktuální roli z databáze při každém
požadavku. Posledního správce nelze přes správu rolí degradovat.

## Místní vývoj

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check:worker
pnpm db:migrate:local
```

Vytvoř soubor `.dev.vars` podle `.dev.vars.example` a vygeneruj vlastní náhodný
`PASSWORD_PEPPER` o alespoň 32 znacích. Soubor je ignorován Gitem.

```sh
pnpm db:seed:local
pnpm dev:cloudflare
pnpm test:cloudflare
```

Integrační test vytváří dočasnou izolovanou D1 a vlastní tajný klíč. Potřebuje
Chromium (`CHROMIUM_PATH` je volitelná cesta), volný port 8790 a aktuální `docs`
z `pnpm build`. Nemění vývojovou ani produkční databázi. Kontroluje skutečný
Worker, registrační a přihlašovací tok, role, CSRF, hesla, souběžné zápisy,
historii, obnovu, publikaci a ovládání přihlášení/editoru v prohlížeči.

## První nasazení

Produkční tabulky byly vytvořeny a naplněny 172 otázkami. Přístup ověřuj na
produkční adrese; nové nastavení již používá uživatelské jméno a heslo.
První účet správce byl nastaven vlastníkem přes D1.

Konfigurace už uvádí účet `3a865422ab5895d8430a5f59fb765927` a jméno Workeru
`habra-editor`. Než nahradíš existující Worker, ověř jeho aktuální kód,
bindings a domény a uchovej předchozí verzi. Před vzdálenými migracemi ověř,
že jde o novou databázi určenou traineru, nikoli o databázi jiné aplikace.

1. Přihlas Wrangler pomocí `pnpm exec wrangler login` ve svém místním Codexu,
   nebo přidej `CLOUDFLARE_API_TOKEN` bezpečně do nastavení cloudového prostředí.
   Token pro tento účet potřebuje Workers Scripts Edit a D1 Edit; hodnotu nedávej
   do chatu ani repozitáře. Pro ověření autentizace použij `pnpm exec wrangler whoami`.
2. Pro tento účet již existuje databáze `habra-bridge-auth` a její ID je nastavené.
   Použij ji; další databázi vytvářej jen při samostatném novém nasazení:

   ```sh
   pnpm exec wrangler d1 create habra-bridge-auth
   ```

   Její `database_id` doplň do `wrangler.jsonc`. V dashboardu odpovídá položce
   Workers → habra-editor → Settings → Bindings → D1 Database, název bindingu
   musí být přesně `DB`. Wrangler jej nastaví při nasazení z konfigurace.
3. `APP_URL` je nastavené na výše uvedenou produkční adresu. Při nasazení jinam
   jej změň na skutečný HTTPS origin Workeru nebo jeho
   vlastní domény, bez cesty. Najdeš jej na přehledu Workeru. Web i API se otevírají
   na této adrese; nelze použít adresu dashboardu ani GitHub Pages.
4. Připrav tabulky a výchozí obsah:

   ```sh
   pnpm exec wrangler d1 migrations apply DB --remote
   node --experimental-strip-types scripts/seed-database.ts --remote
   ```

   Seed pouze naplní prázdnou historii. Opakované spuštění nepřepíše otázky,
   které už byly upravené přes web. SQL je děleno na malé příkazy kvůli limitu D1.
5. Produkční `PASSWORD_PEPPER` už je nastavený. Při aktualizaci jej zachovej.
   Jen při samostatném prvním nasazení vygeneruj **samostatný produkční**
   `PASSWORD_PEPPER` a nastav jej jako Secret
   v Settings → Variables and Secrets, nebo interaktivně:

   ```sh
   pnpm exec wrangler secret put PASSWORD_PEPPER
   ```

   Secret musí zůstat stabilní a být bezpečně zálohovaný: změna nebo ztráta
   zneplatní ověřování všech uložených hesel. Vývojový tajný klíč nepoužívej
   v produkci. Hesla uživatelů do dashboardu nezadáváš.
6. Nasaď aplikaci:

   ```sh
   pnpm deploy:cloudflare
   ```

   Příkaz odmítne zástupné ID databáze a místní/neHTTPS `APP_URL`. Pak provede
   kontrolu typů frontendu i Workeru, sestavení a nasazení. Žádné tajné hodnoty
   nejsou součástí sestaveného JavaScriptu.
7. Na produkčním webu si vytvoř vlastní účet. V D1 → Console ověř jeho jméno
   a povyš **svůj skutečný účet** následujícím příkazem (nahraď `tvuj_ucet`):

   ```sql
   SELECT id, username, name, role FROM users WHERE username = 'tvuj_ucet';
   UPDATE users SET role = 'admin' WHERE username = 'tvuj_ucet';
   ```

   Obnov web. V Můj účet → Načíst uživatele přiděluj ostatním role. Tento první
   krok přes konzoli brání tomu, aby si roli správce přivlastnila první registrace.

## Běžná práce s otázkami

Editor načte společný koncept. „Uložit koncept na server“ uchová rozpracovanou
práci pro ostatní editory, ale hráčům se dál zobrazují zveřejněné otázky.
„Zveřejnit pro všechny“ provede serverovou kontrolu a zapíše novou zveřejněnou
verzi. Po zavření editoru se načte aktuální obsah; ostatní hráči jej dostanou
při dalším načtení webu. Již probíhající lekce se během práce nemění.

Při konfliktu verzí server změnu odmítne. Exportuj svůj koncept do JSON,
načti aktuální společný koncept a úpravy znovu zapracuj. Historie uchovává
autora, čas a obsah každé verze; „Obnovit jako koncept“ nezmění publikované
otázky, dokud obnovený koncept výslovně nezveřejníš.

## Přihlášení a provoz

Jména mají 3–32 znaků, bez diakritiky, nerozlišují velká a malá písmena. Hesla
mají 12–128 znaků. Uložen je PBKDF2-HMAC-SHA256 hash (100 000 iterací,
limit Web Crypto ve Workers), náhodná sůl pro každý účet a HMAC předzpracování
pomocí serverového pepperu. Databáze neobsahuje původní hesla ani aktivní
session tokeny v otevřeném tvaru; ukládá jejich SHA-256 hashe.

Session trvá sedm dní a používá HttpOnly/SameSite=Lax cookie, v produkci také
Secure. Zápisy vyžadují shodný Origin a CSRF token. Pokusy o přihlášení
a registraci jsou omezené přes D1; změna hesla ukončí ostatní sessions účtu.
Samostatný serverový klíč není určen k posílání mezi prohlížečem a serverem.

Automatická obnova zapomenutého hesla bez přihlášení zatím není součástí této
verze. Pro veřejné větší nasazení má smysl doplnit ověřený kontakt a recovery
tok; vyšší provoz může vyžadovat Turnstile a samostatné rate limiting pravidlo.
Zálohy D1 a přístup k tokenu/pepperu spravuje vlastník Cloudflare účtu.


## Systémy, pravidla a testy

Ve **Správě obsahu** načti koncept a použij **Nový systém**. Nový systém i
kapitoly začínají jako rozpracované; hráči je neuvidí, dokud je nepřepneš do
stavu ke zveřejnění a nezveřejníš koncept. Pravidla a podklady zadávej po řádcích.
Smazání systému či kapitoly vyžaduje potvrzení a projeví se až zveřejněním.

Každá kapitola může pro test použít tréninkové otázky nebo **samostatnou sadu**.
U samostatné sady přepínej mezi tréninkovými a testovými otázkami. Prázdný počet
znamená všechny otázky; s náhodným pořadím se vybere náhodný podvýběr z celé sady,
bez něj prvních N otázek v pořadí editoru. Nastavit lze i požadavek na dokončený
trénink a hranici úspěchu. Zveřejnění odmítne prázdnou sadu, neplatné otázky nebo
počet vyšší než velikost sady. Starší obsah používá původní nastavení automaticky.

## Přístup k systémům

Výchozí přístup systému je **Veřejný** nebo **Jen povolení uživatelé**.
Ve **Můj účet → Oprávnění uživatelů → Systémy uživatele** může správce studentovi
nastavit Povolit, Zakázat nebo Podle systému. Povolení překoná výchozí zamčení,
zákaz výchozí povolení. Editoři a správci mají přístup ke všem systémům kvůli správě.
Změny individuálních oprávnění platí na serveru hned, změna výchozího přístupu
systému po zveřejnění konceptu. Studentská stránka aktualizuje obsah při návratu do
okna, změně přihlášení a každých 30 sekund; již stažený obsah nelze vzít zpět.

Veřejný systém zůstává dostupný hostům. Chceš-li ho zpřístupnit jen některým
studentům, nastav **Jen povolení uživatelé** a uděl konkrétní povolení.
Server vrací zamčeným uživatelům pouze ID a název systému, včetně přímých odkazů
na JSON. Statický výstup vynechává otázky omezených systémů; uživatelská oprávnění
fungují na Cloudflare, nikoli na GitHub Pages. Nevkládej neveřejný obsah do
veřejného zdrojového repozitáře, upravuj jej ve sdíleném editoru Cloudflare.

Migrace `0002_system_access.sql` přidává přístupy a jejich audit bez změny
existujících účtů a obsahu. Nasazovací skript aplikuje chybějící migrace před
nasazením Workeru; před aktualizací uchovej zálohu D1.
