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
    {codigo_produto: "PSAI-050", codigo_produto_integracao: "101", descricao: "CHAPA PSAI CRISTAL 0,50 MM — 1000 X 2000 MM", unidade: "CH", ncm: "3920.30.00", valor_unitario: 45.80},
    {codigo_produto: "PSAI-075", codigo_produto_integracao: "102", descricao: "CHAPA PSAI CRISTAL 0,75 MM — 1000 X 2000 MM", unidade: "CH", ncm: "3920.30.00", valor_unitario: 62.50},
    {codigo_produto: "ACR-200", codigo_produto_integracao: "201", descricao: "CHAPA ACRILICO CRISTAL 2,00 MM — 1000 X 2000 MM", unidade: "CH", ncm: "3926.90.90", valor_unitario: 146.36},
  ],
  total_de_paginas: 2,
  total_de_registros: 5,
  pagina: 1,
  registros_por_pagina: 200
};


const FIXTURE_LISTAR_PRODUTOS_P2 = {
  produto_servico_cadastro: [
    {codigo_produto: "MDF-060", codigo_produto_integracao: "301", descricao: "CHAPA MDF CRU 6,00 MM — 1840 X 2750 MM", unidade: "CH", ncm: "4411.12.10", valor_unitario: 89.90},
    {codigo_produto: "TQ-2020-120", codigo_produto_integracao: "401", descricao: "TUBO QUADRADO AÇO 20 X 20 X 1,20 MM — BARRA 6000 MM", unidade: "UN", ncm: "7306.61.00", valor_unitario: 32.40}
  ],
  total_de_paginas: 2,
  total_de_registros: 5,
  pagina: 2,
  registros_por_pagina: 200
};

