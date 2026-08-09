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
    id: String(p.codigo_produto_integracao || p.codigo_produto || ''),
    codigo: String(p.codigo_produto || ''),
    descricao: String(p.descricao || ''),
    unidade: String(p.unidade || ''),
    ncm: String(p.ncm || ''),
    valorUnitario: Number(p.valor_unitario || 0)
  };
}

// ============================================================
// PAGINAÇÃO COMPLETA — Carrega TODOS os produtos do Omie
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
      apenas_importado_api: 'N'
    });

    const lista = r.produto_servico_cadastro || [];
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
    // Espera o carregamento em andamento
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
        apenas_importado_api: 'N'
      });

      conectado = true;
      // Limpa cache ao reconectar com novas credenciais
      cacheProdutos = [];
      cacheTimestamp = 0;

      const p = (r.produto_servico_cadastro || [])[0] || {};
      const resultado = {
        connected: true,
        produtoTesteCodigo: p.codigo_produto || '',
        produtoTesteId: String(p.codigo_produto_integracao || p.codigo_produto || ''),
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
    const q = (parsed.query.q || '').trim().toLowerCase();
    log('DOMU', `GET /api/omie/produtos?q=${parsed.query.q || ''}`);

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

      // Filtro local case insensitive em codigo E descricao
      const filtrados = todos.filter(p => {
        const cod = String(p.codigo_produto || '').toLowerCase();
        const desc = String(p.descricao || '').toLowerCase();
        return cod.includes(q) || desc.includes(q);
      });

      log('DOMU FILTER', `termo="${parsed.query.q || ''}" => ${filtrados.length} resultados`);
      const resultado = { produtos: filtrados.slice(0, MAX_RESULTADOS_BUSCA).map(mapProduto) };
      log('DOMU', '200 OK');
      return jsonResponse(res, 200, resultado);
    } catch (e) {
      return erroOmie(res, e);
    }
  }

  // GET /api/omie/materiais?categoria=chapa-psai
  if (caminho === '/api/omie/materiais' && req.method === 'GET') {
    const categoria = (parsed.query.categoria || '').trim().toLowerCase();
    log('DOMU', `GET /api/omie/materiais?categoria=${parsed.query.categoria || ''}`);

    if (!conectado) {
      log('DOMU', '400 Nao conectado');
      return jsonResponse(res, 400, { error: 'Conecte-se ao Omie primeiro.' });
    }

    try {
      const todos = await obterProdutosCache();

      // Filtro por categoria (futuro — por enquanto retorna todos)
      let filtrados = todos;
      if (categoria) {
        // Implementacao futura de filtro por categoria
        // Por enquanto, pode-se usar como filtro simples no codigo/descricao
        const termoCategoria = categoria.replace(/-/g, ' ').replace(/chapa\s*/i, '');
        if (termoCategoria.length >= 2) {
          filtrados = todos.filter(p => {
            const cod = String(p.codigo_produto || '').toLowerCase();
            const desc = String(p.descricao || '').toLowerCase();
            return cod.includes(termoCategoria) || desc.includes(termoCategoria);
          });
        }
      }

      log('DOMU', `${filtrados.length} materiais retornados`);
      log('DOMU', '200 OK');
      return jsonResponse(res, 200, { produtos: filtrados.map(mapProduto) });
    } catch (e) {
      return erroOmie(res, e);
    }
  }

  // GET /api/omie/produto-compra?id=xxx&codigo=yyy
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
      let produtoOmie = null;

      // 1. Tenta ConsultarProduto por codigo
      if (codigo) {
        try {
          log('OMIE', `ConsultarProduto codigo_produto="${codigo}"`);
          const r = await chamarOmie('geral/produtos/', 'ConsultarProduto', { codigo_produto: codigo });
          if (r && r.codigo_produto) {
            produtoOmie = r;
            produto = mapProduto(r);
          }
        } catch (e) {
          log('DOMU', `ConsultarProduto por codigo falhou: ${e.message}`);
        }
      }

      // 2. Se nao achou, tenta por codigo_produto_integracao (id)
      if (!produto && id) {
        try {
          log('OMIE', `ConsultarProduto codigo_produto_integracao="${id}"`);
          const r = await chamarOmie('geral/produtos/', 'ConsultarProduto', { codigo_produto_integracao: id });
          if (r && r.codigo_produto) {
            produtoOmie = r;
            produto = mapProduto(r);
          }
        } catch (e) {
          log('DOMU', `ConsultarProduto por id falhou: ${e.message}`);
        }
      }

      // Estrutura de compra padrao
      let compra = {
        fonteCusto: 'nao_encontrado',
        custoUnitario: 0,
        custoLiquidoUnitario: 0,
        dataUltimaCompra: '',
        numeroNota: '',
        cmc: 0,
        saldo: 0,
        dataEstoque: '',
        ipi: 0,
        icms: 0,
        pisCofins: 0,
        fiscalCompraCompleto: false,
        tributosOrigem: '',
        valorUnitarioNota: 0,
        criterioSelecao: '',
        criterioVinculo: '',
        tratamentoFiscal: null,
        codigoProdutoNfe: '',
        descricaoProdutoNfe: ''
      };

      if (produto) {
        // 3. Tenta ListarPosEstoque para pegar CMC e saldo
        try {
          const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
          log('OMIE', `ListarPosEstoque para produto ${produto.codigo}`);
          const est = await chamarOmie('estoque/consulta/', 'ListarPosEstoque', {
            nPagina: 1,
            nRegPorPagina: 100,
            dDataPosicao: hoje,
            cExibeTodos: 'S'
          });

          const produtos = est.produtos || [];
          // Filtra pelo produto atual
          const codProd = Number(id) || Number(produto.id) || 0;
          const estoqueItem = produtos.find(e =>
            e.nCodProd === codProd ||
            String(e.cCodigo || '').toLowerCase() === String(produto.codigo || '').toLowerCase()
          );

          if (estoqueItem) {
            compra.cmc = estoqueItem.nCMC || 0;
            compra.saldo = estoqueItem.nSaldo || 0;
            compra.dataEstoque = hoje;
            log('DOMU', `Estoque encontrado: saldo=${compra.saldo} CMC=${compra.cmc}`);
          }
        } catch (e) {
          log('DOMU', `ListarPosEstoque falhou: ${e.message}`);
        }

        // 4. Usa valor_unitario como custoUnitario
        compra.fonteCusto = 'ultima_compra';
        compra.custoUnitario = produto.valorUnitario;
        compra.custoLiquidoUnitario = produto.valorUnitario;
        compra.criterioSelecao = 'valor_unitario_cadastro';
        compra.criterioVinculo = 'codigo_produto';
        compra.codigoProdutoNfe = produto.codigo;
        compra.descricaoProdutoNfe = produto.descricao;

        log('DOMU', `Produto: ${produto.codigo} custoUnitario=${produto.valorUnitario}`);
      }

      log('DOMU', '200 OK');
      return jsonResponse(res, 200, { produto, compra });
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
  module.exports = { server, handler, chamarOmie, mapProduto, obterProdutosCache, PORTA };
}
