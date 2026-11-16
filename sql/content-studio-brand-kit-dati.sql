-- Content Studio — Brand Kit precompilati (16/11/2026), da correggere dalla scheda.
-- Fonti: sito di ogni brand (colori e font del tema Shopify), bio e post Instagram con le loro metriche,
-- prodotti più venduti negli ordini Shopify degli ultimi 12 mesi. File nel bucket brand-kit.
-- Sovrascrive i campi: eseguirlo di nuovo cancella le modifiche fatte a mano.

update public.brand_kits set
  logo_chiaro = 'ciucciamilcalzino/logo-chiaro.png',
  logo_scuro  = 'ciucciamilcalzino/logo-scuro.png',
  palette = '[
    {"nome": "Nero", "hex": "#000000"},
    {"nome": "Bianco", "hex": "#FFFFFF"},
    {"nome": "Azzurro calzino", "hex": "#C3DBEA"},
    {"nome": "Blu bottoni", "hex": "#13ADE4"},
    {"nome": "Blu scuro", "hex": "#0070A7"}
  ]'::jsonb,
  font = '{"titoli": {"nome": "Inter (sito); il logo usa un lettering tondo disegnato"}, "testi": {"nome": "Inter"}}'::jsonb,
  tono_voce = 'Ironico, irriverente e sfacciato, senza filtri: "calzini che parlano per te", "dillo coi calzini". Frasi brevi a effetto, giochi di parole, battute da palestra e da lunedì mattina, dialetti e modi di dire italiani. Si dà del tu. Emoji frequenti (🧦 💣 😎 🔥 😈) e titoli in maiuscolo per le novità (NUOVA COLLEZIONE, DROP ALERT). Si rivendica il Made in Italy con orgoglio, anche toscano. Sulle collezioni provocatorie: "né di destra, né di sinistra, solo dalla parte di chi ha voglia di farsi notare". Chiusura con invito al sito (LINK IN BIO) o ai DM.',
  target = 'Adulti italiani, soprattutto 20-45 anni, con un senso dell''umorismo spinto: chi va in palestra e fa sport (fitness, running, padel, basket), chi ama i meme e le frasi a effetto, chi cerca un regalo divertente. Seconda linea: aziende, palestre, squadre e rivenditori che vogliono calzini personalizzati con il proprio logo.',
  prodotti = 'Calzini sportivi stampati 100% Made in Italy (13,90 €; spedizione gratuita sopra 79 €). Più venduti nell''ultimo anno: Ovunque proteggimi, Santo Silvio, Alzati e fattura, Smadonno ma non mollo, Vi libero dai comunisti, Bello il fitness ma la figa?!, Tira un porco, Paranoia, Beer Happy, Si stava meglio. Collezioni: Anti Social, Politicamente Scorretti, Dialettali, Explicit Content, Fitness, Running, Basket, Food & Drink, Meme, Pets, Pattern, Cinema, Skeleton. Personalizzati con nome, foto, logo o frase, anche creati con l''AI sul sito.',
  parole_si = array['Made in Italy', 'dillo coi calzini', 'calzini che parlano per te', 'personalizzati', 'senza filtri', 'irriverenti', 'LINK IN BIO', 'scrivici in DM'],
  parole_no = array['T&C Factory', 'economici', 'low cost', 'calze', 'tono istituzionale o aziendale', 'attacchi a persone reali non pubbliche'],
  esempi = '[
    {"url": "https://www.instagram.com/p/DdG75X-jYiv/", "immagine": "ciucciamilcalzino/esempi/DdG75X-jYiv.jpg", "nota": "Carosello, 209 like: calzino personalizzato per un personaggio noto (Il Dongi di Cash or Trash), raccontato come pezzo da collezione. Il post migliore dell''anno."},
    {"url": "https://www.instagram.com/p/DfCMxdzDe6R/", "immagine": "ciucciamilcalzino/esempi/DfCMxdzDe6R.jpg", "nota": "Carosello, 86 like: lancio della collezione Anti Social, titolo in maiuscolo e tono sfacciato."},
    {"url": "https://www.instagram.com/reel/DU5szwujTln/", "immagine": "ciucciamilcalzino/esempi/DU5szwujTln.jpg", "nota": "Reel, 57 like: la mascotte al Carnevale di Viareggio, evento locale e domanda al pubblico."},
    {"url": "https://www.instagram.com/p/DeG9GDbjffo/", "immagine": "ciucciamilcalzino/esempi/DeG9GDbjffo.jpg", "nota": "Carosello, 47 like: nuova categoria Politicamente Scorretti, frasi brevi a effetto."},
    {"url": "https://www.instagram.com/p/DW6VAyjDZVu/", "immagine": "ciucciamilcalzino/esempi/DW6VAyjDZVu.jpg", "nota": "Carosello: collezione dialetto toscano, orgoglio Made in Tuscany."}
  ]'::jsonb
