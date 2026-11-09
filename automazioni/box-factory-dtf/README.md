# Libreria DTF di Box Factory Lab

`libreria.py` rifà le grafiche delle t-shirt partendo dagli originali, che non vengono toccati.
Dal NAS sono copiati in `Creative System/Box Factory Lab DTF/originali`.

Per ogni file:
- tiene una copia sola: molti originali sono fogli con 2 o 3 copie affiancate;
- converte in CMYK Coated FOGRA39 (gli RGB con il loro profilo, sRGB se manca);
- porta i neri a 0/0/0/100;
- toglie lo SPOT, che diventa trasparenza: lo spot si rifà nel foglio, ridotto di 1 px;
- ritaglia la grafica ai suoi bordi.

```
python libreria.py "/Users/Shared/Creative System/Box Factory Lab DTF/originali" "/Users/Shared/Creative System/Box Factory Lab DTF/grafiche"
```

Scrive anche `grafiche/libreria.csv` con misure, dpi e note. `provini-grafiche.pdf` mette a confronto originale e nuovo.

Nella cartella `Box Factory Lab DTF`:
- `mappa-prodotti.csv`: nome della grafica nel titolo del prodotto ("T-shirt Uomo - **Batman**") → file per le t-shirt chiare e per quelle scure. Si modifica a mano. Le righe con `da_verificare` compaiono nella checklist del mattino.
- `bandiere/`: le PNG di Live Printing, con i nomi in `bandiere.csv`.

I fogli li crea ogni mattina `shopify-mattino/dtf.py`.
