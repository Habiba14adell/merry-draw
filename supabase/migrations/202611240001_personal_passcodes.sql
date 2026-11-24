begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table merry_private.passcode_keys (
  singleton boolean primary key check (singleton),
  hash_key bytea not null,
  display_key text not null
);
insert into merry_private.passcode_keys values (
  true, extensions.gen_random_bytes(32), encode(extensions.gen_random_bytes(32), 'hex')
);

-- Keep retired hashes reserved so a word previously shared cannot be issued again.
create table merry_private.passcodes (
  exchange_id uuid not null references merry_private.exchanges(id),
  participant_id uuid,
  word_hash bytea not null,
  encrypted_word bytea,
  primary key (exchange_id, word_hash),
  unique (participant_id),
  foreign key (exchange_id, participant_id)
    references merry_private.participants(exchange_id, id),
  check ((participant_id is null) = (encrypted_word is null))
);

create table merry_private.passcode_attempts (
  exchange_id uuid primary key references merry_private.exchanges(id),
  window_started timestamptz not null,
  failures integer not null check (failures between 1 and 5)
);

alter table merry_private.passcode_keys enable row level security;
alter table merry_private.passcodes enable row level security;
alter table merry_private.passcode_attempts enable row level security;
revoke all on all tables in schema merry_private from public, anon, authenticated;

create function merry_private.name_overlaps_word(p_exchange uuid, p_word text)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from merry_private.participants p
    cross join lateral regexp_split_to_table(
      regexp_replace(normalize(lower(p.name), NFKD), U&'[\0300-\036F]', '', 'g'),
      '[^a-z]+'
    ) as names(part)
    where p.exchange_id = p_exchange and (
      part = lower(p_word) or (length(part) >= 2 and strpos(lower(p_word), part) > 0)
      or (length(p_word) >= 3 and strpos(part, lower(p_word)) > 0)
    )
  )
$$;

create function merry_private.issue_passcode(p_exchange uuid, p_participant uuid)
returns void language plpgsql set search_path = '' as $$
declare
  keys merry_private.passcode_keys;
  candidate text;
  candidate_hash bytea;
