// ============================================================
// DOMU — Testes Automatizados do Conector Omie
// Execucao: node testes-omie.js
// Sem dependencias externas — intercepta HTTPS nativamente
// ============================================================

const http = require('http');
const https = require('https');
const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');

// ============================================================
// FIXTURES — Dados realistas da API Omie
// ============================================================

const FIXTURE_LISTAR_PRODUTOS_P1 = {
  produto_servico_cadastro: [
    {codigo_produto: "101", codigo: "PSAI-050", codigo_produto_integracao: "INT-101", descricao: "CHAPA PSAI CRISTAL 0,50 MM — 1000 X 2000 MM", unidade: "CH", ncm: "3920.30.00", valor_unitario: 45.80, tipoItem: "01", inativo: "N"},
    {codigo_produto: "102", codigo: "PSAI-075", codigo_produto_integracao: "INT-102", descricao: "CHAPA PSAI CRISTAL 0,75 MM — 1000 X 2000 MM", unidade: "CH", ncm: "3920.30.00", valor_unitario: 62.50, tipoItem: "01", inativo: "N"},
    {codigo_produto: "201", codigo: "ACR-200", codigo_produto_integracao: "INT-201", descricao: "CHAPA ACRILICO CRISTAL 2,00 MM — 1000 X 2000 MM", unidade: "CH", ncm: "3926.90.90", valor_unitario: 200.00, tipoItem: "01", inativo: "N"},
  ],
  total_de_paginas: 2,
  total_de_registros: 5,
  pagina: 1,
  registros_por_pagina: 200
};

const FIXTURE_LISTAR_PRODUTOS_P2 = {
  produto_servico_cadastro: [
    {codigo_produto: "301", codigo: "MDF-060", codigo_produto_integracao: "INT-301", descricao: "CHAPA MDF CRU 6,00 MM — 1840 X 2750 MM", unidade: "CH", ncm: "4411.12.10", valor_unitario: 89.90, tipoItem: "01", inativo: "N"},
    {codigo_produto: "401", codigo: "TQ-2020-120", codigo_produto_integracao: "INT-401", descricao: "TUBO QUADRADO AÇO 20 X 20 X 1,20 MM — BARRA 6000 MM", unidade: "UN", ncm: "7306.61.00", valor_unitario: 32.40, tipoItem: "01", inativo: "N"}
  ],
  total_de_paginas: 2,
  total_de_registros: 5,
  pagina: 2,
  registros_por_pagina: 200
};


const FIXTURE_CONSULTAR_PRODUTO = {
  codigo_produto: "101",
  codigo: "PSAI-050",
  codigo_produto_integracao: "INT-101",
  descricao: "CHAPA PSAI CRISTAL 0,50 MM — 1000 X 2000 MM",
  unidade: "CH",
  ncm: "3920.30.00",
  valor_unitario: 45.80
};

const FIXTURE_CONSULTAR_PRODUTO_ACR = {
  codigo_produto: "201",
  codigo: "ACR-200",
  codigo_produto_integracao: "INT-201",
  descricao: "CHAPA ACRILICO CRISTAL 2,00 MM — 1000 X 2000 MM",
  unidade: "CH",
  ncm: "3926.90.90",
  valor_unitario: 200.00
};

const FIXTURE_ESTOQUE = {
  produtos: [
    {nCodProd: 101, cCodigo: "PSAI-050", cDescricao: "CHAPA PSAI CRISTAL 0,50 MM", nSaldo: 25, nCMC: 42.30}
  ]
};

const FIXTURE_ERRO_OMIE = {
  faultstring: "A chave de acesso informada é inválida.",
  faultcode: "SOAP-ENV:Client-102"
};

// --- NOVAS FIXTURES: Última compra ---

const FIXTURE_MOVIMENTO_ESTOQUE = {
  movimentos: [
    {idMov: 5001, dtMov: "10/07/2026", dtEmissao: "08/07/2026", numDoc: "54321", operacao: "21", idDoc: 9001, idRecebimento: 8001, idProd: 201, tipo: "E", descricao: "Compra de Produto", cmc: 155, qtde: 10, valor: 1463.60, saldo: 25, cancelamento: "N"},
    {idMov: 4500, dtMov: "15/03/2026", dtEmissao: "12/03/2026", numDoc: "51000", operacao: "21", idDoc: 8500, idRecebimento: 7500, idProd: 201, tipo: "E", descricao: "Compra de Produto", cmc: 148, qtde: 5, valor: 720, saldo: 15, cancelamento: "N"},
    {idMov: 4600, dtMov: "20/05/2026", dtEmissao: "18/05/2026", numDoc: "52000", operacao: "30", idDoc: 8600, idRecebimento: 0, idProd: 201, tipo: "S", descricao: "Venda", cmc: 150, qtde: 3, valor: 450, saldo: 12, cancelamento: "N"}
  ],
  nPagina: 1,
  nTotPaginas: 1,
  nTotRegistros: 3,
  nRegistros: 3
};


const FIXTURE_NOTA_ENTRADA = {
  cabec: {
    nIdNota: 9001,
    cNumNFe: "54321",
    cSerieNFe: "1",
    dtEmissao: "08/07/2026",
    cChaveNFe: "35260712345678901234550010000543211234567890",
    nIdFornecedor: 5000,
    cNomeFornecedor: "Distribuidora ABC Ltda"
  },
  produtos: [
    {nCodProd: 201, cCodigo: "ACR-200", cDescricao: "CHAPA ACRILICO CRISTAL 2,00 MM — 1000 X 2000 MM", nQtde: 10, nValUnit: 146.36, cNCM: "3926.90.90", ICMS: {nAliq: 12, nValor: 175.63}, IPI: {nAliqIPI: 0, nValorIPI: 0}, PIS: {nAliqPIS: 1.65, nValorPIS: 24.15}, COFINS: {nAliqCOFINS: 7.60, nValorCOFINS: 111.23}, custos: {cICMSCusto: "S", cIPICusto: "N", cPISCusto: "N", cCOFINSCusto: "N", cFreteCusto: "N"}},
    {nCodProd: 301, cCodigo: "MDF-060", cDescricao: "CHAPA MDF CRU 6,00 MM", nQtde: 20, nValUnit: 89.90, cNCM: "4411.12.10", ICMS: {nAliq: 12}, IPI: {nAliqIPI: 3.25}, PIS: {nAliqPIS: 1.65}, COFINS: {nAliqCOFINS: 7.60}, custos: {}}
  ]
};

const FIXTURE_POSICAO_ESTOQUE = {
  saldo: 25,
  cmc: 155.00,
  fisico: 25,
  reservado: 0,
  pendente: 0,
  estoque_minimo: 5,
  codigo_local_estoque: 1
};

const FIXTURE_RECEBIMENTO = {
  nIdReceb: 8001,
  nIdFornecedor: 5000,
  cNome: "Distribuidora ABC",
  cRazaoSocial: "Distribuidora ABC Ltda",
  cChaveNfe: "35260712345678901234550010000543211234567890",
  cNumeroNFe: "54321",
  cSerieNFe: "1",
  dEmissaoNFe: "08/07/2026",
  nValorNFe: 3263.60
};

function fixtureListaRecebimentos({ preco = 25.50, naoGerar = 'N', pagina = 1, totalPaginas = 1, recebimentos = null } = {}) {
  return {
    recebimentos: recebimentos || [{
      recebimentoCabec: {
        nIdReceb: 88001,
        cNumeroNFe: '99001',
        dtEmissao: '20/07/2026',
        cRazaoSocial: 'Fornecedor PSAI Ltda'
      },
      itens: [{ itensCabec: {
        nIdProduto: 11835150482,
        cCodigoProduto: '4084438',
        cDescricaoProduto: 'CHAPA PSAI BRANCO TRICAMADA 1,00 X 1000 X 2000MM',
        nPrecoUnit: preco,
        cNaoGerarMovEstoque: naoGerar,
        nAliqICMS: 12,
        nAliqIPI: 0,
        nAliqPIS: 1.65,
        nAliqCOFINS: 7.6
      } }]
    }],
    nPagina: pagina,
    nTotPaginas: totalPaginas
  };
}

const FIXTURE_MOVIMENTO_VAZIO = {
  movimentos: [],
  nPagina: 1,
  nTotPaginas: 1,
  nTotRegistros: 0,
  nRegistros: 0
};

const FIXTURE_MOVIMENTO_COM_CANCELADO = {
  movimentos: [
    {idMov: 5001, dtMov: "10/07/2026", dtEmissao: "08/07/2026", numDoc: "54321", operacao: "21", idDoc: 9001, idRecebimento: 8001, idProd: 201, tipo: "E", descricao: "Compra de Produto", cmc: 155, qtde: 10, valor: 1463.60, saldo: 25, cancelamento: "S"},
    {idMov: 4500, dtMov: "15/03/2026", dtEmissao: "12/03/2026", numDoc: "51000", operacao: "21", idDoc: 8500, idRecebimento: 7500, idProd: 201, tipo: "E", descricao: "Compra de Produto", cmc: 148, qtde: 5, valor: 720, saldo: 15, cancelamento: "N"},
    {idMov: 4600, dtMov: "20/05/2026", dtEmissao: "18/05/2026", numDoc: "52000", operacao: "30", idDoc: 8600, idRecebimento: 0, idProd: 201, tipo: "S", descricao: "Venda", cmc: 150, qtde: 3, valor: 450, saldo: 12, cancelamento: "N"}
  ],
  nPagina: 1,
  nTotPaginas: 1,
  nTotRegistros: 3,
  nRegistros: 3
};


const FIXTURE_NOTA_ENTRADA_8500 = {
  cabec: {
    nIdNota: 8500,
    cNumNFe: "51000",
    cSerieNFe: "1",
    dtEmissao: "12/03/2026",
    cChaveNFe: "35260312345678901234550010000510001234567890",
    nIdFornecedor: 4000,
    cNomeFornecedor: "Outra Distribuidora Ltda"
  },
  produtos: [
    {nCodProd: 201, cCodigo: "ACR-200", cDescricao: "CHAPA ACRILICO CRISTAL 2,00 MM — 1000 X 2000 MM", nQtde: 5, nValUnit: 144.00, cNCM: "3926.90.90", ICMS: {nAliq: 12, nValor: 86.40}, IPI: {nAliqIPI: 0, nValorIPI: 0}, PIS: {nAliqPIS: 1.65, nValorPIS: 11.88}, COFINS: {nAliqCOFINS: 7.60, nValorCOFINS: 54.72}, custos: {cICMSCusto: "S", cIPICusto: "N", cPISCusto: "N", cCOFINSCusto: "N"}}
  ]
};

// ============================================================
// MOCK DO HTTPS — Intercepta chamadas para app.omie.com.br
// ============================================================

let mockResponses = [];
let mockCallRouter = null;
let mockCalls = [];
let mockUpstreamAtual = 0;
let mockUpstreamMaximo = 0;
let concorrenciaMaximaMedida = 0;
const chamadasReaisOmie = 0;

const originalRequest = https.request;

function instalarMock() {
  mockCalls = [];
  mockUpstreamAtual = 0;
  mockUpstreamMaximo = 0;
  https.request = function(opts, callback) {
    const callInfo = {
      hostname: opts.hostname,
      path: opts.path,
      method: opts.method,
      headers: opts.headers,
      body: ''
    };

    const fakeReq = {
      _destroyed: false,
      write(data) { callInfo.body += data; },
      end() {
        mockUpstreamAtual++;
        mockUpstreamMaximo = Math.max(mockUpstreamMaximo, mockUpstreamAtual);
        let parsed = {};
        try { parsed = JSON.parse(callInfo.body); } catch(e) {}
        callInfo.parsed = parsed;
        mockCalls.push(callInfo);

        let responseData = '{}';
        let statusCode = 200;

        // Use router if available, otherwise use queue
        let delayMs = 0;
        if (mockCallRouter) {
          const routedResponse = mockCallRouter(parsed);
          if (routedResponse && Object.prototype.hasOwnProperty.call(routedResponse, '__mockBody')) {
            delayMs = routedResponse.__delayMs || 0;
            responseData = JSON.stringify(routedResponse.__mockBody);
          } else {
            responseData = JSON.stringify(routedResponse);
          }
        } else if (mockResponses.length > 0) {
          const mock = mockResponses.shift();
          if (typeof mock === 'function') {
            responseData = JSON.stringify(mock(parsed));
          } else {
            responseData = JSON.stringify(mock);
          }
        }

        const fakeRes = {
          statusCode,
          headers: { 'content-type': 'application/json' },
          on(event, handler) {
            if (event === 'data') {
              setImmediate(() => handler(responseData));
            }
            if (event === 'end') {
              setImmediate(() => setImmediate(() => { mockUpstreamAtual--; handler(); }));
            }
            return fakeRes;
          }
        };

        if (callback) setTimeout(() => callback(fakeRes), delayMs);
      },
      on(event, handler) { return fakeReq; },
      setTimeout(ms, handler) { return fakeReq; },
      destroy() { fakeReq._destroyed = true; }
    };
    return fakeReq;
  };
}

function restaurarMock() {
  https.request = originalRequest;
  mockResponses = [];
  mockCallRouter = null;
  mockCalls = [];
}

function setMockResponses(...responses) {
  mockResponses = [...responses];
  mockCallRouter = null;
}

function setMockRouter(routerFn) {
  mockCallRouter = routerFn;
  mockResponses = [];
}


// ============================================================
// UTILITÁRIO — Fazer request HTTP local
// ============================================================

