/* =====================================================================
   CONFIRMAÇÃO DE PRESENÇA: dados (anônima)
   Usa o mesmo banco (Supabase "brigada", tabelas confra_) do site da festa.
   A pessoa responde só: Vou / Ainda não sei / Não vou e, se vai ou talvez vá,
   a pergunta das bebidas (opcional). Não há nome nem departamento.
   Uma resposta por aparelho: o celular guarda uma chave e pode alterar a resposta.
   Com ?teste no endereço, tudo fica só no navegador (respostas de exemplo).
   ===================================================================== */
window.presenca = (function () {
  "use strict";
  const SUPABASE_URL = "https://paueyalgozwchzrkgfoq.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhdWV5YWxnb3p3Y2h6cmtnZm9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTU3MjEsImV4cCI6MjEwODA3MTcyMX0.kwnq470o2LbKwkqZJBYDxGs2rQpzQ0DLFlHPKyqOKT0";
  const TESTE = new URLSearchParams(location.search).has("teste");

  const RESPOSTAS = { sim: "Vou", talvez: "Ainda não sei", nao: "Não vou" };
  // Pergunta: "Para organizarmos melhor as bebidas da confraternização, qual opção combina com você?" (opcional)
  const BEBIDAS = {
    alcool: "Cerveja e/ou outras bebidas alcoólicas",
    sem_alcool: "Somente bebidas sem álcool",
    tanto_faz: "Tanto faz, posso consumir ambas",
    prefiro_nao: "Prefiro não responder",
    sem_resposta: "Não respondeu",
  };
  const OPCOES_BEBIDA = ["alcool", "sem_alcool", "tanto_faz", "prefiro_nao"];
  const CHAVES_CFG = ["evento_nome", "evento_data", "evento_local", "presenca_aberta", "presenca_prazo"];

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

  // A resposta deste aparelho (para poder alterar depois).
  const MINHA = TESTE ? "confra_presenca_voto_teste" : "confra_presenca_voto";
  const minha = () => store.get(MINHA, null);
  const guardarMinha = (m) => store.set(MINHA, m);

  // ------------------------------------------------ modo de teste (só no navegador)
  const KEY_TESTE = "confra_presenca_teste_v5";
  function sementeTeste() {
    let s = 7;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const agora = Date.now();
    const linhas = [];
    for (let i = 0; i < 160; i++) {
      const x = rnd(), resp = x < .68 ? "sim" : x < .84 ? "talvez" : "nao";
      const y = rnd(), beb = resp === "nao" ? null : y < .45 ? "alcool" : y < .7 ? "sem_alcool" : y < .88 ? "tanto_faz" : y < .94 ? "prefiro_nao" : null;
      const t = agora - Math.round(Math.pow(rnd(), 1.6) * 3.2 * 86400000);
      linhas.push({ id: uuid(), resposta: resp, bebida: beb, chave: null, criado_em: t, atualizado_em: t });
    }
    return { senha: "trocar123", config: { evento_nome: "Confraternização 2026", evento_data: "2026-12-04", evento_local: "Fazendinha", presenca_aberta: "sim", presenca_prazo: "até 01/12" }, linhas };
  }
  const lerTeste = () => { let d = store.get(KEY_TESTE, null); if (!d) { d = sementeTeste(); store.set(KEY_TESTE, d); } return d; };
  const espera = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  function exigirSenha(d, senha) { if (senha !== d.senha) throw new Error("Senha incorreta."); }
  function resumoDe(linhas) {
    const r = { sim: 0, talvez: 0, nao: 0, bebidas: {}, ultima: null };
    linhas.forEach((l) => { r[l.resposta]++; if (l.resposta === "sim") { const k = l.bebida || "sem_resposta"; r.bebidas[k] = (r.bebidas[k] || 0) + 1; } });
    if (linhas.length) r.ultima = new Date(Math.max(...linhas.map((l) => l.atualizado_em))).toISOString();
    return r;
  }
  const teste = {
    async config() { await espera(60); return { ...lerTeste().config }; },
    async votar(p) {
      await espera(300);
      const d = lerTeste();
      if (d.config.presenca_aberta !== "sim") throw new Error("As confirmações estão encerradas.");
      const bebida = p.resposta === "nao" ? null : p.bebida || null, agora = Date.now();
      const l = p.id && d.linhas.find((x) => x.id === p.id && x.chave === p.chave);
      if (l) { Object.assign(l, { resposta: p.resposta, bebida, atualizado_em: agora }); store.set(KEY_TESTE, d); return l.id; }
      const n = { id: uuid(), resposta: p.resposta, bebida, chave: p.chave, criado_em: agora, atualizado_em: agora };
      d.linhas.push(n); store.set(KEY_TESTE, d); return n.id;
    },
    async login(senha) { await espera(); return senha === lerTeste().senha; },
    async respostas(senha) {
      await espera(80); const d = lerTeste(); exigirSenha(d, senha);
      return d.linhas.map((l) => ({ id: l.id, resposta: l.resposta, bebida: l.bebida, criado_em: new Date(l.criado_em).toISOString(), atualizado_em: new Date(l.atualizado_em).toISOString() }));
    },
    async resumo() { await espera(60); return resumoDe(lerTeste().linhas); },
    async zerar(senha) { const d = lerTeste(); exigirSenha(d, senha); d.linhas = []; store.set(KEY_TESTE, d); },
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
    return new Error(msg || "Algo deu errado. Tente de novo.");
  }
  async function rpc(fn, args) { let r; try { r = await (await sb()).rpc(fn, args); } catch (e) { throw erro(e); } if (r.error) throw erro(r.error); return r.data; }
  const real = {
    async config() {
      let r; try { r = await (await sb()).from("confra_config").select("chave,valor").in("chave", CHAVES_CFG); } catch (e) { throw erro(e); }
      if (r.error) throw erro(r.error);
      const o = {}; (r.data || []).forEach((x) => { o[x.chave] = x.valor; }); return o;
    },
    votar(p) { return rpc("confra_presenca_votar", { p_id: p.id || null, p_chave: p.chave, p_resposta: p.resposta, p_bebida: p.bebida || null }); },
    login(senha) { return rpc("confra_admin_login", { p_senha: senha }); },
    async respostas(senha) { return (await rpc("confra_presenca_respostas", { p_senha: senha })) || []; },
    async resumo() { return (await rpc("confra_presenca_resumo", {})) || { sim: 0, talvez: 0, nao: 0, bebidas: {}, ultima: null }; },
    zerar(senha) { return rpc("confra_admin_presenca_zerar", { p_senha: senha }); },
    salvarConfig(senha, chave, valor) { return rpc("confra_admin_config", { p_senha: senha, p_chave: chave, p_valor: valor }); },
  };
  const b = TESTE ? teste : real;

  return {
    TESTE, RESPOSTAS, BEBIDAS, OPCOES_BEBIDA, minha,
    config: () => b.config(),
    // Envia a resposta deste aparelho (nova ou alteração). dados: { resposta, bebida }
    async votar(dados) {
      const atual = minha();
      const chave = (atual && atual.chave) || (uuid() + uuid()).replace(/-/g, "").slice(0, 40);
      const id = await b.votar({ ...dados, id: atual && atual.id, chave });
      guardarMinha({ id, chave, ...dados, quando: Date.now() });
      return id;
    },
    login: (s) => b.login(s), respostas: (s) => b.respostas(s), resumo: () => b.resumo(),
    zerar: (s) => b.zerar(s), salvarConfig: (s, k, v) => b.salvarConfig(s, k, v),
    resetarTeste() { store.del(KEY_TESTE); store.del("confra_presenca_voto_teste"); },
    carregarScript,
  };
})();
