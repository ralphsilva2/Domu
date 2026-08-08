// ============================================================
// DOMU — Conector Local Omie
// Este servidor faz a ponte entre o HTML e a API do Omie
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
    const dados = JSON.stringify({
      call,
      app_key: appKey,
      app_secret: appSecret,
      param: [param]
    });
    const opcoes = {
      hostname: 'app.omie.com.br',
      path: '/api/v1/' + endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) }
    };
    const req = https.request(opcoes, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Resposta inválida do Omie')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout na comunicação com o Omie')); });
    req.write(dados);
    req.end();
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
    // STATUS
    if (caminho === '/api/omie/status') {
      return responderJson(200, {
        connected: conectado,
        configured: Boolean(appKey && appSecret),
        appKeyMasked: appKey ? appKey.slice(0, 4) + '****' : ''
      });
    }

    // TESTAR CONEXÃO
    if (caminho === '/api/omie/test' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const dados = JSON.parse(body || '{}');
      if (dados.appKey) appKey = dados.appKey;
      if (dados.appSecret) appSecret = dados.appSecret;
      if (!appKey || !appSecret) return responderJson(400, { error: 'Informe App Key e App Secret.' });

      const resultado = await chamarOmie('geral/produtos/', 'ListarProdutos', {
        pagina: 1, registros_por_pagina: 1, apenas_importado_api: 'N'
      });
      if (resultado.faultstring) {
        conectado = false;
        return responderJson(400, { error: resultado.faultstring });
      }
      conectado = true;
      const produto = resultado.produto_servico_cadastro?.[0] || {};
      return responderJson(200, {
        connected: true,
        produtoTesteCodigo: produto.codigo_produto || '',
        produtoTesteId: produto.codigo_produto_integracao || produto.codigo || '',
        custoTeste: produto.valor_unitario || 0,
        appKeyMasked: appKey.slice(0, 4) + '****'
      });
    }

    // BUSCAR PRODUTOS
    if (caminho === '/api/omie/produtos') {
      if (!conectado) return responderJson(400, { error: 'Teste a conexão primeiro.' });
      const q = parsed.query.q || '';
      if (q.length < 2) return responderJson(400, { error: 'Digite pelo menos 2 caracteres.' });

      const resultado = await chamarOmie('geral/produtos/', 'ListarProdutos', {
        pagina: 1, registros_por_pagina: 20, apenas_importado_api: 'N',
        filtrar_por_descricao: q
      });

      // Tenta também por código
      let produtosPorCodigo = [];
      try {
        const res2 = await chamarOmie('geral/produtos/', 'ListarProdutos', {
          pagina: 1, registros_por_pagina: 10, apenas_importado_api: 'N',
          filtrar_por_codigo: q
        });
        produtosPorCodigo = res2.produto_servico_cadastro || [];
      } catch (e) {}

      const todos = [...(resultado.produto_servico_cadastro || []), ...produtosPorCodigo];
      const unicos = new Map();
      todos.forEach(p => {
        if (!unicos.has(p.codigo_produto)) {
          unicos.set(p.codigo_produto, {
            id: p.codigo_produto_integracao || String(p.codigo_produto || ''),
            codigo: p.codigo_produto || '',
            descricao: p.descricao || '',
            unidade: p.unidade || '',
            ncm: p.ncm || '',
            valorUnitario: p.valor_unitario || 0
          });
        }
      });

      return responderJson(200, { produtos: Array.from(unicos.values()) });
    }

    // BUSCAR MATERIAIS POR CATEGORIA
    if (caminho === '/api/omie/materiais') {
      if (!conectado) return responderJson(400, { error: 'Teste a conexão primeiro.' });
      const resultado = await chamarOmie('geral/produtos/', 'ListarProdutos', {
        pagina: 1, registros_por_pagina: 50, apenas_importado_api: 'N'
      });
      const produtos = (resultado.produto_servico_cadastro || []).map(p => ({
        id: p.codigo_produto_integracao || String(p.codigo_produto || ''),
        codigo: p.codigo_produto || '',
        descricao: p.descricao || '',
        unidade: p.unidade || '',
        ncm: p.ncm || '',
        valorUnitario: p.valor_unitario || 0
      }));
      return responderJson(200, { produtos });
    }

    // BUSCAR DADOS DE COMPRA
    if (caminho === '/api/omie/produto-compra') {
      if (!conectado) return responderJson(400, { error: 'Teste a conexão primeiro.' });
      const id = parsed.query.id || '';
      const codigo = parsed.query.codigo || '';

      let produto = null;
      if (codigo) {
        try {
          const res = await chamarOmie('geral/produtos/', 'ConsultarProduto', { codigo_produto: codigo });
          produto = {
            id: res.codigo_produto_integracao || String(res.codigo_produto || ''),
            codigo: res.codigo_produto || codigo,
            descricao: res.descricao || '',
            unidade: res.unidade || '',
            ncm: res.ncm || '',
            valorUnitario: res.valor_unitario || 0
          };
        } catch (e) {}
      }

      // Simula dados de compra (a API completa de NF-e requer endpoints adicionais)
      return responderJson(200, {
        produto: produto,
        compra: {
          fonteCusto: produto ? 'ultima_compra' : 'nao_encontrado',
          custoUnitario: produto?.valorUnitario || 0,
          custoLiquidoUnitario: produto?.valorUnitario || 0,
          dataUltimaCompra: '',
          numeroNota: '',
          cmc: 0,
          saldo: 0,
          ipi: 0,
          icms: 0,
          pisCofins: 0,
          fiscalCompraCompleto: false,
          criterioSelecao: '',
          criterioVinculo: ''
        }
      });
    }

    responderJson(404, { error: 'Rota não encontrada: ' + caminho });

  } catch (erro) {
    console.error('Erro:', erro.message);
    responderJson(500, { error: erro.message || 'Erro interno do conector.' });
  }
}

const servidor = http.createServer(tratarRequisicao);
servidor.listen(PORTA, () => {
  console.log('');
  console.log('===========================================');
  console.log('  DOMU - Conector Omie ativo!');
  console.log('  Porta: ' + PORTA);
  console.log('  Acesse: http://localhost:' + PORTA);
  console.log('===========================================');
  console.log('');
  console.log('Mantenha esta janela aberta enquanto usa o DOMU.');
  console.log('Para fechar, pressione Ctrl+C');
  console.log('');
});
