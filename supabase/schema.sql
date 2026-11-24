begin;

create schema merry_private;
revoke all on schema merry_private from public, anon, authenticated;

create table merry_private.organizers (
  user_id uuid primary key references auth.users(id)
);
create table merry_private.exchanges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references merry_private.organizers(user_id),
  title text not null check (char_length(title) between 1 and 100),
  event_date date not null,
  budget text not null check (char_length(budget) <= 100),
  details text not null check (char_length(details) <= 1500),
  invite uuid not null unique default gen_random_uuid(),
  drawn_at timestamptz
);
create table merry_private.participants (
  id uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references merry_private.exchanges(id),
  name text not null check (char_length(name) between 1 and 100),
  claim_code uuid not null unique default gen_random_uuid(),
  token_hash bytea,
  joined_at timestamptz,
  unique (exchange_id, id),
  check ((joined_at is null) = (token_hash is null))
);
create unique index participants_unique_name on merry_private.participants (exchange_id, lower(name));
create table merry_private.assignments (
  exchange_id uuid not null,
  giver uuid not null,
  recipient uuid not null,
  primary key (exchange_id, giver),
  unique (exchange_id, recipient),
  foreign key (exchange_id, giver) references merry_private.participants(exchange_id, id),
  foreign key (exchange_id, recipient) references merry_private.participants(exchange_id, id),
  check (giver <> recipient)
);
create table merry_private.activity (
  id bigint generated always as identity primary key,
  exchange_id uuid not null references merry_private.exchanges(id),
  action text not null,
  subject text,
  occurred_at timestamptz not null default clock_timestamp()
);
alter table merry_private.organizers enable row level security;
alter table merry_private.exchanges enable row level security;
alter table merry_private.participants enable row level security;
alter table merry_private.assignments enable row level security;
alter table merry_private.activity enable row level security;

