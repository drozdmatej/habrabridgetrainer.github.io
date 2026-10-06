# HABRA — Bridžový trenažér

Výuka pro Havířovskou bridžovou akademii: základní Lepší levná, pokročilá
Lepší levná s 2/1 GF, Epstein Precision, Precise Mr. and Mrs. Smith
a samostatný velmi pokročilý standard Matěje a Mikuláše. Aplikace nabízí
112 úloh v 16 kapitolách. Přesné dohody výukových variant najdete pod „Pravidla systému“.
Obě varianty Precision a standard Matěje a Mikuláše vycházejí z dodaných
systémových karet. Přehled podkladů a rozsahu lekcí je v [SOURCES.md](SOURCES.md).

Potřebujete Node.js alespoň 22.13 a pnpm 11.19.0 (viz `packageManager`).

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

`pnpm-workspace.yaml` povoluje instalační skript pouze závislosti esbuild.
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

Postup, výsledky a chybné odpovědi se ukládají v prohlížeči pro každý systém
zvlášť. Starší postup se převádí do základní Lepší levné. Opakování chyb
neodemkne další kapitolu: k tomu je třeba úspěšný test. Mazání dat prohlížeče
odstraní i místní postup.
