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
const MAX_RESULTADOS_BUSCA = 50;
const REGISTROS_POR_PAGINA = 200;

// Estado da conexao
let appKey = '';
let appSecret = '';
let conectado = false;

// Cache de produtos
let cacheProdutos = [];
let cacheTimestamp = 0;
let cacheCarregando = false;

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

// ============================================================
// CHAMADA OMIE COM CIRCUIT BREAKER E FILA
// ============================================================
function chamarOmieProtegido(endpoint, call, param) {
  const bloqueio = verificarBloqueio(call);
  if (bloqueio) {
    const err = new Error(`OMIE_RATE_LIMIT: ${call} bloqueado por mais ${bloqueio.retryAfterSeconds}s`);
    err.isRateLimit = true;
    err.rateLimitInfo = bloqueio;
    return Promise.reject(err);
  }
  return executarComFila(() => chamarOmie(endpoint, call, param).catch(e => {
    const segundos = parseRateLimit(e.message);
    if (segundos > 0) {
      registrarBloqueio(call, segundos);
      e.isRateLimit = true;
      e.rateLimitInfo = { code: 'OMIE_RATE_LIMIT', method: call, retryAfterSeconds: segundos, blockedUntil: Date.now() + segundos * 1000 };
    }
    throw e;
  }));
}

// ============================================================
// DEDUPLICAÇÃO — uma cadeia por produtoId
// ============================================================
const compraEmAndamento = new Map();


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
  const codigo = normalizarBusca(produto.codigo || produto.codigo_produto || '');
  const codigoCompacto = normalizarCodigoBusca(produto.codigo || produto.codigo_produto || '');
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

  if (cacheCarregando) {
    log('CACHE', 'Aguardando carregamento em andamento...');
    while (cacheCarregando) {
      await new Promise(r => setTimeout(r, 200));
    }
    return cacheProdutos;
  }

  cacheCarregando = true;
  try {
    log('CACHE', 'Atualizando cache de produtos...');
    cacheProdutos = await carregarTodosProdutos();
    cacheTimestamp = Date.now();
    log('CACHE', `Cache atualizado: ${cacheProdutos.length} produtos`);
    return cacheProdutos;
  } finally {
    cacheCarregando = false;
  }
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

// Converte DD/MM/YYYY para Date para comparacao
function parseDataBR(str) {
  if (!str) return new Date(0);
  const partes = str.split('/');
  if (partes.length !== 3) return new Date(0);
  return new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
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

async function buscarMovimentosCompra(idProd) {
  // Janelas NÃO sobrepostas: 0-2, 2-4, 4-6, 6-8, 8-10, 10-12 anos
  const janelas = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10], [10, 12]];

  for (const [anosInicio, anosFim] of janelas) {
    const dtInicial = dataNAnosAtras(anosFim);
    const dtFinal = anosInicio === 0 ? dataHoje() : dataNAnosAtras(anosInicio);
    log('OMIE', `ListarMovimentoEstoque idProd=${idProd} janela=${anosInicio}-${anosFim} anos [${dtInicial} a ${dtFinal}]`);

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

      const compras = todosMovimentos.filter(movimentoEhCompraValida);

      if (compras.length > 0) {
        compras.sort((a, b) => parseDataBR(obterDtMov(b)).getTime() - parseDataBR(obterDtMov(a)).getTime());
        const movimentoCompra = compras[0];
        log('OMIE', `Movimento compra encontrado janela ${anosInicio}-${anosFim} anos: idMov=${obterIdMov(movimentoCompra)} dt=${obterDtMov(movimentoCompra)}`);
        return movimentoCompra;
      }

      log('OMIE', `Nenhuma compra na janela ${anosInicio}-${anosFim} anos, avancando...`);
    } catch (e) {
      // Rate limit ou erro técnico: PARAR imediatamente, NÃO continuar janelas
      if (e.isRateLimit) throw e;
      log('OMIE', `ListarMovimentoEstoque falhou janela ${anosInicio}-${anosFim}: ${e.message}`);
      throw e; // Erro técnico NÃO significa janela vazia
    }
  }

  log('OMIE', 'Nenhum movimento de compra encontrado em 12 anos');
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

