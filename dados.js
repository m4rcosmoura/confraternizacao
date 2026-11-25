/* =====================================================================
   CONFIGURAÇÃO
   Deixe em branco para o MODO DE TESTE (dados salvos só no navegador).
   Para ligar o banco depois: crie o projeto no Supabase, rode o arquivo
   supabase/schema.sql e preencha os dois campos abaixo.
   ===================================================================== */
window.CONFIG = {
  // Projeto Supabase "brigada" (tabelas com prefixo confra_). A chave anon é pública por natureza:
  // quem protege os dados são as regras e funções do banco (supabase/schema.sql).
  SUPABASE_URL: "https://paueyalgozwchzrkgfoq.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhdWV5YWxnb3p3Y2h6cmtnZm9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTU3MjEsImV4cCI6MjEwODA3MTcyMX0.kwnq470o2LbKwkqZJBYDxGs2rQpzQ0DLFlHPKyqOKT0"
};

/* =====================================================================
   DADOS
   Votação por nota: cada celular dá de 1 a 5 estrelas para cada
   candidato (pode trocar enquanto a votação estiver aberta).
   O ranking usa a média das notas.
   ===================================================================== */
window.api = (function () {
  "use strict";
  const modoTeste = !(window.CONFIG.SUPABASE_URL && window.CONFIG.SUPABASE_ANON_KEY);

  function uuid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* segue */ }
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignora */ } },
  };
  // ------------------------------------------------ trava por aparelho
  // Cada celular recebe uma identificação guardada em 3 lugares do navegador
  // (localStorage, cookie e IndexedDB). Se um deles for apagado, os outros a recuperam.
  // O banco aceita só 1 nota por aparelho para cada candidato (trocar a nota é permitido).
  const ELEITOR = "confra_eleitor";
  function lerCookie() { try { const m = document.cookie.match(/(?:^|;\s*)confra_eleitor=([^;]+)/); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } }
  function gravarCookie(id) { try { document.cookie = `${ELEITOR}=${encodeURIComponent(id)}; max-age=31536000; path=/; SameSite=Lax`; } catch (e) { /* ignora */ } }
  function idb(modo, valor) {
    return new Promise((res) => {
      try {
        const req = indexedDB.open("confra", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onerror = () => res(null);
        req.onsuccess = () => {
          try {
            const tx = req.result.transaction("kv", modo === "ler" ? "readonly" : "readwrite");
            const st = tx.objectStore("kv");
            const r = modo === "ler" ? st.get(ELEITOR) : st.put(valor, ELEITOR);
            r.onsuccess = () => res(modo === "ler" ? r.result || null : valor);
            r.onerror = () => res(null);
          } catch (e) { res(null); }
        };
      } catch (e) { res(null); }
    });
  }
  let eleitorPromessa = null;
  function eleitor() {
    return (eleitorPromessa ||= (async () => {
      const id = store.get(ELEITOR, null) || lerCookie() || (await idb("ler")) || uuid();
      store.set(ELEITOR, id); gravarCookie(id); await idb("gravar", id);
      return id;
    })());
  }
  function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Inscrições feitas neste celular: { id: chave secreta }. A chave é o que permite editar.
  let minhasMem = {};
  function minhas() { return store.get("confra_minhas", null) || minhasMem; }
  function guardarMinha(id, chave) { const m = { ...minhas(), [id]: chave }; minhasMem = m; store.set("confra_minhas", m); }
  function chaveDe(id) { const c = minhas()[id]; if (!c) throw new Error("Essa inscrição só pode ser editada no celular em que foi feita."); return c; }

  function validarNota(nota) {
    const n = Number(nota);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error("Escolha uma nota de 1 a 5.");
    return n;
  }

  // Reduz a foto no próprio celular antes de salvar/enviar.
  async function reduzirFoto(file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("Não consegui abrir essa imagem. Tente outra foto."));
        i.src = url;
      });
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
      if (!blob) throw new Error("Não consegui preparar a foto. Tente outra.");
      return blob;
    } finally { URL.revokeObjectURL(url); }
  }
  function blobParaDataURL(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error("Não consegui ler a foto."));
      r.readAsDataURL(blob);
    });
  }
  function limpar(dados) {
    return {
      nome: dados.nome, setor: dados.setor || null, titulo: dados.titulo || null,
      tipo: dados.tipo || null, descricao: dados.descricao || null,
    };
  }

  // ------------------------------------------------ modo de teste (localStorage)
  const DEMO_KEY = "confra_demo_v6";
  const espera = (ms = 150) => new Promise((r) => setTimeout(r, ms));

  // "Foto" de teste: silhueta sobre fundo colorido, só para mostrar como fica um inscrito com foto.
  function fotoTeste(c1, c2, corpo) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="150" cy="118" r="52" fill="${corpo}"/><path d="M52 300c8-70 50-104 98-104s90 34 98 104z" fill="${corpo}"/></svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function semente() {
    const p = (hora, fim, titulo, descricao, ordem) => ({ id: uuid(), hora, fim, titulo, descricao, ordem });
    let n = 0;
    const part = (categoria, nome, setor, titulo, tipo, descricao, foto_url) => ({
      id: uuid(), categoria, nome, setor, titulo, tipo: tipo || null, descricao: descricao || null, foto_url: foto_url || null,
      criado_em: new Date(Date.now() - (60 - n++) * 3600000).toISOString(),
    });
    const participantes = [
      part("fantasia", "Ana Paula Ribeiro", "Comercial", "Espantalho do milharal", null, null, fotoTeste("#e8a33a", "#8a4b12", "#3b2410")),
      part("fantasia", "Bruno Carvalho", "Logística", "Astronauta", null, null, fotoTeste("#2d3e6b", "#0e1530", "#d9dde8")),
      part("fantasia", "Carla Mendes", "Laboratório de Sementes", "Bruxa do campo"),
      part("fantasia", "Rafael Souza", "Expedição", "Pirata do armazém", null, null, fotoTeste("#7a1f1f", "#2a0b0b", "#151515")),
      part("fantasia", "Juliana Martins", "RH", "Abelha polinizadora", null, null, fotoTeste("#f4c430", "#c98a00", "#222222")),
      part("fantasia", "Marcelo Lima", "Produção", "Vampiro"),
      part("fantasia", "Fernanda Alves", "Financeiro", "Fada do jardim", null, null, fotoTeste("#6fbf8a", "#24583a", "#f2e6ff")),
      part("fantasia", "Thiago Pereira", "Campo", "Cowboy do rodeio"),
      part("fantasia", "Patrícia Gomes", "Qualidade", "Chef de cozinha", null, null, fotoTeste("#f2efe6", "#b9b2a0", "#4a3b2a")),
      part("fantasia", "Lucas Rocha", "TI", "Múmia"),
      part("talento", "Trio do Armazém", "Expedição", "Moda de viola", "Música", "2 microfones e 1 cadeira.", fotoTeste("#8a5a2b", "#3a220c", "#f0d9b5")),
      part("talento", "Diego Fernandes", "TI", "Stand-up: a impressora que nunca funciona", "Comédia", "1 microfone."),
      part("talento", "Camila e Renato", "Comercial", "Dança sertaneja", "Dança", "Música no pendrive.", fotoTeste("#b0306a", "#4a0f2c", "#ffd9e8")),
      part("talento", "Os Germinados", "Produção", "Rock acústico", "Música", "Tomada para o teclado, 3 microfones."),
      part("talento", "Sérgio Nunes", "Beneficiamento", "Mágica com cartas", "Mágica", "Uma mesa pequena."),
      part("talento", "Bianca Torres", "Marketing", "Imitações de famosos", "Comédia", null, fotoTeste("#3a6ea5", "#13294a", "#ffe2c6")),
    ];
    // Notas de teste (1 a 5) para o painel da organização ter o que mostrar.
    const notas = {};
    const perfis = {
      fantasia: [[5, 4, 5, 5, 4, 3, 5], [4, 3, 4, 5], [3, 4, 2], [5, 5, 4, 5, 5, 4, 5, 5], [4, 5, 4, 3, 4], [2, 3], [4, 4, 5, 3], [3, 2, 4], [4, 3], []],
      talento: [[5, 5, 4, 5, 5, 4], [4, 5, 3, 4], [5, 4, 5, 5, 4], [3, 4], [4], [5, 4, 4]],
    };
    ["fantasia", "talento"].forEach((cat) => {
      participantes.filter((x) => x.categoria === cat).forEach((x, i) => {
        notas[x.id] = {};
        perfis[cat][i].forEach((nota, k) => { notas[x.id][`teste-${cat}-${i}-${k}`] = nota; });
      });
    });
    return {
      config: {
        evento_nome: "Confraternização 2026",
        evento_data: "2026-12-04",
        evento_local: "Fazendinha",
        aviso: "Versão de teste: cronograma, inscritos e notas são exemplos.",
        inscricoes_fantasia: "sim", inscricoes_talento: "sim",
        votacao_fantasia: "nao", votacao_talento: "nao",
        resultados_publicos: "nao",
      },
      senha: "trocar123",
      programacao: [
        p("10:00", "10:15", "Abertura e agradecimentos", "Com Reinaldo.", 1),
        p("10:20", "11:20", "Show de talentos", "5 minutos por apresentação.", 2),
        p("11:20", "12:00", "Desfile das fantasias", null, 3),
        p("12:00", "13:00", "Almoço", null, 4),
        p("13:00", "15:30", "Banda", null, 5),
        p("15:00", "15:30", "Acerte a música", null, 6),
        p("15:30", "15:45", "Divulgação dos resultados", "Melhor fantasia e show de talentos.", 7),
        p("16:00", "17:00", "Bingo", null, 8),
        p("17:00", "18:00", "Encerramento", null, 9),
      ],
      participantes,
      chaves: {},   // id da inscrição -> chave de edição
      notas,        // id da inscrição -> { eleitor: nota }
    };
  }
  let memoria = null;   // usado quando o navegador bloqueia o armazenamento
  function ler() { let d = store.get(DEMO_KEY, null) || memoria; if (!d) { d = semente(); memoria = d; store.set(DEMO_KEY, d); } return d; }
  function gravar(d) { memoria = d; store.set(DEMO_KEY, d); }
  function exigirAdmin(d, senha) { if (senha !== d.senha) throw new Error("Senha de administrador incorreta."); }
  function calcularResultados(d) {
    return d.participantes.map((p) => {
      const ns = Object.values(d.notas[p.id] || {});
      const soma = ns.reduce((s, x) => s + x, 0);
      return { categoria: p.categoria, participante_id: p.id, nome: p.nome, titulo: p.titulo, media: ns.length ? soma / ns.length : 0, qtd: ns.length };
    }).sort(ordenarResultado);
  }

  const teste = {
    async getConfig() { await espera(60); return { ...ler().config }; },
    async getProgramacao() { await espera(60); return ordenarProg(ler().programacao); },
    async getParticipantes(cat) { await espera(60); return ler().participantes.filter((p) => p.categoria === cat); },
    async avaliar(cat, pid, nota) {
      await espera();
      const n = validarNota(nota);
      const d = ler();
      if (d.config["votacao_" + cat] !== "sim") throw new Error("A votação está fechada no momento.");
      if (!d.participantes.some((p) => p.id === pid && p.categoria === cat)) throw new Error("Esse participante não está mais na lista. Atualize a página.");
      const eu = await eleitor();
      d.notas[pid] = d.notas[pid] || {};
      d.notas[pid][eu] = n; gravar(d);
    },
    async minhasNotas(cat) {
      const d = ler(), eu = await eleitor(), o = {};
      d.participantes.filter((p) => p.categoria === cat).forEach((p) => {
        const n = d.notas[p.id] && d.notas[p.id][eu];
        if (n != null) o[p.id] = n;
      });
      return o;
    },
    async inscrever(cat, dados, foto) {
      await espera(300);
      const d = ler();
      if (d.config["inscricoes_" + cat] !== "sim") throw new Error("As inscrições estão fechadas.");
      const foto_url = foto ? await blobParaDataURL(await reduzirFoto(foto, 480)) : null;
      const novo = { id: uuid(), categoria: cat, ...limpar(dados), foto_url, criado_em: new Date().toISOString() };
      const chave = uuid();
      d.participantes.push(novo); d.chaves[novo.id] = chave; gravar(d);
      guardarMinha(novo.id, chave);
      return novo.id;
    },
    async editarInscricao(id, dados, foto) {
      await espera(300);
      const chave = chaveDe(id);
      const d = ler();
      const p = d.participantes.find((x) => x.id === id);
      if (!p) throw new Error("Essa inscrição não existe mais (pode ter sido removida pela organização).");
      if (d.chaves[id] !== chave) throw new Error("Essa inscrição só pode ser editada no celular em que foi feita.");
      Object.assign(p, limpar(dados));
      if (foto.remover) p.foto_url = null;
      else if (foto.nova) p.foto_url = await blobParaDataURL(await reduzirFoto(foto.nova, 480));
      gravar(d);
    },
    async resultados(senha) {
      await espera(60);
      const d = ler();
      if (senha !== d.senha && d.config.resultados_publicos !== "sim") throw new Error("Os resultados ainda não foram divulgados.");
      return calcularResultados(d);
    },
    async telao(cat) { await espera(60); return calcularResultados(ler()).filter((r) => r.categoria === cat); },
    async adminLogin(senha) { await espera(); return senha === ler().senha; },
    async adminConfig(senha, chave, valor) { const d = ler(); exigirAdmin(d, senha); d.config[chave] = valor; gravar(d); },
    async adminItemSalvar(senha, it) {
      const d = ler(); exigirAdmin(d, senha);
      if (it.id) {
        const i = d.programacao.findIndex((x) => x.id === it.id);
        if (i < 0) throw new Error("Item não encontrado.");
        d.programacao[i] = { ...it };
      } else { it = { ...it, id: uuid() }; d.programacao.push(it); }
      gravar(d); return it.id;
    },
    async adminItemExcluir(senha, id) { const d = ler(); exigirAdmin(d, senha); d.programacao = d.programacao.filter((x) => x.id !== id); gravar(d); },
    async adminParticipanteExcluir(senha, id) {
      const d = ler(); exigirAdmin(d, senha);
      d.participantes = d.participantes.filter((x) => x.id !== id);
      delete d.notas[id]; delete d.chaves[id];
      gravar(d);
    },
    async adminZerarVotos(senha, cat) {
      const d = ler(); exigirAdmin(d, senha);
      d.participantes.filter((p) => p.categoria === cat).forEach((p) => { d.notas[p.id] = {}; });
      gravar(d);
    },
    async adminTrocarSenha(senha, nova) {
      const d = ler(); exigirAdmin(d, senha);
      if (!nova || nova.length < 6) throw new Error("A nova senha precisa ter pelo menos 6 caracteres.");
      d.senha = nova; gravar(d);
    },
    resetarTeste() { store.del(DEMO_KEY); store.del("confra_minhas"); minhasMem = {}; memoria = null; },
  };
  function ordenarProg(l) { return l.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || String(a.hora).localeCompare(String(b.hora))); }
  function ordenarResultado(a, b) { return a.categoria.localeCompare(b.categoria) || b.media - a.media || b.qtd - a.qtd || a.nome.localeCompare(b.nome); }

  // ------------------------------------------------ Supabase (quando configurado)
  function criarSupabase() {
    const sb = window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    function erro(e) {
      const msg = (e && e.message) || "";
      if (/failed to fetch|network|load failed/i.test(msg)) return new Error("Sem conexão. Verifique a internet e tente de novo.");
      if (/violates check constraint/i.test(msg)) return new Error("Algum campo ficou grande demais. Encurte o texto e tente de novo.");
      return new Error(msg || "Algo deu errado. Tente de novo.");
    }
    async function rpc(fn, args) { let r; try { r = await sb.rpc(fn, args); } catch (e) { throw erro(e); } if (r.error) throw erro(r.error); return r.data; }
    async function sel(q) { let r; try { r = await q; } catch (e) { throw erro(e); } if (r.error) throw erro(r.error); return r.data || []; }
    async function enviarFoto(cat, foto) {
      const blob = await reduzirFoto(foto, 900);
      const caminho = `${cat}/${uuid()}.jpg`;
      const up = await sb.storage.from("confra-fotos").upload(caminho, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new Error("Não consegui enviar a foto. Tente sem foto ou com outra imagem.");
      return sb.storage.from("confra-fotos").getPublicUrl(caminho).data.publicUrl;
    }
    const args = (dados) => ({ p_nome: dados.nome, p_setor: dados.setor || null, p_titulo: dados.titulo || null, p_tipo: dados.tipo || null, p_descricao: dados.descricao || null });
    return {
      async getConfig() { const o = {}; (await sel(sb.from("confra_config").select("chave,valor"))).forEach((l) => { o[l.chave] = l.valor; }); return o; },
      getProgramacao() { return sel(sb.from("confra_programacao").select("id,hora,fim,titulo,descricao,ordem").order("ordem").order("hora")); },
      getParticipantes(cat) { return sel(sb.from("confra_participantes").select("id,categoria,nome,setor,titulo,tipo,descricao,foto_url,criado_em").eq("categoria", cat).order("criado_em")); },
      async avaliar(cat, pid, nota) { return rpc("confra_avaliar", { p_categoria: cat, p_participante: pid, p_eleitor: await eleitor(), p_nota: validarNota(nota) }); },
      async minhasNotas(cat) {
        const o = {};
        ((await rpc("confra_minhas_notas", { p_categoria: cat, p_eleitor: await eleitor() })) || []).forEach((r) => { o[r.participante_id] = r.nota; });
        return o;
      },
      async inscrever(cat, dados, foto) {
        const foto_url = foto ? await enviarFoto(cat, foto) : null;
        const chave = uuid();
        const id = await rpc("confra_inscrever", { p_categoria: cat, ...args(dados), p_foto_url: foto_url, p_chave: chave });
        guardarMinha(id, chave);
        return id;
      },
      async editarInscricao(id, dados, foto) {
        const chave = chaveDe(id);
        const nova = foto.nova ? await enviarFoto("edicao", foto.nova) : null;
        return rpc("confra_editar_inscricao", { p_id: id, p_chave: chave, ...args(dados), p_foto_url: nova, p_foto_acao: foto.remover ? "remover" : (nova ? "trocar" : "manter") });
      },
      async resultados(senha) {
        return ((await rpc("confra_resultados", { p_senha: senha || null })) || [])
          .map((x) => ({ ...x, media: Number(x.media), qtd: Number(x.qtd) }))
          .sort(ordenarResultado);
      },
      // Telão da TV: ranking de uma categoria, sem senha.
      async telao(cat) {
        return ((await rpc("confra_telao", { p_categoria: cat })) || [])
          .map((x) => ({ ...x, media: Number(x.media), qtd: Number(x.qtd) }))
          .sort(ordenarResultado);
      },
      adminLogin(senha) { return rpc("confra_admin_login", { p_senha: senha }); },
      adminConfig(senha, chave, valor) { return rpc("confra_admin_config", { p_senha: senha, p_chave: chave, p_valor: valor }); },
      adminItemSalvar(senha, it) { return rpc("confra_admin_item_salvar", { p_senha: senha, p_id: it.id || null, p_hora: it.hora, p_fim: it.fim || null, p_titulo: it.titulo, p_descricao: it.descricao || null, p_ordem: Number(it.ordem) || 0 }); },
      adminItemExcluir(senha, id) { return rpc("confra_admin_item_excluir", { p_senha: senha, p_id: id }); },
      adminParticipanteExcluir(senha, id) { return rpc("confra_admin_participante_excluir", { p_senha: senha, p_id: id }); },
      adminZerarVotos(senha, cat) { return rpc("confra_admin_zerar_votos", { p_senha: senha, p_categoria: cat }); },
      adminTrocarSenha(senha, nova) { return rpc("confra_admin_trocar_senha", { p_senha: senha, p_nova: nova }); },
      resetarTeste() {},
    };
  }
  function carregarScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res;
      s.onerror = () => rej(new Error("Não foi possível conectar. Verifique a internet."));
      document.head.append(s);
    });
  }
  function supabasePreguicoso() {
    let pronto = null;
    const iniciar = () => (pronto ||= carregarScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js").then(criarSupabase).catch((e) => { pronto = null; throw e; }));
    return new Proxy({}, { get: (_, k) => (k === "resetarTeste" ? () => {} : async (...a) => (await iniciar())[k](...a)) });
  }

  const backend = modoTeste ? teste : supabasePreguicoso();
  const nomes = ["getConfig", "getProgramacao", "getParticipantes", "avaliar", "minhasNotas", "inscrever", "editarInscricao", "resultados", "telao",
    "adminLogin", "adminConfig", "adminItemSalvar", "adminItemExcluir", "adminParticipanteExcluir", "adminZerarVotos", "adminTrocarSenha", "resetarTeste"];
  const api = { modoTeste, hojeISO, carregarScript, souDono: (id) => !!minhas()[id] };
  nomes.forEach((n) => { api[n] = (...a) => backend[n](...a); });
  return api;
})();
