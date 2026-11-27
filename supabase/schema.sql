-- =====================================================================
-- Confraternização — banco de dados (Supabase / PostgreSQL)
--
-- Como usar: no painel do Supabase, abra "SQL Editor", cole este
-- arquivo inteiro e clique em "Run". Pode rodar de novo sem perder dados.
--
-- Tudo tem o prefixo "confra_" (e a pasta de fotos é "confra-fotos") para
-- poder conviver com outras tabelas no mesmo projeto do Supabase.
--
-- Segurança: o site usa a chave pública (anon). Ninguém grava direto nas
-- tabelas; toda gravação passa pelas funções abaixo, que conferem se a
-- votação/inscrição está aberta e, no caso do painel, a senha de admin.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.confra_config (
  chave text primary key,
  valor text not null default ''
);

create table if not exists public.confra_admin_segredo (
  id int primary key default 1 check (id = 1),
  senha_hash text not null
);

create table if not exists public.confra_programacao (
  id uuid primary key default gen_random_uuid(),
  hora text not null check (char_length(hora) between 1 and 10),
  fim text check (char_length(fim) <= 10),
  titulo text not null check (char_length(titulo) between 1 and 120),
  descricao text check (char_length(descricao) <= 400),
  ordem int not null default 0
);

create table if not exists public.confra_participantes (
  id uuid primary key default gen_random_uuid(),
  categoria text not null check (categoria in ('fantasia', 'talento')),
  nome text not null check (char_length(nome) between 2 and 80),
  setor text check (char_length(setor) <= 60),
  titulo text check (char_length(titulo) <= 100),   -- fantasia: qual a fantasia / talento: nome da apresentação
  tipo text check (char_length(tipo) <= 40),        -- talento: Música, Dança...
  descricao text check (char_length(descricao) <= 400),
  foto_url text check (char_length(foto_url) <= 500),
  criado_em timestamptz not null default now()
);

-- Chave secreta de cada inscrição (só o celular que inscreveu tem a chave e pode editar).
create table if not exists public.confra_participantes_chave (
  participante_id uuid primary key references public.confra_participantes(id) on delete cascade,
  chave_hash text not null
);

-- Notas de 1 a 5. Trava por aparelho: 1 nota por aparelho para cada candidato
-- (o aparelho pode trocar a nota enquanto a votação estiver aberta).
create table if not exists public.confra_notas (
  id bigint generated always as identity primary key,
  categoria text not null check (categoria in ('fantasia', 'talento')),
  participante_id uuid not null references public.confra_participantes(id) on delete cascade,
  eleitor text not null check (char_length(eleitor) between 8 and 64),
  nota smallint not null check (nota between 1 and 5),
  criado_em timestamptz not null default now(),
  unique (participante_id, eleitor)
);

create index if not exists confra_notas_categoria_eleitor_idx on public.confra_notas (categoria, eleitor);

-- ---------------------------------------------------------------------
-- Acesso: leitura pública de programação, configuração e participantes.
-- Notas, chaves e senha: nenhum acesso direto (sem política = bloqueado).
-- ---------------------------------------------------------------------
alter table public.confra_config        enable row level security;
alter table public.confra_admin_segredo enable row level security;
alter table public.confra_programacao   enable row level security;
alter table public.confra_participantes enable row level security;
alter table public.confra_notas         enable row level security;
alter table public.confra_participantes_chave enable row level security;

drop policy if exists "leitura publica" on public.confra_config;
create policy "leitura publica" on public.confra_config for select to anon, authenticated using (true);

drop policy if exists "leitura publica" on public.confra_programacao;
create policy "leitura publica" on public.confra_programacao for select to anon, authenticated using (true);

drop policy if exists "leitura publica" on public.confra_participantes;
create policy "leitura publica" on public.confra_participantes for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- Funções internas
-- ---------------------------------------------------------------------
create or replace function public._confra_cfg(p_chave text)
returns text language sql stable security definer set search_path = public as $$
  select valor from public.confra_config where chave = p_chave
$$;

