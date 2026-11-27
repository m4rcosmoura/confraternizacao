/* =====================================================================
   CONFIRMAÇÃO DE PRESENÇA: dados
   Usa o mesmo banco (Supabase "brigada", tabelas confra_) do site da festa.
   A pessoa procura o próprio nome na lista de colaboradores (que fica no
   banco, protegida: a busca devolve no máximo 8 nomes a partir de 3 letras)
   e toca nele; o departamento vem junto.
   Com ?teste no endereço, tudo fica só no navegador (nomes e respostas de
   exemplo), para testar sem mexer nas respostas de verdade.
   ===================================================================== */
window.presenca = (function () {
  "use strict";
  const SUPABASE_URL = "https://paueyalgozwchzrkgfoq.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhdWV5YWxnb3p3Y2h6cmtnZm9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTU3MjEsImV4cCI6MjEwODA3MTcyMX0.kwnq470o2LbKwkqZJBYDxGs2rQpzQ0DLFlHPKyqOKT0";
  const TESTE = new URLSearchParams(location.search).has("teste");

  const RESPOSTAS = { sim: "Vou", talvez: "Talvez", nao: "Não vou" };
  const BEBIDAS = { cerveja: "Cerveja / bebida alcoólica", refrigerante: "Refrigerante", suco: "Suco", agua: "Água", tanto_faz: "Tanto faz", sem_resposta: "Não respondeu" };
  const CHAVES_CFG = ["evento_nome", "evento_data", "evento_local", "presenca_aberta", "presenca_prazo", "presenca_departamentos"];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignora */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignora */ } },
  };
  function uuid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* segue */ }
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  // Lista de departamentos da configuração (só usada se a lista de pessoas não estiver disponível).
  const linhasDep = (cfg) => String(cfg.presenca_departamentos || "").split("\n").map((x) => x.trim()).filter(Boolean)
    .map((x) => { const [nome, n] = x.split("|"); return { nome: nome.trim(), qtd: Number(String(n || "").replace(/\D/g, "")) || 0 }; })
    .filter((x) => x.nome);
  const departamentos = (cfg) => linhasDep(cfg).map((x) => x.nome);
  const quadro = (cfg) => new Map(linhasDep(cfg).filter((x) => x.qtd > 0).map((x) => [x.nome, x.qtd]));

  // A resposta deste aparelho (para poder alterar depois). A chave só existe aqui e, embaralhada, no banco.
  const MINHA = TESTE ? "confra_presenca_minha_teste2" : "confra_presenca_minha2";
  const minha = () => store.get(MINHA, null);
  const guardarMinha = (m) => store.set(MINHA, m);

  // ------------------------------------------------ modo de teste (só no navegador)
  const KEY_TESTE = "confra_presenca_teste_v3";
  const DEPS_PADRAO = [["Administrativo", 5], ["Ambulatório", 3], ["Balança / Faturamento", 9], ["Campo", 18], ["Campo / Milho", 3], ["Cantina", 6], ["Comercial Cooperados", 4], ["Comercial Vendas", 12], ["Construção Civil", 1], ["Controle de Qualidade", 29], ["Elétrica e Manutenção", 26], ["Frotas", 2], ["Gestão da Qualidade", 3], ["Grãos", 19], ["Laboratório", 23], ["Limpeza", 20], ["Logística", 8], ["Portaria", 18], ["Produção", 175], ["Segurança do Trabalho", 5], ["Suprimentos / Compras", 7], ["TI", 11]];
  function sementeTeste() {
    const nomes = ["Ana", "Bruno", "Carla", "Diego", "Eduarda", "Fábio", "Gabriela", "Henrique", "Isabela", "João", "Karina", "Lucas", "Mariana", "Nicolas", "Olívia", "Paulo", "Queila", "Rafael", "Sabrina", "Tiago", "Úrsula", "Vinícius", "Wesley", "Yasmin", "Zeca"];
    const meio = ["Alves", "da Silva", "de Souza", "Pereira", "dos Santos", "Ferreira", "de Oliveira"];
    const sobren = ["Souza", "Lima", "Alves", "Rocha", "Martins", "Pereira", "Gomes", "Ribeiro", "Carvalho", "Costa", "Nunes", "Torres"];
    const colaboradores = [];
    let i = 0;
    DEPS_PADRAO.forEach(([dep, n]) => { for (let k = 0; k < n; k++, i++) colaboradores.push({ id: uuid(), nome: `${nomes[i % 25]} ${meio[i % 7]} ${sobren[i % 12]}`, departamento: dep }); });
    let s = 7;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const embaralhados = colaboradores.slice().sort(() => rnd() - .5).slice(0, 140);
    const agora = Date.now();
    const linhas = embaralhados.map((c) => {
      const x = rnd(), resp = x < .68 ? "sim" : x < .84 ? "talvez" : "nao";
      const y = rnd(), beb = resp === "nao" ? null : y < .46 ? "cerveja" : y < .7 ? "refrigerante" : y < .8 ? "suco" : y < .87 ? "agua" : y < .95 ? "tanto_faz" : null;
      const t = agora - Math.round(Math.pow(rnd(), 1.6) * 3.2 * 86400000);
      return { id: uuid(), colaborador_id: c.id, nome: c.nome, departamento: c.departamento, resposta: resp, bebida: beb, chave: null, criado_em: t, atualizado_em: t };
    });
    return {
      senha: "trocar123",
      config: { evento_nome: "Confraternização 2026", evento_data: "2026-12-04", evento_local: "Fazendinha", presenca_aberta: "sim", presenca_prazo: "até 01/12", presenca_departamentos: "" },
      colaboradores, linhas,
    };
  }
  const lerTeste = () => { let d = store.get(KEY_TESTE, null); if (!d) { d = sementeTeste(); store.set(KEY_TESTE, d); } return d; };
  const espera = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  function exigirSenha(d, senha) { if (senha !== d.senha) throw new Error("Senha incorreta."); }
  const teste = {
    async config() { await espera(60); return { ...lerTeste().config }; },
    async buscar(texto) {
      await espera(80);
      const q = normal(texto), palavras = q.split(" ").filter(Boolean);
      if (q.replace(/ /g, "").length < 3) return [];
      return lerTeste().colaboradores.filter((c) => palavras.every((w) => normal(c.nome).includes(w)))
        .sort((a, b) => (normal(b.nome).startsWith(q) - normal(a.nome).startsWith(q)) || a.nome.localeCompare(b.nome))
        .slice(0, 8).map((c) => ({ id: c.id, nome: c.nome, departamento: c.departamento }));
    },
    async confirmar(p) {
      await espera(300);
      const d = lerTeste();
      if (d.config.presenca_aberta !== "sim") throw new Error("As confirmações estão encerradas.");
      const c = d.colaboradores.find((x) => x.id === p.colaborador);
      if (!c) throw new Error("Procure e toque no seu nome na lista.");
      const bebida = p.resposta === "nao" ? null : p.bebida || null;
      const agora = Date.now();
      const existe = d.linhas.find((l) => l.colaborador_id === c.id);
      if (existe) {
        if (existe.chave !== p.chave) throw new Error("Esse nome já tem uma resposta, enviada de outro celular. Se for você e quiser mudar, fale com a organização.");
        Object.assign(existe, { resposta: p.resposta, bebida, atualizado_em: agora });
        if (p.id && p.id !== existe.id) d.linhas = d.linhas.filter((l) => !(l.id === p.id && l.chave === p.chave));
        store.set(KEY_TESTE, d); return existe.id;
      }
      const minhaAntiga = p.id && d.linhas.find((l) => l.id === p.id && l.chave === p.chave);
      if (minhaAntiga) { Object.assign(minhaAntiga, { colaborador_id: c.id, nome: c.nome, departamento: c.departamento, resposta: p.resposta, bebida, atualizado_em: agora }); store.set(KEY_TESTE, d); return minhaAntiga.id; }
      const l = { id: uuid(), colaborador_id: c.id, nome: c.nome, departamento: c.departamento, resposta: p.resposta, bebida, chave: p.chave, criado_em: agora, atualizado_em: agora };
      d.linhas.push(l); store.set(KEY_TESTE, d); return l.id;
    },
    async login(senha) { await espera(); return senha === lerTeste().senha; },
    async painel(senha) {
      await espera(80); const d = lerTeste(); exigirSenha(d, senha);
      return d.linhas.map((l) => ({ id: l.id, nome: l.nome, departamento: l.departamento, resposta: l.resposta, criado_em: new Date(l.criado_em).toISOString(), atualizado_em: new Date(l.atualizado_em).toISOString() }));
    },
    async pendentes(senha) {
      await espera(60); const d = lerTeste(); exigirSenha(d, senha);
      const resp = new Set(d.linhas.map((l) => l.colaborador_id));
      return d.colaboradores.filter((c) => !resp.has(c.id)).map((c) => ({ id: c.id, nome: c.nome, departamento: c.departamento }));
    },
    async bebidas(senha) {
      await espera(40); const d = lerTeste(); exigirSenha(d, senha);
      const m = new Map();
      d.linhas.filter((l) => l.resposta !== "nao").forEach((l) => {
        const k = [l.departamento, l.resposta, l.bebida || "sem_resposta"].join("|");
        m.set(k, (m.get(k) || 0) + 1);
      });
      return [...m].map(([k, qtd]) => { const [departamento, resposta, bebida] = k.split("|"); return { departamento, resposta, bebida, qtd }; });
    },
    // resumo público: só números
    async resumo() {
      await espera(60); const d = lerTeste();
      const m = new Map(), pega = (dep) => { if (!m.has(dep)) m.set(dep, { d: dep, sim: 0, talvez: 0, nao: 0, sem: 0 }); return m.get(dep); };
      const resp = new Map(d.linhas.map((l) => [l.colaborador_id, l]));
      d.colaboradores.forEach((c) => { const l = resp.get(c.id); pega(c.departamento)[l ? l.resposta : "sem"]++; });
      const bebidas = {};
      d.linhas.filter((l) => l.resposta === "sim").forEach((l) => { const k = l.bebida || "sem_resposta"; bebidas[k] = (bebidas[k] || 0) + 1; });
      return { deps: [...m.values()], bebidas, ultima: d.linhas.length ? new Date(Math.max(...d.linhas.map((l) => l.atualizado_em))).toISOString() : null };
    },
    async excluir(senha, id) { const d = lerTeste(); exigirSenha(d, senha); d.linhas = d.linhas.filter((l) => l.id !== id); store.set(KEY_TESTE, d); },
    async adicionarColaborador(senha, nome, departamento) {
      const d = lerTeste(); exigirSenha(d, senha);
      if (d.colaboradores.some((c) => normal(c.nome) === normal(nome))) throw new Error("Esse nome já está na lista.");
      const c = { id: uuid(), nome: nome.trim(), departamento: departamento.trim() }; d.colaboradores.push(c); store.set(KEY_TESTE, d); return c.id;
    },
    async salvarConfig(senha, chave, valor) { const d = lerTeste(); exigirSenha(d, senha); d.config[chave] = valor; store.set(KEY_TESTE, d); },
  };

  // ------------------------------------------------ Supabase (de verdade)
  function carregarScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Não foi possível conectar. Verifique a internet."));
      document.head.append(s);
    });
  }
  let sbPronto = null;
  function sb() {
    return (sbPronto ||= carregarScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js")
      .then(() => window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }))
      .catch((e) => { sbPronto = null; throw e; }));
  }
  function erro(e) {
    const msg = (e && e.message) || "";
    if (/failed to fetch|network|load failed/i.test(msg)) return new Error("Sem conexão. Verifique a internet e tente de novo.");
    if (/violates check constraint/i.test(msg)) return new Error("Algum campo ficou grande demais. Encurte o texto e tente de novo.");
    return new Error(msg || "Algo deu errado. Tente de novo.");
  }
  async function rpc(fn, args) { let r; try { r = await (await sb()).rpc(fn, args); } catch (e) { throw erro(e); } if (r.error) throw erro(r.error); return r.data; }
  const real = {
    async config() {
      let r; try { r = await (await sb()).from("confra_config").select("chave,valor").in("chave", CHAVES_CFG); } catch (e) { throw erro(e); }
      if (r.error) throw erro(r.error);
      const o = {}; (r.data || []).forEach((x) => { o[x.chave] = x.valor; }); return o;
    },
    async buscar(texto) { return (await rpc("confra_presenca_buscar", { p_texto: texto })) || []; },
    confirmar(p) { return rpc("confra_presenca_confirmar", { p_id: p.id || null, p_chave: p.chave, p_colaborador: p.colaborador, p_resposta: p.resposta, p_bebida: p.bebida || null }); },
    login(senha) { return rpc("confra_admin_login", { p_senha: senha }); },
    async painel(senha) { return (await rpc("confra_presenca_painel", { p_senha: senha })) || []; },
    async pendentes(senha) { return (await rpc("confra_presenca_pendentes", { p_senha: senha })) || []; },
    async bebidas(senha) { return ((await rpc("confra_presenca_bebidas", { p_senha: senha })) || []).map((x) => ({ ...x, qtd: Number(x.qtd) })); },
    async resumo() { return (await rpc("confra_presenca_resumo", {})) || { deps: [], bebidas: {}, ultima: null }; },
    excluir(senha, id) { return rpc("confra_admin_presenca_excluir", { p_senha: senha, p_id: id }); },
    adicionarColaborador(senha, nome, departamento) { return rpc("confra_admin_colaborador_adicionar", { p_senha: senha, p_nome: nome, p_departamento: departamento }); },
    salvarConfig(senha, chave, valor) { return rpc("confra_admin_config", { p_senha: senha, p_chave: chave, p_valor: valor }); },
  };
  const b = TESTE ? teste : real;

  return {
    TESTE, RESPOSTAS, BEBIDAS, departamentos, quadro, minha, normal,
    config: () => b.config(),
    buscar: (t) => b.buscar(t),
    // Envia a resposta deste aparelho (nova ou alteração) e guarda o necessário para alterar depois.
    // dados: { colaborador, nome, departamento, resposta, bebida }
    async responder(dados) {
      const atual = minha();
      const chave = (atual && atual.chave) || (uuid() + uuid()).replace(/-/g, "").slice(0, 40);
      const id = await b.confirmar({ ...dados, id: atual && atual.id, chave });
      guardarMinha({ id, chave, ...dados, quando: Date.now() });
      return id;
    },
    resumo: () => b.resumo(),
    login: (s) => b.login(s), painel: (s) => b.painel(s), pendentes: (s) => b.pendentes(s), bebidas: (s) => b.bebidas(s),
    excluir: (s, id) => b.excluir(s, id), adicionarColaborador: (s, n, d) => b.adicionarColaborador(s, n, d),
    salvarConfig: (s, k, v) => b.salvarConfig(s, k, v),
    resetarTeste() { store.del(KEY_TESTE); store.del("confra_presenca_minha_teste2"); },
    carregarScript,
  };
})();
