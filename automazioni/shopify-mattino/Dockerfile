# Server del mattino (Railway): lo stesso script del Mac in sede. Libreria DTF e font dei nomi
# arrivano dal gestionale (--libreria-remota), i file vanno nella scheda "File del mattino".
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY mattino.py dtf.py bello.py ./
COPY fonts ./fonts
CMD ["python", "-W", "ignore", "mattino.py", "--cartella", "/data", "--applica", "--libreria-remota", "--solo-ora", "5"]
