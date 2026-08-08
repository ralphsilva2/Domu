// ============================================================
// DOMU — Conector Local Omie (v2)
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

    console.log('[OMIE] ' + call + ' -> ' + endpoint);

    const req = https.request(opcoes, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.faultstring) {
            console.log('[OMIE] ERRO: ' + json.faultstring);
            reject(new Error(json.faultstring));
          } else {
            console.log('[OMIE] OK (' + data.length + ' bytes)');
            resolve(json);
          }
        } catch (e) {
          console.log('[OMIE] Resposta invalida: ' + data.substring(0, 200));
          reject(new Error('Resposta invalida do Omie'));
        }
      });
    });

    req.on('error', (e) => {
      console.log('[OMIE] ERRO de rede: ' + e.message);
      reject(e);
    });
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('Timeout: o Omie demorou mais de 20 segundos para responder.'));
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

      console.log('[TEST] Testando com App Key: ' + appKey.slice(0, 4) + '****');

      const resultado = await chamarOmie('geral/produtos/', 'ListarProdutos', {
        pagina: 1,
        registros_por_pagina: 1,
        apenas_importado_api: 'N'
      });

      conectado = true;
      const produto = (resultado.produto_servico_cadastro || [])[0] || {};

      console.log('[TEST] Conexao OK! Produto teste: ' + (produto.codigo_produto || 'nenhum'));

      return responderJson(200, {
        connected: true,
        produtoTesteCodigo: produto.codigo_produto || '—',
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

      console.log('[BUSCA] Pesquisando: "' + q + '"');

      // Busca por descrição
      let produtosDesc = [];
      try {
        const r1 = await chamarOmie('geral/produtos/', 'ListarProdutos', {
          pagina: 1,
          registros_por_pagina: 20,
          apenas_importado_api: 'N',
          filtrar_por_descricao: q
        });
        produtosDesc = r1.produto_servico_cadastro || [];
      } catch (e) {
        console.log('[BUSCA] Erro busca por descricao: ' + e.message);
      }

      // Busca por código
      let produtosCod = [];
      try {
        const r2 = await chamarOmie('geral/produtos/', 'ListarProdutos', {
          pagina: 1,
          registros_por_pagina: 10,
          apenas_importado_api: 'N',
          filtrar_por_codigo: q
        });
        produtosCod = r2.produto_servico_cadastro || [];
      } catch (e) {
        console.log('[BUSCA] Erro busca por codigo: ' + e.message);
      }

      // Consolida sem duplicatas
      const todos = [...produtosDesc, ...produtosCod];
      const unicos = new Map();
      todos.forEach(p => {
        const chave = String(p.codigo_produto_integracao || p.codigo_produto || '');
        if (chave && !unicos.has(chave)) {
          unicos.set(chave, {
            id: chave,
            codigo: p.codigo_produto || '',
            descricao: p.descricao || p.descricao_familia || '',
            unidade: p.unidade || '',
            ncm: p.ncm || '',
            valorUnitario: p.valor_unitario || 0
          });
        }
      });

      const resultado = Array.from(unicos.values());
      console.log('[BUSCA] ' + resultado.length + ' produtos encontrados');
      return responderJson(200, { produtos: resultado });
    }

    // ============ MATERIAIS POR CATEGORIA ============
    if (caminho === '/api/omie/materiais') {
      if (!conectado) return responderJson(400, { error: 'Teste a conexao primeiro.' });

      console.log('[MATERIAIS] Carregando lista completa...');

      const resultado = await chamarOmie('geral/produtos/', 'ListarProdutos', {
        pagina: 1,
        registros_por_pagina: 50,
        apenas_importado_api: 'N'
      });

      const produtos = (resultado.produto_servico_cadastro || []).map(p => ({
        id: String(p.codigo_produto_integracao || p.codigo_produto || ''),
        codigo: p.codigo_produto || '',
        descricao: p.descricao || '',
        unidade: p.unidade || '',
        ncm: p.ncm || '',
        valorUnitario: p.valor_unitario || 0
      }));

      console.log('[MATERIAIS] ' + produtos.length + ' produtos carregados');
      return responderJson(200, { produtos });
    }

    // ============ DADOS DE COMPRA DO PRODUTO ============
    if (caminho === '/api/omie/produto-compra') {
      if (!conectado) return responderJson(400, { error: 'Teste a conexao primeiro.' });
      const id = (parsed.query.id || '').trim();
      const codigo = (parsed.query.codigo || '').trim();

      console.log('[COMPRA] Buscando produto id=' + id + ' codigo=' + codigo);

      let produto = null;

      // Tenta consultar por código
      if (codigo) {
        try {
          const r = await chamarOmie('geral/produtos/', 'ConsultarProduto', {
            codigo_produto: codigo
          });
          if (r && r.codigo_produto) {
            produto = {
              id: String(r.codigo_produto_integracao || r.codigo_produto || ''),
              codigo: r.codigo_produto || codigo,
              descricao: r.descricao || '',
              unidade: r.unidade || '',
              ncm: r.ncm || '',
              valorUnitario: r.valor_unitario || 0
            };
          }
        } catch (e) {
          console.log('[COMPRA] Erro ConsultarProduto por codigo: ' + e.message);
        }
      }

      // Se não achou por código, tenta por ID interno
      if (!produto && id) {
        try {
          const r = await chamarOmie('geral/produtos/', 'ConsultarProduto', {
            codigo_produto_integracao: id
          });
          if (r && r.codigo_produto) {
            produto = {
              id: String(r.codigo_produto_integracao || r.codigo_produto || ''),
              codigo: r.codigo_produto || '',
              descricao: r.descricao || '',
              unidade: r.unidade || '',
              ncm: r.ncm || '',
              valorUnitario: r.valor_unitario || 0
            };
          }
        } catch (e) {
          console.log('[COMPRA] Erro ConsultarProduto por id: ' + e.message);
        }
      }

      if (produto) {
        console.log('[COMPRA] Produto encontrado: ' + produto.codigo + ' - ' + produto.descricao);
      } else {
        console.log('[COMPRA] Produto nao encontrado');
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

    // ============ ROTA NÃO ENCONTRADA ============
    console.log('[404] Rota nao encontrada: ' + caminho);
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
  console.log('    DOMU - Conector Omie v2');
  console.log('    Porta: ' + PORTA);
  console.log('    URL: http://localhost:' + PORTA);
  console.log('  =============================================');
  console.log('');
  console.log('  Mantenha esta janela aberta enquanto usa o DOMU.');
  console.log('  Logs de comunicacao aparecerao aqui.');
  console.log('  Para fechar, pressione Ctrl+C');
  console.log('');
});
