// ============================================================
// DOMU — Conector Local Omie (v3)
// Servidor Node.js que faz a ponte entre o HTML e a API Omie
// Rode com: node conector-omie.js
// ============================================================

const http = require('http');
const https = require('https');
const url = require('url');

const PORTA = 3000;
let appKey = '';
let appSecret = '';
let conectado = false;

function chamarOmie(endpoint, call, param) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      call: call,
      app_key: appKey,
      app_secret: appSecret,
      param: Array.isArray(param) ? param : [param]
    });

    const opcoes = {
      hostname: 'app.omie.com.br',
      port: 443,
      path: '/api/v1/' + endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    console.log('[OMIE] ' + call + ' -> /api/v1/' + endpoint);
    console.log('[OMIE] Body: ' + body.substring(0, 300));

    const req = https.request(opcoes, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('[OMIE] Status: ' + res.statusCode + ' | Resposta: ' + data.substring(0, 500));
        try {
          const json = JSON.parse(data);
          if (json.faultstring) {
            console.log('[OMIE] FAULT: ' + json.faultstring);
            reject(new Error(json.faultstring));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error('Resposta invalida do Omie: ' + data.substring(0, 100)));
        }
      });
    });

    req.on('error', (e) => {
      console.log('[OMIE] ERRO de rede: ' + e.message);
      reject(e);
    });
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('Timeout: o Omie demorou mais de 20s para responder.'));
    });
    req.write(body);
    req.end();
  });
}

function lerBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

function extrairProdutos(resultado) {
  // A API Omie pode retornar em diferentes formatos dependendo da versão
  return resultado.produto_servico_cadastro
    || resultado.produto_servico_list
    || resultado.produtos
    || resultado.cadastros
    || [];
}

function mapearProduto(p) {
  return {
    id: String(p.codigo_produto_integracao || p.codigo_produto || p.codigo || ''),
    codigo: p.codigo_produto || p.codigo || '',
    descricao: p.descricao || p.descricao_familia || '',
    unidade: p.unidade || '',
    ncm: p.ncm || '',
    valorUnitario: p.valor_unitario || p.preco_unitario || 0
  };
}

