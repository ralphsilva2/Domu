// ============================================================
// DOMU — Conector Omie (v2)
// Serve o HTML + faz proxy das chamadas para a API Omie
// O usuario acessa: http://localhost:3000
// ============================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const urlMod = require('url');

const PORTA = 3000;
const OMIE_BASE = '/api/v1/';
const OMIE_HOST = 'app.omie.com.br';
const TIMEOUT_MS = 25000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const CACHE_COMPRA_TTL_MS = 60 * 1000;
const CACHE_ESTOQUE_TTL_MS = 30 * 1000;
const MAX_RESULTADOS_BUSCA = 50;
const REGISTROS_POR_PAGINA = 200;
const MAX_PAGINAS_RECEBIMENTOS_POR_BUSCA = 12;

// Estado da conexao
let appKey = '';
let appSecret = '';
let conectado = false;

// Cache de produtos
let cacheProdutos = [];
let cacheTimestamp = 0;
let cacheProdutosEmAndamento = null;
const cacheUltimaCompra = new Map();
const cachePosicaoEstoque = new Map();
const estoqueEmAndamento = new Map();

// Codigo do local de estoque DOMU (descoberto via ListarLocaisEstoque)
let codigoEstoqueDomu = null;


// ============================================================
// LOGGING
// ============================================================
function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${tag}] ${msg}`);
}

// ============================================================
// CHAMADA À API OMIE
// ============================================================
function chamarOmie(endpoint, call, param) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      call,
      app_key: appKey,
      app_secret: appSecret,
      param: Array.isArray(param) ? param : [param]
    });

    const opts = {
      hostname: OMIE_HOST,
      port: 443,
      path: OMIE_BASE + endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.faultstring) {
            log('OMIE', `FAULT: ${json.faultstring} (${json.faultcode || ''})`);
            const err = new Error(json.faultstring);
            err.isOmieFault = true;
            return reject(err);
          }
          resolve(json);
        } catch (e) {
          reject(new Error('Resposta invalida do Omie'));
        }
      });
    });

    req.on('error', err => {
      reject(new Error('Erro de conexao com Omie: ' + err.message));
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Timeout Omie (25s)'));
    });

    req.write(payload);
    req.end();
  });
}


// ============================================================
// LER BODY DO REQUEST
// ============================================================

// ============================================================
// CIRCUIT BREAKER — bloqueio por método Omie
// ============================================================
const circuitBreaker = new Map();

function parseRateLimit(msg) {
  const match = /Tente novamente em (\d+) segundos/i.exec(msg || '');
  if (match) return parseInt(match[1], 10);
  if (/bloqueada por consumo/i.test(msg || '')) return 60;
  return 0;
}

function registrarBloqueio(call, segundos) {
  circuitBreaker.set(call, { blockedUntil: Date.now() + segundos * 1000, retryAfterSeconds: segundos });
  log('CIRCUIT', `${call} bloqueado por ${segundos}s`);
}

function verificarBloqueio(call) {
  const info = circuitBreaker.get(call);
  if (!info) return null;
  if (Date.now() >= info.blockedUntil) { circuitBreaker.delete(call); return null; }
  return { code: 'OMIE_RATE_LIMIT', method: call, retryAfterSeconds: Math.ceil((info.blockedUntil - Date.now()) / 1000), blockedUntil: info.blockedUntil };
}

// ============================================================
// FILA DE CONCORRÊNCIA — máximo 3 chamadas simultâneas
// ============================================================
const MAX_CONCORRENCIA = 3;
let emExecucao = 0;
const filaEspera = [];

function executarComFila(fn) {
  return new Promise((resolve, reject) => {
    const executar = () => {
      emExecucao++;
      fn().then(resolve).catch(reject).finally(() => {
        emExecucao--;
        if (filaEspera.length > 0) (filaEspera.shift())();
      });
    };
    if (emExecucao < MAX_CONCORRENCIA) executar();
    else filaEspera.push(executar);
  });
}

function erroRateLimit(call, bloqueio) {
  const err = new Error(`OMIE_RATE_LIMIT: ${call} bloqueado por mais ${bloqueio.retryAfterSeconds}s`);
  err.isRateLimit = true;
  err.rateLimitInfo = bloqueio;
  return err;
}

// ============================================================
// CHAMADA OMIE COM CIRCUIT BREAKER E FILA
// ============================================================
function chamarOmieProtegido(endpoint, call, param) {
  const bloqueio = verificarBloqueio(call);
  if (bloqueio) return Promise.reject(erroRateLimit(call, bloqueio));
  return executarComFila(() => {
    // Reavaliar ao sair da fila: chamadas enfileiradas antes do bloqueio
    // não podem atingir o upstream depois que o método foi bloqueado.
    const bloqueioNaExecucao = verificarBloqueio(call);
    if (bloqueioNaExecucao) return Promise.reject(erroRateLimit(call, bloqueioNaExecucao));
    return chamarOmie(endpoint, call, param).catch(e => {
      const segundos = parseRateLimit(e.message);
      if (segundos > 0) {
        registrarBloqueio(call, segundos);
        e.isRateLimit = true;
        e.rateLimitInfo = { code: 'OMIE_RATE_LIMIT', method: call, retryAfterSeconds: segundos, blockedUntil: Date.now() + segundos * 1000 };
      }
      throw e;
    });
  });
}

// ============================================================
// DEDUPLICAÇÃO — uma cadeia por produtoId
// ============================================================
const compraEmAndamento = new Map();

function limparCachesOperacionais() {
  cacheProdutos = [];
  cacheTimestamp = 0;
  cacheProdutosEmAndamento = null;
  cacheUltimaCompra.clear();
  cachePosicaoEstoque.clear();
  estoqueEmAndamento.clear();
  compraEmAndamento.clear();
}

function limparCachesConsultas() {
  cacheUltimaCompra.clear();
  cachePosicaoEstoque.clear();
  estoqueEmAndamento.clear();
  compraEmAndamento.clear();
}


function lerBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

// ============================================================
// MAPEAR PRODUTO OMIE → FORMATO DOMU
// ============================================================
function mapProduto(p) {
  return {
    id: String(p.codigo_produto || ''),
    codigo: String(p.codigo || ''),
    descricao: String(p.descricao || ''),
    unidade: String(p.unidade || ''),
    ncm: String(p.ncm || ''),
    valorUnitario: Number(p.valor_unitario || 0),
    tipoItem: String(p.tipoItem || ''),
    inativo: String(p.inativo || 'N')
  };
}

// ============================================================
// PAGINAÇÃO COMPLETA — Carrega TODOS os produtos ATIVOS do Omie
// NÃO filtra por tipoItem — o catálogo completo é necessário.
// ============================================================
async function carregarTodosProdutos() {
  const todos = [];
  let pagina = 1;
  let totalPaginas = 1;

  do {
    log('OMIE', `ListarProdutos pagina=${pagina} registros=${REGISTROS_POR_PAGINA}`);
    const r = await chamarOmieProtegido('geral/produtos/', 'ListarProdutos', {
      pagina,
      registros_por_pagina: REGISTROS_POR_PAGINA,
      apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N',
      inativo: 'N'
    });

    const lista = (r.produto_servico_cadastro || []).filter(p =>
      String(p.inativo || 'N') !== 'S'
    );
    todos.push(...lista);
    totalPaginas = r.total_de_paginas || 1;

    if (pagina === 1) {
      log('OMIE', `OK ${r.total_de_registros || lista.length} produtos, ${totalPaginas} paginas`);
    } else {
      log('OMIE', `OK ${lista.length} produtos`);
    }

    pagina++;
  } while (pagina <= totalPaginas);

  return todos;
}


// ============================================================
// BUSCA COM PONTUAÇÃO — Relevância por código e descrição
// ============================================================
function normalizarBusca(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function normalizarCodigoBusca(str) {
  return normalizarBusca(str).replace(/[-_.\s]/g, '');
}

function pontuarProduto(produto, consulta) {
  const termo = normalizarBusca(consulta);
  const codigo = normalizarBusca(produto.codigo || '');
  const codigoCompacto = normalizarCodigoBusca(produto.codigo || '');
  const termoCompacto = normalizarCodigoBusca(consulta);
  const descricao = normalizarBusca(produto.descricao || '');

  if (codigo === termo || (termoCompacto && codigoCompacto === termoCompacto)) return 0;
  if (codigo.startsWith(termo) || (termoCompacto && codigoCompacto.startsWith(termoCompacto))) return 1;
  if (codigo.includes(termo) || (termoCompacto && codigoCompacto.includes(termoCompacto))) return 2;
  if (descricao.startsWith(termo)) return 3;
  if (descricao.includes(termo)) return 4;

  // Múltiplas palavras: todas presentes na descricao ou codigo
  const palavras = termo.split(/\s+/).filter(p => p.length >= 2);
  if (palavras.length > 1) {
    const textoCompleto = codigo + ' ' + descricao;
    if (palavras.every(p => textoCompleto.includes(p))) return 4;
  }

  return -1; // Não corresponde
}


// ============================================================
// REGRAS DE CATEGORIA MATERIAL — Classificação DOMU
// ============================================================
const REGRAS_CATEGORIA_MATERIAL = {
  'chapa-mdf': texto =>
    texto.includes('mdf'),

  'chapa-psai': texto =>
    texto.includes('psai') || /\bps\s*ai\b/.test(texto),

  'chapa-aco': texto =>
    texto.includes('chapa') &&
    (texto.includes('aco') || texto.includes('inox')),

  'chapa-acrilico': texto =>
    texto.includes('acril'),

  'chapa-petg': texto =>
    texto.includes('petg'),

  'tubo-quadrado': texto =>
    texto.includes('metalon') ||
    (texto.includes('tubo') &&
      (texto.includes('quadr') || /\btubo\s+quad\b/.test(texto))),

  'tubo-redondo': texto =>
    texto.includes('tubo') &&
    (texto.includes('redond') || /\btubo\s+red\b/.test(texto)),

  'arame': texto =>
    texto.includes('arame')
};

function produtoPertenceCategoria(produto, categoria) {
  const regra = REGRAS_CATEGORIA_MATERIAL[categoria];
  if (!regra) return false;
  const texto = normalizarBusca(
    `${produto.codigo || ''} ${produto.descricao || ''}`
  );
  return regra(texto);
}


// ============================================================
// CACHE DE PRODUTOS
// ============================================================
async function obterProdutosCache(forceRefresh = false) {
  const agora = Date.now();
  const cacheValido = !forceRefresh && cacheProdutos.length > 0 && (agora - cacheTimestamp) < CACHE_TTL_MS;

  if (cacheValido) {
    log('CACHE', `Usando cache (${cacheProdutos.length} produtos, idade: ${Math.round((agora - cacheTimestamp) / 1000)}s)`);
    return cacheProdutos;
  }

  if (cacheProdutosEmAndamento) {
    log('CACHE', 'Compartilhando carregamento em andamento...');
    return cacheProdutosEmAndamento;
  }

  cacheProdutosEmAndamento = (async () => {
    log('CACHE', 'Atualizando cache de produtos...');
    const produtos = await carregarTodosProdutos();
    cacheProdutos = produtos;
    cacheTimestamp = Date.now();
    log('CACHE', `Cache atualizado: ${cacheProdutos.length} produtos`);
    return cacheProdutos;
  })();
  try { return await cacheProdutosEmAndamento; }
  finally { cacheProdutosEmAndamento = null; }
}

// ============================================================
// SERVIR ARQUIVO ESTÁTICO
// ============================================================
function servirArquivo(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  try {
    const conteudo = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(conteudo);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Arquivo nao encontrado');
  }
}


// ============================================================
// UTILITÁRIOS DE RESPOSTA
// ============================================================
function jsonResponse(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function erroOmie(res, err) {
  if (err.code === 'OMIE_QUERY_BUDGET_EXCEEDED') {
    return jsonResponse(res, 503, {
      error: err.message,
      code: err.code,
      method: err.method,
      paginasConsultadas: err.paginasConsultadas,
      intervaloHistoricoConsultado: err.intervaloHistoricoConsultado,
      limiteConfigurado: err.limiteConfigurado
    });
  }
  if (err.isRateLimit) {
    const retryAfterSeconds = err.rateLimitInfo?.retryAfterSeconds || 60;
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return jsonResponse(res, 429, { error: err.message, code: 'OMIE_RATE_LIMIT', retryAfterSeconds });
  }
  if (err.isOmieFault) {
    return jsonResponse(res, 502, { error: `Omie: ${err.message}` });
  }
  return jsonResponse(res, 500, { error: err.message });
}

// ============================================================
// UTILITÁRIO DE DATA — formato DD/MM/YYYY
// ============================================================
function dataHoje() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function data2AnosAtras() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Calcula data N anos atras no formato DD/MM/YYYY
function dataNAnosAtras(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatarDataBR(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function criarJanelasHistoricas(quantidade = 6, anosPorJanela = 2) {
  const hoje = new Date();
  const janelas = [];
  let fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  for (let i = 0; i < quantidade; i++) {
    const inicio = new Date(hoje.getFullYear() - ((i + 1) * anosPorJanela), hoje.getMonth(), hoje.getDate());
    janelas.push({ inicio: formatarDataBR(inicio), fim: formatarDataBR(fim), indice: i });
    fim = new Date(inicio);
    fim.setDate(fim.getDate() - 1);
  }
  return janelas;
}

// Converte DD/MM/YYYY para Date para comparacao
function parseDataBR(str) {
  if (!str) return new Date(0);
  const partes = str.split('/');
  if (partes.length !== 3) return new Date(0);
  return new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
}

function chaveEstoque(idProd) {
  return `${String(idProd)}|${String(codigoEstoqueDomu)}|${dataHoje()}`;
}

async function obterPosicaoEstoque(idProd) {
  if (!idProd) throw new Error('codigo_produto ausente para PosicaoEstoque');
  if (codigoEstoqueDomu === null) return null;
  const chave = chaveEstoque(idProd);
  const cached = cachePosicaoEstoque.get(chave);
  if (cached && Date.now() - cached.timestamp < CACHE_ESTOQUE_TTL_MS) return cached.valor;
  if (estoqueEmAndamento.has(chave)) return estoqueEmAndamento.get(chave);
  const promessa = chamarOmieProtegido('estoque/consulta/', 'PosicaoEstoque', {
    id_prod: Number(idProd),
    codigo_local_estoque: codigoEstoqueDomu,
    data: dataHoje()
  }).then(valor => {
    cachePosicaoEstoque.set(chave, { timestamp: Date.now(), valor });
    return valor;
  });
  estoqueEmAndamento.set(chave, promessa);
  try { return await promessa; }
  finally { estoqueEmAndamento.delete(chave); }
}

// ============================================================
// DESCOBRIR LOCAL DE ESTOQUE DOMU
// ============================================================
// Chama ListarLocaisEstoque e busca o local com "DOMU" no codigo/descricao
// Armazena o codigo_local_estoque para uso nas chamadas PosicaoEstoque
// ============================================================
async function descobrirEstoqueDomu() {
  try {
    log('OMIE', 'ListarLocaisEstoque — buscando local DOMU');
    const resp = await chamarOmieProtegido('estoque/local/', 'ListarLocaisEstoque', {
      nPagina: 1,
      nRegPorPagina: 50
    });

    const locais = resp.locaisEncontrados || resp.locais || [];
    const localDomu = locais.find(l => {
      const codigo = String(l.codigo || l.cCodigo || '').toUpperCase();
      const descricao = String(l.descricao || l.cDescricao || l.cDescrLocalEstoque || '').toUpperCase();
      return codigo.includes('DOMU') || descricao.includes('DOMU');
    });

    if (localDomu) {
      codigoEstoqueDomu = localDomu.codigo_local_estoque || localDomu.nCodLocalEstoque || 0;
      log('OMIE', `Local de estoque DOMU encontrado: codigo_local_estoque=${codigoEstoqueDomu}`);
    } else {
      log('OMIE', 'AVISO: Local de estoque DOMU nao encontrado. Estoque NAO sera consultado.');
      codigoEstoqueDomu = null; // null means not found, no fallback
    }
  } catch (e) {
    log('OMIE', `AVISO: ListarLocaisEstoque falhou: ${e.message}. Estoque NAO sera consultado.`);
    codigoEstoqueDomu = null;
    throw e;
  }
}


// ============================================================
// BUSCA HISTÓRICA DE MOVIMENTOS DE COMPRA — Arquitetura DOMU
// ============================================================
// Janelas progressivas ~2 anos cada, até ~12 anos.
// Paginação completa em cada janela.
// Parser aceita movProdutoListar / movimentos / listaMovimentos.
// Filtra operação 21/22, exclui cancelamento/devolução/qtde<=0.
// Ordena por data mais recente.
// ============================================================

function extrairMovimentos(resposta) {
  const lista =
    resposta?.movProdutoListar ||
    resposta?.movimentos ||
    resposta?.listaMovimentos ||
    [];
  return Array.isArray(lista) ? lista : [];
}

function extrairTotalPaginas(resposta) {
  return resposta?.nTotPaginas || resposta?.total_de_paginas || resposta?.totalPaginas || 1;
}

function obterOperacao(m) {
  return String(m.operacao ?? m.cOperacao ?? '');
}

function obterIdMov(m) {
  return m.idMov ?? m.nIdMov ?? 0;
}

function obterDtMov(m) {
  return m.dtMov || m.dDtMov || m.dtEmissao || '';
}

function obterIdDoc(m) {
  return m.idDoc ?? m.nIdDoc ?? 0;
}

function movimentoEhCompraValida(m) {
  const op = obterOperacao(m);
  if (!['21', '22'].includes(op)) return false;
  if (String(m.cancelamento || 'N').toUpperCase() === 'S') return false;
  if (String(m.devolucao || 'N').toUpperCase() === 'S') return false;
  if ((m.qtde || 0) <= 0) return false;
  return true;
}

async function buscarMovimentosCompra(idProd, diagnostico = null) {
  const janelas = criarJanelasHistoricas();

  for (const janela of janelas) {
    const dtInicial = janela.inicio;
    const dtFinal = janela.fim;
    const rotulo = `${janela.indice * 2}-${(janela.indice + 1) * 2}`;
    log('OMIE', `ListarMovimentoEstoque idProd=${idProd} janela=${rotulo} anos [${dtInicial} a ${dtFinal}]`);

    const registro = { inicio: dtInicial, fim: dtFinal, janela: rotulo, resultado: 'executando', quantidadeMovimentos: 0 };
    if (diagnostico && diagnostico.janelasConsultadas) diagnostico.janelasConsultadas.push(registro);

    try {
      let todosMovimentos = [];
      let pagina = 1;
      let totalPaginas = 1;

      do {
        const movResp = await chamarOmieProtegido('estoque/consulta/', 'ListarMovimentoEstoque', {
          idProd: Number(idProd),
          dDtInicial: dtInicial,
          dDtFinal: dtFinal,
          nPagina: pagina,
          nRegPorPagina: 500,
          lista_local_estoque: 'TODOS'
        });

        const movimentos = extrairMovimentos(movResp);
        todosMovimentos.push(...movimentos);
        totalPaginas = extrairTotalPaginas(movResp);
        pagina++;
      } while (pagina <= totalPaginas);

      registro.quantidadeMovimentos = todosMovimentos.length;
      const compras = todosMovimentos.filter(movimentoEhCompraValida);

      if (compras.length > 0) {
        compras.sort((a, b) => parseDataBR(obterDtMov(b)).getTime() - parseDataBR(obterDtMov(a)).getTime());
        const movimentoCompra = compras[0];
        registro.resultado = 'compra_encontrada';
        log('OMIE', `Movimento compra encontrado janela ${rotulo} anos: idMov=${obterIdMov(movimentoCompra)} dt=${obterDtMov(movimentoCompra)}`);
        return movimentoCompra;
      }

      registro.resultado = 'sem_registros';
      log('OMIE', `Nenhuma compra na janela ${rotulo} anos, avancando...`);
    } catch (e) {
      // Rate limit: PARAR imediatamente
      if (e.isRateLimit) { registro.resultado = 'rate_limit'; throw e; }
      // "Não existem registros" = janela vazia, avançar normalmente
      if (/[Nn]ão existem registros/i.test(e.message)) {
        registro.resultado = 'sem_registros';
        log('OMIE', `Janela ${rotulo} sem registros (Omie), avancando...`);
        continue;
      }
      // Outro erro técnico: PARAR
      registro.resultado = 'erro';
      registro.erro = e.message;
      log('OMIE', `ListarMovimentoEstoque falhou janela ${rotulo}: ${e.message}`);
      throw e;
    }
  }

  log('OMIE', 'Nenhum movimento de compra encontrado em 12 anos');
  return null;
}

function extrairRecebimentos(resposta) {
  const lista = resposta?.recebimentos || resposta?.listaRecebimentos || resposta?.recebimentosEncontrados || [];
  return Array.isArray(lista) ? lista : [];
}

function indicadorSim(obj, campos) {
  return campos.some(campo => String(obj?.[campo] || '').toUpperCase() === 'S');
}

function entidadeInvalida(obj) {
  if (!obj) return false;
  if (indicadorSim(obj, ['cCancelado', 'cCancelada', 'cancelado', 'cancelada', 'cDevolvido', 'cDevolvida', 'devolvido', 'devolvida', 'cIgnorado', 'cIgnorar', 'ignorado'])) return true;
  const status = normalizarBusca(obj.cStatus || obj.status || obj.cSituacao || obj.situacao || '');
  return status.includes('cancel') || status.includes('devol') || status.includes('ignorado');
}

function cabecalhoRecebimento(recebimento) {
  return recebimento?.recebimentoCabec || recebimento?.cabec || recebimento?.cabecalho || recebimento || {};
}

function itensRecebimento(recebimento) {
  const itens = recebimento?.itens || recebimento?.itensRecebimento || recebimento?.produtos || [];
  return Array.isArray(itens) ? itens : [];
}

function dataRecebimento(recebimento) {
  const cabec = cabecalhoRecebimento(recebimento);
  return cabec.dtEmissao || cabec.dEmissaoNFe || cabec.dtEntrada || cabec.dDataEntrada || recebimento.dtEmissao || '';
}

function localizarItemRecebimento(recebimento, idProd) {
  if (entidadeInvalida(recebimento) || entidadeInvalida(cabecalhoRecebimento(recebimento))) return null;
  return itensRecebimento(recebimento).find(item => {
    const cabec = item?.itensCabec || item?.cabec || item || {};
    return !entidadeInvalida(item) && !entidadeInvalida(cabec)
      && Number(cabec.nIdProduto) === Number(idProd);
  }) || null;
}

async function buscarRecebimentoCompra(idProd, diagnostico = null) {
  const janelas = criarJanelasHistoricas();
  let paginasConsultadas = 0;
  const intervaloConsultado = { de: janelas[0].inicio, ate: janelas[0].fim };

  function erroOrcamento(janela) {
    intervaloConsultado.de = janela.inicio;
    const err = new Error(`OMIE_QUERY_BUDGET_EXCEEDED: ListarRecebimentos atingiu o limite de ${MAX_PAGINAS_RECEBIMENTOS_POR_BUSCA} páginas.`);
    err.code = 'OMIE_QUERY_BUDGET_EXCEEDED';
    err.method = 'ListarRecebimentos';
    err.paginasConsultadas = paginasConsultadas;
    err.intervaloHistoricoConsultado = { ...intervaloConsultado };
    err.limiteConfigurado = MAX_PAGINAS_RECEBIMENTOS_POR_BUSCA;
    return err;
  }

  for (const janela of janelas) {
    intervaloConsultado.de = janela.inicio;
    let pagina = 1;
    let totalPaginas = 1;
    do {
      if (paginasConsultadas >= MAX_PAGINAS_RECEBIMENTOS_POR_BUSCA) throw erroOrcamento(janela);
      let resp;
      try {
        resp = await chamarOmieProtegido('produtos/recebimentonfe/', 'ListarRecebimentos', {
          nPagina: pagina,
          nRegistrosPorPagina: 200,
          dtEmissaoDe: janela.inicio,
          dtEmissaoAte: janela.fim,
          cExibirDetalhes: 'S'
        });
      } catch (e) {
        if (e.isRateLimit) throw e;
        if (/[Nn]ão existem registros/i.test(e.message)) {
          resp = { recebimentos: [], nTotPaginas: 1 };
        } else {
          throw e;
        }
      }
      paginasConsultadas++;
      totalPaginas = extrairTotalPaginas(resp);
      const candidatos = extrairRecebimentos(resp)
        .map(recebimento => ({ recebimento, item: localizarItemRecebimento(recebimento, idProd) }))
        .filter(c => c.item)
        .sort((a, b) => parseDataBR(dataRecebimento(b.recebimento)) - parseDataBR(dataRecebimento(a.recebimento)));
      if (diagnostico?.recebimentosConsultados) diagnostico.recebimentosConsultados.push({
        inicio: janela.inicio,
        fim: janela.fim,
        pagina,
        totalPaginas,
        paginasConsultadas,
        candidatos: candidatos.length
      });
      if (candidatos.length) return candidatos[0];
      pagina++;
    } while (pagina <= totalPaginas);
  }
  return null;
}


// ============================================================
// ÚLTIMA COMPRA — Busca dados reais de NF-e de entrada
// ============================================================
// FLUXO:
// 1. ConsultarProduto(codigo) → info do produto + idProd
// 2. ListarMovimentoEstoque(idProd, 2 anos) → filtra operacao 21/22,
//    exclui cancelamento=S, ordena por dtEmissao desc → pega mais recente
// 3. SE movimento encontrado com idDoc:
//    a. ConsultarNotaEnt(idDoc) → detalhes da nota de entrada
//    b. Localiza item em nota.produtos onde nCodProd === idProd
//    c. Extrai nValUnit (CUSTO REAL)
//    d. Extrai ICMS, IPI, PIS, COFINS do item
//    e. Extrai numNFe, dtEmissao do cabec
// 4. SE movimento encontrado com idRecebimento:
//    a. ConsultarRecebimento(idRecebimento) → fornecedor, NF-e info
// 5. PosicaoEstoque(idProd) → saldo, cmc, fisico, reservado
// 6. Retorna resposta completa
//
// HIERARQUIA:
// 1. "ultima_compra" — nValUnit da ConsultarNotaEnt (PREFERIDO, contrato frontend)
// 2. "movimento_estoque" — informação auxiliar (frontend NÃO usa como custo automático)
// 3. "nao_encontrado" — sem historico de compra
//
// NUNCA usa valor_unitario do ConsultarProduto como custoUnitario.
// ============================================================

async function buscarUltimaCompra(idProd, codigoProduto, diagnostico = null) {
  const resultado = {
    fonteCusto: 'nao_encontrado',
    custoUnitario: 0,
    custoLiquidoUnitario: 0,
    dataUltimaCompra: '',
    numeroNota: '',
    fornecedor: '',
    idDocumentoOmie: '',
    idRecebimentoOmie: '',
    ipi: null,
    icms: null,
    pisCofins: null,
    fiscalCompraCompleto: false,
    tributosOrigem: '',
    valorUnitarioNota: 0,
    valorUnitarioMovimento: 0,
    cmc: 0,
    saldo: 0,
    fisico: 0,
    reservado: 0,
    dataEstoque: '',
    criterioSelecao: '',
    criterioVinculo: '',
    tratamentoFiscal: null,
    codigoProdutoNfe: codigoProduto || '',
    descricaoProdutoNfe: ''
  };

  // --- PASSO 2: Busca histórica de movimentos de compra ---
  let movimentoCompra = null;
  try {
    movimentoCompra = await buscarMovimentosCompra(idProd, diagnostico);
  } catch (e) {
    if (e.isRateLimit) throw e; // Propagar rate limit — NÃO mascarar
    log('OMIE', `Busca de movimentos de compra falhou: ${e.message}`);
    throw e; // Erro técnico NÃO é "nao_encontrado"
  }

  // --- PASSO 3: ConsultarNotaEnt (se movimento com idDoc) ---
  const idDocumento = movimentoCompra ? obterIdDoc(movimentoCompra) : 0;
  if (movimentoCompra && idDocumento) {
    try {
      log('OMIE', `ConsultarNotaEnt nCodNotaEnt=${idDocumento}`);
      const notaResp = await chamarOmieProtegido('produtos/notaentrada/', 'ConsultarNotaEnt', {
        nCodNotaEnt: idDocumento
      });

      const cabec = notaResp.cabec || {};
      const itens = notaResp.produtos || notaResp.itens || notaResp.produto_servico || [];

      // Localiza item na nota pelo nCodProd ou codigo_produto
      const itemNota = itens.find(p =>
        Number(p.nCodProd ?? p.codigo_produto ?? 0) === Number(idProd)
      );

      if (itemNota) {
        const nValUnit = Number(itemNota.nValUnit || 0);
        resultado.fonteCusto = 'ultima_compra';
        resultado.custoUnitario = nValUnit;
        resultado.custoLiquidoUnitario = nValUnit;
        resultado.valorUnitarioNota = nValUnit;
        resultado.dataUltimaCompra = cabec.dtEmissao || obterDtMov(movimentoCompra) || '';
        resultado.numeroNota = cabec.cNumNFe || movimentoCompra.numDoc || '';
        resultado.fornecedor = cabec.cNomeFornecedor || '';
        resultado.idDocumentoOmie = String(idDocumento || '');
        resultado.idRecebimentoOmie = String(movimentoCompra.idRecebimento || '');
        resultado.codigoProdutoNfe = itemNota.cCodigo || codigoProduto || '';
        resultado.descricaoProdutoNfe = itemNota.cDescricao || '';
        resultado.criterioSelecao = 'maior_data_emissao';
        resultado.criterioVinculo = 'nota_entrada_item';
        resultado.tributosOrigem = 'nota_entrada';
        resultado.fiscalCompraCompleto = true;

        // Extrai tributos
        resultado.icms = itemNota.ICMS?.nAliq ?? null;
        resultado.ipi = itemNota.IPI?.nAliqIPI ?? null;
        const pisAliq = itemNota.PIS?.nAliqPIS ?? null;
        const cofinsAliq = itemNota.COFINS?.nAliqCOFINS ?? null;
        resultado.pisCofins = (pisAliq !== null || cofinsAliq !== null)
          ? ((pisAliq || 0) + (cofinsAliq || 0)) || null
          : null;

        // Tratamento fiscal
        if (itemNota.custos) {
          resultado.tratamentoFiscal = {
            cICMSCusto: itemNota.custos.cICMSCusto || 'N',
            cIPICusto: itemNota.custos.cIPICusto || 'N',
            cPISCusto: itemNota.custos.cPISCusto || 'N',
            cCOFINSCusto: itemNota.custos.cCOFINSCusto || 'N'
          };
        }

        log('OMIE', `Nota entrada OK: nValUnit=${nValUnit} NF=${cabec.cNumNFe}`);
      } else {
        log('OMIE', `AVISO: Nota ${idDocumento} nao contem produto idProd=${idProd}`);
      }
    } catch (e) {
      log('OMIE', `ConsultarNotaEnt falhou: ${e.message}`);
      if (e.isRateLimit) throw e;
    }
  }

  // --- FALLBACK: movimento_estoque (informação auxiliar, frontend NÃO usa como custo automático) ---
  if (resultado.fonteCusto !== 'ultima_compra' && movimentoCompra) {
    const valorUnitRaw = (movimentoCompra.qtde && movimentoCompra.qtde > 0)
      ? movimentoCompra.valor / movimentoCompra.qtde
      : movimentoCompra.valor || 0;
    const valorUnit = Math.round(valorUnitRaw * 100) / 100;

    resultado.fonteCusto = 'movimento_estoque';
    resultado.custoUnitario = 0;
    resultado.custoLiquidoUnitario = 0;
    resultado.valorUnitarioMovimento = valorUnit;
    resultado.dataUltimaCompra = obterDtMov(movimentoCompra) || '';
    resultado.numeroNota = movimentoCompra.numDoc || '';
    resultado.idDocumentoOmie = String(idDocumento || '');
    resultado.idRecebimentoOmie = String(movimentoCompra.idRecebimento || '');
    resultado.criterioSelecao = 'maior_data_emissao';
    resultado.criterioVinculo = 'movimento_estoque';
    resultado.tributosOrigem = 'nao_disponivel';
    resultado.fiscalCompraCompleto = false;

    log('OMIE', `Fallback movimento: valorUnit=${valorUnit.toFixed(2)} dt=${obterDtMov(movimentoCompra)}`);
  }

  // Fallback documental independente do movimento. É obrigatório quando o
  // estoque não registra a entrada (inclusive cNaoGerarMovEstoque="S").
  if (resultado.fonteCusto !== 'ultima_compra') {
    const candidato = await buscarRecebimentoCompra(idProd, diagnostico);
    if (candidato) {
      const recebimento = candidato.recebimento;
      const cabec = cabecalhoRecebimento(recebimento);
      const itemCabec = candidato.item.itensCabec || candidato.item.cabec || candidato.item;
      const preco = Number(itemCabec.nPrecoUnit || 0);
      if (preco > 0) {
        resultado.fonteCusto = 'ultima_compra';
        resultado.custoUnitario = preco;
        resultado.custoLiquidoUnitario = preco;
        resultado.valorUnitarioNota = preco;
        resultado.dataUltimaCompra = dataRecebimento(recebimento);
        resultado.numeroNota = cabec.cNumeroNFe || cabec.cNumNFe || cabec.nNumeroNFe || '';
        resultado.fornecedor = cabec.cRazaoSocial || cabec.cNomeFornecedor || cabec.cNome || '';
        resultado.idRecebimentoOmie = String(cabec.nIdReceb || recebimento.nIdReceb || '');
        resultado.codigoProdutoNfe = itemCabec.cCodigoProduto || itemCabec.cCodigo || codigoProduto || '';
        resultado.descricaoProdutoNfe = itemCabec.cDescricaoProduto || itemCabec.cDescricao || '';
        resultado.criterioSelecao = 'maior_data_emissao';
        resultado.criterioVinculo = 'recebimento_item_id_interno';
        resultado.tributosOrigem = 'recebimento_nfe';
        resultado.icms = itemCabec.nAliqICMS ?? itemCabec.ICMS?.nAliq ?? null;
        resultado.ipi = itemCabec.nAliqIPI ?? itemCabec.IPI?.nAliqIPI ?? null;
        const pis = itemCabec.nAliqPIS ?? itemCabec.PIS?.nAliqPIS ?? null;
        const cofins = itemCabec.nAliqCOFINS ?? itemCabec.COFINS?.nAliqCOFINS ?? null;
        resultado.pisCofins = (pis !== null || cofins !== null) ? (Number(pis || 0) + Number(cofins || 0)) : null;
        resultado.fiscalCompraCompleto = [resultado.icms, resultado.ipi, resultado.pisCofins].some(v => v !== null);
      }
    }
  }

  // --- PASSO 4: ConsultarRecebimento (se idRecebimento disponivel) ---
  if (movimentoCompra && movimentoCompra.idRecebimento) {
    try {
      log('OMIE', `ConsultarRecebimento nIdReceb=${movimentoCompra.idRecebimento}`);
      const recResp = await chamarOmieProtegido('produtos/recebimentonfe/', 'ConsultarRecebimento', {
        nIdReceb: movimentoCompra.idRecebimento
      });
      if (recResp) {
        if (!resultado.fornecedor) resultado.fornecedor = recResp.cRazaoSocial || recResp.cNome || '';
        if (!resultado.numeroNota && recResp.cNumeroNFe) resultado.numeroNota = recResp.cNumeroNFe;
      }
    } catch (e) {
      log('OMIE', `ConsultarRecebimento falhou: ${e.message}`);
      if (e.isRateLimit) throw e;
    }
  }

  // --- PASSO 5: PosicaoEstoque (independente de última compra) ---
  if (codigoEstoqueDomu !== null) {
    try {
      log('OMIE', `PosicaoEstoque id_prod=${idProd} codigo_local_estoque=${codigoEstoqueDomu}`);
      const estResp = await obterPosicaoEstoque(idProd);
      if (estResp) {
        resultado.cmc = estResp.cmc || 0;
        resultado.saldo = estResp.saldo || 0;
        resultado.fisico = estResp.fisico || 0;
        resultado.reservado = estResp.reservado || 0;
        resultado.dataEstoque = dataHoje();
        log('OMIE', `Estoque: saldo=${resultado.saldo} cmc=${resultado.cmc} fisico=${resultado.fisico}`);
      }
    } catch (e) {
      log('OMIE', `PosicaoEstoque falhou: ${e.message}`);
      if (e.isRateLimit) throw e;
    }
  } else {
    log('OMIE', 'PosicaoEstoque ignorado: estoque DOMU nao identificado');
    resultado.dataEstoque = 'estoque_domu_nao_encontrado';
  }

  return resultado;
}


// ============================================================
// HANDLER PRINCIPAL
// ============================================================
async function handler(req, res) {
  const parsed = urlMod.parse(req.url, true);
  const caminho = parsed.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ==================== API ROUTES ====================

  // GET /api/omie/status
  if (caminho === '/api/omie/status' && req.method === 'GET') {
    log('DOMU', 'GET /api/omie/status');
    const resultado = {
      connected: conectado,
      configured: Boolean(appKey && appSecret),
      appKeyMasked: appKey ? appKey.slice(0, 4) + '****' + appKey.slice(-2) : ''
    };
    log('DOMU', '200 OK');
    return jsonResponse(res, 200, resultado);
  }


  // POST /api/omie/test
  if (caminho === '/api/omie/test' && req.method === 'POST') {
    log('DOMU', 'POST /api/omie/test');
    try {
      const body = JSON.parse(await lerBody(req) || '{}');
      const novaKey = body.appKey === undefined ? null : String(body.appKey).trim();
      const novoSecret = body.appSecret === undefined ? null : String(body.appSecret).trim();
      // Ambos vazios significam reutilizar a sessão já configurada.
      if (novaKey || novoSecret) {
        appKey = novaKey || '';
        appSecret = novoSecret || '';
      }

      if (!appKey || !appSecret) {
        log('DOMU', '400 Credenciais ausentes');
        return jsonResponse(res, 400, { error: 'Informe App Key e App Secret.' });
      }

      log('OMIE', 'ListarProdutos pagina=1 registros=1 (teste)');
      const r = await chamarOmieProtegido('geral/produtos/', 'ListarProdutos', {
        pagina: 1,
        registros_por_pagina: 1,
        apenas_importado_api: 'N',
        filtrar_apenas_omiepdv: 'N'
      });

      conectado = true;
      // Limpa cache ao reconectar com novas credenciais
      cacheProdutos = [];
      cacheTimestamp = 0;
      cacheUltimaCompra.clear();
      cachePosicaoEstoque.clear();

      // Descobre o local de estoque DOMU
      await descobrirEstoqueDomu();

      const p = (r.produto_servico_cadastro || [])[0] || {};
      const resultado = {
        connected: true,
        produtoTesteCodigo: p.codigo || p.codigo_produto || '',
        produtoTesteId: String(p.codigo_produto || ''),
        // O cadastro não prova última compra. Mantém o contrato do HTML sem
        // apresentar valor_unitario como custo histórico.
        custoTeste: 0,
        numeroNotaTeste: '',
        dataCompraTeste: '',
        appKeyMasked: appKey.slice(0, 4) + '****' + appKey.slice(-2)
      };

      log('DOMU', `200 OK — Produto teste: ${p.codigo_produto || '(vazio)'}`);
      return jsonResponse(res, 200, resultado);
    } catch (e) {
      conectado = false;
      log('DOMU', `400 Erro: ${e.message}`);
      if (e.isRateLimit) return erroOmie(res, e);
      return jsonResponse(res, 400, { error: e.message });
    }
  }


  // GET /api/omie/produtos?q=PSAI
  if (caminho === '/api/omie/produtos' && req.method === 'GET') {
    const q = (parsed.query.q || '').trim();
    log('DOMU', `GET /api/omie/produtos?q=${q}`);

    if (!conectado) {
      log('DOMU', '400 Nao conectado');
      return jsonResponse(res, 400, { error: 'Conecte-se ao Omie primeiro.' });
    }

    if (q.length < 2) {
      log('DOMU', '400 Termo muito curto');
      return jsonResponse(res, 400, { error: 'Minimo 2 caracteres para busca.' });
    }

    try {
      const todos = await obterProdutosCache();

      // Busca com pontuação — NÃO filtra por tipoItem
      const pontuados = [];
      for (const p of todos) {
        const score = pontuarProduto(p, q);
        if (score >= 0) pontuados.push({ p, score });
      }

      // Ordena por relevancia (menor score = mais relevante)
      pontuados.sort((a, b) => a.score - b.score);

      const resultado = { produtos: pontuados.slice(0, MAX_RESULTADOS_BUSCA).map(item => mapProduto(item.p)) };
      log('DOMU FILTER', `termo="${q}" => ${pontuados.length} resultados`);
      log('DOMU', '200 OK');
      return jsonResponse(res, 200, resultado);
    } catch (e) {
      return erroOmie(res, e);
    }
  }


  // GET /api/omie/materiais?categoria=chapa-psai
  // ============================================================
  // CATÁLOGO DE MATÉRIAS-PRIMAS para orçamento.
  // Fluxo: catálogo ativo → regra de categoria DOMU → PosicaoEstoque DOMU → saldo/fisico > 0
  // ============================================================
  if (caminho === '/api/omie/materiais' && req.method === 'GET') {
    const categoria = (parsed.query.categoria || '').trim().toLowerCase();
    log('DOMU', `GET /api/omie/materiais?categoria=${parsed.query.categoria || ''}`);

    if (!conectado) {
      log('DOMU', '400 Nao conectado');
      return jsonResponse(res, 400, { error: 'Conecte-se ao Omie primeiro.' });
    }

    if (!categoria) {
      log('DOMU', '400 Categoria obrigatoria');
      return jsonResponse(res, 400, { error: 'Informe a categoria do material.' });
    }

    if (!REGRAS_CATEGORIA_MATERIAL[categoria]) {
      log('DOMU', `400 Categoria desconhecida: ${categoria}`);
      return jsonResponse(res, 400, { error: `Categoria desconhecida: ${categoria}. Validas: ${Object.keys(REGRAS_CATEGORIA_MATERIAL).join(', ')}` });
    }

    try {
      const todos = await obterProdutosCache();

      // Passo 1: filtrar por regra de categoria
      if (codigoEstoqueDomu === null) {
        return jsonResponse(res, 503, { error: 'Estoque DOMU não identificado; não é possível confirmar materiais elegíveis.' });
      }
      const candidatos = todos.filter(p => produtoPertenceCategoria(p, categoria));
      log('DOMU', `Categoria "${categoria}": ${candidatos.length} candidatos`);

      // Passo 2: verificar estoque DOMU (saldo > 0 OU fisico > 0)
      let materiaisDisponiveis = [];
      if (codigoEstoqueDomu !== null && candidatos.length > 0) {
        const resultados = await Promise.all(
          candidatos.map(async (p) => {
            const idProd = p.codigo_produto;
            if (!idProd) return null;
            const est = await obterPosicaoEstoque(idProd);
            const saldo = est?.saldo || 0;
            const fisico = est?.fisico || 0;
            if (saldo > 0 || fisico > 0) {
              return { produto: p, saldo, fisico };
            }
            return null;
          })
        );
        materiaisDisponiveis = resultados.filter(r => r !== null);
      }

      const produtos = materiaisDisponiveis.map(r => {
        const mapped = mapProduto(r.produto);
        mapped.saldoEstoque = r.saldo;
        mapped.fisicoEstoque = r.fisico;
        return mapped;
      });

      log('DOMU', `${produtos.length} materiais com estoque DOMU retornados`);
      log('DOMU', '200 OK');
      return jsonResponse(res, 200, { produtos });
    } catch (e) {
      return erroOmie(res, e);
    }
  }


  // GET /api/omie/produto-compra?id=xxx&codigo=yyy
  // ============================================================
  // FLUXO "ÚLTIMA COMPRA":
  // 1. Catálogo → resolve codigo visível para codigo_produto (ID interno)
  // 2. ListarMovimentoEstoque → filtra compras (op 21/22), mais recente
  // 3. ConsultarNotaEnt → nValUnit real da NF-e (PREFERIDO)
  //    FALLBACK: valor/qtde do movimento
  // 4. ConsultarRecebimento → dados do fornecedor
  // 5. PosicaoEstoque → saldo, cmc, fisico, reservado
  //
  // NUNCA usa valor_unitario do cadastro como custo de compra.
  // ============================================================
  if (caminho === '/api/omie/produto-compra' && req.method === 'GET') {
    const id = (parsed.query.id || '').trim();
    const codigo = (parsed.query.codigo || '').trim();
    log('DOMU', `GET /api/omie/produto-compra?id=${id}&codigo=${codigo}`);

    if (!conectado) {
      log('DOMU', '400 Nao conectado');
      return jsonResponse(res, 400, { error: 'Conecte-se ao Omie primeiro.' });
    }

    if (!id && !codigo) {
      log('DOMU', '400 Sem id ou codigo');
      return jsonResponse(res, 400, { error: 'Informe id ou codigo do produto.' });
    }

    try {
      let produto = null;
      let idProd = null;

      // --- PASSO 1: Identificar produto SEM ConsultarProduto quando ID disponível ---
      if (id) {
        idProd = id;
        // Tentar encontrar no cache do catálogo
        if (cacheProdutos.length > 0) {
          const cached = cacheProdutos.find(p =>
            String(p.codigo_produto) === String(id) || String(p.codigo) === String(codigo)
          );
          if (cached) produto = mapProduto(cached);
        }
        // Se não encontrou no cache, montar objeto mínimo com dados disponíveis
        // NUNCA chamar ConsultarProduto quando ID já existe
        if (!produto) {
          produto = { id: String(id), codigo: String(codigo || ''), descricao: '', unidade: '', ncm: '', valorUnitario: 0, tipoItem: '', inativo: 'N' };
        }
      }

      // Resolve código visível pelo catálogo. Nunca o envia como codigo_produto,
      // pois esse parâmetro pertence ao namespace do ID interno.
      if (!idProd && codigo) {
        try {
          const todos = await obterProdutosCache();
          const encontrado = todos.find(p => String(p.codigo || '') === String(codigo));
          if (encontrado?.codigo_produto) {
            produto = mapProduto(encontrado);
            idProd = encontrado.codigo_produto;
          }
        } catch (e) {
          log('DOMU', `Resolução de código pelo catálogo falhou: ${e.message}`);
          throw e;
        }
      }

      // Fallback
      if (!idProd && id) idProd = id;

      // --- PASSOS 2-5: buscarUltimaCompra com deduplicação ---
      let compra;
      if (idProd) {
        // Deduplicação: se já existe uma busca em andamento para este produto, reutilizar
        const chaveDedup = String(idProd);
        if (compraEmAndamento.has(chaveDedup)) {
          compra = await compraEmAndamento.get(chaveDedup);
        } else {
          const cachedCompra = cacheUltimaCompra.get(chaveDedup);
          if (cachedCompra && Date.now() - cachedCompra.timestamp < CACHE_COMPRA_TTL_MS) {
            compra = cachedCompra.valor;
          } else {
          const promessa = buscarUltimaCompra(idProd, produto ? produto.codigo : codigo).then(valor => {
            cacheUltimaCompra.set(chaveDedup, { timestamp: Date.now(), valor });
            return valor;
          });
          compraEmAndamento.set(chaveDedup, promessa);
          try {
            compra = await promessa;
          } finally {
            compraEmAndamento.delete(chaveDedup);
          }
          }
        }
        if (!compra.descricaoProdutoNfe && produto) {
          compra.descricaoProdutoNfe = produto.descricao;
        }
      } else {
        // Sem idProd, retorna estrutura vazia
        compra = {
          fonteCusto: 'nao_encontrado',
          custoUnitario: 0,
          custoLiquidoUnitario: 0,
          dataUltimaCompra: '',
          numeroNota: '',
          fornecedor: '',
          idDocumentoOmie: '',
          idRecebimentoOmie: '',
          ipi: null,
          icms: null,
          pisCofins: null,
          fiscalCompraCompleto: false,
          tributosOrigem: '',
          valorUnitarioNota: 0,
          cmc: 0,
          saldo: 0,
          fisico: 0,
          reservado: 0,
          dataEstoque: '',
          criterioSelecao: '',
          criterioVinculo: '',
          tratamentoFiscal: null,
          codigoProdutoNfe: codigo || '',
          descricaoProdutoNfe: ''
        };
      }

      log('DOMU', `200 OK — fonteCusto=${compra.fonteCusto} custoUnitario=${compra.custoUnitario}`);
      return jsonResponse(res, 200, { produto, compra });
    } catch (e) {
      return erroOmie(res, e);
    }
  }


  // GET /api/omie/debug-campos?q=PSAI (TEMPORÁRIO — diagnóstico de campos brutos)
  if (caminho === '/api/omie/debug-campos' && req.method === 'GET') {
    const q = (parsed.query.q || '').trim().toLowerCase();
    log('DOMU', `GET /api/omie/debug-campos?q=${parsed.query.q || ''}`);

    if (!conectado) {
      return jsonResponse(res, 400, { error: 'Conecte-se ao Omie primeiro.' });
    }
    if (q.length < 2) {
      return jsonResponse(res, 400, { error: 'Minimo 2 caracteres.' });
    }

    try {
      const todos = await obterProdutosCache();
      const filtrados = todos.filter(p => {
        const cod = String(p.codigo || p.codigo_produto || '').toLowerCase();
        const desc = String(p.descricao || '').toLowerCase();
        return cod.includes(q) || desc.includes(q);
      });

      // Retorna campos brutos sem mapear, primeiros 10
      const resultado = filtrados.slice(0, 10).map(p => ({
        codigo: p.codigo || null,
        codigo_produto: p.codigo_produto || null,
        codigo_produto_integracao: p.codigo_produto_integracao || null,
        descricao: p.descricao || null,
        tipoItem: p.tipoItem || null,
        codigo_familia: p.codigo_familia || null,
        descricao_familia: p.descricao_familia || null,
        caracteristicas: p.caracteristicas || null,
        inativo: p.inativo || null,
        bloqueado: p.bloqueado || null
      }));

      log('DOMU', `debug-campos: ${resultado.length} produtos brutos retornados`);
      return jsonResponse(res, 200, { total: filtrados.length, campos: resultado });
    } catch (e) {
      return erroOmie(res, e);
    }
  }

  // GET /api/omie/debug-ultima-compra?id=xxx&codigo=yyy (TEMPORÁRIO — diagnóstico)
  // ============================================================
  // Usa EXATAMENTE buscarUltimaCompra() da produção com diagnóstico.
  // ZERO ConsultarProduto. ZERO chamadas extras.
  // ============================================================
  if (caminho === '/api/omie/debug-ultima-compra' && req.method === 'GET') {
    const id = (parsed.query.id || '').trim();
    const codigo = (parsed.query.codigo || '').trim();
    log('DOMU', `GET /api/omie/debug-ultima-compra?id=${id}&codigo=${codigo}`);

    if (!conectado) return jsonResponse(res, 400, { error: 'Conecte-se ao Omie primeiro.' });
    if (!id && !codigo) return jsonResponse(res, 400, { error: 'Informe id ou codigo.' });

    // produtoId direto — SEM ConsultarProduto
    const idProd = id || null;
    if (!idProd) return jsonResponse(res, 400, { error: 'Informe o id (codigo_produto Omie).' });

    const diag = {
      produtoId: idProd,
      codigo: codigo || null,
      janelasConsultadas: [],
      ultimaCompraCandidata: null,
      consultaNota: null,
      itemNotaEncontrado: null,
      resultadoFinal: { fonteCusto: 'nao_encontrado', custoUnitario: 0 }
    };

    try {
      // Chama a MESMA função da produção, passando diagnostico
      const compra = await buscarUltimaCompra(idProd, codigo, diag);
      diag.resultadoFinal = { fonteCusto: compra.fonteCusto, custoUnitario: compra.custoUnitario };
      if (compra.fonteCusto !== 'nao_encontrado') {
        diag.ultimaCompraCandidata = {
          numeroNota: compra.numeroNota,
          dataUltimaCompra: compra.dataUltimaCompra,
          valorUnitarioNota: compra.valorUnitarioNota,
          cmc: compra.cmc,
          saldo: compra.saldo
        };
      }
    } catch (e) {
      diag.resultadoFinal = { fonteCusto: 'erro', erro: e.message, isRateLimit: Boolean(e.isRateLimit) };
    }

    return jsonResponse(res, 200, diag);
  }


    // ==================== STATIC FILES ====================

  // Rota raiz → serve o HTML principal
  if (caminho === '/' || caminho === '/index.html') {
    return servirArquivo(res, path.join(__dirname, 'domu_dashboard_completo_74.html'));
  }

  // Qualquer outro arquivo estático na pasta
  const arquivo = path.join(__dirname, decodeURIComponent(caminho));
  // Seguranca: nao permitir traversal
  if (!arquivo.startsWith(__dirname)) {
    return jsonResponse(res, 403, { error: 'Acesso negado' });
  }

  if (fs.existsSync(arquivo) && fs.statSync(arquivo).isFile()) {
    return servirArquivo(res, arquivo);
  }

  jsonResponse(res, 404, { error: 'Nao encontrado: ' + caminho });
}

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const server = http.createServer(handler);

server.listen(PORTA, () => {
  console.log('');
  console.log('  =============================================');
  console.log('  DOMU - Conector Omie v2');
  console.log('  =============================================');
  console.log('');
  console.log('  Acesse no navegador:');
  console.log(`  http://localhost:${PORTA}`);
  console.log('');
  console.log('  NAO feche esta janela enquanto usa o DOMU.');
  console.log('');
});

// Export para testes
if (typeof module !== 'undefined') {
  module.exports = { server, handler, chamarOmie, chamarOmieProtegido, mapProduto, obterProdutosCache, buscarUltimaCompra, buscarMovimentosCompra, buscarRecebimentoCompra, descobrirEstoqueDomu, obterPosicaoEstoque, extrairMovimentos, extrairRecebimentos, extrairTotalPaginas, movimentoEhCompraValida, pontuarProduto, normalizarBusca, normalizarCodigoBusca, produtoPertenceCategoria, REGRAS_CATEGORIA_MATERIAL, criarJanelasHistoricas, circuitBreaker, registrarBloqueio, verificarBloqueio, parseRateLimit, compraEmAndamento, limparCachesOperacionais, limparCachesConsultas, MAX_PAGINAS_RECEBIMENTOS_POR_BUSCA, PORTA };
}
