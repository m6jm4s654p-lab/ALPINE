-- Independent from SAJ/player data and device-stats. Execute once as postgres.
begin;
create table public.rare_card_types (
  id text primary key check (id ~ '^rare_[0-9]{3}$'),
  name text not null,
  image_url text check (image_url is null or image_url ~ '^https://'),
  active boolean not null default true
);
insert into public.rare_card_types (id,name) values
 ('rare_001','Mikaela Shiffrin'),('rare_002','Lindsey Vonn'),
 ('rare_003','Marcel Hirscher'),('rare_004','Aleksander Aamodt Kilde'),
 ('rare_005','Petra Vlhová'),('rare_006','Lara Gut-Behrami'),
 ('rare_007','Federica Brignone'),('rare_008','Marco Odermatt'),
 ('rare_009','Henrik Kristoffersen'),('rare_010','Sofia Goggia');
create table public.rare_card_instances (
  id uuid primary key default gen_random_uuid(),
  card_type_id text not null references public.rare_card_types(id),
  owner_user_id uuid not null references auth.users(id),
  acquired_at timestamptz not null default now(),
  acquisition_type text not null default 'lottery' check (acquisition_type = 'lottery')
);
create index rare_instances_owner on public.rare_card_instances(owner_user_id);
create table public.daily_rare_draws (
  user_id uuid not null references auth.users(id),
  date_jst date not null,
  draw_count integer not null default 0 check (draw_count between 0 and 5),
  primary key(user_id,date_jst)
);
-- A launch UUID is retained across network retries, even across JST midnight.
create table public.rare_draw_requests (
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  result jsonb not null,
  primary key(user_id,request_id)
);
create table public.rare_card_exchanges (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  issuer_user_id uuid not null references auth.users(id),
  offered_card_instance_id uuid not null references public.rare_card_instances(id),
  status text not null default 'active' check (status in ('active','used','cancelled','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 minutes'),
  used_at timestamptz,
  recipient_user_id uuid references auth.users(id),
  check ((status='used') = (used_at is not null and recipient_user_id is not null))
);
create unique index rare_one_active_exchange on public.rare_card_exchanges(offered_card_instance_id) where status='active';
create index rare_exchanges_issuer on public.rare_card_exchanges(issuer_user_id);
-- All access goes through verified Edge Function + service_role-only RPCs.
alter table public.rare_card_types enable row level security;
alter table public.rare_card_instances enable row level security;
alter table public.daily_rare_draws enable row level security;
alter table public.rare_draw_requests enable row level security;
alter table public.rare_card_exchanges enable row level security;
revoke all on public.rare_card_types,public.rare_card_instances,public.daily_rare_draws,public.rare_draw_requests,public.rare_card_exchanges from public,anon,authenticated;

-- gen_random_uuid uses PostgreSQL's cryptographic generator. Rejection sampling
-- of its first 32 random bits gives an unbiased value in [0, n), unlike random().
create function public.rare_random_below(p_n integer) returns integer
language plpgsql volatile set search_path = '' as $$
declare v bigint; limit_value bigint;
begin
 if p_n is null or p_n<1 then raise exception 'invalid bound'; end if;
 limit_value := 4294967296 - (4294967296 % p_n);
 loop
  v := ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint;
  if v<limit_value then return (v%p_n)::integer; end if;
 end loop;
end $$;

create function public.rare_card_json(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
 select jsonb_build_object('instanceId',i.id,'typeId',i.card_type_id,'name',t.name,
   'imageUrl',t.image_url,'acquiredAt',i.acquired_at,'acquisitionType',i.acquisition_type)
 from public.rare_card_instances i join public.rare_card_types t on t.id=i.card_type_id where i.id=p_id
$$;

create function public.rare_draw(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date; count_today integer; prior jsonb; chosen text;
 card_id uuid; result_value jsonb; types text[]; won boolean := false;
begin
 if p_user_id is null or p_request_id is null then raise exception 'invalid request'; end if;
 -- Serialize requests for this account. Hash collisions only serialize extra users.
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 today := (clock_timestamp() at time zone 'Asia/Tokyo')::date;
 select result into prior from public.rare_draw_requests where user_id=p_user_id and request_id=p_request_id;
 if found then return prior || jsonb_build_object('replayed',true); end if;
 insert into public.daily_rare_draws(user_id,date_jst) values(p_user_id,today) on conflict do nothing;
 select draw_count into count_today from public.daily_rare_draws where user_id=p_user_id and date_jst=today for update;
 if count_today>=5 then
  result_value:=jsonb_build_object('drawExecuted',false,'drawCountToday',5,'remainingToday',0,'dateJst',today,'won',false);
  insert into public.rare_draw_requests(user_id,request_id,result) values(p_user_id,p_request_id,result_value);
  return result_value;
 end if;
 select array_agg(id order by id) into types from public.rare_card_types where active;
 if coalesce(array_length(types,1),0)=0 then raise exception 'no active cards'; end if;
 count_today:=count_today+1;
 update public.daily_rare_draws set draw_count=count_today where user_id=p_user_id and date_jst=today;
 won:=public.rare_random_below(200)=0;
 if won then
  chosen:=types[public.rare_random_below(array_length(types,1))+1];
  insert into public.rare_card_instances(card_type_id,owner_user_id) values(chosen,p_user_id) returning id into card_id;
 end if;
 result_value:=jsonb_build_object('drawExecuted',true,'drawCountToday',count_today,'remainingToday',5-count_today,
   'dateJst',today,'won',won,'card',public.rare_card_json(card_id));
 insert into public.rare_draw_requests(user_id,request_id,result) values(p_user_id,p_request_id,result_value);
 return result_value;
end $$;

create function public.rare_collection(p_user_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
 select jsonb_build_object(
  'dateJst',(clock_timestamp() at time zone 'Asia/Tokyo')::date,
  'drawCountToday',coalesce((select draw_count from public.daily_rare_draws where user_id=p_user_id and date_jst=(clock_timestamp() at time zone 'Asia/Tokyo')::date),0),
  'types',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'imageUrl',image_url,'active',active) order by id) from public.rare_card_types),'[]'::jsonb),
  'instances',coalesce((select jsonb_agg(public.rare_card_json(i.id)||jsonb_build_object('exchange',
    (select jsonb_build_object('id',e.id,'expiresAt',e.expires_at) from public.rare_card_exchanges e where e.offered_card_instance_id=i.id and e.status='active' and e.expires_at>clock_timestamp())) order by i.acquired_at,i.id)
    from public.rare_card_instances i where i.owner_user_id=p_user_id),'[]'::jsonb))