begin
  select * into strict keys from merry_private.passcode_keys;

  -- Sample from a fixed list of English words independent of the roster.
  for candidate in
    select word from regexp_split_to_table(trim($words$
      ACORN AGATE ALBATROSS ALMOND AMBER ANT ANTELOPE ANVIL APRICOT AQUARIUM
      ARCH ARROW ASPEN ASTER ATLAS AURORA AVALANCHE BADGER BAMBOO BANYAN
      BARK BASALT BASIL BASKET BAT BAYOU BEACON BEAN BEAVER BEE
      BEET BEETLE BELL BERRY BIRCH BISON BLACKBIRD BLOSSOM BLUEBELL
      BOAT BOBCAT BOLT BONGO BONNET BOULDER BOWL BRAMBLE BRANCH BRASS
      BREAD BREEZE BRICK BRIDGE BROOK BROOM BUBBLE BUCKET BUFFALO
      BUTTERCUP BUTTERFLY CABIN CACTUS CANARY CANDLE CANOE CANYON CAPER
      CARPET CARROT CASCADE CASHMERE CASTLE CAT CATTAIL CAVE CEDAR CELERY
      CHALK CHESTNUT CHICKPEA CHIME CHISEL CIDER CILANTRO CINNAMON CIRRUS
      CLAM CLAY CLIFF CLOUD CLOVER COAST COBALT COCOA COCONUT COMET COMPASS
      CONCH COPPER CORAL CORD CORK COSMOS COTTON COYOTE CRAB CRANE CREEK
      CRICKET CRIMSON CRYSTAL CUP CUSHION CYPRESS DAFFODIL DAHLIA DAISY
      DAMSELFLY DANDELION DAWN DEER DELTA DESERT DEWDROP DIAMOND DILL
      DOLPHIN DONKEY DOVE DRAGONFLY DRIFTWOOD DRUM DUNE EAGLE EBONY
      ECLIPSE EEL EGGPLANT EGRET ELK ELM EMBER EMERALD ERMINE ESTUARY
      EUCALYPTUS FALCON FENNEL FERN FIDDLE FIG FINCH FIR FIREFLY FLAMINGO
      FLANNEL FLINT FLOSS FLUTE FOAM FOREST FOX FOSSIL FROND FROST
      GALAXY GARNET GECKO GEODE GERANIUM GLACIER GLOBE GLOW GLYCINE
      GNOME GOAT GOBLET GOOSE GOURD GRANITE GRAPE GRASS GUAVA GULL
      HAMMOCK HAMSTER HARBOR HARE HARVEST HAWK HAZELNUT HEDGEHOG HELMET
      HERON HIBISCUS HICKORY HIVE HOLLY HONEY HONEYSUCKLE HORIZON HUMMINGBIRD
      HYACINTH IBIS ICEBERG ICICLE IGLOO IGUANA INK IRON IVORY IVY
      JACKAL JAGUAR JASMINE JASPER JAY JUNIPER KANGAROO KELP KESTREL
      KETTLE KINGFISHER KITE KIWI KNOLL KOALA LADDER LAGOON LAMB LANTERN
      LARK LATTICE LAVA LAVENDER LEAF LEMON LEMUR LENTIL LEOPARD LICHEN
      LILAC LILY LIME LINEN LION LIZARD LLAMA LOBSTER LOCUST LOTUS LUPINE
      LYNX MACAW MAGNET MAGNOLIA MALLOW MAMMOTH MANGO MANTIS MAPLE
      MARBLE MARIGOLD MARSH MEADOW MELON MERINGUE METEOR MICA MILLET
      MINK MINT MIST MITTEN MOCKINGBIRD MOLASSES MOLE MONGOOSE MOON
      MOOSE MOSAIC MOSS MOTH MOUNTAIN MUSHROOM MUSSEL MUSTARD NARWHAL
      NEBULA NECTAR NETTLE NIGHTINGALE NUTMEG OAK OASIS OAT OBSIDIAN
      OCEAN OCTOPUS OKRA OLIVE ONION ONYX OPAL ORCHARD ORCHID ORIOLE
      ORYX OSPREY OTTER OWL OX OYSTER PALM PANDA PANSY PANTHER PAPAYA
      PARSLEY PARSNIP PARROT PARTRIDGE PASTURE PEACH PEACOCK PEAR PEBBLE
      PECAN PELICAN PENGUIN PEONY PEPPER PERCH PERIWINKLE PETAL PHEASANT
      PICKLE PIGEON PINE PISTACHIO PLATE PLUM POMEGRANATE POND POPLAR
      POPPY PORPOISE PORCUPINE POUCH PRAIRIE PRIMROSE PRISM PUFFIN PUMICE
      PUMPKIN QUAIL QUARTZ QUINCE RABBIT RACCOON RAFT RAINBOW RAINDROP
      RAVEN REDWOOD REED REEF REINDEER RHUBARB RIBBON RIPPLE RIVER
      ROCKET ROSEMARY RUG RYE SADDLE SAFFRON SANDALWOOD SANDPIPER
      SAPPHIRE SATCHEL SATIN SCALLOP SCARF SCOOTER SEAGULL SEASHELL
      SESAME SHARK SHAWL SILK SKY SLATE SLOTH SNOWDROP SNOWFLAKE
      SPARROW SPRUCE SQUASH SQUIRREL STAR STARFISH STICK STONE STOOL
      STORM STREAM SUMAC SUMMIT SUNBEAM SUNFLOWER SUNRISE SWALLOW SWAN
      TAMARIND TAPIR TEAPOT TERRACE THIMBLE THISTLE THRUSH THUNDER THYME
      TIGER TIMBER TITMOUSE TOAD TOPAZ TORCH TORTOISE TOUCAN TRAIL
      TRILLIUM TROUT TRUFFLE TULIP TUNDRA TURQUOISE TWIG VALLEY VANILLA
      VELVET VERBENA VERVAIN VIOLET VIPER VULTURE WAFFLE WALNUT WALRUS
      WASP WATERFALL WHEAT WHIRLPOOL WICK WILLOW WIND WISTERIA WOLF
      WOMBAT WOODPECKER WREN YAM YEW ZEBRA ZINNIA
    $words$, E' \n\r\t'), '[[:space:]]+') as words(word)
    where not merry_private.name_overlaps_word(p_exchange, word)
    order by gen_random_uuid()
  loop
    candidate_hash := extensions.hmac(
      convert_to(p_exchange::text || ':' || candidate, 'UTF8'), keys.hash_key, 'sha256'
    );
    if not exists (
      select 1 from merry_private.passcodes
      where exchange_id = p_exchange and word_hash = candidate_hash
    ) then
      update merry_private.passcodes set participant_id = null, encrypted_word = null
        where participant_id = p_participant;
      insert into merry_private.passcodes values (
        p_exchange, p_participant, candidate_hash,
        extensions.pgp_sym_encrypt(candidate, keys.display_key, 'cipher-algo=aes256')
      );
      return;
    end if;
  end loop;
  raise exception 'No unused passcode words are available for this roster.';
