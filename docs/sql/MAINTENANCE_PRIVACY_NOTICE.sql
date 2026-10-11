-- Apply after WORK_REPORT_PRIVACY_NOTICE.sql, before the maintenance notice UI release.
-- Back up the database first. This repeatable change only extends snapshot validation.
-- Version 1 snapshots remain unchanged; version 2 is a maintenance service-provider notice.
-- No backfill, customer sharing, consent grant, table policy or billing change.
begin;

create or replace function public.guard_work_report_privacy_notice()
returns trigger language plpgsql security definer
set search_path = '' set row_security = off
as $$
declare
  v_notice jsonb;
  v_controller jsonb;
  v_party jsonb;
  v_section jsonb;
  v_key text;
  v_roles text[] := array[]::text[];
  v_signed_at timestamptz;
  v_text_length integer := 0;
  v_notice_changed boolean := false;
  v_fresh_signature boolean := false;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'work_reports' then
    raise exception 'Érvénytelen adatkezelési naplóforrás.' using errcode = '42501';
  end if;

  if tg_op <> 'DELETE' then
    v_notice := new.privacy_notice;
    if tg_op = 'UPDATE' then
      -- Keep every history row in the original scope, including when another
      -- scope guard is removed inadvertently. No workspace transfer is added.
      if new.workspace_id is distinct from old.workspace_id
        or new.customer_id is distinct from old.customer_id
        or new.id is distinct from old.id then
        raise exception 'A munkalap adatkezelési hatóköre nem módosítható.' using errcode = '23514';
      end if;
      v_notice_changed := new.privacy_notice is distinct from old.privacy_notice;
      v_fresh_signature := new.signature_data_url is distinct from old.signature_data_url
        or new.signed_at is distinct from old.signed_at;
      if v_notice_changed and v_notice is not null and not v_fresh_signature then
        raise exception 'Új adatkezelési nyilatkozathoz új aláírás szükséges.' using errcode = '23514';
      end if;
      -- Omitted revocation fields on a normal save cannot undo a withdrawal.
      -- A cleared draft or a newly signed replacement starts a separate record;
      -- the former snapshot AND its withdrawal are copied to history below.
      if v_notice_changed then
        new.privacy_consent_revoked_at := null;
      end if;
    end if;

    if v_notice is null then
      if new.privacy_consent_revoked_at is not null then
        raise exception 'Visszavonás csak mentett hozzájáruláshoz rögzíthető.' using errcode = '23514';
      end if;
    else
      if jsonb_typeof(v_notice) <> 'object' or octet_length(v_notice::text) > 2200000
        or not (v_notice ?& array['version','controllers','partner','customer','sections','consentText','consentGranted','signatureDataUrl','signerName','signedAt'])
        or v_notice - array['version','controllers','partner','customer','sections','consentText','consentGranted','signatureDataUrl','signerName','signedAt'] <> '{}'::jsonb then
        raise exception 'Érvénytelen adatkezelési pillanatkép.' using errcode = '23514';
      end if;
      foreach v_key in array array['version','consentText','signatureDataUrl','signerName','signedAt'] loop
        if jsonb_typeof(v_notice -> v_key) <> 'string' or length(btrim(v_notice ->> v_key)) = 0 then
          raise exception 'Hiányos adatkezelési pillanatkép.' using errcode = '23514';
        end if;
      end loop;
      if (v_notice ->> 'version') not in ('2026-10-11.1', '2026-10-11.2') or length(v_notice ->> 'consentText') > 4000
        or length(v_notice ->> 'signerName') > 300 or length(v_notice ->> 'signedAt') > 40
        or (v_notice ->> 'signedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$'
        or length(v_notice ->> 'signatureDataUrl') > 2000000
        or (v_notice ->> 'signatureDataUrl') !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
        or jsonb_typeof(v_notice -> 'consentGranted') <> 'boolean' then
        raise exception 'Érvénytelen nyilatkozat vagy aláírás.' using errcode = '23514';
      end if;
      begin
        v_signed_at := (v_notice ->> 'signedAt')::timestamptz;
      exception when others then
        raise exception 'Érvénytelen nyilatkozati időpont.' using errcode = '23514';
      end;
      if not isfinite(v_signed_at) or new.signed_at is null
        or v_signed_at is distinct from new.signed_at::timestamptz
        or (v_notice ->> 'signatureDataUrl') is distinct from new.signature_data_url
        or (v_notice ->> 'signerName') is distinct from new.signer_name then
        raise exception 'A nyilatkozat és a munkalap aláírása nem egyezik.' using errcode = '23514';
      end if;

      if jsonb_typeof(v_notice -> 'controllers') <> 'array' then
        raise exception 'Érvénytelen adatkezelők.' using errcode = '23514';
      end if;
      if v_notice ->> 'version' = '2026-10-11.2' then
        if new.appointment_type is distinct from 'maintenance'
          or jsonb_array_length(v_notice -> 'controllers') <> 1
          or (v_notice -> 'controllers' -> 0 ->> 'role') is distinct from 'service_provider' then
          raise exception 'A karbantartási tájékoztatóhoz az adott karbantartás szolgáltatója szükséges.' using errcode = '23514';
        end if;
      elsif jsonb_array_length(v_notice -> 'controllers') <> 2 then
        raise exception 'Mindkét adatkezelő szükséges.' using errcode = '23514';
      end if;
      for v_controller in select value from jsonb_array_elements(v_notice -> 'controllers') loop
        if jsonb_typeof(v_controller) <> 'object'
          or not (v_controller ?& array['role','party'])
          or v_controller - array['role','party'] <> '{}'::jsonb
          or coalesce(v_controller ->> 'role', '') not in ('device_seller','service_provider')
          or (v_controller ->> 'role') = any(v_roles) then
          raise exception 'Érvénytelen adatkezelői szerep.' using errcode = '23514';
        end if;
        v_roles := array_append(v_roles, v_controller ->> 'role');
      end loop;
      if jsonb_typeof(v_notice -> 'partner') not in ('object', 'null')
        or ((v_notice ->> 'consentGranted')::boolean and v_notice -> 'partner' = 'null'::jsonb) then
        raise exception 'Hozzájáruláshoz megnevezett partner szükséges.' using errcode = '23514';
      end if;
      for v_party in
        select value -> 'party' from jsonb_array_elements(v_notice -> 'controllers')
        union all select v_notice -> 'partner' where v_notice -> 'partner' <> 'null'::jsonb
      loop
        if jsonb_typeof(v_party) <> 'object'
          or not (v_party ?& array['legalName','address','email','phone','taxNumber'])
          or v_party - array['legalName','address','email','phone','taxNumber'] <> '{}'::jsonb then
          raise exception 'Érvénytelen vállalkozási adatok.' using errcode = '23514';
        end if;
        foreach v_key in array array['legalName','address','email','phone','taxNumber'] loop
          if jsonb_typeof(v_party -> v_key) <> 'string'
            or length(v_party ->> v_key) > (case v_key when 'address' then 1000 when 'legalName' then 300 when 'email' then 254 else 80 end) then
            raise exception 'Érvénytelen vállalkozási adatmező.' using errcode = '23514';
          end if;
        end loop;
        if length(btrim(v_party ->> 'legalName')) = 0 or length(btrim(v_party ->> 'address')) = 0
          or (v_party ->> 'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
          raise exception 'Hiányos vállalkozási adatok.' using errcode = '23514';
        end if;
      end loop;
      v_party := v_notice -> 'customer';
      if jsonb_typeof(v_party) <> 'object' or not (v_party ?& array['name','address','phone','email'])
        or v_party - array['name','address','phone','email'] <> '{}'::jsonb then
        raise exception 'Érvénytelen ügyféladatok.' using errcode = '23514';
      end if;
      foreach v_key in array array['name','address','phone','email'] loop
        if jsonb_typeof(v_party -> v_key) <> 'string'
          or length(v_party ->> v_key) > (case v_key when 'address' then 1000 when 'name' then 300 when 'email' then 254 else 80 end) then
          raise exception 'Érvénytelen ügyféladatmező.' using errcode = '23514';
        end if;
      end loop;
      if length(btrim(v_party ->> 'name')) = 0 or length(btrim(v_party ->> 'address')) = 0 then
        raise exception 'Hiányzó ügyfélnév vagy cím.' using errcode = '23514';
      end if;
      if jsonb_typeof(v_notice -> 'sections') <> 'array' then
        raise exception 'Érvénytelen tájékoztató.' using errcode = '23514';
      end if;
      if jsonb_array_length(v_notice -> 'sections') not between 1 and 12 then
        raise exception 'Hiányos vagy túl hosszú tájékoztató.' using errcode = '23514';
      end if;
      for v_section in select value from jsonb_array_elements(v_notice -> 'sections') loop
        if jsonb_typeof(v_section) <> 'object' or not (v_section ?& array['title','text'])
          or v_section - array['title','text'] <> '{}'::jsonb
          or jsonb_typeof(v_section -> 'title') <> 'string' or jsonb_typeof(v_section -> 'text') <> 'string'
          or length(btrim(v_section ->> 'title')) not between 1 and 120
          or length(btrim(v_section ->> 'text')) not between 1 and 5000 then
          raise exception 'Érvénytelen tájékoztatószakasz.' using errcode = '23514';
        end if;
        v_text_length := v_text_length + length(v_section ->> 'text');
      end loop;
      if v_text_length > 20000 then
        raise exception 'Túl hosszú tájékoztató.' using errcode = '23514';
      end if;
      for v_key in select value #>> '{}' from jsonb_path_query(v_notice, '$.** ? (@.type() == "string")') as strings(value) loop
        if translate(v_key, chr(9) || chr(10) || chr(13), '') ~ '[[:cntrl:]]' then
          raise exception 'Érvénytelen vezérlőkarakter a nyilatkozatban.' using errcode = '23514';
        end if;
      end loop;

      if new.privacy_consent_revoked_at is not null then
        if not (v_notice ->> 'consentGranted')::boolean then
          raise exception 'Csak megadott hozzájárulás vonható vissza.' using errcode = '23514';
        end if;
        if tg_op = 'INSERT' then
          new.privacy_consent_revoked_at := now();
        elsif old.privacy_consent_revoked_at is null or v_notice_changed then
          new.privacy_consent_revoked_at := now();
        elsif new.privacy_consent_revoked_at is distinct from old.privacy_consent_revoked_at then
          raise exception 'A visszavonás időpontja nem írható át.' using errcode = '23514';
        end if;
      elsif tg_op = 'UPDATE' and old.privacy_consent_revoked_at is not null
        and not (v_notice_changed and v_fresh_signature) then
        raise exception 'Visszavont hozzájárulás csak új aláírással újítható meg.' using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    if old.privacy_notice is not null then
      insert into public.work_report_privacy_history
        (workspace_id,customer_id,work_report_id,appointment_id,privacy_notice,privacy_consent_revoked_at,operation,recorded_by)
      values (old.workspace_id,old.customer_id,old.id,old.appointment_id,old.privacy_notice,old.privacy_consent_revoked_at,'deleted',auth.uid());
    end if;
    return old;
  elsif tg_op = 'UPDATE' and old.privacy_notice is not null and
    (v_notice_changed or new.privacy_consent_revoked_at is distinct from old.privacy_consent_revoked_at) then
    insert into public.work_report_privacy_history
      (workspace_id,customer_id,work_report_id,appointment_id,privacy_notice,privacy_consent_revoked_at,operation,recorded_by)
    values (old.workspace_id,old.customer_id,old.id,old.appointment_id,old.privacy_notice,old.privacy_consent_revoked_at,
      case when new.privacy_notice is null then 'cleared' when v_notice_changed then 'replaced' else 'revoked' end,auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function public.guard_work_report_privacy_notice() from public, anon, authenticated;
commit;
