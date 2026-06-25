/**
 * T&C Factory — Configurazione Supabase
 *
 * ✅ Già configurato con il progetto "tc-factory's Project".
 * Se in futuro cambi progetto Supabase, sostituisci questi due valori
 * (li trovi in: Project Settings → API Keys → Publishable key).
 *
 * Questa chiave è pensata per essere pubblica nel codice frontend:
 * la sicurezza è garantita dalle policy RLS impostate nel database
 * (vedi sql/setup.sql), non dalla segretezza di questa chiave.
 */

const SUPABASE_URL = 'https://gdtlpyowpbwetnovxget.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bKoXOKF4Pe6yLe1dDHEsRA_U4HUnfTW';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabaseClient;