where negozio = 'ciucciamilcalzino';

update public.brand_kits set
  logo_chiaro = 'bienjugado/logo-chiaro.png',
  logo_scuro  = 'bienjugado/logo-scuro.png',
  palette = '[
    {"nome": "Navy", "hex": "#023047"},
    {"nome": "Nero", "hex": "#202123"},
    {"nome": "Bianco", "hex": "#FFFFFF"}
  ]'::jsonb,
  font = '{"titoli": {"nome": "Archivo (il logo usa un lettering condensed corsivo)"}, "testi": {"nome": "Archivo"}}'::jsonb,
  tono_voce = 'Energico, giocoso e autoironico, da "The Unconventional Padel Brand". Motto: MENOS TRABAJO MAS PADEL; chiusura ricorrente "Conquista il campo con lo stile Bienjugado". Ironia sul gioco in coppia ("qualcuno deve prendersi la colpa"), titoli in maiuscolo tra emoji ⚡️💥, si dà del tu. Si punta su personalizzazione (nomi, bandiere, sponsor), tessuti tecnici e colori. Qualche parola spagnola per richiamare il padel.',
  target = 'Giocatori e giocatrici di padel amatoriali in Italia, 25-55 anni, che giocano in coppia o in squadra e vogliono distinguersi in campo; anche bambini. Coppie che cercano outfit coordinati (DUO). Circoli e squadre per capi personalizzati (Custom Lab).',
  prodotti = 'Abbigliamento tecnico da padel uomo, donna e bambino: T-shirt Quick Dry (19,90 €), linea Breezy (T-shirt, short e gonne), Second Skin termico, tute e felpe, giacche, calzini padel (13,90 €). Più venduti nell''ultimo anno: stampa nome sui capi e sui calzini, T-shirt Fun "È colpa sua" (DX e SX, uomo e donna), stampa bandiera, T-shirt Padel Hub, calzini "Non posso ho padel", calzini antiscivolo. Collezioni: DUO, ESSENTIAL, Breezy, Custom Lab.',
  parole_si = array['MENOS TRABAJO MAS PADEL', 'Conquista il campo', 'Unconventional Padel Brand', 'Custom Lab', 'tessuti tecnici', 'stampa del nome', 'outfit di coppia'],
  parole_no = array['T&C Factory', 'tennis (al posto di padel)', 'economico', 'tono serioso'],
  esempi = '[
    {"url": "https://www.instagram.com/p/DVyZMRzAidK/", "immagine": "bienjugado/esempi/DVyZMRzAidK.jpg", "nota": "Immagine: T-shirt Fun \"È colpa sua\", ironia sulla coppia di gioco. È anche tra i prodotti più venduti."},
    {"url": "https://www.instagram.com/p/C_zgBQXoyfo/", "immagine": "bienjugado/esempi/C_zgBQXoyfo.jpg", "nota": "Carosello: promo stampa del nome gratuita con motto e chiusura del brand."},
    {"url": "https://www.instagram.com/p/C3uMsAsIaMG/", "immagine": "bienjugado/esempi/C3uMsAsIaMG.jpg", "nota": "Carosello: CUSTOM 2.0, nuovi materiali e fit raccontati punto per punto."},
    {"url": "https://www.instagram.com/p/DL96Rz7ISSj/", "immagine": "bienjugado/esempi/DL96Rz7ISSj.jpg", "nota": "Carosello: saldi annunciati con autoironia (\"siamo arrivati lunghi\")."}
  ]'::jsonb
