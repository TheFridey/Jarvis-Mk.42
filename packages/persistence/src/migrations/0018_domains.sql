-- Additive Kernel domain ownership. Existing ambiguous records are retained in
-- each owner's SYSTEM quarantine; no business-name inference or data deletion.
create table identity.domains (
  id text primary key, principal_id text not null,
  kind text not null check(kind in ('PERSONAL','BUSINESS','PROJECT','FINANCIAL','SYSTEM')),
  name text not null, status text not null default 'active' check(status in ('active','archived')),
  version integer not null default 1, created_at timestamptz not null default clock_timestamp(),
  unique(id,principal_id)
);
create table identity.domain_selections (
  principal_id text not null, node_id text not null references nodes.registry(node_id),
  domain_id text not null, version integer not null,
  primary key(principal_id,node_id),
  foreign key(domain_id,principal_id) references identity.domains(id,principal_id)
);
create table identity.domain_bindings (
  principal_id text not null, correlation_id text not null, domain_id text not null,
  purpose text not null check(purpose in ('general','research','coding','financial','system')),
  primary key(principal_id,correlation_id),
  foreign key(domain_id,principal_id) references identity.domains(id,principal_id)
);
create table identity.domain_fusion_grants (
  id text primary key, principal_id text not null, source_domain_id text not null, target_domain_id text not null,
  purpose text not null check(purpose in ('general','research','coding','financial','system')),
  expires_at timestamptz not null, revoked_at timestamptz,
  foreign key(source_domain_id,principal_id) references identity.domains(id,principal_id),
  foreign key(target_domain_id,principal_id) references identity.domains(id,principal_id)
);
create table agency.secret_references (
  principal_id text not null, provider text not null, domain_id text not null,
  -- Only an opaque reference, never credential material.
  secret_ref text not null, primary key(principal_id,provider),
  foreign key(domain_id,principal_id) references identity.domains(id,principal_id)
);
create function identity.domain_can_read(owner text,target text,sources text[],purpose text,resource jsonb)
returns boolean language sql stable as $$
  select coalesce(resource->>'principal_id'=owner and resource->>'domain_id'=any(sources) and (
    resource->>'domain_id'=target or resource->>'privacy_class'='PUBLIC' or (
      coalesce(resource->>'privacy_class','INTERNAL')='INTERNAL' and exists(
        select 1 from identity.domains where id=resource->>'domain_id' and principal_id=owner and kind in ('PERSONAL','PROJECT','SYSTEM')
      )
    )
  ) and (purpose not in ('research','coding') or resource->>'privacy_class'='PUBLIC' or not exists(
    select 1 from identity.domains where id=resource->>'domain_id' and principal_id=owner and kind='FINANCIAL'
  )),false)
$$;

-- Credential handles previously inherited ownership only through invocation.
alter table agency.credential_grants add column principal_id text;
update agency.credential_grants c set principal_id=i.principal_id from agency.invocations i where i.invocation_id=c.invocation_id;
update agency.credential_grants set principal_id='system' where principal_id is null;
alter table agency.credential_grants alter column principal_id set not null;

create function identity.assign_resource_domain() returns trigger language plpgsql as $$
declare data jsonb:=to_jsonb(new); owner text:=data->>'principal_id'; selected text;
  correlation text:=coalesce(data->>'correlation_id',data->'provenance'->>'correlationId');
  parent_domain text; parent_owner text; parent_id text; parent_table text; parent_key text; reference text;