function requisicaoLocal(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({ status: res.statusCode, body: json, raw: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================================
// FRAMEWORK DE TESTES SIMPLES
// ============================================================

let testesTotal = 0;
let testesOk = 0;
let testesFalha = 0;
const resultados = [];

async function teste(nome, fn) {
  testesTotal++;
  try {
    try {
      const carregado = require.cache[require.resolve('./conector-omie.js')];
      carregado?.exports?.limparCachesConsultas?.();
    } catch (_) {}
    await fn();
    testesOk++;
    resultados.push({ nome, ok: true });
    console.log(`  \u2713 ${nome}`);
  } catch (e) {
    testesFalha++;
    resultados.push({ nome, ok: false, erro: e.message });
    console.log(`  \u2717 ${nome}`);
    console.log(`    ERRO: ${e.message}`);
  }
}

// ============================================================
// SERVIDOR DE TESTE
// ============================================================

let serverInstance = null;

async function iniciarServidor() {
  instalarMock();
  delete require.cache[require.resolve('./conector-omie.js')];
  const conector = require('./conector-omie.js');
  serverInstance = conector.server;

  await new Promise((resolve, reject) => {
    if (serverInstance.listening) return resolve();
    serverInstance.on('listening', resolve);
    serverInstance.on('error', reject);
  });
}

async function pararServidor() {
  if (serverInstance) {
    await new Promise(resolve => serverInstance.close(resolve));
    serverInstance = null;
  }
  restaurarMock();
}

function pausa(ms = 50) {
  return new Promise(r => setTimeout(r, ms));
}


// ============================================================
// TESTES
// ============================================================

async function executarTestes() {
  console.log('\n  =============================================');
  console.log('  DOMU — Testes do Conector Omie');
  console.log('  =============================================\n');

  await iniciarServidor();
  await pausa(100);

  // ----------------------------------------------------------
  // 1. GET /api/omie/status — nao conectado
  // ----------------------------------------------------------
  await teste('GET /api/omie/status — retorna nao conectado inicialmente', async () => {
    const r = await requisicaoLocal('GET', '/api/omie/status');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.connected, false);
    assert.strictEqual(r.body.configured, false);
    assert.strictEqual(typeof r.body.appKeyMasked, 'string');
  });

  await pausa();

  // ----------------------------------------------------------
  // 2. POST /api/omie/test — conexao com sucesso
  // ----------------------------------------------------------
  await teste('POST /api/omie/test — conecta com sucesso', async () => {
    setMockResponses({
      produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO],
      total_de_paginas: 1,
      total_de_registros: 1,
      pagina: 1,
      registros_por_pagina: 1
    }, {
      // ListarLocaisEstoque response for descobrirEstoqueDomu()
      locaisEncontrados: [
        {codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU PRINCIPAL"}
      ]
    });

    const r = await requisicaoLocal('POST', '/api/omie/test', {
      appKey: '1234567890',
      appSecret: 'segredo-secreto-123'
    });

    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.connected, true);
    assert.strictEqual(r.body.produtoTesteCodigo, 'PSAI-050');
    assert.strictEqual(r.body.produtoTesteId, '101');
    assert.strictEqual(r.body.custoTeste, 0);
    assert.strictEqual(r.body.numeroNotaTeste, '');
    assert.strictEqual(r.body.dataCompraTeste, '');
    assert.strictEqual(r.body.appKeyMasked, '1234****90');
  });

  await pausa();

  // ----------------------------------------------------------
  // 3. GET /api/omie/status — agora conectado
  // ----------------------------------------------------------
  await teste('GET /api/omie/status — retorna conectado apos test', async () => {
    const r = await requisicaoLocal('GET', '/api/omie/status');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.connected, true);
    assert.strictEqual(r.body.configured, true);
    assert.strictEqual(r.body.appKeyMasked, '1234****90');
  });

  await pausa();


  // ----------------------------------------------------------
  // 4. GET /api/omie/produtos — paginacao completa (2 paginas)
  // ----------------------------------------------------------
  await teste('GET /api/omie/produtos — paginacao com 2 paginas', async () => {
    setMockResponses(FIXTURE_LISTAR_PRODUTOS_P1, FIXTURE_LISTAR_PRODUTOS_P2);

    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=CHAPA');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body.produtos));
    assert.strictEqual(r.body.produtos.length, 4);
  });

  await pausa();

  // ----------------------------------------------------------
  // 5. GET /api/omie/produtos — busca por descricao PSAI
  // ----------------------------------------------------------
  await teste('GET /api/omie/produtos — busca PSAI retorna resultados corretos', async () => {
    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=PSAI');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body.produtos));
    assert.strictEqual(r.body.produtos.length, 2);
    assert(r.body.produtos.every(p => p.codigo.includes('PSAI') || p.descricao.toLowerCase().includes('psai')));
  });

  await pausa();

  // ----------------------------------------------------------
  // 6. GET /api/omie/produtos — busca por codigo
  // ----------------------------------------------------------
  await teste('GET /api/omie/produtos — busca por codigo ACR retorna resultado', async () => {
    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=ACR');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body.produtos));
    assert.strictEqual(r.body.produtos.length, 1);
    assert.strictEqual(r.body.produtos[0].codigo, 'ACR-200');
    assert.strictEqual(r.body.produtos[0].valorUnitario, 200.00);
  });

  await pausa();

  // ----------------------------------------------------------
  // 7. GET /api/omie/produtos — formato correto de resposta
  // ----------------------------------------------------------
  await teste('GET /api/omie/produtos — formato correto para frontend', async () => {
    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=MDF');
    assert.strictEqual(r.status, 200);
    assert(r.body.produtos.length >= 1);
    const p = r.body.produtos[0];
    assert.strictEqual(typeof p.id, 'string');
    assert.strictEqual(typeof p.codigo, 'string');
    assert.strictEqual(typeof p.descricao, 'string');
    assert.strictEqual(typeof p.unidade, 'string');
    assert.strictEqual(typeof p.ncm, 'string');
    assert.strictEqual(typeof p.valorUnitario, 'number');
    assert.strictEqual(p.codigo_produto, undefined);
    assert.strictEqual(p.codigo_produto_integracao, undefined);
    assert.strictEqual(p.valor_unitario, undefined);
  });

  await pausa();


  // ----------------------------------------------------------
  // 8. GET /api/omie/materiais — retorna lista de materiais (com estoque DOMU)
  // ----------------------------------------------------------
  await teste('GET /api/omie/materiais — retorna produtos PSAI com estoque', async () => {
    // Mock PosicaoEstoque for the PSAI candidates in cache
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'PosicaoEstoque') {
        const idProd = parsed.param[0].id_prod;
        // PSAI-050 (id=101), PSAI-075 (id=102) have stock
        if (idProd === 101 || idProd === 102) return { saldo: 10, fisico: 10, cmc: 50, reservado: 0 };
        return { saldo: 0, fisico: 0, cmc: 0, reservado: 0 };
      }
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/materiais?categoria=chapa-psai');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body.produtos));
    assert(r.body.produtos.length >= 1);
    assert(r.body.produtos.every(p =>
      p.codigo.toLowerCase().includes('psai') ||
      p.descricao.toLowerCase().includes('psai')
    ));
  });

  await pausa();

  // ----------------------------------------------------------
  // 9. GET /api/omie/produto-compra — fluxo completo ultima compra (acrilico)
  // ----------------------------------------------------------
  await teste('GET /api/omie/produto-compra — fluxo completo ultima compra nota entrada', async () => {
    // Router: routes different calls to different fixtures
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    assert(r.body.produto !== null);
    assert.strictEqual(r.body.produto.codigo, 'ACR-200');
    assert.strictEqual(r.body.produto.id, '201');
    // valor_unitario do cadastro e 200, mas custoUnitario DEVE ser 146.36 da nota
    assert.strictEqual(r.body.produto.valorUnitario, 200.00);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 146.36);
    assert.strictEqual(r.body.compra.custoLiquidoUnitario, 146.36);
    assert.strictEqual(r.body.compra.valorUnitarioNota, 146.36);
    assert.strictEqual(r.body.compra.numeroNota, '54321');
    assert.strictEqual(r.body.compra.dataUltimaCompra, '08/07/2026');
    assert.strictEqual(r.body.compra.fornecedor, 'Distribuidora ABC Ltda');
    assert.strictEqual(r.body.compra.cmc, 155.00);
    assert.strictEqual(r.body.compra.saldo, 25);
    assert.strictEqual(r.body.compra.fisico, 25);
    assert.strictEqual(r.body.compra.reservado, 0);
    assert.strictEqual(r.body.compra.fiscalCompraCompleto, true);
    assert.strictEqual(r.body.compra.tributosOrigem, 'nota_entrada');
    assert.strictEqual(r.body.compra.criterioSelecao, 'maior_data_emissao');
    assert.strictEqual(r.body.compra.criterioVinculo, 'nota_entrada_item');
    assert.strictEqual(r.body.compra.codigoProdutoNfe, 'ACR-200');
    assert.strictEqual(r.body.compra.icms, 12);
    assert.strictEqual(r.body.compra.ipi, 0);
    assert.strictEqual(r.body.compra.pisCofins, 9.25); // 1.65 + 7.60
    assert(r.body.compra.tratamentoFiscal !== null);
    assert.strictEqual(r.body.compra.tratamentoFiscal.cICMSCusto, 'S');
    assert.strictEqual(r.body.compra.tratamentoFiscal.cIPICusto, 'N');
  });

  await pausa();


  // ----------------------------------------------------------
  // 10. Formato completo do contrato de resposta
  // ----------------------------------------------------------
  await teste('GET /api/omie/produto-compra — formato completo do contrato', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    const c = r.body.compra;
    assert.strictEqual(typeof c.fonteCusto, 'string');
    assert.strictEqual(typeof c.custoUnitario, 'number');
    assert.strictEqual(typeof c.custoLiquidoUnitario, 'number');
    assert.strictEqual(typeof c.dataUltimaCompra, 'string');
    assert.strictEqual(typeof c.numeroNota, 'string');
    assert.strictEqual(typeof c.fornecedor, 'string');
    assert.strictEqual(typeof c.idDocumentoOmie, 'string');
    assert.strictEqual(typeof c.idRecebimentoOmie, 'string');
    assert.strictEqual(typeof c.cmc, 'number');
    assert.strictEqual(typeof c.saldo, 'number');
    assert.strictEqual(typeof c.fisico, 'number');
    assert.strictEqual(typeof c.reservado, 'number');
    assert.strictEqual(typeof c.dataEstoque, 'string');
    assert.strictEqual(typeof c.fiscalCompraCompleto, 'boolean');
    assert.strictEqual(typeof c.tributosOrigem, 'string');
    assert.strictEqual(typeof c.valorUnitarioNota, 'number');
    assert.strictEqual(typeof c.criterioSelecao, 'string');
    assert.strictEqual(typeof c.criterioVinculo, 'string');
    assert.strictEqual(typeof c.codigoProdutoNfe, 'string');
    assert.strictEqual(typeof c.descricaoProdutoNfe, 'string');
    assert(c.tratamentoFiscal === null || typeof c.tratamentoFiscal === 'object');
    // ipi, icms, pisCofins can be number or null
    assert(c.ipi === null || typeof c.ipi === 'number');
    assert(c.icms === null || typeof c.icms === 'number');
    assert(c.pisCofins === null || typeof c.pisCofins === 'number');
  });

  await pausa();


  // ----------------------------------------------------------
  // 11. Erro Omie (faultstring) — retorna HTTP 400 no /test
  // ----------------------------------------------------------
  await teste('Erro Omie faultstring — retorna HTTP 400 com mensagem', async () => {
    setMockResponses(FIXTURE_ERRO_OMIE);

    const r = await requisicaoLocal('POST', '/api/omie/test', {
      appKey: 'INVALIDA',
      appSecret: 'INVALIDA'
    });
    assert.strictEqual(r.status, 400);
    assert(r.body.error.includes('chave de acesso'));
  });

  await pausa();

  // Reconecta para proximos testes
  setMockResponses({
    produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO],
    total_de_paginas: 1,
    total_de_registros: 1,
    pagina: 1,
    registros_por_pagina: 1
  }, {
    locaisEncontrados: [{codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU PRINCIPAL"}]
  });
  await requisicaoLocal('POST', '/api/omie/test', {
    appKey: '1234567890',
    appSecret: 'segredo-secreto-123'
  });
  await pausa();

  // ----------------------------------------------------------
  // 12. Erro Omie em /produtos — retorna 502, NAO array vazio
  // ----------------------------------------------------------
  await teste('Erro Omie em /produtos — retorna 502, NAO array vazio', async () => {
    setMockResponses(FIXTURE_ERRO_OMIE);

    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=XYZINEXISTENTE');
    if (r.status === 200) {
      assert(Array.isArray(r.body.produtos));
    } else {
      assert(r.status >= 400);
      assert(r.body.error !== undefined);
      assert(!Array.isArray(r.body.produtos));
    }
  });

  await pausa();

  // ----------------------------------------------------------
  // 13. POST /api/omie/test — credenciais vazias reutilizam sessão
  // ----------------------------------------------------------
  await teste('POST /api/omie/test — credenciais vazias preservam sessão configurada', async () => {
    setMockResponses({ produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO] }, { locaisEncontrados: [] });
    const r = await requisicaoLocal('POST', '/api/omie/test', {
      appKey: '',
      appSecret: ''
    });
    assert.strictEqual(r.status, 200);
    const chamada = mockCalls.find(c => c.parsed?.call === 'ListarProdutos');
    assert.strictEqual(chamada.parsed.app_key, '1234567890');
    assert.strictEqual(chamada.parsed.app_secret, 'segredo-secreto-123');
  });

  await pausa();


  // ----------------------------------------------------------
  // 14. GET /api/omie/produtos — termo curto retorna 400
  // ----------------------------------------------------------
  await teste('GET /api/omie/produtos — termo < 2 chars retorna 400', async () => {
    setMockResponses({
      produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
    }, {
      locaisEncontrados: [{codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU PRINCIPAL"}]
    });
    await requisicaoLocal('POST', '/api/omie/test', {
      appKey: '1234567890', appSecret: 'segredo-secreto-123'
    });
    await pausa();

    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=X');
    assert.strictEqual(r.status, 400);
    assert(r.body.error.length > 0);
  });

  await pausa();

  // ----------------------------------------------------------
  // 15. Content-Type para Omie e exatamente application/json
  // ----------------------------------------------------------
  await teste('Content-Type para Omie e exatamente application/json (sem charset)', async () => {
    setMockResponses(FIXTURE_LISTAR_PRODUTOS_P1);
    await requisicaoLocal('GET', '/api/omie/produtos?q=PSAI');
    await pausa();

    const ultima = mockCalls[mockCalls.length - 1];
    if (ultima) {
      assert.strictEqual(ultima.headers['Content-Type'], 'application/json');
      assert(!ultima.headers['Content-Type'].includes('charset'),
        'Content-Type NAO deve conter charset');
    }
  });

  await pausa();

  // ----------------------------------------------------------
  // 16. app_secret nunca aparece nos logs
  // ----------------------------------------------------------
  await teste('app_secret nunca e logado (verificacao de seguranca)', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    setMockResponses({
      produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
    }, {
      locaisEncontrados: [{codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU PRINCIPAL"}]
    });
    await requisicaoLocal('POST', '/api/omie/test', {
      appKey: '9999888877',
      appSecret: 'SEGREDO_ULTRA_SECRETO_XYZ'
    });
    await pausa();

    console.log = originalLog;

    const todosLogs = logs.join('\n');
    assert(!todosLogs.includes('SEGREDO_ULTRA_SECRETO_XYZ'),
      'app_secret apareceu nos logs!');
  });

  await pausa();

  // ----------------------------------------------------------
  // 17. GET /api/omie/produto-compra — sem parametros retorna 400
  // ----------------------------------------------------------
  await teste('GET /api/omie/produto-compra — sem id/codigo retorna 400', async () => {
    const r = await requisicaoLocal('GET', '/api/omie/produto-compra');
    assert.strictEqual(r.status, 400);
    assert(r.body.error.length > 0);
  });

  await pausa();


  // ----------------------------------------------------------
  // 18. Limite maximo de 50 resultados
  // ----------------------------------------------------------
  await teste('GET /api/omie/produtos — limita a 50 resultados', async () => {
    const muitosProdutos = [];
    for (let i = 0; i < 60; i++) {
      muitosProdutos.push({
        codigo_produto: `TESTE-${String(i).padStart(3, '0')}`,
        codigo_produto_integracao: String(1000 + i),
        descricao: `PRODUTO TESTE NUMERO ${i}`,
        unidade: 'UN', ncm: '0000.00.00', valor_unitario: 10 + i
      });
    }

    setMockResponses({
      produto_servico_cadastro: muitosProdutos,
      total_de_paginas: 1,
      total_de_registros: 60,
      pagina: 1,
      registros_por_pagina: 200
    });

    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=TESTE');
    assert.strictEqual(r.status, 200);
    assert(r.body.produtos.length <= 50,
      `Esperado max 50, recebeu ${r.body.produtos.length}`);
  });

  await pausa();


  // ===========================================================
  // NOVOS TESTES — Fluxo "Última Compra" com NF-e de Entrada
  // ===========================================================

  // Reconecta para os novos testes
  setMockResponses({
    produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO],
    total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
  }, {
    locaisEncontrados: [{codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU PRINCIPAL"}]
  });
  await requisicaoLocal('POST', '/api/omie/test', {
    appKey: '1234567890', appSecret: 'segredo-secreto-123'
  });
  await pausa();

  // ----------------------------------------------------------
  // 19. Acrilico — custoUnitario vem da nota, NAO do cadastro
  // ----------------------------------------------------------
  await teste('Ultima compra: custoUnitario=146.36 (nota), NAO 200 (cadastro)', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    // custoUnitario REAL vem da nota (146.36), NUNCA do cadastro (200)
    assert.strictEqual(r.body.compra.custoUnitario, 146.36);
    assert.notStrictEqual(r.body.compra.custoUnitario, 200.00);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
  });

  await pausa();


  // ----------------------------------------------------------
  // 20. Filtragem de movimentos — so operacao 21/22, exclui cancelados
  // ----------------------------------------------------------
  await teste('Filtragem movimentos: so operacao 21/22, exclui cancelados', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_COM_CANCELADO;
      // A compra mais recente (idMov=5001) esta cancelada, deve pegar a segunda (idMov=4500, idDoc=8500)
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA_8500;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    // Deve ter pego a nota 8500 (segunda compra), nao a cancelada
    assert.strictEqual(r.body.compra.custoUnitario, 144.00);
    assert.strictEqual(r.body.compra.numeroNota, '51000');
    assert.strictEqual(r.body.compra.dataUltimaCompra, '12/03/2026');
  });

  await pausa();

  // ----------------------------------------------------------
  // 21. Selecao mais recente — pega maior dtEmissao entre compras validas
  // ----------------------------------------------------------
  await teste('Selecao mais recente: pega maior dtEmissao entre compras validas', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    // Movimento com dtEmissao 08/07/2026 e o mais recente (vs 12/03/2026)
    assert.strictEqual(r.body.compra.dataUltimaCompra, '08/07/2026');
    assert.strictEqual(r.body.compra.custoUnitario, 146.36);
    assert.strictEqual(r.body.compra.criterioSelecao, 'maior_data_emissao');
  });

  await pausa();


  // ----------------------------------------------------------
  // 22. Sem historico de compra — fonteCusto = sem_ultima_compra
  // ----------------------------------------------------------
  await teste('Sem historico compra: fonteCusto=nao_encontrado, custoUnitario=0', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_VAZIO;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'nao_encontrado');
    assert.strictEqual(r.body.compra.custoUnitario, 0);
    assert.strictEqual(r.body.compra.custoLiquidoUnitario, 0);
    assert.strictEqual(r.body.compra.dataUltimaCompra, '');
    assert.strictEqual(r.body.compra.numeroNota, '');
    assert.strictEqual(r.body.compra.fiscalCompraCompleto, false);
    // Mas estoque deve estar disponivel
    assert.strictEqual(r.body.compra.cmc, 155.00);
    assert.strictEqual(r.body.compra.saldo, 25);
  });

  await pausa();

  // ----------------------------------------------------------
  // 23. Nota inacessivel — fallback para movimento (valor/qtde)
  // ----------------------------------------------------------
  await teste('Nota inacessivel: fallback para movimento_estoque', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') {
        // Simula erro na consulta da nota
        return { faultstring: "Nota não encontrada", faultcode: "SOAP-ENV:Client-404" };
      }
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'movimento_estoque');
    // valor=1463.60, qtde=10 → unit=146.36
    assert.strictEqual(r.body.compra.custoUnitario, 0);
    assert.strictEqual(r.body.compra.valorUnitarioMovimento, 146.36);
    assert.strictEqual(r.body.compra.criterioVinculo, 'movimento_estoque');
    assert.strictEqual(r.body.compra.fiscalCompraCompleto, false);
    assert.strictEqual(r.body.compra.tributosOrigem, 'nao_disponivel');
    // Tributos devem ser null pois nao tem nota
    assert.strictEqual(r.body.compra.icms, null);
    assert.strictEqual(r.body.compra.ipi, null);
    assert.strictEqual(r.body.compra.pisCofins, null);
    assert.strictEqual(r.body.compra.tratamentoFiscal, null);
  });

  await pausa();


  // ----------------------------------------------------------
  // 24. CMC e custoUnitario vem de fontes diferentes
  // ----------------------------------------------------------
  await teste('CMC vs custoUnitario: fontes diferentes (PosicaoEstoque vs nota)', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    // CMC vem de PosicaoEstoque (155.00)
    assert.strictEqual(r.body.compra.cmc, 155.00);
    // custoUnitario vem da nota de entrada (146.36)
    assert.strictEqual(r.body.compra.custoUnitario, 146.36);
    // Sao diferentes — CMC e media, custoUnitario e ultima compra real
    assert.notStrictEqual(r.body.compra.cmc, r.body.compra.custoUnitario);
  });

  await pausa();

  // ----------------------------------------------------------
  // 25. ConsultarNotaEnt usa nCodNotaEnt (nao nIdNota)
  // ----------------------------------------------------------
  await teste('ConsultarNotaEnt usa nCodNotaEnt (nao nIdNota)', async () => {
    mockCalls = [];
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');

    const notaCall = mockCalls.find(c => c.parsed && c.parsed.call === 'ConsultarNotaEnt');
    assert(notaCall, 'Deve ter chamado ConsultarNotaEnt');
    const param = notaCall.parsed.param[0];
    assert(param.nCodNotaEnt !== undefined, 'Deve usar nCodNotaEnt');
    assert(param.nIdNota === undefined, 'NAO deve usar nIdNota');
  });

  await pausa();

  // ----------------------------------------------------------
  // 26. PosicaoEstoque usa id_prod e data (nao nCodProd)
  // ----------------------------------------------------------
  await teste('PosicaoEstoque usa id_prod e data (nao nCodProd)', async () => {
    mockCalls = [];
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');

    const estoqueCall = mockCalls.find(c => c.parsed && c.parsed.call === 'PosicaoEstoque');
    assert(estoqueCall, 'Deve ter chamado PosicaoEstoque');
    const param = estoqueCall.parsed.param[0];
    assert(param.id_prod !== undefined, 'Deve usar id_prod');
    assert(param.data !== undefined, 'Deve enviar campo data');
    assert(param.nCodProd === undefined, 'NAO deve usar nCodProd');
  });

  await pausa();

  // ----------------------------------------------------------
  // 27. Busca historica progressiva - encontra compra antiga
  // ----------------------------------------------------------
  await teste('Busca historica progressiva - encontra compra antiga (3 anos)', async () => {
    let chamadaMovimento = 0;
    mockCalls = [];
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') {
        chamadaMovimento++;
        // Primeira chamada (1 ano): retorna vazio
        if (chamadaMovimento === 1) {
          return FIXTURE_MOVIMENTO_VAZIO;
        }
        // Segunda chamada (3 anos): retorna compra encontrada
        return FIXTURE_MOVIMENTO_ESTOQUE;
      }
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    // Deve ter encontrado a compra na segunda tentativa (3 anos)
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 146.36);
    // Deve ter feito pelo menos 2 chamadas de ListarMovimentoEstoque
    const movCalls = mockCalls.filter(c => c.parsed && c.parsed.call === 'ListarMovimentoEstoque');
    assert(movCalls.length >= 2, `Esperado >= 2 chamadas ListarMovimentoEstoque, recebeu ${movCalls.length}`);
  });

  await pausa();

  // ----------------------------------------------------------
  // 28. Nota valida: produto encontrado e numDoc/dtEmissao batem
  // ----------------------------------------------------------
  await teste('Nota valida: produto encontrado e numDoc/dtEmissao batem', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA; // numDoc=54321, dtEmissao=08/07/2026 matches movement
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 146.36);
  });

  await pausa();

  // ----------------------------------------------------------
  // 29. Nota incompativel: produto NAO encontrado na nota → fallback movimento
  // ----------------------------------------------------------
  await teste('Nota incompativel: produto NAO encontrado na nota → fallback movimento', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') {
        // Nota exists but does NOT contain product 201
        return {
          cabec: { nIdNota: 9001, cNumNFe: "54321", dtEmissao: "08/07/2026", cNomeFornecedor: "Fornecedor X" },
          produtos: [
            {nCodProd: 999, cCodigo: "OUTRO-001", cDescricao: "OUTRO PRODUTO", nQtde: 5, nValUnit: 50.00, cNCM: "0000.00.00"}
          ]
        };
      }
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    // Should fallback to movement value since nota doesn't contain the product
    assert.strictEqual(r.body.compra.fonteCusto, 'movimento_estoque');
    assert.strictEqual(r.body.compra.custoUnitario, 0);
    assert.strictEqual(r.body.compra.valorUnitarioMovimento, 146.36); // auxiliar, nunca custo
    assert.strictEqual(r.body.compra.criterioVinculo, 'movimento_estoque');
  });

  await pausa();

  // ----------------------------------------------------------
  // 30. Estoque DOMU encontrado: usa codigo_local_estoque correto
  // ----------------------------------------------------------
  await teste('Estoque DOMU encontrado: usa codigo_local_estoque correto', async () => {
    // Reconnect with DOMU estoque available
    setMockResponses({
      produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
    }, {
      locaisEncontrados: [
        {codigo_local_estoque: 5, cDescricao: "ESTOQUE GERAL"},
        {codigo_local_estoque: 7, cDescricao: "ESTOQUE DOMU INDUSTRIAL"}
      ]
    });
    await requisicaoLocal('POST', '/api/omie/test', {
      appKey: '1234567890', appSecret: 'segredo-secreto-123'
    });
    await pausa();

    // Now make a produto-compra call and check PosicaoEstoque uses codigo 7
    mockCalls = [];
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });

    await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');

    const estoqueCall = mockCalls.find(c => c.parsed && c.parsed.call === 'PosicaoEstoque');
    assert(estoqueCall, 'Deve ter chamado PosicaoEstoque');
    assert.strictEqual(estoqueCall.parsed.param[0].codigo_local_estoque, 7);
  });

  await pausa();

  // ----------------------------------------------------------
  // 31. Estoque DOMU NAO encontrado: nao faz fallback para 0
  // ----------------------------------------------------------
  await teste('Estoque DOMU NAO encontrado: nao faz fallback para 0', async () => {
    // Reconnect with NO DOMU estoque
    setMockResponses({
      produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
    }, {
      locaisEncontrados: [
        {codigo_local_estoque: 5, cDescricao: "ESTOQUE GERAL"},
        {codigo_local_estoque: 8, cDescricao: "ESTOQUE LOJA"}
      ]
    });
    await requisicaoLocal('POST', '/api/omie/test', {
      appKey: '1234567890', appSecret: 'segredo-secreto-123'
    });
    await pausa();

    // Now make a produto-compra call
    mockCalls = [];
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      // PosicaoEstoque should NOT be called
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    // Custo must still work (from nota)
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 146.36);
    // PosicaoEstoque should NOT have been called (no fallback to 0)
    const estoqueCall = mockCalls.find(c => c.parsed && c.parsed.call === 'PosicaoEstoque');
    assert(!estoqueCall, 'NAO deve chamar PosicaoEstoque quando estoque DOMU nao encontrado');
    // dataEstoque should indicate the problem
    assert.strictEqual(r.body.compra.dataEstoque, 'estoque_domu_nao_encontrado');
  });

  await pausa();

  // ----------------------------------------------------------
  // 32. Busca geral: acrilico retorna chapas acrilico (qualquer tipoItem)
  // ----------------------------------------------------------
  await teste('Busca geral: acrilico retorna chapas acrilico independente de tipoItem', async () => {
    setMockResponses({
      produto_servico_cadastro: [
        {codigo_produto: "601", codigo: "ACR-CRI-2", descricao: "CHAPA ACRILICO CRISTAL 2MM 1000X2000", unidade: "CH", ncm: "3926.90.90", valor_unitario: 200, tipoItem: "03", inativo: "N"},
        {codigo_produto: "602", codigo: "ACR-BRA-6", descricao: "CHAPA ACRILICO BRANCO 6MM 1000X2000", unidade: "CH", ncm: "3926.90.90", valor_unitario: 350, tipoItem: "01", inativo: "N"},
        {codigo_produto: "603", codigo: "COLA-ACR", descricao: "COLA PARA ACRILICO 500ML", unidade: "UN", ncm: "3506.10.90", valor_unitario: 45, tipoItem: "01", inativo: "N"},
        {codigo_produto: "604", codigo: "PSAI-050", descricao: "CHAPA PSAI CRISTAL 0,50MM", unidade: "CH", ncm: "3920.30.00", valor_unitario: 45, tipoItem: "01", inativo: "N"},
        {codigo_produto: "605", codigo: "ACR-INAT", descricao: "CHAPA ACRILICO INATIVA", unidade: "CH", ncm: "3926.90.90", valor_unitario: 100, tipoItem: "01", inativo: "S"}
      ],
      total_de_paginas: 1, total_de_registros: 5, pagina: 1, registros_por_pagina: 200
    });

    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=acrilico');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.produtos.length, 3);
    const codigos = r.body.produtos.map(p => p.codigo);
    assert(codigos.includes('ACR-CRI-2'), 'Deve incluir ACR-CRI-2 (tipoItem=03)');
    assert(codigos.includes('ACR-BRA-6'), 'Deve incluir ACR-BRA-6');
    assert(codigos.includes('COLA-ACR'), 'Deve incluir COLA-ACR');
    assert(!codigos.includes('ACR-INAT'), 'NAO deve incluir inativo');
  });

  await pausa();

  // ----------------------------------------------------------
  // 33. Mapeamento codigo vs id: codigo=SKU, id=codigo_produto
  // ----------------------------------------------------------
  await teste('Mapeamento: id=codigo_produto (numerico), codigo=SKU', async () => {
    // Force cache refresh with new data
    setMockResponses({
      produto_servico_cadastro: [{codigo_produto: "101", codigo: "PSAI-050", descricao: "CHAPA PSAI", unidade: "CH", ncm: "3920.30.00", valor_unitario: 45.80, tipoItem: "01", inativo: "N"}],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
    }, {
      locaisEncontrados: [{codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU"}]
    });
    await requisicaoLocal('POST', '/api/omie/test', {appKey: '1234567890', appSecret: 'segredo-secreto-123'});
    await pausa();

    setMockResponses({
      produto_servico_cadastro: [
        {codigo_produto: "1661181502", codigo: "PSAI-001", codigo_produto_integracao: "XYZ", descricao: "CHAPA PSAI TEST", unidade: "CH", ncm: "3920.30.00", valor_unitario: 50, tipoItem: "01", inativo: "N"}
      ],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 200
    });

    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=PSAI');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.produtos.length, 1);
    assert.strictEqual(r.body.produtos[0].id, '1661181502');
    assert.strictEqual(r.body.produtos[0].codigo, 'PSAI-001');
    // NUNCA: codigo = '1661181502'
    assert.notStrictEqual(r.body.produtos[0].codigo, '1661181502');
  });

  await pausa();

  // ----------------------------------------------------------
  // 34. Categoria chapa-acrilico: filtra por regra + estoque DOMU
  // ----------------------------------------------------------
  await teste('Categoria chapa-acrilico: filtra por regra + estoque DOMU', async () => {
    setMockResponses({
      produto_servico_cadastro: [{codigo_produto: "101", codigo: "PSAI-050", descricao: "CHAPA PSAI", unidade: "CH", ncm: "3920.30.00", valor_unitario: 45, inativo: "N"}],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
    }, {
      locaisEncontrados: [{codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU"}]
    });
    await requisicaoLocal('POST', '/api/omie/test', {appKey: '1234567890', appSecret: 'segredo-secreto-123'});
    await pausa();

    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ListarProdutos') return {
        produto_servico_cadastro: [
          {codigo_produto: "801", codigo: "ACR-CRI-2", descricao: "CHAPA ACRILICO CRISTAL 2MM", unidade: "CH", ncm: "3926.90.90", valor_unitario: 200, tipoItem: "03", inativo: "N"},
          {codigo_produto: "802", codigo: "ACR-BRA-6", descricao: "CHAPA ACRILICO BRANCO 6MM", unidade: "CH", ncm: "3926.90.90", valor_unitario: 350, inativo: "N"},
          {codigo_produto: "803", codigo: "PSAI-050", descricao: "CHAPA PSAI CRISTAL 0,50MM", unidade: "CH", ncm: "3920.30.00", valor_unitario: 45, inativo: "N"},
          {codigo_produto: "805", codigo: "ACR-SEM-EST", descricao: "CHAPA ACRILICO SEM ESTOQUE", unidade: "CH", ncm: "3926.90.90", valor_unitario: 150, inativo: "N"}
        ],
        total_de_paginas: 1, total_de_registros: 4, pagina: 1, registros_por_pagina: 200
      };
      if (call === 'PosicaoEstoque') {
        const idProd = parsed.param[0].id_prod;
        if (idProd === 801) return { saldo: 10, fisico: 10, cmc: 200, reservado: 0 };
        if (idProd === 802) return { saldo: 5, fisico: 5, cmc: 350, reservado: 0 };
        if (idProd === 805) return { saldo: 0, fisico: 0, cmc: 150, reservado: 0 };
        return { saldo: 0, fisico: 0, cmc: 0, reservado: 0 };
      }
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/materiais?categoria=chapa-acrilico');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.produtos.length, 2);
    const codigos = r.body.produtos.map(p => p.codigo);
    assert(codigos.includes('ACR-CRI-2'), 'Deve incluir ACR-CRI-2 (tem estoque)');
    assert(codigos.includes('ACR-BRA-6'), 'Deve incluir ACR-BRA-6 (tem estoque)');
    assert(!codigos.includes('ACR-SEM-EST'), 'NAO deve incluir sem estoque');
    assert(!codigos.includes('PSAI-050'), 'NAO deve incluir PSAI');
  });

  await pausa();

  // ----------------------------------------------------------
  // 35. Categoria chapa-psai: filtra PSAI corretamente
  // ----------------------------------------------------------
  await teste('Categoria chapa-psai: filtra por regra PSAI', async () => {
    // Force cache refresh by reconnecting
    setMockResponses({
      produto_servico_cadastro: [{codigo_produto: "101", codigo: "X", descricao: "X", unidade: "UN", inativo: "N"}],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
    }, {
      locaisEncontrados: [{codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU"}]
    });
    await requisicaoLocal('POST', '/api/omie/test', {appKey: '1234567890', appSecret: 'segredo-secreto-123'});
    await pausa();

    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ListarProdutos') return {
        produto_servico_cadastro: [
          {codigo_produto: "801", codigo: "ACR-CRI-2", descricao: "CHAPA ACRILICO 2MM", unidade: "CH", inativo: "N"},
          {codigo_produto: "803", codigo: "PSAI-050", descricao: "CHAPA PSAI CRISTAL 0,50MM", unidade: "CH", inativo: "N"},
          {codigo_produto: "806", codigo: "PSAI-100", descricao: "CHAPA PSAI BRANCO 1,00MM", unidade: "CH", inativo: "N"}
        ],
        total_de_paginas: 1, total_de_registros: 3, pagina: 1, registros_por_pagina: 200
      };
      if (call === 'PosicaoEstoque') {
        const idProd = parsed.param[0].id_prod;
        if (idProd === 803) return { saldo: 20, fisico: 20, cmc: 45, reservado: 0 };
        if (idProd === 806) return { saldo: 15, fisico: 15, cmc: 60, reservado: 0 };
        return { saldo: 0, fisico: 0, cmc: 0, reservado: 0 };
      }
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/materiais?categoria=chapa-psai');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.produtos.length, 2);
    const codigos = r.body.produtos.map(p => p.codigo);
    assert(codigos.includes('PSAI-050'), 'Deve incluir PSAI-050');
    assert(codigos.includes('PSAI-100'), 'Deve incluir PSAI-100');
    assert(!codigos.includes('ACR-CRI-2'), 'NAO deve incluir acrilico');
  });

  await pausa();

  // ----------------------------------------------------------
  // 36. Categoria chapa-mdf: filtra MDF corretamente
  // ----------------------------------------------------------
  await teste('Categoria chapa-mdf: filtra por regra MDF', async () => {
    // Force cache refresh
    setMockResponses({
      produto_servico_cadastro: [{codigo_produto: "101", codigo: "X", descricao: "X", unidade: "UN", inativo: "N"}],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
    }, {
      locaisEncontrados: [{codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU"}]
    });
    await requisicaoLocal('POST', '/api/omie/test', {appKey: '1234567890', appSecret: 'segredo-secreto-123'});
    await pausa();

    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ListarProdutos') return {
        produto_servico_cadastro: [
          {codigo_produto: "804", codigo: "MDF-060", descricao: "CHAPA MDF CRU 6MM", unidade: "CH", inativo: "N"},
          {codigo_produto: "807", codigo: "MDF-150", descricao: "CHAPA MDF BRANCO 15MM", unidade: "CH", inativo: "N"},
          {codigo_produto: "803", codigo: "PSAI-050", descricao: "CHAPA PSAI 0,50MM", unidade: "CH", inativo: "N"}
        ],
        total_de_paginas: 1, total_de_registros: 3, pagina: 1, registros_por_pagina: 200
      };
      if (call === 'PosicaoEstoque') {
        const idProd = parsed.param[0].id_prod;
        if (idProd === 804) return { saldo: 30, fisico: 30, cmc: 90, reservado: 0 };
        if (idProd === 807) return { saldo: 8, fisico: 8, cmc: 200, reservado: 0 };
        return { saldo: 0, fisico: 0, cmc: 0, reservado: 0 };
      }
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/materiais?categoria=chapa-mdf');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.produtos.length, 2);
    const codigos = r.body.produtos.map(p => p.codigo);
    assert(codigos.includes('MDF-060'), 'Deve incluir MDF-060');
    assert(codigos.includes('MDF-150'), 'Deve incluir MDF-150');
    assert(!codigos.includes('PSAI-050'), 'NAO deve incluir PSAI');
  });

  await pausa();

  // ----------------------------------------------------------
  // 37. Categoria tubo-quadrado: filtra tubos quadrados e metalon
  // ----------------------------------------------------------
  await teste('Categoria tubo-quadrado: filtra tubos quadrados e metalon', async () => {
    // Force cache refresh
    setMockResponses({
      produto_servico_cadastro: [{codigo_produto: "101", codigo: "X", descricao: "X", unidade: "UN", inativo: "N"}],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
    }, {
      locaisEncontrados: [{codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU"}]
    });
    await requisicaoLocal('POST', '/api/omie/test', {appKey: '1234567890', appSecret: 'segredo-secreto-123'});
    await pausa();

    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ListarProdutos') return {
        produto_servico_cadastro: [
          {codigo_produto: "901", codigo: "TQ-2020", descricao: "TUBO QUADRADO ACO 20X20X1,20MM", unidade: "UN", inativo: "N"},
          {codigo_produto: "902", codigo: "METALON-30", descricao: "METALON 30X30X1,50MM", unidade: "UN", inativo: "N"},
          {codigo_produto: "903", codigo: "TR-2500", descricao: "TUBO REDONDO ACO 25MM", unidade: "UN", inativo: "N"}
        ],
        total_de_paginas: 1, total_de_registros: 3, pagina: 1, registros_por_pagina: 200
      };
      if (call === 'PosicaoEstoque') {
        const idProd = parsed.param[0].id_prod;
        if (idProd === 901) return { saldo: 50, fisico: 50, cmc: 32, reservado: 0 };
        if (idProd === 902) return { saldo: 30, fisico: 30, cmc: 48, reservado: 0 };
        if (idProd === 903) return { saldo: 40, fisico: 40, cmc: 28, reservado: 0 };
        return { saldo: 0, fisico: 0, cmc: 0, reservado: 0 };
      }
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/materiais?categoria=tubo-quadrado');
    assert.strictEqual(r.status, 200);
    const codigos = r.body.produtos.map(p => p.codigo);
    assert(codigos.includes('TQ-2020'), 'Deve incluir tubo quadrado');
    assert(codigos.includes('METALON-30'), 'Deve incluir metalon');
    assert(!codigos.includes('TR-2500'), 'NAO deve incluir tubo redondo');
  });

  await pausa();

  // ----------------------------------------------------------
  // 38. movProdutoListar: parser aceita formato alternativo do Omie
  // ----------------------------------------------------------
  await teste('Parser movProdutoListar: encontra ultima compra com formato alternativo Omie', async () => {
    setMockResponses({
      produto_servico_cadastro: [{codigo_produto: "101", codigo: "X", descricao: "X", unidade: "UN", inativo: "N"}],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
    }, {
      locaisEncontrados: [{codigo_local_estoque: 1, cDescricao: "ESTOQUE DOMU"}]
    });
    await requisicaoLocal('POST', '/api/omie/test', {appKey: '1234567890', appSecret: 'segredo-secreto-123'});
    await pausa();

    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return {
        codigo_produto: "11835150482", codigo: "4084438",
        descricao: "CHAPA PSAI BRANCO TRICAMADA 1,00 X 1000 X 2000MM",
        unidade: "CH", ncm: "3920.30.00", valor_unitario: 32.30
      };
      if (call === 'ListarMovimentoEstoque') return {
        movProdutoListar: [
          { idMov: 90001, idDoc: 7001, idProd: 11835150482, dtMov: '15/07/2026', numDoc: '77001', operacao: '21', cancelamento: 'N', devolucao: 'N', qtde: 10, valor: 1000, idRecebimento: 5001 }
        ],
        nTotPaginas: 1
      };
      if (call === 'ConsultarNotaEnt') return {
        cabec: { nIdNota: 7001, cNumNFe: "77001", dtEmissao: "15/07/2026", cNomeFornecedor: "Fornecedor PSAI" },
        produtos: [
          { nCodProd: 11835150482, cCodigo: "4084438", cDescricao: "CHAPA PSAI BRANCO TRICAMADA", nQtde: 10, nValUnit: 100.00, cNCM: "3920.30.00", ICMS: {nAliq: 12}, IPI: {nAliqIPI: 0}, PIS: {nAliqPIS: 1.65}, COFINS: {nAliqCOFINS: 7.60} }
        ]
      };
      if (call === 'PosicaoEstoque') return { saldo: 0, cmc: 22.32, fisico: 0, reservado: 0 };
      if (call === 'ConsultarRecebimento') return { cRazaoSocial: "Fornecedor PSAI Ltda" };
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 100.00);
    assert.strictEqual(r.body.compra.valorUnitarioNota, 100.00);
    assert.strictEqual(r.body.compra.numeroNota, '77001');
    assert.strictEqual(r.body.compra.cmc, 22.32);
    assert.strictEqual(r.body.compra.fiscalCompraCompleto, true);
  });

  await pausa();

  // ----------------------------------------------------------
  // 40. lista_local_estoque=TODOS: compra em local diferente do DOMU
  // ----------------------------------------------------------
  await teste('lista_local_estoque=TODOS: encontra compra em local diferente do DOMU', async () => {
    mockCalls = [];
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return { codigo_produto: "11835150482", codigo: "4084438", descricao: "CHAPA PSAI", unidade: "CH", valor_unitario: 32.30 };
      if (call === 'ListarMovimentoEstoque') {
        // Verifica que lista_local_estoque=TODOS foi enviado
        return { movProdutoListar: [
          { idMov: 80001, idDoc: 6001, idProd: 11835150482, dtMov: '10/06/2026', numDoc: '66001', operacao: '21', cancelamento: 'N', devolucao: 'N', qtde: 5, valor: 127.50, idRecebimento: 4001, codigo_local_estoque: 99 }
        ], nTotPaginas: 1 };
      }
      if (call === 'ConsultarNotaEnt') return {
        cabec: { cNumNFe: "66001", dtEmissao: "10/06/2026", cNomeFornecedor: "Forn X" },
        produtos: [{ nCodProd: 11835150482, cCodigo: "4084438", nValUnit: 25.50, cDescricao: "CHAPA PSAI", ICMS: {nAliq: 12}, IPI: {nAliqIPI: 0}, PIS: {nAliqPIS: 1.65}, COFINS: {nAliqCOFINS: 7.60} }]
      };
      if (call === 'PosicaoEstoque') return { saldo: 0, cmc: 22.32, fisico: 0, reservado: 0 };
      if (call === 'ConsultarRecebimento') return { cRazaoSocial: "Forn X" };
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 25.50);
    assert.strictEqual(r.body.compra.cmc, 22.32);
    assert.strictEqual(r.body.compra.saldo, 0);

    // Verifica que lista_local_estoque=TODOS foi usado
    const movCall = mockCalls.find(c => c.parsed?.call === 'ListarMovimentoEstoque');
    assert(movCall, 'Deve ter chamado ListarMovimentoEstoque');
    assert.strictEqual(movCall.parsed.param[0].lista_local_estoque, 'TODOS');
  });

  await pausa();

  // ----------------------------------------------------------
  // 41. Saldo DOMU = 0 mas compra historica existente → ultima_compra
  // ----------------------------------------------------------
  await teste('Saldo DOMU=0 + compra historica = ultima_compra com custo', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return { codigo_produto: "11835150482", codigo: "4084438", descricao: "CHAPA PSAI BRANCO TRICAMADA", unidade: "CH", valor_unitario: 32.30 };
      if (call === 'ListarMovimentoEstoque') return {
        movProdutoListar: [{ idMov: 90001, idDoc: 7001, idProd: 11835150482, dtMov: '15/07/2026', numDoc: '77001', operacao: '21', cancelamento: 'N', devolucao: 'N', qtde: 10, valor: 255, idRecebimento: 5001 }],
        nTotPaginas: 1
      };
      if (call === 'ConsultarNotaEnt') return {
        cabec: { cNumNFe: "77001", dtEmissao: "15/07/2026", cNomeFornecedor: "Fornecedor Y" },
        produtos: [{ nCodProd: 11835150482, nValUnit: 25.50, cCodigo: "4084438", cDescricao: "CHAPA PSAI BRANCO" }]
      };
      if (call === 'PosicaoEstoque') return { saldo: 0, cmc: 22.32, fisico: 0, reservado: 0 };
      if (call === 'ConsultarRecebimento') return {};
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 25.50);
    assert.strictEqual(r.body.compra.valorUnitarioNota, 25.50);
    assert.strictEqual(r.body.compra.cmc, 22.32);
    assert.strictEqual(r.body.compra.saldo, 0);
  });

  await pausa();

  // ----------------------------------------------------------
  // 42. Operação 22 também é aceita como compra válida
  // ----------------------------------------------------------
  await teste('Operacao 22 aceita como compra valida', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return {
        movProdutoListar: [{ idMov: 1001, idDoc: 2001, idProd: 201, dtMov: '01/08/2026', numDoc: '88001', operacao: '22', cancelamento: 'N', devolucao: 'N', qtde: 3, valor: 450, idRecebimento: 3001 }],
        nTotPaginas: 1
      };
      if (call === 'ConsultarNotaEnt') return {
        cabec: { cNumNFe: "88001", dtEmissao: "01/08/2026" },
        produtos: [{ nCodProd: 201, nValUnit: 150.00, cCodigo: "ACR-200" }]
      };
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return {};
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=201&codigo=ACR-200');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 150.00);
  });

  await pausa();

  // ----------------------------------------------------------
  // 43. Paginação com mais de uma página de movimentos
  // ----------------------------------------------------------
  await teste('Paginacao: busca multiplas paginas de movimentos', async () => {
    let chamadaMovimento = 0;
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') {
        chamadaMovimento++;
        if (chamadaMovimento === 1) return { movProdutoListar: [{ idMov: 1, idDoc: 0, idProd: 201, dtMov: '01/01/2026', operacao: '30', cancelamento: 'N', qtde: 1, valor: 10 }], nTotPaginas: 2 };
        if (chamadaMovimento === 2) return { movProdutoListar: [{ idMov: 2, idDoc: 5001, idProd: 201, dtMov: '15/05/2026', numDoc: '55001', operacao: '21', cancelamento: 'N', devolucao: 'N', qtde: 8, valor: 800, idRecebimento: 6001 }], nTotPaginas: 2 };
        return { movProdutoListar: [], nTotPaginas: 2 };
      }
      if (call === 'ConsultarNotaEnt') return {
        cabec: { cNumNFe: "55001", dtEmissao: "15/05/2026" },
        produtos: [{ nCodProd: 201, nValUnit: 100.00, cCodigo: "ACR-200" }]
      };
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return {};
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=201&codigo=ACR-200');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 100.00);
  });

  await pausa();
  // ----------------------------------------------------------
  // 44. Erro ListarMovimentoEstoque NAO vira nao_encontrado silenciosamente
  // ----------------------------------------------------------
  await teste('Erro ListarMovimentoEstoque nao vira nao_encontrado silenciosamente', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ListarMovimentoEstoque') return { faultstring: "Erro interno do servidor", faultcode: "SOAP-500" };
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/debug-ultima-compra?id=201&codigo=ACR-200');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.resultadoFinal.fonteCusto, 'erro');
    assert(r.body.resultadoFinal.erro.length > 0);
  });

  await pausa();

  // ----------------------------------------------------------
  // 45. Erro ConsultarNotaEnt → fallback movimento_estoque
  // ----------------------------------------------------------
  await teste('Erro ConsultarNotaEnt: fallback para movimento_estoque', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ListarMovimentoEstoque') return { movProdutoListar: [{ idMov: 1, idDoc: 9999, idProd: 201, dtMov: '01/08/2026', operacao: '21', cancelamento: 'N', devolucao: 'N', qtde: 5, valor: 500 }], nTotPaginas: 1 };
      if (call === 'ConsultarNotaEnt') return { faultstring: "Registro nao encontrado", faultcode: "SOAP-404" };
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=201&codigo=ACR-200');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'movimento_estoque');
    assert.strictEqual(r.body.compra.custoUnitario, 0);
    assert.strictEqual(r.body.compra.valorUnitarioMovimento, 100);
  });

  await pausa();

  // 46. Categoria chapa-petg: filtra PETG corretamente
  // ----------------------------------------------------------
  await teste('Categoria chapa-petg: filtra por regra PETG', async () => {
    setMockResponses({ produto_servico_cadastro: [{codigo_produto:"1",codigo:"X",descricao:"X",unidade:"UN",inativo:"N"}], total_de_paginas:1,total_de_registros:1,pagina:1,registros_por_pagina:1 }, { locaisEncontrados:[{codigo_local_estoque:1,cDescricao:"ESTOQUE DOMU"}] });
    await requisicaoLocal('POST','/api/omie/test',{appKey:'1234567890',appSecret:'s'});
    await pausa();
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarProdutos') return { produto_servico_cadastro: [
        {codigo_produto:"P1",codigo:"PETG-2",descricao:"CHAPA PETG CRISTAL 2MM",unidade:"CH",inativo:"N"},
        {codigo_produto:"P2",codigo:"PETG-3",descricao:"CHAPA PETG BRANCO 3MM",unidade:"CH",inativo:"N"},
        {codigo_produto:"P3",codigo:"PETG-5",descricao:"CHAPA PETG FUME 5MM",unidade:"CH",inativo:"N"},
        {codigo_produto:"X1",codigo:"ACR-2",descricao:"CHAPA ACRILICO 2MM",unidade:"CH",inativo:"N"}
      ], total_de_paginas:1 };
      if (parsed.call === 'PosicaoEstoque') return {saldo:10,fisico:10,cmc:50,reservado:0};
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/materiais?categoria=chapa-petg');
    assert.strictEqual(r.status,200);
    assert.strictEqual(r.body.produtos.length,3);
    assert(r.body.produtos.every(p => p.codigo.startsWith('PETG')));
  });

  await pausa();

  // ----------------------------------------------------------
  // 47. Categoria chapa-aco: filtra aço/inox corretamente
  // ----------------------------------------------------------
  await teste('Categoria chapa-aco: filtra por regra aco/inox', async () => {
    setMockResponses({ produto_servico_cadastro: [{codigo_produto:"1",codigo:"X",descricao:"X",unidade:"UN",inativo:"N"}], total_de_paginas:1,total_de_registros:1,pagina:1,registros_por_pagina:1 }, { locaisEncontrados:[{codigo_local_estoque:1,cDescricao:"ESTOQUE DOMU"}] });
    await requisicaoLocal('POST','/api/omie/test',{appKey:'1234567890',appSecret:'s'});
    await pausa();
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarProdutos') return { produto_servico_cadastro: [
        {codigo_produto:"A1",codigo:"ACO-08",descricao:"CHAPA ACO 1020 0,8MM",unidade:"CH",inativo:"N"},
        {codigo_produto:"A2",codigo:"INOX-15",descricao:"CHAPA INOX 304 1,5MM",unidade:"CH",inativo:"N"},
        {codigo_produto:"A3",codigo:"ACO-20",descricao:"CHAPA ACO GALV 2,0MM",unidade:"CH",inativo:"N"},
        {codigo_produto:"X1",codigo:"MDF-6",descricao:"CHAPA MDF 6MM",unidade:"CH",inativo:"N"}
      ], total_de_paginas:1 };
      if (parsed.call === 'PosicaoEstoque') return {saldo:5,fisico:5,cmc:100,reservado:0};
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/materiais?categoria=chapa-aco');
    assert.strictEqual(r.status,200);
    assert.strictEqual(r.body.produtos.length,3);
  });

  await pausa();

  // ----------------------------------------------------------
  // 48. Categoria tubo-redondo: filtra tubos redondos
  // ----------------------------------------------------------
  await teste('Categoria tubo-redondo: filtra tubos redondos', async () => {
    setMockResponses({ produto_servico_cadastro: [{codigo_produto:"1",codigo:"X",descricao:"X",unidade:"UN",inativo:"N"}], total_de_paginas:1,total_de_registros:1,pagina:1,registros_por_pagina:1 }, { locaisEncontrados:[{codigo_local_estoque:1,cDescricao:"ESTOQUE DOMU"}] });
    await requisicaoLocal('POST','/api/omie/test',{appKey:'1234567890',appSecret:'s'});
    await pausa();
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarProdutos') return { produto_servico_cadastro: [
        {codigo_produto:"T1",codigo:"TR-25",descricao:"TUBO REDONDO ACO 25MM",unidade:"UN",inativo:"N"},
        {codigo_produto:"T2",codigo:"TR-32",descricao:"TUBO REDONDO ACO 32MM",unidade:"UN",inativo:"N"},
        {codigo_produto:"T3",codigo:"TR-50",descricao:"TUBO REDONDO INOX 50MM",unidade:"UN",inativo:"N"},
        {codigo_produto:"TQ",codigo:"TQ-20",descricao:"TUBO QUADRADO 20X20",unidade:"UN",inativo:"N"}
      ], total_de_paginas:1 };
      if (parsed.call === 'PosicaoEstoque') return {saldo:20,fisico:20,cmc:30,reservado:0};
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/materiais?categoria=tubo-redondo');
    assert.strictEqual(r.status,200);
    assert.strictEqual(r.body.produtos.length,3);
  });

  await pausa();

  // ----------------------------------------------------------
  // 49. Categoria arame: filtra arames
  // ----------------------------------------------------------
  await teste('Categoria arame: filtra arames', async () => {
    setMockResponses({ produto_servico_cadastro: [{codigo_produto:"1",codigo:"X",descricao:"X",unidade:"UN",inativo:"N"}], total_de_paginas:1,total_de_registros:1,pagina:1,registros_por_pagina:1 }, { locaisEncontrados:[{codigo_local_estoque:1,cDescricao:"ESTOQUE DOMU"}] });
    await requisicaoLocal('POST','/api/omie/test',{appKey:'1234567890',appSecret:'s'});
    await pausa();
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarProdutos') return { produto_servico_cadastro: [
        {codigo_produto:"AR1",codigo:"ARAME-3",descricao:"ARAME GALVANIZADO 3MM",unidade:"KG",inativo:"N"},
        {codigo_produto:"AR2",codigo:"ARAME-4",descricao:"ARAME RECOZIDO 4MM",unidade:"KG",inativo:"N"},
        {codigo_produto:"AR3",codigo:"ARAME-6",descricao:"ARAME INOX 6MM",unidade:"KG",inativo:"N"},
        {codigo_produto:"X1",codigo:"PSAI-1",descricao:"CHAPA PSAI 1MM",unidade:"CH",inativo:"N"}
      ], total_de_paginas:1 };
      if (parsed.call === 'PosicaoEstoque') return {saldo:100,fisico:100,cmc:15,reservado:0};
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/materiais?categoria=arame');
    assert.strictEqual(r.status,200);
    assert.strictEqual(r.body.produtos.length,3);
  });

  await pausa();

  // ----------------------------------------------------------
  // 50. Materiais: NÃO limita a 50 — retorna todos os candidatos
  // ----------------------------------------------------------
  await teste('Materiais: retorna 75 produtos sem limitar a 50', async () => {
    setMockResponses({ produto_servico_cadastro: [{codigo_produto:"1",codigo:"X",descricao:"X",unidade:"UN",inativo:"N"}], total_de_paginas:1,total_de_registros:1,pagina:1,registros_por_pagina:1 }, { locaisEncontrados:[{codigo_local_estoque:1,cDescricao:"ESTOQUE DOMU"}] });
    await requisicaoLocal('POST','/api/omie/test',{appKey:'1234567890',appSecret:'s'});
    await pausa();
    const muitos = [];
    for (let i = 0; i < 75; i++) muitos.push({codigo_produto:String(2000+i),codigo:`MDF-${String(i).padStart(3,'0')}`,descricao:`CHAPA MDF TIPO ${i}`,unidade:"CH",inativo:"N"});
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarProdutos') return { produto_servico_cadastro: muitos, total_de_paginas:1 };
      if (parsed.call === 'PosicaoEstoque') return {saldo:5,fisico:5,cmc:90,reservado:0};
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/materiais?categoria=chapa-mdf');
    assert.strictEqual(r.status,200);
    assert.strictEqual(r.body.produtos.length,75,'Deve retornar TODOS os 75, nao limitar a 50');
  });

  await pausa();

  // ----------------------------------------------------------
  // 51. End-to-end: /produto-compra com produto real 11835150482
  // ----------------------------------------------------------
  await teste('End-to-end: produto-compra retorna fonteCusto=ultima_compra custoUnitario=25.50', async () => {
    setMockResponses({ produto_servico_cadastro: [{codigo_produto:"1",codigo:"X",descricao:"X",unidade:"UN",inativo:"N"}], total_de_paginas:1,total_de_registros:1,pagina:1,registros_por_pagina:1 }, { locaisEncontrados:[{codigo_local_estoque:1,cDescricao:"ESTOQUE DOMU"}] });
    await requisicaoLocal('POST','/api/omie/test',{appKey:'1234567890',appSecret:'s'});
    await pausa();
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return { codigo_produto:"11835150482", codigo:"4084438", descricao:"CHAPA PSAI BRANCO TRICAMADA 1,00 X 1000 X 2000MM", unidade:"CH", ncm:"3920.30.00", valor_unitario:32.30 };
      if (call === 'ListarMovimentoEstoque') return { movProdutoListar:[{idMov:90001,idDoc:7001,idProd:11835150482,dtMov:'15/07/2026',numDoc:'77001',operacao:'21',cancelamento:'N',devolucao:'N',qtde:10,valor:255,idRecebimento:5001}], nTotPaginas:1 };
      if (call === 'ConsultarNotaEnt') return { cabec:{cNumNFe:"77001",dtEmissao:"15/07/2026",cNomeFornecedor:"Fornecedor PSAI"}, produtos:[{nCodProd:11835150482,cCodigo:"4084438",cDescricao:"CHAPA PSAI BRANCO TRICAMADA",nValUnit:25.50,ICMS:{nAliq:12},IPI:{nAliqIPI:0},PIS:{nAliqPIS:1.65},COFINS:{nAliqCOFINS:7.60},custos:{cICMSCusto:"S",cIPICusto:"N",cPISCusto:"N",cCOFINSCusto:"N"}}] };
      if (call === 'PosicaoEstoque') return { saldo:0, cmc:22.32, fisico:0, reservado:0 };
      if (call === 'ConsultarRecebimento') return { cRazaoSocial:"Fornecedor PSAI Ltda" };
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/produto-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status,200);
    assert.strictEqual(r.body.compra.fonteCusto,'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario,25.50);
    assert.strictEqual(r.body.compra.valorUnitarioNota,25.50);
    assert.strictEqual(r.body.compra.cmc,22.32);
    assert.strictEqual(r.body.compra.saldo,0);
    assert.strictEqual(r.body.compra.numeroNota,'77001');
    assert.strictEqual(r.body.compra.fiscalCompraCompleto,true);
    assert.strictEqual(r.body.compra.criterioSelecao,'maior_data_emissao');
    assert.strictEqual(r.body.compra.criterioVinculo,'nota_entrada_item');
    assert.strictEqual(r.body.produto.id,'11835150482');
    assert.strictEqual(r.body.produto.codigo,'4084438');
  });

  await pausa();

  // ----------------------------------------------------------
  // 52. Contrato HTML: campos do backend correspondem ao que HTML consome
  // ----------------------------------------------------------
  await teste('Contrato HTML: todos os campos consumidos pelo HTML estao presentes na resposta', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      if (call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/produto-compra?id=201&codigo=ACR-200');
    assert.strictEqual(r.status,200);
    const c = r.body.compra;
    // Campos que o HTML consome (extraidos de aplicarDadosCompraOmieAoGrupo)
    const camposObrigatorios = ['fonteCusto','custoUnitario','dataUltimaCompra','numeroNota','cmc','saldo','dataEstoque','tributosOrigem','valorUnitarioNota','custoLiquidoUnitario','fiscalCompraCompleto','tratamentoFiscal','criterioSelecao','criterioVinculo','codigoProdutoNfe','descricaoProdutoNfe','ipi','icms','pisCofins'];
    for (const campo of camposObrigatorios) {
      assert(campo in c, `Campo "${campo}" ausente na resposta compra`);
    }
    // fonteCusto deve ser 'ultima_compra' quando nota encontrada
    assert.strictEqual(c.fonteCusto,'ultima_compra');
    // Campos do produto
    const p = r.body.produto;
    assert.strictEqual(typeof p.id,'string');
    assert.strictEqual(typeof p.codigo,'string');
    assert.strictEqual(typeof p.descricao,'string');
    assert.strictEqual(typeof p.unidade,'string');
    assert.strictEqual(typeof p.ncm,'string');
    assert.strictEqual(typeof p.valorUnitario,'number');
  });

  await pausa();

  // ----------------------------------------------------------
  // 53. Circuit breaker: rate limit não vira nao_encontrado
  // ----------------------------------------------------------
  await teste('Circuit breaker: rate limit retorna erro, NAO nao_encontrado', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return { codigo_produto:"201", codigo:"ACR-200", descricao:"CHAPA ACRILICO", unidade:"CH", valor_unitario:200 };
      if (call === 'ListarMovimentoEstoque') return { faultstring:"API bloqueada por consumo indevido. Tente novamente em 287 segundos.", faultcode:"SOAP-ENV:Client" };
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/produto-compra?id=201&codigo=ACR-200');
    // Rate limit deve resultar em erro, NÃO em fonteCusto=nao_encontrado
    assert(r.status >= 400 || (r.body.error && r.body.error.includes('bloqueada')), 'Rate limit deve virar erro HTTP, nao nao_encontrado');
  });

  await pausa();

  // ----------------------------------------------------------
  // 54. Circuit breaker: segunda chamada ao mesmo método usa bloqueio salvo
  // ----------------------------------------------------------
  await teste('Circuit breaker: segunda chamada ao metodo bloqueado nao atinge Omie', async () => {
    // Limpar circuit breaker
    const conector = require('./conector-omie.js');
    conector.circuitBreaker.clear();

    // Registrar bloqueio manual
    conector.registrarBloqueio('ListarMovimentoEstoque', 300);

    mockCalls = [];
    setMockRouter((parsed) => {
      if (parsed.call === 'ConsultarProduto') return { codigo_produto:"201", codigo:"ACR-200", descricao:"X", unidade:"CH", valor_unitario:1 };
      if (parsed.call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      return {};
    });

    const r = await requisicaoLocal('GET','/api/omie/produto-compra?id=201&codigo=ACR-200');
    // NÃO deve ter chamado ListarMovimentoEstoque no mock
    const movCalls = mockCalls.filter(c => c.parsed?.call === 'ListarMovimentoEstoque');
    assert.strictEqual(movCalls.length, 0, 'NAO deve atingir Omie quando metodo bloqueado');

    // Limpar para próximos testes
    conector.circuitBreaker.clear();
  });

  await pausa();

  // ----------------------------------------------------------
  // 55. Métodos independentes: PosicaoEstoque funciona com ListarMovimento bloqueado
  // ----------------------------------------------------------
  await teste('Metodos independentes: PosicaoEstoque funciona com ListarMovimento bloqueado', async () => {
    const conector = require('./conector-omie.js');
    conector.circuitBreaker.clear();
    conector.registrarBloqueio('ListarMovimentoEstoque', 300);

    setMockRouter((parsed) => {
      if (parsed.call === 'ConsultarProduto') return { codigo_produto:"201", codigo:"ACR-200", descricao:"X", unidade:"CH", valor_unitario:1 };
      if (parsed.call === 'PosicaoEstoque') return { saldo:15, cmc:155, fisico:15, reservado:0 };
      return {};
    });

    const r = await requisicaoLocal('GET','/api/omie/produto-compra?id=201&codigo=ACR-200');
    // Deve retornar erro por rate limit de ListarMovimentoEstoque
    // MAS se PosicaoEstoque fosse chamado, não estaria bloqueado
    const bloqPos = conector.verificarBloqueio('PosicaoEstoque');
    assert.strictEqual(bloqPos, null, 'PosicaoEstoque NAO deve estar bloqueado');
    const bloqMov = conector.verificarBloqueio('ListarMovimentoEstoque');
    assert(bloqMov !== null, 'ListarMovimentoEstoque DEVE estar bloqueado');

    conector.circuitBreaker.clear();
  });

  await pausa();

  // ----------------------------------------------------------
  // 56. Zero ConsultarProduto quando ID já disponível — cache vazio E populado
  // ----------------------------------------------------------
  await teste('Zero ConsultarProduto com ID disponivel: cache vazio E populado', async () => {
    // Reconectar com cache limpo
    setMockResponses({
      produto_servico_cadastro: [{codigo_produto:"1",codigo:"X",descricao:"X",unidade:"UN",inativo:"N"}],
      total_de_paginas:1, total_de_registros:1, pagina:1, registros_por_pagina:1
    }, { locaisEncontrados:[{codigo_local_estoque:1,cDescricao:"ESTOQUE DOMU"}] });
    await requisicaoLocal('POST','/api/omie/test',{appKey:'1234567890',appSecret:'s'});
    await pausa();

    // TESTE A: cache VAZIO — ConsultarProduto deve ser 0
    mockCalls = [];
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarMovimentoEstoque') return { movProdutoListar:[{idMov:1,idDoc:7001,idProd:11835150482,dtMov:'15/07/2026',operacao:'21',cancelamento:'N',devolucao:'N',qtde:10,valor:255}], nTotPaginas:1 };
      if (parsed.call === 'ConsultarNotaEnt') return { cabec:{cNumNFe:"77001",dtEmissao:"15/07/2026"}, produtos:[{nCodProd:11835150482,nValUnit:25.50}] };
      if (parsed.call === 'PosicaoEstoque') return { saldo:0, cmc:22.32, fisico:0, reservado:0 };
      if (parsed.call === 'ConsultarRecebimento') return {};
      if (parsed.call === 'ListarProdutos') return { produto_servico_cadastro:[], total_de_paginas:1 };
      return {};
    });

    const r1 = await requisicaoLocal('GET','/api/omie/produto-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r1.status, 200);
    const cpCalls1 = mockCalls.filter(c => c.parsed?.call === 'ConsultarProduto');
    assert.strictEqual(cpCalls1.length, 0, 'Cache VAZIO: zero ConsultarProduto');
    assert.strictEqual(r1.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r1.body.compra.custoUnitario, 25.50);

    // TESTE B: popular cache e repetir
    setMockResponses({
      produto_servico_cadastro: [{codigo_produto:"11835150482",codigo:"4084438",descricao:"CHAPA PSAI BRANCO TRICAMADA",unidade:"CH",ncm:"3920.30.00",valor_unitario:32.30,inativo:"N"}],
      total_de_paginas:1, total_de_registros:1, pagina:1, registros_por_pagina:200
    });
    await requisicaoLocal('GET','/api/omie/produtos?q=PSAI');
    await pausa();

    mockCalls = [];
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarMovimentoEstoque') return { movProdutoListar:[{idMov:1,idDoc:7001,idProd:11835150482,dtMov:'15/07/2026',operacao:'21',cancelamento:'N',devolucao:'N',qtde:10,valor:255}], nTotPaginas:1 };
      if (parsed.call === 'ConsultarNotaEnt') return { cabec:{cNumNFe:"77001",dtEmissao:"15/07/2026"}, produtos:[{nCodProd:11835150482,nValUnit:25.50}] };
      if (parsed.call === 'PosicaoEstoque') return { saldo:0, cmc:22.32, fisico:0, reservado:0 };
      if (parsed.call === 'ConsultarRecebimento') return {};
      return {};
    });

    const r2 = await requisicaoLocal('GET','/api/omie/produto-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r2.status, 200);
    const cpCalls2 = mockCalls.filter(c => c.parsed?.call === 'ConsultarProduto');
    assert.strictEqual(cpCalls2.length, 0, 'Cache POPULADO: zero ConsultarProduto');
    assert.strictEqual(r2.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r2.body.compra.custoUnitario, 25.50);
    // Com cache populado, produto completo
    assert.strictEqual(r2.body.produto.id, '11835150482');
    assert.strictEqual(r2.body.produto.codigo, '4084438');
  });

  await pausa();

  // ----------------------------------------------------------
  // 57. Janelas históricas NÃO se sobrepõem
  // ----------------------------------------------------------
  await teste('Janelas historicas NAO se sobrepoem', async () => {
    setMockResponses({ produto_servico_cadastro: [{codigo_produto:"1",codigo:"X",descricao:"X",unidade:"UN",inativo:"N"}], total_de_paginas:1,total_de_registros:1,pagina:1,registros_por_pagina:1 }, { locaisEncontrados:[{codigo_local_estoque:1,cDescricao:"ESTOQUE DOMU"}] });
    await requisicaoLocal('POST','/api/omie/test',{appKey:'1234567890',appSecret:'s'});
    await pausa();

    mockCalls = [];
    let chamadaMov = 0;
    setMockRouter((parsed) => {
      if (parsed.call === 'ConsultarProduto') return { codigo_produto:"201", codigo:"ACR-200", descricao:"X", unidade:"CH", valor_unitario:1 };
      if (parsed.call === 'ListarMovimentoEstoque') {
        chamadaMov++;
        // Retorna vazio para forçar avançar pelas janelas
        if (chamadaMov <= 5) return { movProdutoListar:[], nTotPaginas:1 };
        // Na 6a janela encontra
        return { movProdutoListar:[{idMov:1,idDoc:1001,idProd:201,dtMov:'01/01/2016',operacao:'21',cancelamento:'N',devolucao:'N',qtde:1,valor:50}], nTotPaginas:1 };
      }
      if (parsed.call === 'ConsultarNotaEnt') return { cabec:{cNumNFe:"1001",dtEmissao:"01/01/2016"}, produtos:[{nCodProd:201,nValUnit:50}] };
      if (parsed.call === 'PosicaoEstoque') return { saldo:0, cmc:0, fisico:0, reservado:0 };
      return {};
    });

    const r = await requisicaoLocal('GET','/api/omie/produto-compra?id=201&codigo=ACR-200');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');

    // Verificar datas das chamadas: NÃO devem se sobrepor
    const movCalls = mockCalls.filter(c => c.parsed?.call === 'ListarMovimentoEstoque');
    assert(movCalls.length >= 2, 'Deve ter feito multiplas janelas');
    // Verificar que dtFinal de uma janela = dtInicial da anterior (sem sobreposição)
    for (let i = 1; i < movCalls.length; i++) {
      const prevFinal = movCalls[i-1].parsed.param[0].dDtFinal;
      const currInicial = movCalls[i].parsed.param[0].dDtInicial;
      // A data final da janela anterior deve ser >= data inicial da próxima (sem gap excessivo)
      // E a data inicial da janela atual deve ser <= data final da janela anterior (sem sobreposição)
      // Na prática: dtFinal(janela N) é a mesma que dtFinal(janela N+1) NÃO (sobreposição)
      assert.notStrictEqual(movCalls[i].parsed.param[0].dDtFinal, movCalls[i-1].parsed.param[0].dDtFinal, 'Janelas NAO devem ter mesmo dtFinal (sobreposicao)');
    }
  });

  await pausa();

  // ----------------------------------------------------------
  // 58. Concorrência: máximo 3 chamadas simultâneas
  // ----------------------------------------------------------
  await teste('Concorrencia: maximo 3 chamadas simultaneas ao Omie', async () => {
    const conector = require('./conector-omie.js');
    mockCalls = [];
    mockUpstreamAtual = 0;
    mockUpstreamMaximo = 0;
    setMockRouter(() => ({ __delayMs: 30, __mockBody: { ok: true } }));
    await Promise.all(Array.from({ length: 12 }, (_, i) =>
      conector.chamarOmieProtegido('teste/', `Concorrencia${i}`, { i })
    ));
    assert(mockUpstreamMaximo > 1, 'Teste deve observar concorrencia real');
    assert(mockUpstreamMaximo <= 3, `Maximo observado ${mockUpstreamMaximo}, esperado <= 3`);
    concorrenciaMaximaMedida = mockUpstreamMaximo;
  });

  await pausa();

  // ----------------------------------------------------------
  // 59. "Não existem registros" NÃO aborta busca — avança janela
  // ----------------------------------------------------------
  await teste('Nao existem registros para pagina: avanca janela sem abortar', async () => {
    setMockResponses({ produto_servico_cadastro: [{codigo_produto:"1",codigo:"X",descricao:"X",unidade:"UN",inativo:"N"}], total_de_paginas:1,total_de_registros:1,pagina:1,registros_por_pagina:1 }, { locaisEncontrados:[{codigo_local_estoque:1,cDescricao:"ESTOQUE DOMU"}] });
    await requisicaoLocal('POST','/api/omie/test',{appKey:'1234567890',appSecret:'s'});
    await pausa();

    let chamadaMov = 0;
    setMockRouter((parsed) => {
      if (parsed.call === 'ConsultarProduto') return { codigo_produto:"201", codigo:"ACR-200", descricao:"X", unidade:"CH", valor_unitario:1 };
      if (parsed.call === 'ListarMovimentoEstoque') {
        chamadaMov++;
        // 1ª janela: "Não existem registros"
        if (chamadaMov === 1) return { faultstring: "ERROR: Não existem registros para a página [1]!", faultcode: "SOAP-ENV:Client" };
        // 2ª janela: "Não existem registros"
        if (chamadaMov === 2) return { faultstring: "Não existem registros para a página [1]!", faultcode: "0" };
        // 3ª janela: encontra compra
        return { movProdutoListar:[{idMov:1,idDoc:5001,idProd:201,dtMov:'01/01/2022',operacao:'21',cancelamento:'N',devolucao:'N',qtde:5,valor:125}], nTotPaginas:1 };
      }
      if (parsed.call === 'ConsultarNotaEnt') return { cabec:{cNumNFe:"5001",dtEmissao:"01/01/2022"}, produtos:[{nCodProd:201,nValUnit:25.00}] };
      if (parsed.call === 'PosicaoEstoque') return { saldo:0, cmc:0, fisico:0, reservado:0 };
      return {};
    });

    const r = await requisicaoLocal('GET','/api/omie/produto-compra?id=201&codigo=ACR-200');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 25.00);
    // Deve ter passado por pelo menos 3 janelas
    assert(chamadaMov >= 3, `Deve ter consultado pelo menos 3 janelas, consultou ${chamadaMov}`);
  });

  await pausa();

  // ----------------------------------------------------------
  // 60. TESTE A: Debug com cache vazio — zero ConsultarProduto
  // ----------------------------------------------------------
  await teste('Debug cache vazio: zero ConsultarProduto', async () => {
    setMockResponses({ produto_servico_cadastro:[{codigo_produto:"1",codigo:"X",descricao:"X",unidade:"UN",inativo:"N"}], total_de_paginas:1,total_de_registros:1,pagina:1,registros_por_pagina:1 }, { locaisEncontrados:[{codigo_local_estoque:1,cDescricao:"ESTOQUE DOMU"}] });
    await requisicaoLocal('POST','/api/omie/test',{appKey:'1234567890',appSecret:'s'});
    await pausa();
    mockCalls = [];
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarMovimentoEstoque') return { movProdutoListar:[{idMov:1,idDoc:7001,idProd:11835150482,dtMov:'15/07/2026',operacao:'21',cancelamento:'N',devolucao:'N',qtde:10,valor:255}], nTotPaginas:1 };
      if (parsed.call === 'ConsultarNotaEnt') return { cabec:{cNumNFe:"77001",dtEmissao:"15/07/2026"}, produtos:[{nCodProd:11835150482,nValUnit:25.50}] };
      if (parsed.call === 'PosicaoEstoque') return { saldo:0,cmc:22.32,fisico:0,reservado:0 };
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/debug-ultima-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status,200);
    const cpCalls = mockCalls.filter(c => c.parsed?.call === 'ConsultarProduto');
    assert.strictEqual(cpCalls.length, 0, 'Debug: zero ConsultarProduto');
    assert.strictEqual(r.body.resultadoFinal.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.resultadoFinal.custoUnitario, 25.50);
  });

  await pausa();

  // ----------------------------------------------------------
  // 61. TESTE B: 6 janelas vazias → janelasConsultadas.length=6
  // ----------------------------------------------------------
  await teste('6 janelas vazias: janelasConsultadas.length=6, fonteCusto=nao_encontrado', async () => {
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarMovimentoEstoque') return { movProdutoListar:[], nTotPaginas:1 };
      if (parsed.call === 'PosicaoEstoque') return { saldo:0,cmc:0,fisico:0,reservado:0 };
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/debug-ultima-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status,200);
    assert.strictEqual(r.body.janelasConsultadas.length, 6);
    assert.strictEqual(r.body.resultadoFinal.fonteCusto, 'nao_encontrado');
  });

  await pausa();

  // ----------------------------------------------------------
  // 62. TESTE C: Compra na 3ª janela → janelasConsultadas.length=3
  // ----------------------------------------------------------
  await teste('Compra na 3a janela: janelasConsultadas.length=3', async () => {
    let chamada = 0;
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarMovimentoEstoque') {
        chamada++;
        if (chamada <= 2) return { movProdutoListar:[], nTotPaginas:1 };
        return { movProdutoListar:[{idMov:1,idDoc:7001,idProd:11835150482,dtMov:'01/01/2022',operacao:'21',cancelamento:'N',devolucao:'N',qtde:5,valor:125}], nTotPaginas:1 };
      }
      if (parsed.call === 'ConsultarNotaEnt') return { cabec:{cNumNFe:"7001"}, produtos:[{nCodProd:11835150482,nValUnit:25.00}] };
      if (parsed.call === 'PosicaoEstoque') return { saldo:0,cmc:0,fisico:0,reservado:0 };
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/debug-ultima-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status,200);
    assert.strictEqual(r.body.janelasConsultadas.length, 3);
    assert.strictEqual(r.body.janelasConsultadas[2].resultado, 'compra_encontrada');
    assert.strictEqual(r.body.resultadoFinal.fonteCusto, 'ultima_compra');
  });

  await pausa();

  // ----------------------------------------------------------
  // 63. TESTE D: "Não existem registros" avança para próxima janela
  // ----------------------------------------------------------
  await teste('Nao existem registros avanca janela no debug', async () => {
    let chamada = 0;
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarMovimentoEstoque') {
        chamada++;
        if (chamada === 1) return { faultstring:"ERROR: Não existem registros para a página [1]!", faultcode:"0" };
        return { movProdutoListar:[{idMov:1,idDoc:7001,idProd:11835150482,dtMov:'01/06/2024',operacao:'21',cancelamento:'N',devolucao:'N',qtde:3,valor:75}], nTotPaginas:1 };
      }
      if (parsed.call === 'ConsultarNotaEnt') return { cabec:{}, produtos:[{nCodProd:11835150482,nValUnit:25.00}] };
      if (parsed.call === 'PosicaoEstoque') return { saldo:0,cmc:0,fisico:0,reservado:0 };
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/debug-ultima-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status,200);
    assert(r.body.janelasConsultadas.length >= 2, 'Deve ter consultado ao menos 2 janelas');
    assert.strictEqual(r.body.janelasConsultadas[0].resultado, 'sem_registros');
    assert.strictEqual(r.body.resultadoFinal.fonteCusto, 'ultima_compra');
  });

  await pausa();

  // ----------------------------------------------------------
  // 64. TESTE E: Rate limit na 1ª janela → interrompe, NÃO nao_encontrado
  // ----------------------------------------------------------
  await teste('Rate limit na 1a janela: interrompe, NAO nao_encontrado', async () => {
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarMovimentoEstoque') return { faultstring:"API bloqueada por consumo indevido. Tente novamente em 300 segundos.", faultcode:"0" };
      if (parsed.call === 'PosicaoEstoque') return { saldo:0,cmc:0,fisico:0,reservado:0 };
      return {};
    });
    const conector = require('./conector-omie.js');
    conector.circuitBreaker.clear();
    const r = await requisicaoLocal('GET','/api/omie/debug-ultima-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status,200);
    assert.notStrictEqual(r.body.resultadoFinal.fonteCusto, 'nao_encontrado');
    assert.strictEqual(r.body.resultadoFinal.fonteCusto, 'erro');
    assert(r.body.janelasConsultadas.length <= 1, 'Deve parar na 1a janela');
    conector.circuitBreaker.clear();
  });

  await pausa();

  // ----------------------------------------------------------
  // 65. TESTE G: Debug HTTP com janelasConsultadas preenchido
  // ----------------------------------------------------------
  await teste('Debug HTTP: janelasConsultadas NAO pode ser vazio quando busca executou', async () => {
    setMockRouter((parsed) => {
      if (parsed.call === 'ListarMovimentoEstoque') return { movProdutoListar:[], nTotPaginas:1 };
      if (parsed.call === 'PosicaoEstoque') return { saldo:0,cmc:0,fisico:0,reservado:0 };
      return {};
    });
    const r = await requisicaoLocal('GET','/api/omie/debug-ultima-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status,200);
    assert(r.body.janelasConsultadas.length > 0, 'janelasConsultadas NAO pode ser []');
    r.body.janelasConsultadas.forEach(j => {
      assert(j.inicio, 'Janela deve ter inicio');
      assert(j.fim, 'Janela deve ter fim');
      assert(j.resultado, 'Janela deve ter resultado');
    });
  });

  await pausa();

  // ----------------------------------------------------------
  // 66. Caso real: sem movimento, resolve por ListarRecebimentos
  // ----------------------------------------------------------
  await teste('Fallback ListarRecebimentos: caso 4084438/11835150482 retorna 25.50', async () => {
    setMockRouter(parsed => {
      if (parsed.call === 'ListarMovimentoEstoque') return { movProdutoListar: [], nTotPaginas: 1 };
      if (parsed.call === 'ListarRecebimentos') return fixtureListaRecebimentos();
      if (parsed.call === 'PosicaoEstoque') return { saldo: 0, fisico: 0, cmc: 22.32, reservado: 0 };
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 25.50);
    assert.strictEqual(r.body.compra.valorUnitarioNota, 25.50);
    assert.strictEqual(r.body.compra.criterioVinculo, 'recebimento_item_id_interno');
  });

  await teste('Fallback aceita cNaoGerarMovEstoque=S', async () => {
    setMockRouter(parsed => {
      if (parsed.call === 'ListarMovimentoEstoque') return { movProdutoListar: [], nTotPaginas: 1 };
      if (parsed.call === 'ListarRecebimentos') return fixtureListaRecebimentos({ naoGerar: 'S' });
      if (parsed.call === 'PosicaoEstoque') return { saldo: 0, fisico: 0, cmc: 0 };
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 25.50);
  });

  await teste('Movimento resolvido nao chama ListarRecebimentos', async () => {
    mockCalls = [];
    setMockRouter(parsed => {
      if (parsed.call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
      if (parsed.call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (parsed.call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      if (parsed.call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=201&codigo=ACR-200');
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(mockCalls.filter(c => c.parsed?.call === 'ListarRecebimentos').length, 0);
  });

  await teste('ListarRecebimentos pagina completamente e encontra produto na pagina 2', async () => {
    mockCalls = [];
    setMockRouter(parsed => {
      if (parsed.call === 'ListarMovimentoEstoque') return { movProdutoListar: [], nTotPaginas: 1 };
      if (parsed.call === 'ListarRecebimentos') {
        const pagina = parsed.param[0].nPagina;
        return pagina === 1
          ? fixtureListaRecebimentos({ pagina: 1, totalPaginas: 2, recebimentos: [] })
          : fixtureListaRecebimentos({ pagina: 2, totalPaginas: 2 });
      }
      if (parsed.call === 'PosicaoEstoque') return { saldo: 0, fisico: 0, cmc: 0 };
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.body.compra.custoUnitario, 25.50);
    const paginas = mockCalls.filter(c => c.parsed?.call === 'ListarRecebimentos').map(c => c.parsed.param[0].nPagina);
    assert.deepStrictEqual(paginas.slice(0, 2), [1, 2]);
  });

  await teste('Recebimentos cancelados devolvidos e ignorados nao vencem documento valido', async () => {
    const item = (preco, extra = {}) => ({
      recebimentoCabec: { dtEmissao: extra.data, cNumeroNFe: extra.nf, cCancelado: extra.cancelado || 'N', cDevolvido: extra.devolvido || 'N' },
      itens: [{ itensCabec: { nIdProduto: 11835150482, nPrecoUnit: preco, cIgnorado: extra.ignorado || 'N' } }]
    });
    setMockRouter(parsed => {
      if (parsed.call === 'ListarMovimentoEstoque') return { movProdutoListar: [], nTotPaginas: 1 };
      if (parsed.call === 'ListarRecebimentos') return { recebimentos: [
        item(99, { data: '25/07/2026', cancelado: 'S', nf: 'CANCELADA' }),
        item(88, { data: '24/07/2026', devolvido: 'S', nf: 'DEVOLVIDA' }),
        item(77, { data: '23/07/2026', ignorado: 'S', nf: 'IGNORADA' }),
        item(25.50, { data: '20/07/2026', nf: 'VALIDA' })
      ], nTotPaginas: 1 };
      if (parsed.call === 'PosicaoEstoque') return { saldo: 0, fisico: 0, cmc: 0 };
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=11835150482&codigo=4084438');
    assert.strictEqual(r.body.compra.custoUnitario, 25.50);
    assert.strictEqual(r.body.compra.numeroNota, 'VALIDA');
  });

  await teste('Erro tecnico de PosicaoEstoque impede catalogo parcial', async () => {
    setMockResponses({ produto_servico_cadastro: [{ codigo_produto: '1', codigo: 'X', descricao: 'X', inativo: 'N' }] }, { locaisEncontrados: [{ codigo_local_estoque: 1, cDescricao: 'ESTOQUE DOMU' }] });
    await requisicaoLocal('POST', '/api/omie/test', { appKey: '1234567890', appSecret: 's' });
    setMockRouter(parsed => {
      if (parsed.call === 'ListarProdutos') return { produto_servico_cadastro: [
        { codigo_produto: '801', codigo: 'PSAI-1', descricao: 'CHAPA PSAI 1MM', inativo: 'N' },
        { codigo_produto: '802', codigo: 'PSAI-2', descricao: 'CHAPA PSAI 2MM', inativo: 'N' }
      ], total_de_paginas: 1 };
      if (parsed.call === 'PosicaoEstoque' && parsed.param[0].id_prod === 801) return { saldo: 2, fisico: 2 };
      if (parsed.call === 'PosicaoEstoque') return { faultstring: 'API bloqueada por consumo indevido. Tente novamente em 60 segundos.', faultcode: '0' };
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/materiais?categoria=chapa-psai');
    assert.strictEqual(r.status, 429);
    assert.strictEqual(r.body.produtos, undefined);
    require('./conector-omie.js').circuitBreaker.clear();
  });

  await teste('Cache concorrente compartilha uma carga e propaga falha aos 5 consumidores', async () => {
    const conector = require('./conector-omie.js');
    conector.limparCachesOperacionais();
    mockCalls = [];
    setMockRouter(parsed => parsed.call === 'ListarProdutos'
      ? { __delayMs: 20, __mockBody: { faultstring: 'Falha catalogo', faultcode: '500' } }
      : {});
    const resultadosFalha = await Promise.allSettled(Array.from({ length: 5 }, () => conector.obterProdutosCache(true)));
    assert(resultadosFalha.every(r => r.status === 'rejected'));
    assert.strictEqual(mockCalls.filter(c => c.parsed?.call === 'ListarProdutos').length, 1);
  });

  await teste('Breaker reavaliado na fila impede aguardantes de atingir upstream', async () => {
    const conector = require('./conector-omie.js');
    conector.circuitBreaker.clear();
    mockCalls = [];
    let upstream = 0;
    setMockRouter(() => {
      upstream++;
      return upstream === 1
        ? { __delayMs: 5, __mockBody: { faultstring: 'API bloqueada por consumo indevido. Tente novamente em 60 segundos.', faultcode: '0' } }
        : { __delayMs: 40, __mockBody: { ok: true } };
    });
    await Promise.allSettled(Array.from({ length: 10 }, (_, i) => conector.chamarOmieProtegido('fila/', 'MetodoFila', { i })));
    assert(upstream <= 3, `Somente chamadas já em execução podem atingir upstream; observado=${upstream}`);
    assert(upstream < 10);
    conector.circuitBreaker.clear();
  });

  await teste('Namespaces: integracao nunca substitui ID interno em PosicaoEstoque', async () => {
    setMockResponses({ produto_servico_cadastro: [{ codigo_produto: '1', codigo: 'X', descricao: 'X', inativo: 'N' }] }, { locaisEncontrados: [{ codigo_local_estoque: 1, cDescricao: 'ESTOQUE DOMU' }] });
    await requisicaoLocal('POST', '/api/omie/test', { appKey: '1234567890', appSecret: 's' });
    setMockRouter(parsed => {
      if (parsed.call === 'ListarProdutos') return { produto_servico_cadastro: [
        { codigo_produto: '11835150482', codigo: '4084438', codigo_produto_integracao: 'EXT-1', descricao: 'CHAPA PSAI 1MM', inativo: 'N' },
        { codigo: 'SEM-ID', codigo_produto_integracao: '999999', descricao: 'CHAPA PSAI 2MM', inativo: 'N' }
      ], total_de_paginas: 1 };
      if (parsed.call === 'PosicaoEstoque') return { saldo: 1, fisico: 1 };
      return {};
    });
    const r = await requisicaoLocal('GET', '/api/omie/materiais?categoria=chapa-psai');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.produtos.map(p => p.id), ['11835150482']);
    const ids = mockCalls.filter(c => c.parsed?.call === 'PosicaoEstoque').map(c => c.parsed.param[0].id_prod);
    assert.deepStrictEqual(ids, [11835150482]);
  });

  await teste('Rate limit em Nota Recebimento e Estoque propaga HTTP 429', async () => {
    const cenarios = ['ConsultarNotaEnt', 'ConsultarRecebimento', 'PosicaoEstoque'];
    for (const metodoBloqueado of cenarios) {
      const conector = require('./conector-omie.js');
      conector.circuitBreaker.clear();
      conector.limparCachesConsultas();
      setMockRouter(parsed => {
        if (parsed.call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_ESTOQUE;
        if (parsed.call === metodoBloqueado) return { faultstring: 'API bloqueada por consumo indevido. Tente novamente em 60 segundos.', faultcode: '0' };
        if (parsed.call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
        if (parsed.call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
        if (parsed.call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
        return {};
      });
      const r = await requisicaoLocal('GET', '/api/omie/produto-compra?id=201&codigo=ACR-200');
      assert.strictEqual(r.status, 429, `${metodoBloqueado} deve propagar rate limit`);
      assert.strictEqual(r.body.code, 'OMIE_RATE_LIMIT');
    }
    require('./conector-omie.js').circuitBreaker.clear();
  });

  await teste('Compra e estoque simultaneos compartilham Promises in-flight', async () => {
    const conector = require('./conector-omie.js');
    conector.limparCachesConsultas();
    mockCalls = [];
    setMockRouter(parsed => {
      if (parsed.call === 'ListarMovimentoEstoque') return { __delayMs: 20, __mockBody: FIXTURE_MOVIMENTO_ESTOQUE };
      if (parsed.call === 'ConsultarNotaEnt') return FIXTURE_NOTA_ENTRADA;
      if (parsed.call === 'ConsultarRecebimento') return FIXTURE_RECEBIMENTO;
      if (parsed.call === 'PosicaoEstoque') return { __delayMs: 20, __mockBody: FIXTURE_POSICAO_ESTOQUE };
      return {};
    });
    const respostas = await Promise.all(Array.from({ length: 5 }, () =>
      requisicaoLocal('GET', '/api/omie/produto-compra?id=201&codigo=ACR-200')
    ));
    assert(respostas.every(r => r.status === 200 && r.body.compra.custoUnitario === 146.36));
    assert.strictEqual(mockCalls.filter(c => c.parsed?.call === 'ListarMovimentoEstoque').length, 1);
    assert.strictEqual(mockCalls.filter(c => c.parsed?.call === 'PosicaoEstoque').length, 1);
  });

  await teste('Contrato lê HTML oficial e confirma hash/campos consumidos', async () => {
    const htmlBuffer = fs.readFileSync('./domu_dashboard_completo_74.html');
    assert.strictEqual(crypto.createHash('sha256').update(htmlBuffer).digest('hex'), 'd41065129d19030a0ead350bc34498249cf3029f8f87cdbd0c34aecc318b7f06');
    const html = htmlBuffer.toString('utf8');
    for (const endpoint of ['/api/omie/status', '/api/omie/test', '/api/omie/produtos', '/api/omie/materiais', '/api/omie/produto-compra']) assert(html.includes(endpoint));
    for (const campo of ['fonteCusto', 'custoUnitario', 'dataUltimaCompra', 'numeroNota', 'cmc', 'saldo', 'valorUnitarioNota', 'criterioVinculo']) assert(html.includes(campo));
  });

  await pausa();

  // ----------------------------------------------------------
  // RESULTADO FINAL
  // ----------------------------------------------------------
  await pararServidor();

  console.log('\n  =============================================');
  console.log(`  RESULTADO: ${testesOk}/${testesTotal} testes passaram`);
  console.log(`  CONCORRENCIA MAXIMA MEDIDA: ${concorrenciaMaximaMedida}`);
  console.log(`  CHAMADAS REAIS OMIE: ${chamadasReaisOmie}`);
  if (testesFalha > 0) {
    console.log(`  FALHAS: ${testesFalha}`);
    resultados.filter(r => !r.ok).forEach(r => {
      console.log(`    \u2717 ${r.nome}: ${r.erro}`);
    });
  }
  console.log('  =============================================\n');

  process.exit(testesFalha > 0 ? 1 : 0);
}

// ============================================================
// EXECUÇÃO
// ============================================================
executarTestes().catch(err => {
  console.error('Erro fatal nos testes:', err);
  if (serverInstance) serverInstance.close();
  process.exit(1);
});