where negozio = 'bienjugado';

update public.brand_kits set
  logo_chiaro = 'boxfactorylab/logo-chiaro.png',
  logo_scuro  = 'boxfactorylab/logo-scuro.png',
  palette = '[
    {"nome": "Nero", "hex": "#121212"},
    {"nome": "Bianco", "hex": "#FFFFFF"}
  ]'::jsonb,
  font = '{"titoli": {"nome": "Inter (il logo usa un lettering geometrico squadrato)"}, "testi": {"nome": "Inter"}}'::jsonb,
  tono_voce = 'Diretto e carico, da community CrossFit: frasi corte, molta energia (🔥 💥 ‼️ 🚨), annunci "NOVITÀ" e "Avete capito bene!". Si dà del tu all''atleta e del voi ai box. Si valorizza il box cliente ("la vera forza sta nel tuo marchio") e si taggano sempre box ed eventi. Vena ironica nei titoli dei calzini (Leg day, Lift with the Lord).',
  target = 'Proprietari e coach di box CrossFit e organizzatori di gare, che ordinano abbigliamento e merchandising personalizzati per il box o per la gara. Atleti CrossFit e functional fitness, uomo e donna, che comprano calzini, T-shirt e accessori e conservano la targa della gara.',
  prodotti = 'Servizio Box: abbigliamento personalizzato con il logo del box, grafica inclusa, niente minimi, oltre 90 colori di T-shirt (ricamo, serigrafia, stampa digitale, sublimatico). Servizio Gare: pacco gara, T-shirt nominative, targhe atleti e copie della targa in forex, banner e bandiere. Store: calzini CrossFit (13,90 €), T-shirt uomo, donna e bambino, polsini, patch, zaini, portachiavi, ronin tape, magnesite. Più venduti nell''ultimo anno: stampa nome sui calzini, targa Donkey Challenge, maxi targa 059 Classic, calzini Burpees, Smadonno ma non mollo, Tira un porco. Novità: ordini dall''app di Box Factory Lab.',
  parole_si = array['il tuo Box', 'Servizio Box', 'pacco gara', 'niente minimi', 'più di 90 colori', 'personalizzato', 'taggaci per il repost'],
  parole_no = array['T&C Factory', 'palestra (meglio box)', 'economico'],
  esempi = '[
    {"url": "https://www.instagram.com/reel/DN0fdzbWOFn/", "immagine": "boxfactorylab/esempi/DN0fdzbWOFn.jpg", "nota": "Reel, 66 like e 9 commenti: lavorazione in corso di una cropped T-shirt per un box taggato."},
    {"url": "https://www.instagram.com/reel/DPTpMe_DLEh/", "immagine": "boxfactorylab/esempi/DPTpMe_DLEh.jpg", "nota": "Reel, 57 like: annuncio degli ordini dall''app, tono \"Avete capito bene!\"."},
    {"url": "https://www.instagram.com/reel/DOLxTJIDLhH/", "immagine": "boxfactorylab/esempi/DOLxTJIDLhH.jpg", "nota": "Reel, 62 like: più di 90 colori di T-shirt, domanda finale al pubblico."},
    {"url": "https://www.instagram.com/p/DO-kmAxjOaA/", "immagine": "boxfactorylab/esempi/DO-kmAxjOaA.jpg", "nota": "Immagine: replica della targa di gara in forex, prodotto spiegato in punti."},
    {"url": "https://www.instagram.com/reel/DXrA2SpsBAD/", "immagine": "boxfactorylab/esempi/DXrA2SpsBAD.jpg", "nota": "Reel: grafica ufficiale di una gara (Italian Bulls Game) e invito allo stand."}
  ]'::jsonb
where negozio = 'boxfactorylab';
