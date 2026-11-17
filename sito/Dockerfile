# Sito Creative System (cs.pngs.it) su Railway: solo i file del sito, niente sql/, automazioni/, supabase/.
# Si costruisce dalla radice del repository (servizio "sito" del progetto Railway creative-system).
FROM caddy:2.8.4-alpine
COPY sito/Caddyfile /etc/caddy/Caddyfile
COPY index.html dashboard.html privacy.html cliente-dtf.html /srv/
COPY css /srv/css
COPY js /srv/js
COPY img /srv/img
