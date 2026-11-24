# App Spese — guida rapida

## File
- `index.html`, `style.css`, `app.js`, `logic.js`: l'app
- `config.js`: configurazione Firebase, email autorizzate, categorie iniziali
- Le regole di sicurezza (con le email) NON stanno nel repository: si incollano a mano nella console Firebase
- `manifest.json`, `icon-*.png`: per installarla sulla schermata Home

## Prima di pubblicarla
1. Gli indirizzi autorizzati sono solo in `firestore.rules` (non nel codice pubblico).
   La percentuale di divisione si riferisce a chi accede per primo.
2. Console Firebase → Firestore Database → **Regole**: incolla tutto il testo delle regole e premi **Pubblica**.
3. Console Firebase → Authentication → Impostazioni → **Domini autorizzati**: aggiungi il dominio dove pubblichi l'app
   (es. `tuonome.github.io`).
4. Console Firebase → AI Logic: deve risultare attiva la **Gemini Developer API**.

## Funzioni
- **Personali**: entrate, uscite, rimanenti del mese; totali per categoria; elenco movimenti. Visibili solo a te.
- **Condivise**: spese di casa visibili e modificabili da entrambi; chi ha pagato; quote; saldo "chi deve quanto a chi".
- **Importa**: screenshot o testo della banca → l'AI estrae i movimenti e propone la categoria → controlli e salvi.
  Se correggi una categoria, l'app se lo ricorda per la volta successiva.
- **Impostazioni**: nomi, quota predefinita, quote diverse per categoria, spese fisse mensili, categorie
  (aggiungi / rinomina / elimina: le spese di una categoria eliminata passano in "Altro").

## Installazione sul telefono
Apri il link dell'app in Safari → Condividi → **Aggiungi alla schermata Home**.