async function buscarUltimaCompra(idProd, codigoProduto) {
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
    movimentoCompra = await buscarMovimentosCompra(idProd);
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
        const nValUnit = itemNota.nValUnit || 0;
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
    }
  }

  // --- FALLBACK: movimento_estoque (informação auxiliar, frontend NÃO usa como custo automático) ---
  if (resultado.fonteCusto !== 'ultima_compra' && movimentoCompra) {
    const valorUnitRaw = (movimentoCompra.qtde && movimentoCompra.qtde > 0)
      ? movimentoCompra.valor / movimentoCompra.qtde
      : movimentoCompra.valor || 0;
    const valorUnit = Math.round(valorUnitRaw * 100) / 100;

    resultado.fonteCusto = 'movimento_estoque';
    resultado.custoUnitario = valorUnit;
    resultado.custoLiquidoUnitario = valorUnit;
    resultado.valorUnitarioNota = valorUnit;
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
    }
  }

  // --- PASSO 5: PosicaoEstoque (independente de última compra) ---
  if (codigoEstoqueDomu !== null) {
    try {
      log('OMIE', `PosicaoEstoque id_prod=${idProd} codigo_local_estoque=${codigoEstoqueDomu}`);
      const estResp = await chamarOmieProtegido('estoque/consulta/', 'PosicaoEstoque', {
        id_prod: Number(idProd),
        codigo_local_estoque: codigoEstoqueDomu,
        data: dataHoje()
      });
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
      if (body.appKey !== undefined) appKey = String(body.appKey).trim();
      if (body.appSecret !== undefined) appSecret = String(body.appSecret).trim();

      if (!appKey || !appSecret) {
        log('DOMU', '400 Credenciais ausentes');
        return jsonResponse(res, 400, { error: 'Informe App Key e App Secret.' });
      }

      log('OMIE', 'ListarProdutos pagina=1 registros=1 (teste)');
      const r = await chamarOmie('geral/produtos/', 'ListarProdutos', {
        pagina: 1,
        registros_por_pagina: 1,
        apenas_importado_api: 'N',
        filtrar_apenas_omiepdv: 'N'
      });

      conectado = true;
      // Limpa cache ao reconectar com novas credenciais
      cacheProdutos = [];
      cacheTimestamp = 0;

      // Descobre o local de estoque DOMU
      await descobrirEstoqueDomu();

      const p = (r.produto_servico_cadastro || [])[0] || {};
      const resultado = {
        connected: true,
        produtoTesteCodigo: p.codigo || p.codigo_produto || '',
        produtoTesteId: String(p.codigo_produto || ''),
        custoTeste: p.valor_unitario || 0,
        appKeyMasked: appKey.slice(0, 4) + '****' + appKey.slice(-2)
      };

      log('DOMU', `200 OK — Produto teste: ${p.codigo_produto || '(vazio)'}`);
      return jsonResponse(res, 200, resultado);
    } catch (e) {
      conectado = false;
      log('DOMU', `400 Erro: ${e.message}`);
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
      const candidatos = todos.filter(p => produtoPertenceCategoria(p, categoria));
      log('DOMU', `Categoria "${categoria}": ${candidatos.length} candidatos`);

      // Passo 2: verificar estoque DOMU (saldo > 0 OU fisico > 0)
      let materiaisDisponiveis = [];
      if (codigoEstoqueDomu !== null && candidatos.length > 0) {
        const resultados = await Promise.all(
          candidatos.map(async (p) => {
            const idProd = p.codigo_produto || p.codigo_produto_integracao;
            if (!idProd) return null;
            try {
              const est = await chamarOmieProtegido('estoque/consulta/', 'PosicaoEstoque', {
                id_prod: Number(idProd),
                codigo_local_estoque: codigoEstoqueDomu,
                data: dataHoje()
              });
              const saldo = est.saldo || 0;
              const fisico = est.fisico || 0;
              if (saldo > 0 || fisico > 0) {
                return { produto: p, saldo, fisico };
              }
              return null;
            } catch (e) {
              // Produto sem posição de estoque — não inclui
              return null;
            }
          })
        );
        materiaisDisponiveis = resultados.filter(r => r !== null);
      } else if (codigoEstoqueDomu === null) {
        // Estoque DOMU não identificado: retorna candidatos sem filtro de estoque
        log('DOMU', 'AVISO: Estoque DOMU nao identificado, retornando candidatos sem filtro de estoque');
        materiaisDisponiveis = candidatos.map(p => ({ produto: p, saldo: 0, fisico: 0 }));
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
  // 1. ConsultarProduto → info do produto + idProd (codigo_produto_integracao)
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

      // --- PASSO 1: Identificar produto SEM chamada desnecessária ---
      // Se ID está disponível, usar diretamente. Buscar dados no cache.
      if (id) {
        idProd = id;
        // Tentar encontrar no cache do catálogo (evita ConsultarProduto)
        if (cacheProdutos.length > 0) {
          const cached = cacheProdutos.find(p =>
            String(p.codigo_produto) === String(id) || String(p.codigo) === String(codigo)
          );
          if (cached) produto = mapProduto(cached);
        }
        // Se não encontrou no cache, buscar via API (necessário para r.body.produto)
        if (!produto) {
          try {
            const r2 = await chamarOmieProtegido('geral/produtos/', 'ConsultarProduto', { codigo_produto: id });
            if (r2 && r2.codigo_produto) { produto = mapProduto(r2); idProd = r2.codigo_produto; }
          } catch (e) {
            // Se codigo disponível, tentar por codigo
            if (codigo) {
              try {
                const r3 = await chamarOmieProtegido('geral/produtos/', 'ConsultarProduto', { codigo_produto: codigo });
                if (r3 && r3.codigo_produto) { produto = mapProduto(r3); idProd = r3.codigo_produto; }
              } catch (e2) { log('DOMU', `ConsultarProduto falhou: ${e2.message}`); }
            }
          }
        }
      }

      // Só chama ConsultarProduto se NÃO temos idProd e temos apenas codigo
      if (!idProd && codigo) {
        try {
          log('OMIE', `ConsultarProduto codigo_produto="${codigo}"`);
          const r = await chamarOmieProtegido('geral/produtos/', 'ConsultarProduto', { codigo_produto: codigo });
          if (r && r.codigo_produto) {
            produto = mapProduto(r);
            idProd = r.codigo_produto;
          }
        } catch (e) {
          log('DOMU', `ConsultarProduto por codigo falhou: ${e.message}`);
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
          const promessa = buscarUltimaCompra(idProd, produto ? produto.codigo : codigo);
          compraEmAndamento.set(chaveDedup, promessa);
          try {
            compra = await promessa;
          } finally {
            compraEmAndamento.delete(chaveDedup);
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
  // Executa as MESMAS chamadas de /api/omie/produto-compra mas retorna
  // diagnóstico detalhado de cada etapa. NUNCA retorna credenciais.
  // ============================================================
  if (caminho === '/api/omie/debug-ultima-compra' && req.method === 'GET') {
    const id = (parsed.query.id || '').trim();
    const codigo = (parsed.query.codigo || '').trim();
    log('DOMU', `GET /api/omie/debug-ultima-compra?id=${id}&codigo=${codigo}`);

    if (!conectado) return jsonResponse(res, 400, { error: 'Conecte-se ao Omie primeiro.' });
    if (!id && !codigo) return jsonResponse(res, 400, { error: 'Informe id ou codigo.' });

    const diag = {
      produtoId: null,
      codigo: codigo || null,
      etapas: [],
      movimentoRequest: null,
      movimentoResponse: null,
      todosMovimentos: [],
      comprasEncontradas: [],
      ultimaCompraCandidata: null,
      consultaNota: null,
      itemNotaEncontrado: null,
      resultadoFinal: { fonteCusto: 'nao_encontrado', custoUnitario: 0 }
    };

    try {
      // PASSO 1: ConsultarProduto
      let idProd = null;
      if (codigo) {
        try {
          const r = await chamarOmieProtegido('geral/produtos/', 'ConsultarProduto', { codigo_produto: codigo });
          if (r && r.codigo_produto) { idProd = r.codigo_produto; diag.etapas.push({ etapa: 'ConsultarProduto', ok: true, codigo_produto: r.codigo_produto }); }
        } catch (e) { diag.etapas.push({ etapa: 'ConsultarProduto(codigo)', erro: e.message }); }
      }
      if (!idProd && id) {
        try {
          const r = await chamarOmieProtegido('geral/produtos/', 'ConsultarProduto', { codigo_produto_integracao: id });
          if (r && r.codigo_produto) { idProd = r.codigo_produto; diag.etapas.push({ etapa: 'ConsultarProduto(integracao)', ok: true, codigo_produto: r.codigo_produto }); }
        } catch (e) { diag.etapas.push({ etapa: 'ConsultarProduto(integracao)', erro: e.message }); }
      }
      if (!idProd && id) idProd = id;
      diag.produtoId = idProd;

      if (!idProd) { diag.etapas.push({ etapa: 'ERRO', msg: 'Nenhum idProd identificado' }); return jsonResponse(res, 200, diag); }

      // PASSO 2: ListarMovimentoEstoque — TODOS os locais, janela 12 anos
      const dtInicial = dataNAnosAtras(12);
      const dtFinal = dataHoje();
      diag.movimentoRequest = { idProd: Number(idProd), dDtInicial: dtInicial, dDtFinal: dtFinal, lista_local_estoque: 'TODOS' };

      let pagina = 1;
      let totalPaginas = 1;
      let todosMovRaw = [];
      let movErro = null;

      do {
        try {
          const movResp = await chamarOmieProtegido('estoque/consulta/', 'ListarMovimentoEstoque', {
            idProd: Number(idProd),
            dDtInicial: dtInicial,
            dDtFinal: dtFinal,
            nPagina: pagina,
            nRegPorPagina: 500,
            lista_local_estoque: 'TODOS'
          });

          if (pagina === 1) {
            diag.movimentoResponse = {
              chavesResposta: Object.keys(movResp),
              nPagina: movResp.nPagina || pagina,
              nTotPaginas: extrairTotalPaginas(movResp),
              nTotRegistros: movResp.nTotRegistros || movResp.total_de_registros || 0,
              temMovProdutoListar: Array.isArray(movResp.movProdutoListar),
              quantidadeMovProdutoListar: (movResp.movProdutoListar || []).length,
              temMovimentos: Array.isArray(movResp.movimentos),
              quantidadeMovimentos: (movResp.movimentos || []).length
            };
          }

          const movimentos = extrairMovimentos(movResp);
          todosMovRaw.push(...movimentos);
          totalPaginas = extrairTotalPaginas(movResp);
          pagina++;
        } catch (e) {
          movErro = e.message;
          diag.etapas.push({ etapa: 'ListarMovimentoEstoque', erro: e.message, pagina });
          break;
        }
      } while (pagina <= totalPaginas);

      // Campos seguros de cada movimento (max 20)
      diag.todosMovimentos = todosMovRaw.slice(0, 20).map(m => ({
        idMov: obterIdMov(m), dtMov: obterDtMov(m), dtEmissao: m.dtEmissao || '',
        numDoc: m.numDoc || '', operacao: obterOperacao(m),
        cancelamento: m.cancelamento || '', devolucao: m.devolucao || '',
        idDoc: obterIdDoc(m), idRecebimento: m.idRecebimento || 0,
        codigo_local_estoque: m.codigo_local_estoque || m.nCodLocalEstoque || '',
        idProd: m.idProd || m.nIdProd || '', tipo: m.tipo || '',
        descricao: m.descricao || '', qtde: m.qtde || 0, valor: m.valor || 0
      }));

      // Filtrar compras válidas
      const compras = todosMovRaw.filter(movimentoEhCompraValida);
      diag.comprasEncontradas = compras.slice(0, 10).map(m => ({
        idMov: obterIdMov(m), dtMov: obterDtMov(m), numDoc: m.numDoc || '',
        operacao: obterOperacao(m), idDoc: obterIdDoc(m),
        idRecebimento: m.idRecebimento || 0, qtde: m.qtde || 0, valor: m.valor || 0
      }));

      if (compras.length === 0) {
        diag.etapas.push({ etapa: 'FiltroCompras', msg: `${todosMovRaw.length} movimentos brutos, 0 compras validas`, movErro });
        return jsonResponse(res, 200, diag);
      }

      // Ordenar e pegar mais recente
      compras.sort((a, b) => parseDataBR(obterDtMov(b)).getTime() - parseDataBR(obterDtMov(a)).getTime());
      const melhor = compras[0];
      diag.ultimaCompraCandidata = {
        idMov: obterIdMov(melhor), dtMov: obterDtMov(melhor), numDoc: melhor.numDoc || '',
        idDoc: obterIdDoc(melhor), idRecebimento: melhor.idRecebimento || 0,
        qtde: melhor.qtde || 0, valor: melhor.valor || 0
      };

      // PASSO 3: ConsultarNotaEnt
      const idDocumento = obterIdDoc(melhor);
      if (idDocumento) {
        try {
          const notaResp = await chamarOmieProtegido('produtos/notaentrada/', 'ConsultarNotaEnt', { nCodNotaEnt: idDocumento });
          const cabec = notaResp.cabec || {};
          const itens = notaResp.produtos || notaResp.itens || notaResp.produto_servico || [];
          diag.consultaNota = {
            notaEncontrada: true,
            nCodNotaEnt: idDocumento,
            cNumNFe: cabec.cNumNFe || '',
            dtEmissao: cabec.dtEmissao || '',
            quantidadeItens: itens.length,
            chavesNota: Object.keys(notaResp)
          };

          const itemNota = itens.find(p => Number(p.nCodProd ?? p.codigo_produto ?? 0) === Number(idProd));
          if (itemNota) {
            diag.itemNotaEncontrado = {
              encontrado: true,
              nCodProd: itemNota.nCodProd || itemNota.codigo_produto,
              nValUnit: itemNota.nValUnit || 0,
              cCodigo: itemNota.cCodigo || '',
              cDescricao: itemNota.cDescricao || ''
            };
            diag.resultadoFinal = { fonteCusto: 'ultima_compra', custoUnitario: itemNota.nValUnit || 0 };
          } else {
            diag.itemNotaEncontrado = { encontrado: false, idProdBuscado: Number(idProd), idsNota: itens.map(p => p.nCodProd || p.codigo_produto) };
            // Fallback movimento
            const vUnit = (melhor.qtde > 0) ? Math.round((melhor.valor / melhor.qtde) * 100) / 100 : 0;
            diag.resultadoFinal = { fonteCusto: 'movimento_estoque', custoUnitario: vUnit };
          }
        } catch (e) {
          diag.consultaNota = { notaEncontrada: false, nCodNotaEnt: idDocumento, erro: e.message };
          const vUnit = (melhor.qtde > 0) ? Math.round((melhor.valor / melhor.qtde) * 100) / 100 : 0;
          diag.resultadoFinal = { fonteCusto: 'movimento_estoque', custoUnitario: vUnit };
        }
      } else {
        diag.consultaNota = { notaEncontrada: false, motivo: 'idDoc=0 no movimento' };
        const vUnit = (melhor.qtde > 0) ? Math.round((melhor.valor / melhor.qtde) * 100) / 100 : 0;
        diag.resultadoFinal = { fonteCusto: 'movimento_estoque', custoUnitario: vUnit };
      }

      return jsonResponse(res, 200, diag);
    } catch (e) {
      diag.etapas.push({ etapa: 'ERRO_GERAL', erro: e.message });
      return jsonResponse(res, 200, diag);
    }
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
  module.exports = { server, handler, chamarOmie, chamarOmieProtegido, mapProduto, obterProdutosCache, buscarUltimaCompra, buscarMovimentosCompra, descobrirEstoqueDomu, extrairMovimentos, extrairTotalPaginas, movimentoEhCompraValida, pontuarProduto, normalizarBusca, normalizarCodigoBusca, produtoPertenceCategoria, REGRAS_CATEGORIA_MATERIAL, circuitBreaker, registrarBloqueio, verificarBloqueio, parseRateLimit, compraEmAndamento, PORTA };
}
