begin;

create function public.merry_delete_exchange(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  organizer uuid := auth.uid();
begin
  if not exists (select 1 from merry_private.organizers where user_id = organizer) then
    raise exception 'Organizer access required.' using errcode = '42501';
  end if;

  -- Lock the exchange before clearing records that organizer and participant calls can update.
  perform 1 from merry_private.exchanges where id = p_id and owner_id = organizer for update;
  if not found then raise exception 'Exchange not found.'; end if;

  delete from merry_private.assignments where exchange_id = p_id;
  delete from merry_private.passcodes where exchange_id = p_id;
  delete from merry_private.passcode_attempts where exchange_id = p_id;
  delete from merry_private.participants where exchange_id = p_id;
  delete from merry_private.activity where exchange_id = p_id;
  delete from merry_private.exchanges where id = p_id;
end;
$$;

revoke all on function public.merry_delete_exchange(uuid) from public, anon, authenticated;
grant execute on function public.merry_delete_exchange(uuid) to authenticated;

commit;
