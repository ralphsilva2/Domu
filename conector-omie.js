// ============================================================
// DOMU — Conector Omie
// Serve o HTML + faz proxy das chamadas para a API Omie
// O usuario acessa: http://localhost:3000
// ============================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const urlMod = require('url');

const PORTA = 3000;
let appKey = '';
let appSecret = '';
let conectado = false;

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
      hostname: 'app.omie.com.br',
      port: 443,
      path: '/api/v1/' + endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    console.log('  [OMIE] ' + call + ' => ' + opts.path);
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.faultstring) {
            console.log('  [OMIE] FAULT: ' + json.faultstring);
            return reject(new Error(json.faultstring));
          }
          resolve(json);
        } catch (e) {
          reject(new Error('Resposta invalida do Omie'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Timeout Omie (25s)')); });
    req.write(payload);
    req.end();
  });
}

// ============================================================
// LER BODY DO REQUEST
// ============================================================
function lerBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => resolve(b));
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
    '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  try {
    const conteudo = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(conteudo);
  } catch (e) {
    res.writeHead(404);
    res.end('Arquivo nao encontrado');
  }
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

  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  // ==================== API ROUTES ====================

  if (caminho === '/api/omie/status') {
    return json(200, {
      connected: conectado,
      configured: Boolean(appKey && appSecret),
      appKeyMasked: appKey ? appKey.slice(0, 4) + '****' + appKey.slice(-2) : ''
    });
  }

  if (caminho === '/api/omie/test' && req.method === 'POST') {
    try {
      const body = JSON.parse(await lerBody(req) || '{}');
      if (body.appKey) appKey = String(body.appKey).trim();
      if (body.appSecret) appSecret = String(body.appSecret).trim();
      if (!appKey || !appSecret) return json(400, { error: 'Informe App Key e App Secret.' });

      console.log('\n[TEST] Testando credenciais...');
      const r = await chamarOmie('geral/produtos/', 'ListarProdutos', {
        pagina: 1,
        registros_por_pagina: 1,
        apenas_importado_api: 'N'
      });
      conectado = true;
      const p = (r.produto_servico_cadastro || [])[0] || {};
      console.log('[TEST] OK! Produto: ' + (p.codigo_produto || '(vazio)'));
      return json(200, {
        connected: true,
        produtoTesteCodigo: p.codigo_produto || '',
        produtoTesteId: String(p.codigo_produto_integracao || p.codigo_produto || ''),
        custoTeste: p.valor_unitario || 0,
        appKeyMasked: appKey.slice(0, 4) + '****' + appKey.slice(-2)
      });
    } catch (e) {
      conectado = false;
      return json(400, { error: e.message });
    }
  }

  if (caminho === '/api/omie/produtos') {
    if (!conectado) return json(400, { error: 'Conecte primeiro.' });
    const q = (parsed.query.q || '').trim().toLowerCase();
    if (q.length < 2) return json(400, { error: 'Minimo 2 caracteres.' });

    console.log('\n[BUSCA] "' + q + '"');
    try {
      // Pagina 1 com muitos registros, filtro local
      const todos = [];
      let pagina = 1;
      let totalPaginas = 1;
      do {
        const r = await chamarOmie('geral/produtos/', 'ListarProdutos', {
          pagina,
          registros_por_pagina: 200,
          apenas_importado_api: 'N'
        });
        const lista = r.produto_servico_cadastro || [];
        todos.push(...lista);
        totalPaginas = r.total_de_paginas || 1;
        pagina++;
      } while (pagina <= totalPaginas && pagina <= 5); // max 5 paginas = 1000 produtos

      // Filtro local por codigo ou descricao
      const filtrados = todos.filter(p => {
        const cod = String(p.codigo_produto || '').toLowerCase();
        const desc = String(p.descricao || '').toLowerCase();
        return cod.includes(q) || desc.includes(q);
      });

      console.log('[BUSCA] ' + todos.length + ' carregados, ' + filtrados.length + ' filtrados');
      return json(200, { produtos: filtrados.slice(0, 30).map(mapProduto) });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  if (caminho === '/api/omie/materiais') {
    if (!conectado) return json(400, { error: 'Conecte primeiro.' });
    console.log('\n[MATERIAIS] Carregando...');
    try {
      const todos = [];
      let pagina = 1;
      let totalPaginas = 1;
      do {
        const r = await chamarOmie('geral/produtos/', 'ListarProdutos', {
          pagina,
          registros_por_pagina: 200,
          apenas_importado_api: 'N'
        });
        todos.push(...(r.produto_servico_cadastro || []));
        totalPaginas = r.total_de_paginas || 1;
        pagina++;
      } while (pagina <= totalPaginas && pagina <= 5);

      console.log('[MATERIAIS] ' + todos.length + ' produtos');
      return json(200, { produtos: todos.map(mapProduto) });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  if (caminho === '/api/omie/produto-compra') {
    if (!conectado) return json(400, { error: 'Conecte primeiro.' });
    const id = (parsed.query.id || '').trim();
    const codigo = (parsed.query.codigo || '').trim();
    console.log('\n[COMPRA] id=' + id + ' codigo=' + codigo);

    let produto = null;
    if (codigo) {
      try {
        const r = await chamarOmie('geral/produtos/', 'ConsultarProduto', { codigo_produto: codigo });
        if (r && r.codigo_produto) produto = mapProduto(r);
      } catch (e) { console.log('  Nao achou por codigo'); }
    }
    if (!produto && id) {
      try {
        const r = await chamarOmie('geral/produtos/', 'ConsultarProduto', { codigo_produto_integracao: id });
        if (r && r.codigo_produto) produto = mapProduto(r);
      } catch (e) { console.log('  Nao achou por id'); }
    }

    // Buscar ultima compra via estoque
    let compraInfo = {
      fonteCusto: 'nao_encontrado',
      custoUnitario: 0,
      custoLiquidoUnitario: 0,
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
    };

    if (produto) {
      // Tenta pegar posicao de estoque
      try {
        const est = await chamarOmie('estoque/consulta/', 'PosicaoEstoque', {
          codigo_local_estoque: 0,
          id_prod: Number(produto.id) || 0
        });
        if (est && est.saldo !== undefined) {
          compraInfo.saldo = est.saldo || 0;
          compraInfo.cmc = est.cmc || est.cmv || 0;
        }
      } catch (e) { /* sem estoque */ }

      // Usa valor_unitario como custo quando nao ha NF-e
      compraInfo.fonteCusto = 'ultima_compra';
      compraInfo.custoUnitario = produto.valorUnitario;
      compraInfo.custoLiquidoUnitario = produto.valorUnitario;
      compraInfo.criterioSelecao = 'valor_unitario_cadastro';
      console.log('[COMPRA] Produto: ' + produto.codigo + ' custo=' + produto.valorUnitario);
    }

    return json(200, { produto, compra: compraInfo });
  }

  // ==================== STATIC FILES ====================

  // Rota raiz → serve o HTML principal
  if (caminho === '/' || caminho === '/index.html') {
    return servirArquivo(res, path.join(__dirname, 'domu_dashboard_completo_74.html'));
  }

  // Qualquer outro arquivo estático na pasta
  const arquivo = path.join(__dirname, caminho);
  if (fs.existsSync(arquivo) && fs.statSync(arquivo).isFile()) {
    return servirArquivo(res, arquivo);
  }

  json(404, { error: 'Nao encontrado: ' + caminho });
}

// ============================================================
// INICIAR SERVIDOR
// ============================================================
http.createServer(handler).listen(PORTA, () => {
  console.log('');
  console.log('  =============================================');
  console.log('  DOMU - Conector Omie');
  console.log('  =============================================');
  console.log('');
  console.log('  Acesse no navegador:');
  console.log('  http://localhost:' + PORTA);
  console.log('');
  console.log('  NAO feche esta janela enquanto usa o DOMU.');
  console.log('');
});
