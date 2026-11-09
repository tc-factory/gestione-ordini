# Sendcloud: mittente giusto per negozio

Estensione di Chrome per la pagina **Spedizione → Ordini in entrata** di Sendcloud.

- Scegli un negozio nel filtro → "Spedizione da" passa all'indirizzo (e logo) di quel negozio.
- Scegli "Spedizione da" → il filtro passa al negozio di quell'indirizzo.
- In basso c'è sempre una barra:
  - **verde**: negozio e mittente coincidono;
  - **rossa**: non coincidono, oppure sei su "All integrations";
  - **arancione**: l'estensione non riesce più a leggere o cambiare la pagina (Sendcloud l'ha cambiata) → controllare a mano e aggiornare `content.js`.

| Negozio (integrazione) | ID integrazione | Indirizzo mittente |
|---|---|---|
| BIENJUGADO | 424826 | Bienjugado srl |
| DREAMSOCKS | 424827 | Dreamsocks |
| BOX FACTORY LAB | 424828 | Box Factory Lab |
| CIUCCIAMILCALZINO | 424829 | Ciucciami il Calzino |
| ASTEROIDI STORE | 647058 | T&C FACTORY |

Se si ricollega un negozio su Sendcloud, cambia il suo ID integrazione: va aggiornato in `content.js` (lista `COPPIE`).

## Installazione

1. In Chrome apri `chrome://extensions`.
2. Attiva **Modalità sviluppatore** (in alto a destra).
3. **Carica estensione non pacchettizzata** → scegli questa cartella (`estensioni/sendcloud-mittente`).
4. Ricarica la pagina di Sendcloud.

Dopo una modifica a `content.js`: in `chrome://extensions` premi l'icona di ricarica dell'estensione, poi ricarica Sendcloud.