create function public.merry_event(p_invite uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('title', title, 'event_date', event_date, 'budget', budget,
    'details', details, 'drawn_at', drawn_at)
  from merry_private.exchanges where invite = p_invite
$$;

create function public.merry_participant(p_invite uuid, p_token text, p_code uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event merry_private.exchanges;
  person merry_private.participants;
  token_digest bytea;
  recipient_name text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid private access key.';
  end if;
  token_digest := sha256(convert_to(p_token, 'UTF8'));
  select * into event from merry_private.exchanges where invite = p_invite for update;
  if not found then raise exception 'Invitation not found.'; end if;

  if p_code is not null then
    select * into person from merry_private.participants
      where exchange_id = event.id and claim_code = p_code;
    if not found or (person.joined_at is not null and person.token_hash <> token_digest) then
      raise exception 'This joining code is invalid or has already been used.';
    end if;
    if person.joined_at is null then
      update merry_private.participants set token_hash = token_digest, joined_at = clock_timestamp()
        where id = person.id;
      insert into merry_private.activity(exchange_id, action, subject)
        values (event.id, 'Participant joined', person.name);
    end if;
  else
    select * into person from merry_private.participants
      where exchange_id = event.id and token_hash = token_digest;
    if not found then raise exception 'Private access key not recognized for this exchange.'; end if;
  end if;

  select p.name into recipient_name from merry_private.assignments a
    join merry_private.participants p on p.id = a.recipient
    where a.exchange_id = event.id and a.giver = person.id;
  return jsonb_build_object('name', person.name, 'recipient', recipient_name);
end;
$$;

create unique index participants_unique_token on merry_private.participants(exchange_id, token_hash);

create function public.merry_admin(p_action text, p_id uuid default null, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  organizer uuid := auth.uid();
  event merry_private.exchanges;
  person merry_private.participants;
  givers uuid[];
  recipients uuid[];
  participant_count integer;
begin
  if organizer is null or not exists (
    select 1 from merry_private.organizers where user_id = organizer
  ) then raise exception 'Organizer access required.' using errcode = '42501'; end if;

  if p_action = 'list' then
    return coalesce((select jsonb_agg(to_jsonb(e) - 'owner_id' order by e.event_date desc, e.id)
      from merry_private.exchanges e where e.owner_id = organizer), '[]');
  elsif p_action = 'create' then
    insert into merry_private.exchanges(owner_id, title, event_date, budget, details)
      values (organizer, trim(p_data->>'title'), (p_data->>'event_date')::date,
        coalesce(p_data->>'budget', ''), coalesce(p_data->>'details', ''))
      returning * into event;
    insert into merry_private.activity(exchange_id, action) values (event.id, 'Exchange created');
    return to_jsonb(event) - 'owner_id';
  end if;

  select * into event from merry_private.exchanges
    where id = p_id and owner_id = organizer for update;
  if not found then raise exception 'Exchange not found.'; end if;

  if p_action = 'update' then
    update merry_private.exchanges set title = trim(p_data->>'title'),
      event_date = (p_data->>'event_date')::date,
      budget = coalesce(p_data->>'budget', ''), details = coalesce(p_data->>'details', '')
      where id = event.id;
    insert into merry_private.activity(exchange_id, action) values (event.id, 'Exchange details updated');
  elsif p_action in ('add', 'remove', 'draw') then
    if event.drawn_at is not null then raise exception 'This draw is already final.'; end if;
    if p_action = 'add' then
      insert into merry_private.participants(exchange_id, name) values (event.id, trim(p_data->>'name'))
        returning * into person;
      insert into merry_private.activity(exchange_id, action, subject)
        values (event.id, 'Participant added', person.name);
    elsif p_action = 'remove' then
      delete from merry_private.participants where exchange_id = event.id
        and id = (p_data->>'participant_id')::uuid returning * into person;
      if not found then raise exception 'Participant not found.'; end if;
      insert into merry_private.activity(exchange_id, action, subject)
        values (event.id, 'Participant removed', person.name);
    else
      select array_agg(id order by id), count(*) into givers, participant_count
        from merry_private.participants where exchange_id = event.id;
      if participant_count < 2 then raise exception 'Add at least two participants.'; end if;
      if exists (select 1 from merry_private.participants where exchange_id = event.id and joined_at is null)
        then raise exception 'Everyone must join before the draw.'; end if;
      loop
        select array_agg(id order by gen_random_uuid()) into recipients from unnest(givers) as ids(id);
        exit when not exists (select 1 from generate_subscripts(givers, 1) i
          where givers[i] = recipients[i]);
      end loop;
      insert into merry_private.assignments(exchange_id, giver, recipient)
        select event.id, giver, recipient from unnest(givers, recipients) pairs(giver, recipient);
      update merry_private.exchanges set drawn_at = clock_timestamp() where id = event.id;
      insert into merry_private.activity(exchange_id, action) values (event.id, 'Draw finalized');
    end if;
  elsif p_action <> 'details' or p_action is null then
    raise exception 'Unknown organizer action.';
  end if;

  return jsonb_build_object(
    'exchange', (select to_jsonb(e) - 'owner_id' from merry_private.exchanges e where id = event.id),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name,
      'joined_at', joined_at, 'claim_code', case when joined_at is null then claim_code end) order by lower(name))
      from merry_private.participants where exchange_id = event.id), '[]'),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('giver', g.name, 'recipient', r.name) order by lower(g.name))
      from merry_private.assignments a join merry_private.participants g on a.giver = g.id
      join merry_private.participants r on a.recipient = r.id where a.exchange_id = event.id), '[]'),
    'activity', coalesce((select jsonb_agg(to_jsonb(l) - 'exchange_id' - 'id' order by id desc)
      from merry_private.activity l where exchange_id = event.id), '[]'));
end;
$$;

revoke all on function public.merry_event(uuid), public.merry_participant(uuid,text,uuid),
  public.merry_admin(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.merry_event(uuid), public.merry_participant(uuid,text,uuid)
  to anon, authenticated;
grant execute on function public.merry_admin(text,uuid,jsonb) to authenticated;

commit;
