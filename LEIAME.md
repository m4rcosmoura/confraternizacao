# Site da Confraternização

## Arquivos

| Arquivo | Para quem | O que é |
|---|---|---|
| `index.html` | Convidados (é o que o QR code abre) | Tela inicial com a arte do evento e os botões Cronograma, Fantasia e Talentos |
| `admin.html` | Só a organização | Painel com senha: abre e fecha votações, mostra resultados, edita o cronograma, gera o QR code |
| `telao.html` | A TV da festa | Apuração ao vivo da melhor fantasia, em tela cheia (abre sem senha) |
| `estilo.css` | – | Visual compartilhado pelas duas páginas |
| `dados.js` | – | Onde os dados são salvos (teste ou Supabase) |
| `supabase/schema.sql` | – | Banco de dados, para quando forem ligar de verdade |
| `artes/` | – | As três artes dos folders, usadas na tela inicial e na faixa dourada do topo |

Mantenha todos os arquivos na mesma pasta.

## O que cada seção faz

- **Cronograma**: horários da festa. No dia do evento, o item atual aparece como "Agora".
- **Fantasia**: lista pública de quem se inscreveu (aba "Concorrentes") e o formulário "Quero concorrer" (nome + qual é a fantasia; setor e foto opcionais).
- **Talentos**: lista pública das apresentações e o formulário "Quero me apresentar" (nome, apresentação, tipo, do que precisa, foto opcional).
- **Foto**: dois botões, "Tirar foto" (abre a câmera do celular) e "Escolher da galeria". É sempre opcional.
- **Editar inscrição**: quem se inscreveu vê "Sua inscrição" com o botão **Editar** (nome, fantasia/apresentação, setor, foto). Só funciona no celular que fez a inscrição.
- **Votação por nota**: fica bloqueada até a organização liberar no `admin.html`. Liberada, a aba passa a se chamar "Votar". A pessoa toca no candidato e dá de 1 a 5 estrelas, e pode avaliar todos. O ranking é pela **média das notas**.
- **Desempate**, nesta ordem: 1) quem recebeu **mais notas**; 2) quem recebeu **mais notas 5**; 3) mais notas 4; 4) mais notas 3; 5) mais notas 2. Se mesmo assim tudo for igual (mesma média, mesma quantidade e as mesmas estrelas), é **EMPATE**: os dois dividem a posição (ex.: 1º, 1º, 3º) e aparecem marcados como empate no telão, no painel e no site. Aí a **organização decide** (aplausos da plateia ou voto da comissão). No painel aparece quantas notas de cada estrela cada um recebeu.
- **Trava por aparelho**: cada celular dá **uma nota por candidato**. Se tentar de novo, a nota nova substitui a anterior (não soma). A identificação do aparelho fica guardada em 3 lugares do navegador; só apagando todos os dados do site ou usando aba anônima dá para votar de novo.
- **Voltar do celular**: de qualquer seção, volta direto para a tela inicial. Com a janela de estrelas aberta, o voltar só fecha a janela.

## Telão (TV)

Abra `telao.html` direto no navegador da TV (ou num computador ligado na TV). Não pede senha: já abre na apuração. Para tela cheia, aperte **OK** no controle da TV (ou clique na tela / tecla **F** no computador); o navegador só permite tela cheia depois de um toque. **Voltar** ou **Esc** sai. Se o navegador da TV não tiver tela cheia, a apuração se ajusta sozinha ao espaço da tela do mesmo jeito.

Como não tem senha, qualquer pessoa que abrir esse endereço vê o ranking ao vivo (nunca quem votou em quem).

- **Abertura**: vinheta com o título da festa, depois o painel entra em cena.
- **Antes das primeiras notas**: desfile dos concorrentes com foto e o aviso de que a votação está aberta (ou abre em breve).
- **Ao vivo**: o 1º lugar em destaque (foto grande, coroa, média e prêmio) e a classificação do 2º ao 10º com barra de média e número de notas. Atualiza a cada 5 segundos. Quando alguém sobe, a linha brilha e mostra ▲; cada nota nova aparece como "+1".
- **Nova liderança**: quando o 1º lugar muda, a tela escurece, entram faixas de cinema, a foto do novo líder e uma chuva de confete dourado (no máximo uma vez a cada 15 segundos).
- **Poucos concorrentes**: com 6 ou menos, a coluna da direita ganha um cartão "Vote pelo celular" com QR code.
- **Votação fechada no painel**: o selo vira "Votação encerrada" e o ranking fica parado.
- **Letreiro no rodapé**: como votar, regra do desempate, prêmios, horário da divulgação (lido do cronograma) e do 11º lugar em diante.
- A TV não apaga sozinha enquanto o telão estiver aberto (em navegadores que permitem) e o mouse some depois de alguns segundos parado (mexa o mouse para ver o botão "Tela cheia").

| Endereço | O que mostra |
|---|---|
| `telao.html` | Melhor fantasia |
| `telao.html?categoria=talento` | Show de talentos |
| `telao.html?demo` | Demonstração com concorrentes e notas inventados (não lê o banco). Serve para testar a TV antes da festa |

## Arte do evento

A tela inicial é um folder só, montado com as três artes da pasta `artes/` (`confra.webp`, `premios.webp`, `talentos.webp`). Os textos (lema, "Prepare-se para", votação e premiações) estão escritos no `index.html`; só o que é desenho (título, logo, faixa da data, pódio dos prêmios e faixa dourada do topo) vem recortado das imagens. Para mudar um texto, edite o `index.html`; se uma arte mudar, troque o arquivo na pasta `artes/` com o mesmo nome e tamanho.

## Agora: modo de teste

Abra o `index.html` com dois cliques. O painel é o `admin.html`, com a senha `trocar123`.

- Cronograma, inscritos (10 fantasias e 6 apresentações, alguns com foto) e algumas notas são exemplos.
- **Os dados ficam só no navegador de quem está usando.** Serve para ver as telas e o fluxo. Notas de celulares diferentes não se somam.
- Para recomeçar: `admin.html` → "Apagar todos os dados de teste".

Links diretos (úteis para QR codes específicos):

| Endereço | Abre em |
|---|---|
| `index.html` | Tela inicial |
| `index.html#cronograma` | Cronograma |
| `index.html#fantasia` | Concorrentes da fantasia (votação, quando liberada) |
| `index.html#fantasia-concorrer` | Cadastro de fantasia |
| `index.html#talentos` | Apresentações do show de talentos (votação, quando liberada) |
| `index.html#talentos-inscrever` | Inscrição no show de talentos |

## Depois: ligar o banco para a festa de verdade

1. Crie uma conta gratuita em supabase.com e um projeto novo.
2. No projeto, abra **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.
4. No `dados.js`, preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` (logo no começo do arquivo).
5. Publique a pasta num endereço público (ex.: arraste a pasta em app.netlify.com/drop).
6. Abra `.../admin.html` no endereço publicado (senha `trocar123`) e **troque a senha**.
7. No painel, em "QR code das mesas", confira o endereço e imprima os cartões.

Ao alterar `estilo.css` ou `dados.js` depois de publicado, aumente o número em `?v=20` nos links do `index.html` e do `admin.html`, para os celulares não usarem a versão antiga guardada.
