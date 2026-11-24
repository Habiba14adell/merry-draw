begin;

-- Apply the new rule to future draws and organizer-initiated reassignments.
create or replace function public.merry_admin(p_action text, p_id uuid default null, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  organizer uuid := auth.uid();
  event merry_private.exchanges;
  person merry_private.participants;
  givers uuid[];
  recipients uuid[];
  previous_recipients uuid[];
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
  elsif p_action in ('add', 'remove', 'regenerate', 'draw', 'reassign') then
    if p_action = 'reassign' then
      if event.drawn_at is null then raise exception 'Generate the draw before reassigning it.'; end if;
    elsif event.drawn_at is not null then
      raise exception 'This draw is already final.';
    end if;
    if p_action = 'add' then
      insert into merry_private.participants(exchange_id, name) values (event.id, trim(p_data->>'name'))
        returning * into person;
      perform merry_private.refresh_passcodes(event.id);
      insert into merry_private.activity(exchange_id, action, subject)
        values (event.id, 'Participant added', person.name);
    elsif p_action = 'remove' then
      update merry_private.passcodes set participant_id = null, encrypted_word = null
        where exchange_id = event.id and participant_id = (p_data->>'participant_id')::uuid;
      delete from merry_private.participants where exchange_id = event.id
        and id = (p_data->>'participant_id')::uuid returning * into person;
      if not found then raise exception 'Participant not found.'; end if;
      insert into merry_private.activity(exchange_id, action, subject)
        values (event.id, 'Participant removed', person.name);
    elsif p_action = 'regenerate' then
      select * into person from merry_private.participants
        where exchange_id = event.id and id = (p_data->>'participant_id')::uuid;
      if not found then raise exception 'Participant not found.'; end if;
      perform merry_private.issue_passcode(event.id, person.id);
    else
      select array_agg(id order by id), count(*) into givers, participant_count
        from merry_private.participants where exchange_id = event.id;
      if participant_count < 3 then raise exception 'Add at least three participants.'; end if;
      if p_action = 'reassign' then
        select array_agg(a.recipient order by a.giver) into previous_recipients
          from merry_private.assignments a where a.exchange_id = event.id;
      end if;
      loop
        select array_agg(id order by gen_random_uuid()) into recipients from unnest(givers) as ids(id);
        -- A reverse pair also catches self-matches, where the pair reverses to itself.
        exit when recipients is distinct from previous_recipients and not exists (
          select 1 from unnest(givers, recipients) pairs(giver, recipient)
          join unnest(givers, recipients) reverse_pairs(giver, recipient)
            on reverse_pairs.giver = pairs.recipient and reverse_pairs.recipient = pairs.giver
        );
      end loop;
      if p_action = 'reassign' then
        delete from merry_private.assignments where exchange_id = event.id;
      end if;
      insert into merry_private.assignments(exchange_id, giver, recipient)
        select event.id, giver, recipient from unnest(givers, recipients) pairs(giver, recipient);
      update merry_private.exchanges set drawn_at = clock_timestamp() where id = event.id;
      insert into merry_private.activity(exchange_id, action) values (
        event.id, case when p_action = 'reassign' then 'Draw reassigned' else 'Draw finalized' end
      );
    end if;
  elsif p_action <> 'details' or p_action is null then
    raise exception 'Unknown organizer action.';
  end if;

  return jsonb_build_object(
    'exchange', (select to_jsonb(e) - 'owner_id' from merry_private.exchanges e where id = event.id),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
      'passcode', extensions.pgp_sym_decrypt(c.encrypted_word, k.display_key)) order by lower(p.name))
      from merry_private.participants p join merry_private.passcodes c on c.participant_id = p.id
      cross join merry_private.passcode_keys k where p.exchange_id = event.id), '[]'),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('giver', g.name, 'recipient', r.name) order by lower(g.name))
      from merry_private.assignments a join merry_private.participants g on a.giver = g.id
      join merry_private.participants r on a.recipient = r.id where a.exchange_id = event.id), '[]'),
    'activity', coalesce((select jsonb_agg(to_jsonb(l) - 'exchange_id' - 'id' order by id desc)
      from merry_private.activity l where exchange_id = event.id), '[]'));
end;
$$;

commit;