end;
$$;

create function merry_private.refresh_passcodes(p_exchange uuid)
returns void language plpgsql set search_path = '' as $$
declare
  person_id uuid;
begin
  for person_id in
    select p.id from merry_private.participants p
    left join merry_private.passcodes c on c.participant_id = p.id
    cross join merry_private.passcode_keys k
    where p.exchange_id = p_exchange and (
      c.participant_id is null or merry_private.name_overlaps_word(
        p_exchange, extensions.pgp_sym_decrypt(c.encrypted_word, k.display_key)
      )
    )
  loop
    perform merry_private.issue_passcode(p_exchange, person_id);
  end loop;
end;
$$;

-- Keep existing rosters, invitations and finalized assignments.
do $$
declare
  exchange_id uuid;
begin
  for exchange_id in select id from merry_private.exchanges for update loop
    perform merry_private.refresh_passcodes(exchange_id);
  end loop;
end;
$$;

drop function public.merry_participant(uuid, text, uuid);
alter table merry_private.participants
  drop column claim_code, drop column token_hash, drop column joined_at;

create function public.merry_participant(p_invite uuid, p_passcode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_exchange_id uuid;
  code text := upper(btrim(p_passcode) collate "C");
  now_at timestamptz;
  result jsonb;
begin
  if code is null or code collate "C" !~ '^[A-Z]{1,32}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Serialize lookups and failed attempts with roster changes and finalization.
  select e.id into target_exchange_id from merry_private.exchanges e
    where e.invite = p_invite for no key update;
  if not found then return jsonb_build_object('status', 'invalid'); end if;

  now_at := clock_timestamp();
  if exists (
    select 1 from merry_private.passcode_attempts a where a.exchange_id = target_exchange_id
      and a.window_started > now_at - interval '30 minutes' and a.failures >= 5
  ) then
    return jsonb_build_object('status', 'limited');
  end if;

  select jsonb_build_object('status', 'ok', 'name', p.name, 'recipient', r.name) into result
  from merry_private.passcodes c
  join merry_private.participants p on p.id = c.participant_id
  left join merry_private.assignments a on a.exchange_id = p.exchange_id and a.giver = p.id
  left join merry_private.participants r on r.exchange_id = a.exchange_id and r.id = a.recipient
  cross join merry_private.passcode_keys k
  where c.exchange_id = target_exchange_id and c.word_hash = extensions.hmac(
    convert_to(target_exchange_id::text || ':' || code, 'UTF8'), k.hash_key, 'sha256'
  );

  if result is not null then return result; end if;

  -- Return a status so the failed-attempt write commits along with the response.
  insert into merry_private.passcode_attempts as a values (target_exchange_id, now_at, 1)
    on conflict on constraint passcode_attempts_pkey do update set
      failures = case when a.window_started <= now_at - interval '30 minutes' then 1 else a.failures + 1 end,
      window_started = case when a.window_started <= now_at - interval '30 minutes' then now_at else a.window_started end;
  return jsonb_build_object('status', 'invalid');
end;
$$;

revoke all on function merry_private.name_overlaps_word(uuid, text),
  merry_private.issue_passcode(uuid, uuid), merry_private.refresh_passcodes(uuid),
  public.merry_participant(uuid, text) from public, anon, authenticated;
grant execute on function public.merry_participant(uuid, text) to anon, authenticated;

create or replace function public.merry_admin(p_action text, p_id uuid default null, p_data jsonb default '{}')
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
  elsif p_action in ('add', 'remove', 'regenerate', 'draw') then
    if event.drawn_at is not null then raise exception 'This draw is already final.'; end if;
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
      if participant_count < 2 then raise exception 'Add at least two participants.'; end if;
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