$$;

create function public.rare_exchange_create(p_user_id uuid,p_card_instance_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; code_value text; ex public.rare_card_exchanges;
begin
 -- Every exchange operation locks card BEFORE exchange, avoiding lock inversions.
 select owner_user_id into owner_id from public.rare_card_instances where id=p_card_instance_id for update;
 if not found or owner_id<>p_user_id or p_user_id is null then return jsonb_build_object('error','not_owner'); end if;
 update public.rare_card_exchanges set status=case when expires_at<=clock_timestamp() then 'expired' else 'cancelled' end
  where offered_card_instance_id=p_card_instance_id and status='active';
 code_value:='RC1-'||upper(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''));
 insert into public.rare_card_exchanges(code_hash,issuer_user_id,offered_card_instance_id)
  values(encode(sha256(convert_to(code_value,'UTF8')),'hex'),p_user_id,p_card_instance_id) returning * into ex;
 return jsonb_build_object('exchangeId',ex.id,'code',code_value,'expiresAt',ex.expires_at);
end $$;

create function public.rare_exchange_cancel(p_user_id uuid,p_exchange_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare card_id uuid; ex public.rare_card_exchanges;
begin
 select offered_card_instance_id into card_id from public.rare_card_exchanges where id=p_exchange_id;
 if not found then return jsonb_build_object('error','invalid_exchange'); end if;
 perform 1 from public.rare_card_instances where id=card_id for update;
 select * into ex from public.rare_card_exchanges where id=p_exchange_id for update;
 if ex.issuer_user_id<>p_user_id or p_user_id is null then return jsonb_build_object('error','not_owner'); end if;
 if ex.status<>'active' then return jsonb_build_object('error','invalid_exchange'); end if;
 update public.rare_card_exchanges set status='cancelled' where id=ex.id;
 return jsonb_build_object('ok',true);
end $$;

create function public.rare_exchange_redeem(p_user_id uuid,p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ex_id uuid; card_id uuid; owner_id uuid; ex public.rare_card_exchanges;
begin
 if p_user_id is null or p_code is null or p_code !~ '^RC1-[0-9A-F]{64}$' then return jsonb_build_object('error','invalid_exchange'); end if;
 select id,offered_card_instance_id into ex_id,card_id from public.rare_card_exchanges where code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex');
 if not found then return jsonb_build_object('error','invalid_exchange'); end if;
 select owner_user_id into owner_id from public.rare_card_instances where id=card_id for update;
 select * into ex from public.rare_card_exchanges where id=ex_id for update;
 -- A retry by the successful recipient returns a receipt, never another transfer.
 if ex.status='used' and ex.recipient_user_id=p_user_id and owner_id=p_user_id then return jsonb_build_object('ok',true,'alreadyRedeemed',true); end if;
 if ex.status<>'active' then return jsonb_build_object('error','invalid_exchange'); end if;
 if ex.expires_at<=clock_timestamp() then
  update public.rare_card_exchanges set status='expired' where id=ex.id;
  return jsonb_build_object('error','expired_exchange');
 end if;
 if ex.issuer_user_id=p_user_id then return jsonb_build_object('error','self_exchange'); end if;
 if owner_id is null or owner_id<>ex.issuer_user_id then return jsonb_build_object('error','invalid_exchange'); end if;
 update public.rare_card_instances set owner_user_id=p_user_id where id=card_id;
 update public.rare_card_exchanges set status='used',used_at=clock_timestamp(),recipient_user_id=p_user_id where id=ex.id;
 return jsonb_build_object('ok',true,'card',public.rare_card_json(card_id));
end $$;

revoke all on function public.rare_random_below(integer),public.rare_card_json(uuid),public.rare_draw(uuid,uuid),public.rare_collection(uuid),public.rare_exchange_create(uuid,uuid),public.rare_exchange_cancel(uuid,uuid),public.rare_exchange_redeem(uuid,text) from public,anon,authenticated;
grant execute on function public.rare_draw(uuid,uuid),public.rare_collection(uuid),public.rare_exchange_create(uuid,uuid),public.rare_exchange_cancel(uuid,uuid),public.rare_exchange_redeem(uuid,text) to service_role;
commit;
