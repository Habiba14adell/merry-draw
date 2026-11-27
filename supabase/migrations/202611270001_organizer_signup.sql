begin;

create function merry_private.register_confirmed_organizer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into merry_private.organizers (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function merry_private.register_confirmed_organizer() from public, anon, authenticated;

create trigger merry_register_confirmed_organizer
after insert or update of email_confirmed_at on auth.users
for each row
when (
  new.email_confirmed_at is not null
  and new.raw_app_meta_data->>'provider' = 'email'
  and new.raw_user_meta_data->'merry_draw_organizer' = 'true'::jsonb
)
execute function merry_private.register_confirmed_organizer();

commit;