async function tratarRequisicao(req, res) {
  const parsed = url.parse(req.url, true);
  const caminho = parsed.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const responderJson = (statusCode, obj) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  try {
    // ============ STATUS ============
    if (caminho === '/api/omie/status') {
      return responderJson(200, {
        connected: conectado,
        configured: Boolean(appKey && appSecret),
        appKeyMasked: appKey ? appKey.slice(0, 4) + '****' + appKey.slice(-2) : ''
      });
    }

    // ============ TESTAR CONEXÃO ============
    if (caminho === '/api/omie/test' && req.method === 'POST') {
      const body = await lerBody(req);
      const dados = JSON.parse(body || '{}');
      if (dados.appKey) appKey = String(dados.appKey).trim();
      if (dados.appSecret) appSecret = String(dados.appSecret).trim();

      if (!appKey || !appSecret) {
        return responderJson(400, { error: 'Informe App Key e App Secret.' });
      }

      console.log('\n[TEST] Testando conexao...');

      // Tenta ListarProdutos com parametros minimos
      const resultado = await chamarOmie('geral/produtos/', 'ListarProdutos', {
        pagina: 1,
        registros_por_pagina: 1,
        apenas_importado_api: 'N'
      });

      const produtos = extrairProdutos(resultado);
      conectado = true;
      const produto = produtos[0] || {};

      console.log('[TEST] OK! Total paginas: ' + (resultado.total_de_paginas || '?'));
      console.log('[TEST] Primeiro produto: ' + JSON.stringify(produto).substring(0, 200));

      return responderJson(200, {
        connected: true,
        produtoTesteCodigo: produto.codigo_produto || produto.codigo || '—',
        produtoTesteId: String(produto.codigo_produto_integracao || produto.codigo_produto || ''),
        custoTeste: produto.valor_unitario || 0,
        appKeyMasked: appKey.slice(0, 4) + '****' + appKey.slice(-2)
      });
    }

    // ============ BUSCAR PRODUTOS ============
    if (caminho === '/api/omie/produtos') {
      if (!conectado) return responderJson(400, { error: 'Teste a conexao primeiro em Configuracoes.' });
      const q = (parsed.query.q || '').trim();
      if (q.length < 2) return responderJson(400, { error: 'Digite pelo menos 2 caracteres.' });

      console.log('\n[BUSCA] Pesquisando: "' + q + '"');

      const todosResultados = [];

      // Tentativa 1: ListarProdutos sem filtro e buscar localmente
      try {
        // Carrega mais produtos e filtra no servidor
        const r1 = await chamarOmie('geral/produtos/', 'ListarProdutos', {
          pagina: 1,
          registros_por_pagina: 500,
          apenas_importado_api: 'N'
        });
        const lista = extrairProdutos(r1);
        console.log('[BUSCA] ListarProdutos retornou ' + lista.length + ' produtos');

        // Filtra localmente por código ou descrição
        const termoLower = q.toLowerCase();
        const filtrados = lista.filter(p => {
          const codigo = String(p.codigo_produto || p.codigo || '').toLowerCase();
          const descricao = String(p.descricao || '').toLowerCase();
          return codigo.includes(termoLower) || descricao.includes(termoLower);
        });
        console.log('[BUSCA] ' + filtrados.length + ' produtos apos filtro local');
        todosResultados.push(...filtrados);
      } catch (e) {
        console.log('[BUSCA] Erro ListarProdutos: ' + e.message);
      }

      // Tentativa 2: ConsultarProduto direto por código (caso seja código exato)
      if (todosResultados.length === 0) {
        try {
          const r2 = await chamarOmie('geral/produtos/', 'ConsultarProduto', {
            codigo_produto: q
          });
          if (r2 && r2.codigo_produto) {
            todosResultados.push(r2);
            console.log('[BUSCA] ConsultarProduto encontrou: ' + r2.codigo_produto);
          }
        } catch (e) {
          console.log('[BUSCA] ConsultarProduto por codigo nao encontrou');
        }
      }

      // Remove duplicatas
      const unicos = new Map();
      todosResultados.forEach(p => {
        const chave = String(p.codigo_produto_integracao || p.codigo_produto || p.codigo || Math.random());
        if (!unicos.has(chave)) {
          unicos.set(chave, mapearProduto(p));
        }
      });

      const resultado = Array.from(unicos.values()).slice(0, 30);
      console.log('[BUSCA] Retornando ' + resultado.length + ' produtos\n');
      return responderJson(200, { produtos: resultado });
    }

    // ============ MATERIAIS POR CATEGORIA ============
    if (caminho === '/api/omie/materiais') {
      if (!conectado) return responderJson(400, { error: 'Teste a conexao primeiro.' });

      console.log('\n[MATERIAIS] Carregando lista...');

      const resultado = await chamarOmie('geral/produtos/', 'ListarProdutos', {
        pagina: 1,
        registros_por_pagina: 500,
        apenas_importado_api: 'N'
      });

      const lista = extrairProdutos(resultado);
      const produtos = lista.map(mapearProduto);

      console.log('[MATERIAIS] ' + produtos.length + ' produtos carregados\n');
      return responderJson(200, { produtos });
    }

    // ============ DADOS DE COMPRA DO PRODUTO ============
    if (caminho === '/api/omie/produto-compra') {
      if (!conectado) return responderJson(400, { error: 'Teste a conexao primeiro.' });
      const id = (parsed.query.id || '').trim();
      const codigo = (parsed.query.codigo || '').trim();

      console.log('\n[COMPRA] Buscando id="' + id + '" codigo="' + codigo + '"');

      let produto = null;

      if (codigo) {
        try {
          const r = await chamarOmie('geral/produtos/', 'ConsultarProduto', {
            codigo_produto: codigo
          });
          if (r && r.codigo_produto) {
            produto = mapearProduto(r);
            console.log('[COMPRA] Encontrado por codigo: ' + produto.descricao);
          }
        } catch (e) {
          console.log('[COMPRA] Nao encontrou por codigo: ' + e.message);
        }
      }

      if (!produto && id) {
        try {
          const r = await chamarOmie('geral/produtos/', 'ConsultarProduto', {
            codigo_produto_integracao: id
          });
          if (r && r.codigo_produto) {
            produto = mapearProduto(r);
            console.log('[COMPRA] Encontrado por id: ' + produto.descricao);
          }
        } catch (e) {
          console.log('[COMPRA] Nao encontrou por id: ' + e.message);
        }
      }

      return responderJson(200, {
        produto: produto,
        compra: {
          fonteCusto: produto ? 'ultima_compra' : 'nao_encontrado',
          custoUnitario: produto ? produto.valorUnitario : 0,
          custoLiquidoUnitario: produto ? produto.valorUnitario : 0,
          dataUltimaCompra: '',
          numeroNota: '',
          cmc: 0,
          saldo: 0,
          ipi: 0,
          icms: 0,
          pisCofins: 0,
          fiscalCompraCompleto: false,
          criterioSelecao: produto ? 'valor_unitario_cadastro' : '',
          criterioVinculo: ''
        }
      });
    }

    responderJson(404, { error: 'Rota nao encontrada: ' + caminho });

  } catch (erro) {
    console.error('[ERRO] ' + erro.message);
    responderJson(500, { error: erro.message || 'Erro interno do conector.' });
  }
}

const servidor = http.createServer(tratarRequisicao);
servidor.listen(PORTA, () => {
  console.log('');
  console.log('  =============================================');
  console.log('    DOMU - Conector Omie v3');
  console.log('    Porta: ' + PORTA);
  console.log('    URL: http://localhost:' + PORTA);
  console.log('  =============================================');
  console.log('');
  console.log('  Mantenha esta janela aberta enquanto usa o DOMU.');
  console.log('  Logs aparecerao aqui abaixo.');
  console.log('');
});