create or replace function public._confra_admin_ok(p_senha text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select p_senha is not null and exists (
    select 1 from public.confra_admin_segredo s
    where s.senha_hash = extensions.crypt(p_senha, s.senha_hash)
  )
$$;

create or replace function public._confra_exigir_admin(p_senha text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._confra_admin_ok(p_senha) then
    perform pg_sleep(1);
    raise exception 'Senha de administrador incorreta.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Funções públicas (usadas pelo site)
-- ---------------------------------------------------------------------
create or replace function public.confra_avaliar(p_categoria text, p_participante uuid, p_eleitor text, p_nota int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_categoria not in ('fantasia', 'talento') then
    raise exception 'Categoria inválida.';
  end if;
  if coalesce(public._confra_cfg('votacao_' || p_categoria), 'nao') <> 'sim' then
    raise exception 'A votação está fechada no momento.';
  end if;
  if p_nota is null or p_nota < 1 or p_nota > 5 then
    raise exception 'Escolha uma nota de 1 a 5.';
  end if;
  if p_eleitor is null or char_length(p_eleitor) not between 8 and 64 then
    raise exception 'Não foi possível identificar este aparelho. Recarregue a página.';
  end if;
  if not exists (select 1 from public.confra_participantes where id = p_participante and categoria = p_categoria) then
    raise exception 'Esse participante não está mais na lista. Atualize a página.';
  end if;

  insert into public.confra_notas (categoria, participante_id, eleitor, nota)
  values (p_categoria, p_participante, p_eleitor, p_nota)
  on conflict (participante_id, eleitor)
  do update set nota = excluded.nota, criado_em = now();
end $$;

create or replace function public.confra_minhas_notas(p_categoria text, p_eleitor text)
returns table (participante_id uuid, nota smallint)
language sql stable security definer set search_path = public as $$
  select n.participante_id, n.nota from public.confra_notas n
  where n.categoria = p_categoria and n.eleitor = p_eleitor
$$;

create or replace function public.confra_inscrever(
  p_categoria text,
  p_nome text,
  p_setor text default null,
  p_titulo text default null,
  p_tipo text default null,
  p_descricao text default null,
  p_foto_url text default null,
  p_chave text default null
)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  if p_categoria not in ('fantasia', 'talento') then
    raise exception 'Categoria inválida.';
  end if;
  if coalesce(public._confra_cfg('inscricoes_' || p_categoria), 'nao') <> 'sim' then
    raise exception 'As inscrições estão fechadas.';
  end if;
  if char_length(trim(coalesce(p_nome, ''))) < 2 then
    raise exception 'Informe o nome.';
  end if;
  if char_length(trim(coalesce(p_titulo, ''))) < 2 then
    raise exception 'Conte qual é a fantasia ou a apresentação.';
  end if;
  if p_foto_url is not null and position('/storage/v1/object/public/confra-fotos/' in p_foto_url) = 0 then
    raise exception 'Foto inválida.';
  end if;
  if p_categoria = 'fantasia' and p_foto_url is null then
    raise exception 'Coloque uma foto da sua fantasia.';
  end if;
  -- trava simples contra cadastro em massa
  if (select count(*) from public.confra_participantes where criado_em > now() - interval '1 minute') >= 30 then
    raise exception 'Muitas inscrições ao mesmo tempo. Tente de novo em 1 minuto.';
  end if;

  insert into public.confra_participantes (categoria, nome, setor, titulo, tipo, descricao, foto_url)
  values (
    p_categoria,
    trim(p_nome),
    nullif(trim(p_setor), ''),
    nullif(trim(p_titulo), ''),
    nullif(trim(p_tipo), ''),
    nullif(trim(p_descricao), ''),
    p_foto_url
  )
  returning id into v_id;

  if p_chave is not null and char_length(p_chave) between 16 and 64 then
    insert into public.confra_participantes_chave (participante_id, chave_hash)
    values (v_id, extensions.crypt(p_chave, extensions.gen_salt('bf')));
  end if;
  return v_id;
end $$;

create or replace function public.confra_editar_inscricao(
  p_id uuid,
  p_chave text,
  p_nome text,
  p_setor text default null,
  p_titulo text default null,
  p_tipo text default null,
  p_descricao text default null,
  p_foto_url text default null,
  p_foto_acao text default 'manter'   -- 'manter' | 'trocar' | 'remover'
)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (
    select 1 from public.confra_participantes_chave c
    where c.participante_id = p_id and c.chave_hash = extensions.crypt(coalesce(p_chave, ''), c.chave_hash)
  ) then
    perform pg_sleep(1);
    raise exception 'Essa inscrição só pode ser editada no celular em que foi feita.';
  end if;
  if char_length(trim(coalesce(p_nome, ''))) < 2 then
    raise exception 'Informe o nome.';
  end if;
  if char_length(trim(coalesce(p_titulo, ''))) < 2 then
    raise exception 'Conte qual é a fantasia ou a apresentação.';
  end if;
  if p_foto_acao = 'trocar' and (p_foto_url is null or position('/storage/v1/object/public/confra-fotos/' in p_foto_url) = 0) then
    raise exception 'Foto inválida.';
  end if;
  -- Fantasia: a foto é obrigatória (pode trocar, não pode ficar sem).
  if exists (
    select 1 from public.confra_participantes
    where id = p_id and categoria = 'fantasia'
      and (case p_foto_acao when 'trocar' then p_foto_url when 'remover' then null else foto_url end) is null
  ) then
    raise exception 'A foto da fantasia é obrigatória. Troque a foto em vez de remover.';
  end if;

  update public.confra_participantes set
    nome = trim(p_nome),
    setor = nullif(trim(p_setor), ''),
    titulo = nullif(trim(p_titulo), ''),
    tipo = nullif(trim(p_tipo), ''),
    descricao = nullif(trim(p_descricao), ''),
    foto_url = case p_foto_acao when 'trocar' then p_foto_url when 'remover' then null else foto_url end
  where id = p_id;
  if not found then
    raise exception 'Essa inscrição não existe mais (pode ter sido removida pela organização).';
  end if;
end $$;

create or replace function public.confra_resultados(p_senha text default null)
returns table (categoria text, participante_id uuid, nome text, titulo text, media numeric, qtd bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public._confra_admin_ok(p_senha) or coalesce(public._confra_cfg('resultados_publicos'), 'nao') = 'sim') then
    raise exception 'Os resultados ainda não foram divulgados.';
  end if;
  -- Ranking pela média das notas; empate: quem recebeu mais notas.
  return query
    select p.categoria, p.id, p.nome, p.titulo,
           coalesce(round(avg(n.nota)::numeric, 2), 0), count(n.id)
    from public.confra_participantes p
    left join public.confra_notas n on n.participante_id = p.id
    group by p.id
    order by p.categoria, coalesce(avg(n.nota), 0) desc, count(n.id) desc, p.nome;
end $$;

-- Ranking ao vivo para o telão (TV): não pede senha.
-- Devolve só nome, título, média e quantidade de notas de uma categoria (nunca quem votou).
create or replace function public.confra_telao(p_categoria text)
returns table (categoria text, participante_id uuid, nome text, titulo text, media numeric, qtd bigint)
language sql stable security definer set search_path = public as $$
  select p.categoria, p.id, p.nome, p.titulo,
         coalesce(round(avg(n.nota)::numeric, 2), 0), count(n.id)
  from public.confra_participantes p
  left join public.confra_notas n on n.participante_id = p.id
  where p.categoria = p_categoria
  group by p.id
  order by coalesce(avg(n.nota), 0) desc, count(n.id) desc, p.nome;
$$;

-- Desempate: quantas notas 5, 4, 3, 2 e 1 cada concorrente recebeu (nunca quem votou).
-- O site ordena por média > mais notas > mais notas 5 > 4 > 3 > 2; se tudo for igual, marca EMPATE.
create or replace function public.confra_estrelas(p_categoria text)
returns table (participante_id uuid, n5 bigint, n4 bigint, n3 bigint, n2 bigint, n1 bigint)
language sql stable security definer set search_path = public as $$
  select p.id,
         count(n.id) filter (where n.nota = 5), count(n.id) filter (where n.nota = 4),
         count(n.id) filter (where n.nota = 3), count(n.id) filter (where n.nota = 2),
         count(n.id) filter (where n.nota = 1)
  from public.confra_participantes p
  left join public.confra_notas n on n.participante_id = p.id
  where p.categoria = p_categoria
  group by p.id;
$$;

-- ---------------------------------------------------------------------
-- Funções do painel de administração (todas exigem a senha)
-- ---------------------------------------------------------------------
create or replace function public.confra_admin_login(p_senha text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if public._confra_admin_ok(p_senha) then
    return true;
  end if;
  perform pg_sleep(1);
  return false;
end $$;

create or replace function public.confra_admin_config(p_senha text, p_chave text, p_valor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._confra_exigir_admin(p_senha);
  if p_chave not in (
    'evento_nome', 'evento_data', 'evento_local', 'aviso',
    'inscricoes_fantasia', 'inscricoes_talento',
    'votacao_fantasia', 'votacao_talento', 'resultados_publicos',
    'telao_categoria',  -- o que a TV (telao.html) mostra: fantasia ou talento
    'presenca_aberta', 'presenca_prazo', 'presenca_departamentos'   -- confirmação de presença (presenca/)
  ) then
    raise exception 'Configuração desconhecida: %', p_chave;
  end if;
  if p_chave = 'telao_categoria' and coalesce(p_valor, '') not in ('fantasia', 'talento') then
    raise exception 'A TV mostra fantasia ou talento.';
  end if;
  if p_chave = 'presenca_departamentos' and char_length(coalesce(p_valor, '')) > 3000 then
    raise exception 'Lista de departamentos grande demais.';
  end if;
  insert into public.confra_config (chave, valor) values (p_chave, coalesce(p_valor, ''))
  on conflict (chave) do update set valor = excluded.valor;
end $$;

create or replace function public.confra_admin_item_salvar(
  p_senha text, p_id uuid, p_hora text, p_fim text, p_titulo text, p_descricao text, p_ordem int
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public._confra_exigir_admin(p_senha);
  if p_id is null then
    insert into public.confra_programacao (hora, fim, titulo, descricao, ordem)
    values (trim(p_hora), nullif(trim(p_fim), ''), trim(p_titulo), nullif(trim(p_descricao), ''), coalesce(p_ordem, 0))
    returning id into v_id;
  else
    update public.confra_programacao
       set hora = trim(p_hora), fim = nullif(trim(p_fim), ''), titulo = trim(p_titulo),
           descricao = nullif(trim(p_descricao), ''), ordem = coalesce(p_ordem, 0)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Item não encontrado.';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.confra_admin_item_excluir(p_senha text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._confra_exigir_admin(p_senha);
  delete from public.confra_programacao where id = p_id;
end $$;

create or replace function public.confra_admin_participante_excluir(p_senha text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._confra_exigir_admin(p_senha);
  delete from public.confra_participantes where id = p_id;   -- as notas dele saem junto
end $$;

create or replace function public.confra_admin_zerar_votos(p_senha text, p_categoria text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._confra_exigir_admin(p_senha);
  delete from public.confra_notas where categoria = p_categoria;
end $$;

create or replace function public.confra_admin_trocar_senha(p_senha text, p_nova text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._confra_exigir_admin(p_senha);
  if char_length(coalesce(p_nova, '')) < 6 then
    raise exception 'A nova senha precisa ter pelo menos 6 caracteres.';
  end if;
  update public.confra_admin_segredo set senha_hash = extensions.crypt(p_nova, extensions.gen_salt('bf'));
end $$;

-- ---------------------------------------------------------------------
-- Desempate: duelo relâmpago entre os empatados (ou decisão da comissão)
-- A organização abre no painel; cada celular escolhe UM dos empatados
-- (pode trocar até o tempo acabar). O placar só é revelado no fim.
-- Uma "decisão da comissão" é um desempate sem votação (campo decisao).
-- ---------------------------------------------------------------------
create table if not exists public.confra_desempates (
  id uuid primary key default gen_random_uuid(),
  categoria text not null check (categoria in ('fantasia', 'talento')),
  posicao int not null check (posicao between 1 and 50),        -- posição que estava empatada (ex.: 2 = empate no 2º lugar)
  participantes uuid[] not null check (cardinality(participantes) between 2 and 10),
  inicio timestamptz not null default now(),
  fim timestamptz not null,                                     -- votação do duelo aceita votos até aqui
  decisao uuid[],                                               -- ordem escolhida pela comissão (sem votação)
  cancelado boolean not null default false                      -- "desfazer" no painel
);

create table if not exists public.confra_votos_desempate (
  desempate_id uuid not null references public.confra_desempates(id) on delete cascade,
  eleitor text not null check (char_length(eleitor) between 8 and 64),
  participante_id uuid not null references public.confra_participantes(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (desempate_id, eleitor)                           -- 1 voto por aparelho em cada duelo
);

create index if not exists confra_votos_desempate_part_idx on public.confra_votos_desempate (participante_id);

alter table public.confra_desempates      enable row level security;
alter table public.confra_votos_desempate enable row level security;

-- Lista os desempates (sem senha). Enquanto o duelo está aberto, devolve só o total de votos:
-- quantos votos cada um teve só aparece depois que o tempo acaba.
-- p_eleitor (opcional): devolve em quem este aparelho votou.
create or replace function public.confra_desempates(p_categoria text default null, p_eleitor text default null)
returns table (
  id uuid, categoria text, posicao int, participantes uuid[], inicio timestamptz, fim timestamptz,
  agora timestamptz, aberto boolean, total bigint, votos jsonb, decisao uuid[], meu_voto uuid
)
language sql stable security definer set search_path = public as $$
  select d.id, d.categoria, d.posicao, d.participantes, d.inicio, d.fim, now(), d.fim > now(),
         (select count(*) from public.confra_votos_desempate v where v.desempate_id = d.id),
         case when d.fim <= now() then coalesce((
           select jsonb_object_agg(x.participante_id::text, x.n)
           from (select v.participante_id, count(*) as n from public.confra_votos_desempate v
                 where v.desempate_id = d.id group by v.participante_id) x), '{}'::jsonb) end,
         d.decisao,
         case when p_eleitor is null then null else (
           select v.participante_id from public.confra_votos_desempate v
           where v.desempate_id = d.id and v.eleitor = p_eleitor) end
  from public.confra_desempates d
  where not d.cancelado and (p_categoria is null or d.categoria = p_categoria)
  order by d.inicio;
$$;

create or replace function public.confra_desempate_votar(p_desempate uuid, p_eleitor text, p_participante uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.confra_desempates;
begin
  select * into d from public.confra_desempates where id = p_desempate;
  if not found or d.cancelado then
    raise exception 'Esse desempate não está mais valendo. Atualize a página.';
  end if;
  if d.fim <= now() then
    raise exception 'O tempo do desempate acabou.';
  end if;
  if p_eleitor is null or char_length(p_eleitor) not between 8 and 64 then
    raise exception 'Não foi possível identificar este aparelho. Recarregue a página.';
  end if;
  if p_participante is null or not (p_participante = any (d.participantes)) then
    raise exception 'Escolha um dos empatados.';
  end if;
  insert into public.confra_votos_desempate (desempate_id, eleitor, participante_id)
  values (p_desempate, p_eleitor, p_participante)
  on conflict (desempate_id, eleitor)
  do update set participante_id = excluded.participante_id, criado_em = now();
end $$;

create or replace function public._confra_conferir_empatados(p_categoria text, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_categoria not in ('fantasia', 'talento') then
    raise exception 'Categoria inválida.';
  end if;
  if p_ids is null or cardinality(p_ids) < 2 then
    raise exception 'O desempate precisa de pelo menos 2 concorrentes.';
  end if;
  if (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids) then
    raise exception 'Concorrente repetido no desempate.';
  end if;
  if (select count(*) from public.confra_participantes where id = any (p_ids) and categoria = p_categoria) <> cardinality(p_ids) then
    raise exception 'Algum concorrente não está mais na lista. Atualize a página.';
  end if;
end $$;

-- Abre o duelo (exige a senha). Só com a votação principal fechada e um duelo por vez.
create or replace function public.confra_admin_desempate_abrir(
  p_senha text, p_categoria text, p_posicao int, p_participantes uuid[], p_segundos int
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public._confra_exigir_admin(p_senha);
  perform public._confra_conferir_empatados(p_categoria, p_participantes);
  if cardinality(p_participantes) > 4 then
    raise exception 'O duelo é entre 2 e 4 concorrentes. Com mais empatados, a comissão decide.';
  end if;
  if coalesce(public._confra_cfg('votacao_' || p_categoria), 'nao') = 'sim' then
    raise exception 'Feche a votação antes de abrir o desempate.';
  end if;
  if p_segundos is null or p_segundos not between 30 and 900 then
    raise exception 'Escolha um tempo entre 30 segundos e 15 minutos.';
  end if;
  if exists (select 1 from public.confra_desempates where not cancelado and fim > now()) then
    raise exception 'Já tem um desempate em andamento. Encerre ou cancele antes de abrir outro.';
  end if;
  insert into public.confra_desempates (categoria, posicao, participantes, fim)
  values (p_categoria, greatest(1, coalesce(p_posicao, 1)), p_participantes, now() + make_interval(secs => p_segundos))
  returning id into v_id;
  -- a TV passa a mostrar a categoria do duelo
  insert into public.confra_config (chave, valor) values ('telao_categoria', p_categoria)
  on conflict (chave) do update set valor = excluded.valor;
  return v_id;
end $$;

-- A comissão decide a ordem dos empatados, sem votação (p_ordem: do melhor para o pior).
create or replace function public.confra_admin_desempate_decidir(p_senha text, p_categoria text, p_posicao int, p_ordem uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public._confra_exigir_admin(p_senha);
  perform public._confra_conferir_empatados(p_categoria, p_ordem);
  insert into public.confra_desempates (categoria, posicao, participantes, fim, decisao)
  values (p_categoria, greatest(1, coalesce(p_posicao, 1)), p_ordem, now(), p_ordem)
  returning id into v_id;
  return v_id;
end $$;

-- Encerra o duelo antes do tempo (os votos já dados valem).
create or replace function public.confra_admin_desempate_encerrar(p_senha text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._confra_exigir_admin(p_senha);
  update public.confra_desempates set fim = now() where id = p_id and not cancelado and fim > now();
  if not found then
    raise exception 'Esse desempate já tinha terminado.';
  end if;
end $$;

-- Cancela / desfaz um desempate (o empate volta a aparecer).
create or replace function public.confra_admin_desempate_cancelar(p_senha text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._confra_exigir_admin(p_senha);
  update public.confra_desempates set cancelado = true where id = p_id;
end $$;

revoke all on function public._confra_conferir_empatados(text, uuid[]) from public, anon, authenticated;

grant execute on function
  public.confra_desempates(text, text),
  public.confra_desempate_votar(uuid, text, uuid),
  public.confra_admin_desempate_abrir(text, text, int, uuid[], int),
  public.confra_admin_desempate_decidir(text, text, int, uuid[]),
  public.confra_admin_desempate_encerrar(text, uuid),
  public.confra_admin_desempate_cancelar(text, uuid)
to anon, authenticated;

-- ---------------------------------------------------------------------
-- Confirmação de presença (link separado: presenca/)
-- Cada pessoa informa nome, departamento, se vai (sim / não / talvez) e,
-- opcionalmente, o que prefere beber. Só o celular que respondeu pode
-- alterar a resposta (chave secreta guardada no aparelho).
-- O painel (presenca/painel.html, com a senha da organização) vê a lista
-- de nomes e departamentos; a bebida aparece SÓ em totais, nunca por nome.
-- ---------------------------------------------------------------------
create table if not exists public.confra_presenca (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 2 and 80),
  departamento text not null check (char_length(departamento) between 1 and 60),
  resposta text not null check (resposta in ('sim', 'nao', 'talvez')),
  bebida text check (bebida in ('cerveja', 'refrigerante', 'suco', 'agua', 'tanto_faz')),
  chave_hash text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.confra_presenca enable row level security;   -- sem política: ninguém lê direto

-- Responder (p_id vazio) ou alterar a própria resposta (p_id + chave do aparelho).
create or replace function public.confra_presenca_responder(
  p_id uuid, p_chave text, p_nome text, p_departamento text, p_resposta text, p_bebida text default null
)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_deps text := coalesce(public._confra_cfg('presenca_departamentos'), '');
begin
  if coalesce(public._confra_cfg('presenca_aberta'), 'sim') <> 'sim' then
    raise exception 'As confirmações estão encerradas.';
  end if;
  if char_length(trim(coalesce(p_nome, ''))) < 2 then
    raise exception 'Informe seu nome.';
  end if;
  if char_length(trim(coalesce(p_departamento, ''))) < 1 then
    raise exception 'Escolha o seu departamento.';
  end if;
  -- cada linha da lista: "Departamento" ou "Departamento | quantidade de pessoas"
  if v_deps <> '' and not (trim(p_departamento) = any (
       select trim(split_part(x, '|', 1)) from unnest(string_to_array(v_deps, E'\n')) x where trim(x) <> '')) then
    raise exception 'Escolha o departamento na lista.';
  end if;
  if p_resposta not in ('sim', 'nao', 'talvez') then
    raise exception 'Diga se você vai.';
  end if;
  if p_bebida is not null and p_bebida not in ('cerveja', 'refrigerante', 'suco', 'agua', 'tanto_faz') then
    raise exception 'Opção de bebida inválida.';
  end if;
  if p_chave is null or char_length(p_chave) not between 16 and 64 then
    raise exception 'Não foi possível identificar este aparelho. Recarregue a página.';
  end if;

  if p_id is null then
    if (select count(*) from public.confra_presenca where criado_em > now() - interval '1 minute') >= 60 then
      raise exception 'Muitas confirmações ao mesmo tempo. Tente de novo em 1 minuto.';
    end if;
    insert into public.confra_presenca (nome, departamento, resposta, bebida, chave_hash)
    values (trim(p_nome), trim(p_departamento), p_resposta,
            case when p_resposta = 'nao' then null else p_bebida end,
            extensions.crypt(p_chave, extensions.gen_salt('bf')))
    returning id into v_id;
    return v_id;
  end if;

  update public.confra_presenca set
    nome = trim(p_nome), departamento = trim(p_departamento), resposta = p_resposta,
    bebida = case when p_resposta = 'nao' then null else p_bebida end, atualizado_em = now()
  where id = p_id and chave_hash = extensions.crypt(p_chave, chave_hash)
  returning id into v_id;
  if v_id is null then
    raise exception 'Não encontramos sua resposta anterior. Envie de novo.';
  end if;
  return v_id;
end $$;

-- Painel: lista de quem respondeu (sem a bebida).
create or replace function public.confra_presenca_painel(p_senha text)
returns table (id uuid, nome text, departamento text, resposta text, criado_em timestamptz, atualizado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._confra_exigir_admin(p_senha);
  return query select p.id, p.nome, p.departamento, p.resposta, p.criado_em, p.atualizado_em
    from public.confra_presenca p order by p.criado_em;
end $$;

-- Painel: bebida só em totais (por departamento e resposta).
create or replace function public.confra_presenca_bebidas(p_senha text)
returns table (departamento text, resposta text, bebida text, qtd bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._confra_exigir_admin(p_senha);
  return query select p.departamento, p.resposta, coalesce(p.bebida, 'sem_resposta'), count(*)
    from public.confra_presenca p where p.resposta <> 'nao'
    group by 1, 2, 3;
end $$;

-- Painel: remover uma resposta (duplicada ou de brincadeira).
create or replace function public.confra_admin_presenca_excluir(p_senha text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._confra_exigir_admin(p_senha);
  delete from public.confra_presenca where id = p_id;
end $$;

grant execute on function
  public.confra_presenca_responder(uuid, text, text, text, text, text),
  public.confra_presenca_painel(text),
  public.confra_presenca_bebidas(text),
  public.confra_admin_presenca_excluir(text, uuid)
to anon, authenticated;

-- Configuração da confirmação (o painel edita): aberta ou não, prazo e lista de departamentos (um por linha).
insert into public.confra_config (chave, valor) values
  ('presenca_aberta', 'sim'),
  ('presenca_prazo', ''),
  -- um departamento por linha; "| número" = quantas pessoas o departamento tem (o painel mostra quantos já responderam)
  ('presenca_departamentos', E'Administrativo | 5\nAmbulatório | 3\nBalança / Faturamento | 9\nCampo | 18\nCampo / Milho | 3\nCantina | 6\nComercial Cooperados | 4\nComercial Vendas | 12\nConstrução Civil | 1\nControle de Qualidade | 29\nElétrica e Manutenção | 26\nFrotas | 2\nGestão da Qualidade | 3\nGrãos | 19\nLaboratório | 23\nLimpeza | 20\nLogística | 8\nPortaria | 18\nProdução | 175\nSegurança do Trabalho | 5\nSuprimentos / Compras | 7\nTI | 11')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- Permissões das funções
-- ---------------------------------------------------------------------
revoke all on function public._confra_cfg(text)           from public, anon, authenticated;
revoke all on function public._confra_admin_ok(text)      from public, anon, authenticated;
revoke all on function public._confra_exigir_admin(text)  from public, anon, authenticated;

grant execute on function
  public.confra_avaliar(text, uuid, text, int),
  public.confra_minhas_notas(text, text),
  public.confra_inscrever(text, text, text, text, text, text, text, text),
  public.confra_editar_inscricao(uuid, text, text, text, text, text, text, text, text),
  public.confra_resultados(text),
  public.confra_telao(text),
  public.confra_estrelas(text),
  public.confra_admin_login(text),
  public.confra_admin_config(text, text, text),
  public.confra_admin_item_salvar(text, uuid, text, text, text, text, int),
  public.confra_admin_item_excluir(text, uuid),
  public.confra_admin_participante_excluir(text, uuid),
  public.confra_admin_zerar_votos(text, text),
  public.confra_admin_trocar_senha(text, text)
to anon, authenticated;

-- ---------------------------------------------------------------------
-- Fotos das inscrições (Storage, pasta confra-fotos)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('confra-fotos', 'confra-fotos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "confra-fotos upload" on storage.objects;
create policy "confra-fotos upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'confra-fotos');

-- ---------------------------------------------------------------------
-- Valores iniciais (só entram se ainda não existirem)
-- ---------------------------------------------------------------------
insert into public.confra_config (chave, valor) values
  ('evento_nome', 'Confraternização 2026'),
  ('evento_data', '2026-12-04'),
  ('evento_local', 'Fazendinha'),
  ('aviso', ''),
  ('inscricoes_fantasia', 'sim'),
  ('inscricoes_talento', 'sim'),
  ('votacao_fantasia', 'nao'),
  ('votacao_talento', 'nao'),
  ('resultados_publicos', 'nao'),
  ('telao_categoria', 'fantasia')
on conflict (chave) do nothing;

-- Senha inicial do painel: trocar123  (troque no painel logo no primeiro acesso)
insert into public.confra_admin_segredo (id, senha_hash)
values (1, extensions.crypt('trocar123', extensions.gen_salt('bf')))
on conflict (id) do nothing;

-- Cronograma (só entra se a tabela estiver vazia; edite pelo painel)
insert into public.confra_programacao (hora, fim, titulo, descricao, ordem)
select * from (values
  ('10:00', '10:15', 'Abertura e agradecimentos', 'Com Reinaldo.', 1),
  ('10:20', '11:20', 'Show de talentos', '5 minutos por apresentação.', 2),
  ('11:20', '12:00', 'Desfile das fantasias', null, 3),
  ('12:00', '13:00', 'Almoço', null, 4),
  ('13:00', '15:30', 'Banda', null, 5),
  ('15:00', '15:30', 'Acerte a música', null, 6),
  ('15:30', '15:45', 'Divulgação dos resultados', 'Melhor fantasia e show de talentos.', 7),
  ('16:00', '17:00', 'Bingo', null, 8),
  ('17:00', '18:00', 'Encerramento', null, 9)
) as v(hora, fim, titulo, descricao, ordem)
where not exists (select 1 from public.confra_programacao);
