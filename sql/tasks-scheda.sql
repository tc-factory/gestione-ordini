-- Tasks diventa una scheda della navbar (prima era dentro il Centro di controllo):
-- chi vedeva il Centro di controllo vede anche Tasks. Rieseguibile.
update app_users set schede = schede || '["tasks"]'::jsonb
  where jsonb_typeof(schede) = 'array' and schede ? 'controllo' and not schede ? 'tasks';
update app_roles set schede = schede || '["tasks"]'::jsonb
  where jsonb_typeof(schede) = 'array' and schede ? 'controllo' and not schede ? 'tasks';
select 'utenti' as dove, nickname, schede from app_users where schede ? 'tasks'
union all select 'ruoli', nome, schede from app_roles where schede ? 'tasks';
