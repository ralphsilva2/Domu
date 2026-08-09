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
    const r = await chamarOmie('geral/produtos/', 'ListarProdutos', {
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
    const resp = await chamarOmie('estoque/local/', 'ListarLocaisEstoque', {
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
// BUSCA PROGRESSIVA DE MOVIMENTOS DE COMPRA
// ============================================================
// Busca movimentos de compra (operacao 21/22) com janela progressiva:
// 1 ano → 3 anos → 5 anos → 10 anos (máximo)
// Só reporta "sem_ultima_compra" se nenhuma compra em 10 anos.
// ============================================================
async function buscarMovimentosCompra(idProd) {
  const janelas = [1, 3, 5, 10]; // anos

  for (const anos of janelas) {
    const dtInicial = dataNAnosAtras(anos);
    const dtFinal = dataHoje();
    log('OMIE', `ListarMovimentoEstoque idProd=${idProd} janela=${anos} ano(s) [${dtInicial} a ${dtFinal}]`);

    try {
      const movResp = await chamarOmie('estoque/consulta/', 'ListarMovimentoEstoque', {
        idProd: Number(idProd),
        dDtInicial: dtInicial,
        dDtFinal: dtFinal,
        nPagina: 1,
        nRegPorPagina: 500
      });

      const movimentos = movResp.movimentos || [];
      // Filtra: operacao 21 ou 22, exclui cancelamento=S
      const compras = movimentos.filter(m =>
        (m.operacao === '21' || m.operacao === '22') &&
        m.cancelamento !== 'S'
      );

      if (compras.length > 0) {
        // Ordena por dtEmissao desc (mais recente primeiro)
        compras.sort((a, b) => {
          const dA = parseDataBR(a.dtEmissao);
          const dB = parseDataBR(b.dtEmissao);
          return dB.getTime() - dA.getTime();
        });

        const movimentoCompra = compras[0];
        log('OMIE', `Movimento compra encontrado na janela de ${anos} ano(s): idMov=${movimentoCompra.idMov} dtEmissao=${movimentoCompra.dtEmissao} numDoc=${movimentoCompra.numDoc}`);
        return movimentoCompra;
      }

      log('OMIE', `Nenhum movimento de compra em ${anos} ano(s), expandindo busca...`);
    } catch (e) {
      // Se a API retornar erro (ex: periodo sem dados), continua para próxima janela
      log('OMIE', `ListarMovimentoEstoque falhou para janela ${anos} ano(s): ${e.message}`);
    }
  }

  log('OMIE', 'Nenhum movimento de compra encontrado em 10 anos (maximo)');
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
// HIERARQUIA DE FALLBACK:
// 1. "ultima_compra_nota_entrada" — nValUnit da ConsultarNotaEnt (PREFERIDO)
// 2. "ultima_compra_movimento" — valor/qtde do movimento (se nota inacessivel)
// 3. "sem_ultima_compra" — sem historico de compra (custoUnitario = 0)
//
// NUNCA usa valor_unitario do ConsultarProduto como custoUnitario.
// ============================================================

async function buscarUltimaCompra(idProd, codigoProduto) {
  const resultado = {
    fonteCusto: 'sem_ultima_compra',
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

  // --- PASSO 2: Busca progressiva de movimentos de compra ---
  let movimentoCompra = null;
  try {
    movimentoCompra = await buscarMovimentosCompra(idProd);
  } catch (e) {
    log('OMIE', `Busca de movimentos de compra falhou: ${e.message}`);
  }


  // --- PASSO 3: ConsultarNotaEnt (se movimento com idDoc) ---
  let notaEncontrada = false;
  if (movimentoCompra && movimentoCompra.idDoc) {
    try {
      // Omie API: ConsultarNotaEnt usa nCodNotaEnt
      // O campo idDoc do movimento de estoque corresponde ao nCodNotaEnt da Nota de Entrada
      // Documentação: POST /api/v1/produtos/notaentrada/ → ConsultarNotaEnt
      log('OMIE', `ConsultarNotaEnt nCodNotaEnt=${movimentoCompra.idDoc}`);
      const notaResp = await chamarOmie('produtos/notaentrada/', 'ConsultarNotaEnt', {
        nCodNotaEnt: movimentoCompra.idDoc
      });

      const cabec = notaResp.cabec || {};
      const produtos = notaResp.produtos || [];

      // Localiza item na nota pelo nCodProd
      const itemNota = produtos.find(p => p.nCodProd === Number(idProd));

      if (itemNota) {
        // Validação cruzada: numDoc e dtEmissao
        const numDocMatch = !cabec.cNumNFe || !movimentoCompra.numDoc || cabec.cNumNFe === movimentoCompra.numDoc;
        const dtMatch = !cabec.dtEmissao || !movimentoCompra.dtEmissao || cabec.dtEmissao === movimentoCompra.dtEmissao;

        if (!numDocMatch || !dtMatch) {
          log('OMIE', `AVISO: Nota ${movimentoCompra.idDoc} diverge do movimento (numDoc: ${cabec.cNumNFe} vs ${movimentoCompra.numDoc}, dt: ${cabec.dtEmissao} vs ${movimentoCompra.dtEmissao}) — usando nota pois produto ${idProd} foi encontrado`);
        }

        resultado.fonteCusto = 'ultima_compra_nota_entrada';
        resultado.custoUnitario = itemNota.nValUnit || 0;
        resultado.custoLiquidoUnitario = itemNota.nValUnit || 0;
        resultado.valorUnitarioNota = itemNota.nValUnit || 0;
        resultado.dataUltimaCompra = cabec.dtEmissao || movimentoCompra.dtEmissao || '';
        resultado.numeroNota = cabec.cNumNFe || movimentoCompra.numDoc || '';
        resultado.fornecedor = cabec.cNomeFornecedor || '';
        resultado.idDocumentoOmie = String(movimentoCompra.idDoc || '');
        resultado.idRecebimentoOmie = String(movimentoCompra.idRecebimento || '');
        resultado.codigoProdutoNfe = itemNota.cCodigo || codigoProduto || '';
        resultado.descricaoProdutoNfe = itemNota.cDescricao || '';
        resultado.criterioSelecao = 'maior_data_emissao';
        resultado.criterioVinculo = 'nota_entrada_item';
        resultado.tributosOrigem = 'nota_entrada';
        resultado.fiscalCompraCompleto = true;

        // Extrai tributos — campos oficiais da API Omie
        // Aliquotas e valores separados
        resultado.icmsAliquota = itemNota.ICMS?.nAliq ?? null;
        resultado.icmsValor = itemNota.ICMS?.nValor ?? null;
        resultado.ipiAliquota = itemNota.IPI?.nAliqIPI ?? null;
        resultado.ipiValor = itemNota.IPI?.nValorIPI ?? null;
        resultado.pisAliquota = itemNota.PIS?.nAliqPIS ?? null;
        resultado.pisValor = itemNota.PIS?.nValorPIS ?? null;
        resultado.cofinsAliquota = itemNota.COFINS?.nAliqCOFINS ?? null;
        resultado.cofinsValor = itemNota.COFINS?.nValorCOFINS ?? null;
        // Combined for backward compatibility with frontend
        resultado.icms = resultado.icmsAliquota;
        resultado.ipi = resultado.ipiAliquota;
        resultado.pis = resultado.pisAliquota;
        resultado.cofins = resultado.cofinsAliquota;
        resultado.pisCofins = ((resultado.pisAliquota || 0) + (resultado.cofinsAliquota || 0)) || null;

        // Tratamento fiscal (custos)
        if (itemNota.custos) {
          resultado.tratamentoFiscal = {
            cICMSCusto: itemNota.custos.cICMSCusto || 'N',
            cIPICusto: itemNota.custos.cIPICusto || 'N',
            cPISCusto: itemNota.custos.cPISCusto || 'N',
            cCOFINSCusto: itemNota.custos.cCOFINSCusto || 'N'
          };
        }

        notaEncontrada = true;
        log('OMIE', `Nota entrada OK: nValUnit=${itemNota.nValUnit} NF=${cabec.cNumNFe}`);
      } else {
        log('OMIE', `AVISO: Nota ${movimentoCompra.idDoc} nao contem produto idProd=${idProd} — nota incompativel`);
        // Do NOT set notaEncontrada = true
        // Fall through to the movement fallback
      }
    } catch (e) {
      log('OMIE', `ConsultarNotaEnt falhou: ${e.message}`);
    }
  }


  // --- FALLBACK: usa valor do movimento se nota nao acessivel ---
  if (!notaEncontrada && movimentoCompra) {
    const valorUnitRaw = (movimentoCompra.qtde && movimentoCompra.qtde > 0)
      ? movimentoCompra.valor / movimentoCompra.qtde
      : movimentoCompra.valor || 0;
    // Arredonda para 2 casas decimais para evitar imprecisao de ponto flutuante
    const valorUnit = Math.round(valorUnitRaw * 100) / 100;

    resultado.fonteCusto = 'ultima_compra_movimento';
    resultado.custoUnitario = valorUnit;
    resultado.custoLiquidoUnitario = valorUnit;
    resultado.valorUnitarioNota = valorUnit;
    resultado.dataUltimaCompra = movimentoCompra.dtEmissao || movimentoCompra.dtMov || '';
    resultado.numeroNota = movimentoCompra.numDoc || '';
    resultado.idDocumentoOmie = String(movimentoCompra.idDoc || '');
    resultado.idRecebimentoOmie = String(movimentoCompra.idRecebimento || '');
    resultado.criterioSelecao = 'maior_data_emissao';
    resultado.criterioVinculo = 'movimento_estoque';
    resultado.tributosOrigem = 'nao_disponivel';
    resultado.fiscalCompraCompleto = false;

    log('OMIE', `Fallback movimento: valorUnit=${valorUnit.toFixed(2)} dtEmissao=${movimentoCompra.dtEmissao}`);
  }

  // --- PASSO 4: ConsultarRecebimento (se idRecebimento disponivel) ---
  if (movimentoCompra && movimentoCompra.idRecebimento) {
    try {
      log('OMIE', `ConsultarRecebimento nIdReceb=${movimentoCompra.idRecebimento}`);
      const recResp = await chamarOmie('produtos/recebimentonfe/', 'ConsultarRecebimento', {
        nIdReceb: movimentoCompra.idRecebimento
      });

      if (recResp) {
        if (!resultado.fornecedor) {
          resultado.fornecedor = recResp.cRazaoSocial || recResp.cNome || '';
        }
        if (!resultado.numeroNota && recResp.cNumeroNFe) {
          resultado.numeroNota = recResp.cNumeroNFe;
        }
      }
    } catch (e) {
      log('OMIE', `ConsultarRecebimento falhou: ${e.message}`);
    }
  }


  // --- PASSO 5: PosicaoEstoque ---
  if (codigoEstoqueDomu !== null) {
    try {
      log('OMIE', `PosicaoEstoque id_prod=${idProd} codigo_local_estoque=${codigoEstoqueDomu}`);
      const estResp = await chamarOmie('estoque/consulta/', 'PosicaoEstoque', {
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
    log('OMIE', 'PosicaoEstoque ignorado: estoque DOMU nao identificado (codigo_local_estoque=null)');
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
              const est = await chamarOmie('estoque/consulta/', 'PosicaoEstoque', {
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

      // --- PASSO 1: ConsultarProduto ---
      if (codigo) {
        try {
          log('OMIE', `ConsultarProduto codigo_produto="${codigo}"`);
          const r = await chamarOmie('geral/produtos/', 'ConsultarProduto', { codigo_produto: codigo });
          if (r && r.codigo_produto) {
            produto = mapProduto(r);
            idProd = r.codigo_produto;
          }
        } catch (e) {
          log('DOMU', `ConsultarProduto por codigo falhou: ${e.message}`);
        }
      }

      if (!produto && id) {
        try {
          log('OMIE', `ConsultarProduto codigo_produto_integracao="${id}"`);
          const r = await chamarOmie('geral/produtos/', 'ConsultarProduto', { codigo_produto_integracao: id });
          if (r && r.codigo_produto) {
            produto = mapProduto(r);
            idProd = r.codigo_produto;
          }
        } catch (e) {
          log('DOMU', `ConsultarProduto por id falhou: ${e.message}`);
        }
      }

      // Use id parameter as fallback for idProd
      if (!idProd && id) idProd = id;

      // --- PASSOS 2-5: buscarUltimaCompra ---
      let compra;
      if (idProd) {
        compra = await buscarUltimaCompra(idProd, produto ? produto.codigo : codigo);
        // Set descricaoProdutoNfe from product if not set by nota
        if (!compra.descricaoProdutoNfe && produto) {
          compra.descricaoProdutoNfe = produto.descricao;
        }
      } else {
        // Sem idProd, retorna estrutura vazia
        compra = {
          fonteCusto: 'sem_ultima_compra',
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
  module.exports = { server, handler, chamarOmie, mapProduto, obterProdutosCache, buscarUltimaCompra, buscarMovimentosCompra, descobrirEstoqueDomu, pontuarProduto, normalizarBusca, normalizarCodigoBusca, produtoPertenceCategoria, REGRAS_CATEGORIA_MATERIAL, PORTA };
}