begin
  if tg_table_schema='agency' and tg_table_name in ('credential_grants','authority_tokens') then
    select principal_id,domain_id into owner,parent_domain from agency.invocations where invocation_id=data->>'invocation_id';
    if owner is null then raise exception 'credential invocation ownership unavailable'; end if;
    if data->>'principal_id' is not null and data->>'principal_id'<>owner then raise exception 'credential principal mismatch'; end if;
    new.principal_id:=owner;
  end if;
  if owner is null then raise exception 'resource principal required'; end if;
  insert into identity.domains(id,principal_id,kind,name) values
    (owner||':personal',owner,'PERSONAL','Personal'),(owner||':system',owner,'SYSTEM','System / unclassified legacy') on conflict(id) do nothing;
  if correlation is not null then
    select domain_id into selected from identity.domain_bindings where principal_id=owner and correlation_id=correlation;
  end if;
  if selected is not null and new.domain_id is not null and selected<>new.domain_id then raise exception 'resource correlation domain mismatch'; end if;
  selected:=coalesce(new.domain_id,selected,parent_domain,owner||case when owner='system' then ':system' else ':personal' end);
  if tg_table_schema='agency' and tg_table_name in ('credential_grants','authority_tokens') then
    select domain_id,principal_id into parent_domain,parent_owner from agency.invocations where invocation_id=data->>'invocation_id';
    if parent_domain is null or parent_domain<>selected or parent_owner<>owner then raise exception 'credential/authority domain mismatch'; end if;
  end if;
  -- Durable child resources inherit and must agree with their parent boundary.
  if tg_table_name='objectives' then parent_id:=data->>'parent_objective_id'; parent_table:='projections.objectives'; parent_key:='objective_id';
  elsif data ? 'objective_id' and tg_table_schema='cognition' then parent_id:=data->>'objective_id'; parent_table:='projections.objectives'; parent_key:='objective_id';
  elsif data ? 'objective_ref' then parent_id:=data->>'objective_ref'; parent_table:='projections.objectives'; parent_key:='objective_id';
  elsif tg_table_name in ('facts','facts_archive','conflicts') then parent_id:=data->>'subject_entity_id'; parent_table:='atlas.entities'; parent_key:='id';
  elsif tg_table_name='entity_relationships' then parent_id:=data->>'from_entity_id'; parent_table:='atlas.entities'; parent_key:='id';
  end if;
  if parent_id is not null then
    execute format('select domain_id,principal_id from %s where %I=$1',parent_table,parent_key) into parent_domain,parent_owner using parent_id;
    if parent_domain is null or parent_domain<>selected or parent_owner<>owner then raise exception 'cross-domain parent reference rejected'; end if;
  end if;
  if tg_table_name='entity_relationships' then
    select domain_id,principal_id into parent_domain,parent_owner from atlas.entities where id=data->>'to_entity_id';
    if parent_domain<>selected or parent_owner<>owner or parent_domain is null then raise exception 'cross-domain relationship rejected'; end if;
  end if;
  if tg_table_name='agent_jobs' and data->>'parent_job_id' is not null then
    select domain_id,principal_id into parent_domain,parent_owner from cognition.agent_jobs where job_id=data->>'parent_job_id';
    if parent_domain<>selected or parent_owner<>owner or parent_domain is null then raise exception 'cross-domain agent parent rejected'; end if;
  end if;
  if tg_table_name='authority_tokens' then
    select domain_id,principal_id into parent_domain,parent_owner from agency.grants where id=data->>'grant_id';
    if parent_domain is null or parent_domain<>selected or parent_owner<>owner then raise exception 'authority grant domain mismatch'; end if;
  end if;
  if tg_table_name='conversation_turns' then
    select domain_id,principal_id into parent_domain,parent_owner from experience.conversation_turns where conversation_id=data->>'conversation_id' and turn_id<>data->>'turn_id' limit 1;
    if parent_domain is not null and (parent_domain<>selected or parent_owner<>owner) then raise exception 'conversation domain mismatch'; end if;
  end if;
  if tg_table_name='objectives' then
    for reference in select jsonb_array_elements_text(coalesce(data->'dependencies','[]'::jsonb)) loop
      select domain_id,principal_id into parent_domain,parent_owner from projections.objectives where objective_id=reference;
      if parent_domain is null or parent_domain<>selected or parent_owner<>owner then raise exception 'cross-domain objective dependency rejected'; end if;
    end loop;
  end if;
  if tg_table_schema='mnemosyne' and data ? 'source_episode_ids' then
    for reference in select jsonb_array_elements_text(coalesce(data->'source_episode_ids','[]'::jsonb)) loop
      select domain_id,principal_id into parent_domain,parent_owner from mnemosyne.episodes where id=reference;
      if parent_domain is not null and (parent_domain<>selected or parent_owner<>owner) then raise exception 'cross-domain memory source rejected'; end if;
    end loop;
  end if;
  if tg_table_schema='mnemosyne' and data->>'source_event_id' is not null then
    select domain_id,principal_id into parent_domain,parent_owner from events.events where id=data->>'source_event_id' limit 1;
    if parent_domain is not null and (parent_domain<>selected or parent_owner<>owner) then raise exception 'cross-domain event source rejected'; end if;
  end if;
  new.domain_id:=selected;
  return new;
end $$;

do $$
declare target text; owner text;
begin
  foreach target in array array[
    'atlas.entities','atlas.entity_relationships','atlas.facts','atlas.facts_archive','atlas.evidence','atlas.conflicts','atlas.observations','atlas.causal_hypotheses',
    'mnemosyne.episodes','mnemosyne.semantic','mnemosyne.procedures','mnemosyne.preferences','mnemosyne.candidates','mnemosyne.consolidation_runs','mnemosyne.insights',
    'projections.objectives','cognition.runs','cognition.agent_jobs','agency.grants','agency.invocations','agency.credential_grants','agency.authority_tokens','experience.conversation_turns','events.events'] loop
    execute format('alter table %s add column domain_id text',target);
    for owner in execute format('select distinct principal_id from %s',target) loop
      insert into identity.domains(id,principal_id,kind,name) values(owner||':system',owner,'SYSTEM','System / unclassified legacy') on conflict(id) do nothing;
    end loop;
    execute format('update %s set domain_id=principal_id||'':system''',target);
    execute format('alter table %s alter column domain_id set not null',target);
    execute format('alter table %s add constraint resource_domain_owner foreign key(domain_id,principal_id) references identity.domains(id,principal_id)',target);
    execute format('create index on %s(principal_id,domain_id)',target);
    execute format('create trigger assign_domain before insert or update on %s for each row execute function identity.assign_resource_domain()',target);
  end loop;
end $$;

-- Same key/name can exist independently in unrelated domains.
alter table mnemosyne.procedures drop constraint procedures_principal_id_name_key;
alter table mnemosyne.procedures add unique(principal_id,domain_id,name);
alter table mnemosyne.preferences drop constraint preferences_principal_id_key_key;
alter table mnemosyne.preferences add unique(principal_id,domain_id,key);