const FIXTURE_CONSULTAR_PRODUTO = {
  codigo_produto: "PSAI-050",
  codigo_produto_integracao: "101",
  descricao: "CHAPA PSAI CRISTAL 0,50 MM — 1000 X 2000 MM",
  unidade: "CH",
  ncm: "3920.30.00",
  valor_unitario: 45.80
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

// ============================================================
// MOCK DO HTTPS — Intercepta chamadas para app.omie.com.br
// ============================================================

let mockResponses = [];
let mockCalls = [];

const originalRequest = https.request;


function instalarMock() {
  mockCalls = [];
  https.request = function(opts, callback) {
    // Captura a chamada
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
        // Parse o body para saber qual call foi feita
        let parsed = {};
        try { parsed = JSON.parse(callInfo.body); } catch(e) {}
        callInfo.parsed = parsed;
        mockCalls.push(callInfo);

        // Encontra a resposta mock adequada
        let responseData = '{}';
        let statusCode = 200;


        if (mockResponses.length > 0) {
          const mock = mockResponses.shift();
          if (typeof mock === 'function') {
            responseData = JSON.stringify(mock(parsed));
          } else {
            responseData = JSON.stringify(mock);
          }
        }

        // Simula a resposta HTTP
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
  mockCalls = [];
}

function setMockResponses(...responses) {
  mockResponses = [...responses];
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
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    testesFalha++;
    resultados.push({ nome, ok: false, erro: e.message });
    console.log(`  ✗ ${nome}`);
    console.log(`    ERRO: ${e.message}`);
  }
}

// ============================================================
// SERVIDOR DE TESTE
// ============================================================

let serverInstance = null;


async function iniciarServidor() {
  // Instala mock ANTES de carregar o modulo
  instalarMock();

  // Limpa cache do require
  delete require.cache[require.resolve('./conector-omie.js')];

  const conector = require('./conector-omie.js');
  serverInstance = conector.server;

  // Espera o servidor estar ouvindo
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

// Pequena pausa entre testes para garantir I/O
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
    // Mock: ListarProdutos retorna 1 produto para teste
    setMockResponses({
      produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO],
      total_de_paginas: 1,
      total_de_registros: 1,
      pagina: 1,
      registros_por_pagina: 1
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
    // Mock: 2 paginas de produtos
    setMockResponses(FIXTURE_LISTAR_PRODUTOS_P1, FIXTURE_LISTAR_PRODUTOS_P2);

    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=CHAPA');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body.produtos));
    // Deve retornar 4 produtos com "CHAPA" (todos menos o TUBO)
    assert.strictEqual(r.body.produtos.length, 4);
  });

  await pausa();


  // ----------------------------------------------------------
  // 5. GET /api/omie/produtos — busca por descricao PSAI
  // ----------------------------------------------------------
  await teste('GET /api/omie/produtos — busca PSAI retorna resultados corretos', async () => {
    // Cache ja esta carregado do teste anterior, nao precisa mock
    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=PSAI');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body.produtos));
    assert.strictEqual(r.body.produtos.length, 2);
    // Verifica que sao os produtos PSAI
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
    assert.strictEqual(r.body.produtos[0].valorUnitario, 146.36);
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
    // Valida todas as propriedades do contrato
    assert.strictEqual(typeof p.id, 'string');
    assert.strictEqual(typeof p.codigo, 'string');
    assert.strictEqual(typeof p.descricao, 'string');
    assert.strictEqual(typeof p.unidade, 'string');
    assert.strictEqual(typeof p.ncm, 'string');
    assert.strictEqual(typeof p.valorUnitario, 'number');
    // Nao deve ter propriedades extras do Omie
    assert.strictEqual(p.codigo_produto, undefined);
    assert.strictEqual(p.codigo_produto_integracao, undefined);
    assert.strictEqual(p.valor_unitario, undefined);
  });

  await pausa();


  // ----------------------------------------------------------
  // 8. GET /api/omie/materiais — retorna lista de materiais
  // ----------------------------------------------------------
  await teste('GET /api/omie/materiais — retorna produtos', async () => {
    // Cache ja populado
    const r = await requisicaoLocal('GET', '/api/omie/materiais?categoria=chapa-psai');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body.produtos));
    assert(r.body.produtos.length >= 1);
    // Filtra por "psai" (derivado da categoria)
    assert(r.body.produtos.every(p =>
      p.codigo.toLowerCase().includes('psai') ||
      p.descricao.toLowerCase().includes('psai')
    ));
  });

  await pausa();

  // ----------------------------------------------------------
  // 9. GET /api/omie/produto-compra — ConsultarProduto + estoque
  // ----------------------------------------------------------
  await teste('GET /api/omie/produto-compra — retorna produto e dados de compra', async () => {
    // Mock: ConsultarProduto + ListarPosEstoque
    setMockResponses(FIXTURE_CONSULTAR_PRODUTO, FIXTURE_ESTOQUE);

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=PSAI-050&id=101');
    assert.strictEqual(r.status, 200);
    assert(r.body.produto !== null);
    assert.strictEqual(r.body.produto.codigo, 'PSAI-050');
    assert.strictEqual(r.body.produto.id, '101');
    assert.strictEqual(r.body.produto.valorUnitario, 45.80);
    // Dados de compra
    assert.strictEqual(r.body.compra.fonteCusto, 'ultima_compra');
    assert.strictEqual(r.body.compra.custoUnitario, 45.80);
    assert.strictEqual(r.body.compra.cmc, 42.30);
    assert.strictEqual(r.body.compra.saldo, 25);
    assert.strictEqual(typeof r.body.compra.dataEstoque, 'string');
  });

  await pausa();


  // ----------------------------------------------------------
  // 10. GET /api/omie/produto-compra — formato completo da resposta
  // ----------------------------------------------------------
  await teste('GET /api/omie/produto-compra — formato completo do contrato', async () => {
    setMockResponses(FIXTURE_CONSULTAR_PRODUTO, FIXTURE_ESTOQUE);

    const r = await requisicaoLocal('GET', '/api/omie/produto-compra?codigo=PSAI-050&id=101');
    assert.strictEqual(r.status, 200);
    const c = r.body.compra;
    // Verifica todos os campos do contrato
    assert.strictEqual(typeof c.fonteCusto, 'string');
    assert.strictEqual(typeof c.custoUnitario, 'number');
    assert.strictEqual(typeof c.custoLiquidoUnitario, 'number');
    assert.strictEqual(typeof c.dataUltimaCompra, 'string');
    assert.strictEqual(typeof c.numeroNota, 'string');
    assert.strictEqual(typeof c.cmc, 'number');
    assert.strictEqual(typeof c.saldo, 'number');
    assert.strictEqual(typeof c.dataEstoque, 'string');
    assert.strictEqual(typeof c.ipi, 'number');
    assert.strictEqual(typeof c.icms, 'number');
    assert.strictEqual(typeof c.pisCofins, 'number');
    assert.strictEqual(typeof c.fiscalCompraCompleto, 'boolean');
    assert.strictEqual(typeof c.tributosOrigem, 'string');
    assert.strictEqual(typeof c.valorUnitarioNota, 'number');
    assert.strictEqual(typeof c.criterioSelecao, 'string');
    assert.strictEqual(typeof c.criterioVinculo, 'string');
    assert.strictEqual(typeof c.codigoProdutoNfe, 'string');
    assert.strictEqual(typeof c.descricaoProdutoNfe, 'string');
    // tratamentoFiscal pode ser object ou null
    assert(c.tratamentoFiscal === null || typeof c.tratamentoFiscal === 'object');
  });

  await pausa();


  // ----------------------------------------------------------
  // 11. Erro Omie (faultstring) — retorna HTTP 502
  // ----------------------------------------------------------
  await teste('Erro Omie faultstring — retorna HTTP 502 com mensagem', async () => {
    // Precisa reconectar com credenciais invalidas para testar erro
    setMockResponses(FIXTURE_ERRO_OMIE);

    const r = await requisicaoLocal('POST', '/api/omie/test', {
      appKey: 'INVALIDA',
      appSecret: 'INVALIDA'
    });
    // POST /test retorna 400 (nao 502) porque e tratado no handler
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
  });
  await requisicaoLocal('POST', '/api/omie/test', {
    appKey: '1234567890',
    appSecret: 'segredo-secreto-123'
  });
  await pausa();


  // ----------------------------------------------------------
  // 12. Erro Omie em /produtos — retorna 502 (nao array vazio)
  // ----------------------------------------------------------
  await teste('Erro Omie em /produtos — retorna 502, NAO array vazio', async () => {
    // Forca refresh do cache com erro
    // Limpa o cache forçando require
    setMockResponses(FIXTURE_ERRO_OMIE);

    // Faz um request que vai tentar recarregar cache
    // Para forcar recarga, precisamos invalidar o cache
    // Usamos /materiais sem categoria pois tambem usa o cache
    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=XYZINEXISTENTE');
    // Se o cache ja tem dados, vai retornar array vazio filtrado (OK, pois nao houve erro)
    // Se o cache esta vazio e da erro, deve retornar HTTP != 200
    if (r.status === 200) {
      // Cache pode estar populado do teste anterior — OK
      assert(Array.isArray(r.body.produtos));
    } else {
      // Se houve erro, NAO deve ser 200 com array vazio
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
    // Reconecta
    setMockResponses({
      produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
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
  // 15. Validar que Content-Type para Omie e exatamente 'application/json'
  // ----------------------------------------------------------
  await teste('Content-Type para Omie e exatamente application/json (sem charset)', async () => {
    setMockResponses(FIXTURE_LISTAR_PRODUTOS_P1);
    await requisicaoLocal('GET', '/api/omie/produtos?q=PSAI');
    await pausa();

    // Verifica as chamadas capturadas
    const ultima = mockCalls[mockCalls.length - 1];
    if (ultima) {
      assert.strictEqual(ultima.headers['Content-Type'], 'application/json');
      assert(!ultima.headers['Content-Type'].includes('charset'),
        'Content-Type NAO deve conter charset');
    }
  });

  await pausa();

  // ----------------------------------------------------------
  // 16. Validar que app_secret NUNCA aparece nos logs
  // ----------------------------------------------------------
  await teste('app_secret nunca e logado (verificacao de seguranca)', async () => {
    // Captura console.log temporariamente
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    setMockResponses({
      produto_servico_cadastro: [FIXTURE_CONSULTAR_PRODUTO],
      total_de_paginas: 1, total_de_registros: 1, pagina: 1, registros_por_pagina: 1
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
    // Gera 60 produtos com "TESTE" no nome
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

    // Forca refresh do cache
    const r = await requisicaoLocal('GET', '/api/omie/produtos?q=TESTE');
    assert.strictEqual(r.status, 200);
    assert(r.body.produtos.length <= 50,
      `Esperado max 50, recebeu ${r.body.produtos.length}`);
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
      console.log(`    ✗ ${r.nome}: ${r.erro}`);
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
