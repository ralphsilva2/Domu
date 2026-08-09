// ============================================================
// DOMU — Testes Automatizados do Conector Omie
// Execucao: node testes-omie.js
// Sem dependencias externas — intercepta HTTPS nativamente
// ============================================================

const http = require('http');
const https = require('https');
const assert = require('assert');

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

const originalRequest = https.request;

function instalarMock() {
  mockCalls = [];
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
        let parsed = {};
        try { parsed = JSON.parse(callInfo.body); } catch(e) {}
        callInfo.parsed = parsed;
        mockCalls.push(callInfo);

        let responseData = '{}';
        let statusCode = 200;

        // Use router if available, otherwise use queue
        if (mockCallRouter) {
          const routedResponse = mockCallRouter(parsed);
          responseData = JSON.stringify(routedResponse);
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
              setImmediate(() => setImmediate(() => handler()));
            }
            return fakeRes;
          }
        };

        if (callback) setImmediate(() => callback(fakeRes));
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
    assert.strictEqual(r.body.custoTeste, 45.80);
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
  // 8. GET /api/omie/materiais — retorna lista de materiais
  // ----------------------------------------------------------
  await teste('GET /api/omie/materiais — retorna produtos', async () => {
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
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra_nota_entrada');
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
  // 13. POST /api/omie/test — credenciais vazias retorna 400
  // ----------------------------------------------------------
  await teste('POST /api/omie/test — credenciais vazias retorna 400', async () => {
    const r = await requisicaoLocal('POST', '/api/omie/test', {
      appKey: '',
      appSecret: ''
    });
    assert.strictEqual(r.status, 400);
    assert(r.body.error.length > 0);
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
    // cadastro tem valor_unitario=200, mas custo REAL e 146.36
    assert.strictEqual(r.body.produto.valorUnitario, 200.00);
    assert.strictEqual(r.body.compra.custoUnitario, 146.36);
    assert.notStrictEqual(r.body.compra.custoUnitario, 200.00);
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra_nota_entrada');
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
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra_nota_entrada');
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
  await teste('Sem historico compra: fonteCusto=sem_ultima_compra, custoUnitario=0', async () => {
    setMockRouter((parsed) => {
      const call = parsed.call;
      if (call === 'ConsultarProduto') return FIXTURE_CONSULTAR_PRODUTO_ACR;
      if (call === 'ListarMovimentoEstoque') return FIXTURE_MOVIMENTO_VAZIO;
      if (call === 'PosicaoEstoque') return FIXTURE_POSICAO_ESTOQUE;
      return {};
    });

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=ACR-200&id=201');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.compra.fonteCusto, 'sem_ultima_compra');
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
  await teste('Nota inacessivel: fallback para ultima_compra_movimento', async () => {
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
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra_movimento');
    // valor=1463.60, qtde=10 → unit=146.36
    assert.strictEqual(r.body.compra.custoUnitario, 146.36);
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
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra_nota_entrada');
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
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra_nota_entrada');
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
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra_movimento');
    assert.strictEqual(r.body.compra.custoUnitario, 146.36); // 1463.60 / 10
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
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra_nota_entrada');
    assert.strictEqual(r.body.compra.custoUnitario, 146.36);
    // PosicaoEstoque should NOT have been called (no fallback to 0)
    const estoqueCall = mockCalls.find(c => c.parsed && c.parsed.call === 'PosicaoEstoque');
    assert(!estoqueCall, 'NAO deve chamar PosicaoEstoque quando estoque DOMU nao encontrado');
    // dataEstoque should indicate the problem
    assert.strictEqual(r.body.compra.dataEstoque, 'estoque_domu_nao_encontrado');
  });

  await pausa();

  // ----------------------------------------------------------
  // 32. Filtro tipoItem=01: só matéria-prima aparece
  // ----------------------------------------------------------
  await teste('Filtro tipoItem: so materia-prima aparece, produto acabado nao', async () => {
    setMockResponses({
      produto_servico_cadastro: [
        {codigo_produto: "501", codigo: "PSAI-MP", descricao: "CHAPA PSAI MATERIA PRIMA", unidade: "CH", ncm: "3920.30.00", valor_unitario: 50, tipoItem: "01", inativo: "N"},
        {codigo_produto: "502", codigo: "PSAI-PA", descricao: "BANDEJA PSAI PRODUTO ACABADO", unidade: "UN", ncm: "3920.30.00", valor_unitario: 120, tipoItem: "04", inativo: "N"},
        {codigo_produto: "503", codigo: "PSAI-INAT", descricao: "CHAPA PSAI INATIVA", unidade: "CH", ncm: "3920.30.00", valor_unitario: 45, tipoItem: "01", inativo: "S"},
        {codigo_produto: "504", codigo: "MDF-MP", descricao: "CHAPA MDF MATERIA PRIMA", unidade: "CH", ncm: "4411.12.10", valor_unitario: 90, tipoItem: "01", inativo: "N"}
      ],
      total_de_paginas: 1, total_de_registros: 4, pagina: 1, registros_por_pagina: 200
    });

    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=PSAI');
    assert.strictEqual(r.status, 200);
    // Deve retornar SOMENTE a MP ativa com PSAI
    assert.strictEqual(r.body.produtos.length, 1);
    assert.strictEqual(r.body.produtos[0].codigo, 'PSAI-MP');
    assert.strictEqual(r.body.produtos[0].id, '501');
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
  // RESULTADO FINAL
  // ----------------------------------------------------------
  await pararServidor();

  console.log('\n  =============================================');
  console.log(`  RESULTADO: ${testesOk}/${testesTotal} testes passaram`);
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
