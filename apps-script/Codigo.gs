/**
 * AXIS — recebe os cadastros da landing page e grava nesta planilha.
 *
 * COMO INSTALAR (uma vez só, tudo no navegador)
 * ---------------------------------------------
 * 1. Abra a planilha "AXIS — lista de espera (landing page)" no seu Drive.
 * 2. Menu Extensões → Apps Script.
 * 3. Apague o que estiver lá e cole este arquivo inteiro. Salve.
 * 4. Botão azul "Implantar" → "Nova implantação".
 *      Tipo: Aplicativo da Web
 *      Executar como: Eu
 *      Quem pode acessar: QUALQUER PESSOA      <-- precisa ser este
 * 5. Autorize quando o Google pedir (vai aparecer um aviso de "app não
 *    verificado" — é o seu próprio script; siga em "Avançado → Acessar").
 * 6. Copie a URL que termina em /exec e mande para o Claude, ou cole você
 *    mesma em docs/index.html, na constante URL_PLANILHA.
 *
 * POR QUE O ENVIO VEM COMO FORMULÁRIO, E NÃO COMO fetch()
 * -------------------------------------------------------
 * O Apps Script não devolve cabeçalho de CORS de forma confiável, então um
 * fetch() comum é bloqueado pelo navegador e um fetch com mode:'no-cors' volta
 * cego — impossível saber se gravou. Envio de formulário não passa por CORS,
 * e a página escuta o carregamento do iframe oculto para saber que terminou.
 * É técnica antiga, mas é a que não depende de nada fora do nosso controle.
 */

var ABA = 'leads';
var CABECALHO = ['data', 'email', 'perfil', 'origem', 'envios'];

/** Devolve a aba de leads, criando-a com cabeçalho se ainda não existir. */
function aba_() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(ABA);
  if (!aba) {
    aba = planilha.insertSheet(ABA);
  }
  if (aba.getLastRow() === 0) {
    aba.appendRow(CABECALHO);
    aba.getRange(1, 1, 1, CABECALHO.length).setFontWeight('bold');
    aba.setFrozenRows(1);
  }
  return aba;
}

function emailValido_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

/**
 * Procura o e-mail entre os já cadastrados.
 * Devolve o número da linha, ou 0 se for novo.
 *
 * A página reenvia o cadastro guardado quando a pessoa volta ao site, então
 * repetição é esperada — sem esta checagem, a planilha encheria de duplicatas.
 */
function linhaDoEmail_(aba, email) {
  var total = aba.getLastRow();
  if (total < 2) return 0;
  var coluna = aba.getRange(2, 2, total - 1, 1).getValues();
  for (var i = 0; i < coluna.length; i++) {
    if (String(coluna[i][0]).trim().toLowerCase() === email) return i + 2;
  }
  return 0;
}

function doPost(e) {
  var dados = (e && e.parameter) || {};
  var email = String(dados.email || '').trim().toLowerCase();

  if (!emailValido_(email)) {
    return resposta_('erro: e-mail invalido');
  }

  // O perfil vem do formulário, mas qualquer um pode mandar o que quiser para
  // esta URL. Texto livre aqui sujaria a segmentação da lista.
  var perfis = ['profissional', 'escritorio', 'publico', 'instituicao', 'outro'];
  var perfil = String(dados.perfil || 'outro').trim().toLowerCase();
  if (perfis.indexOf(perfil) === -1) perfil = 'outro';

  var origem = String(dados.origem || 'landing-page').trim().slice(0, 60);

  // Uma execução por vez: dois cadastros simultâneos poderiam ler o mesmo
  // "última linha" e um sobrescrever o outro.
  var trava = LockService.getScriptLock();
  try {
    trava.waitLock(20000);
  } catch (err) {
    return resposta_('erro: ocupado');
  }

  try {
    var aba = aba_();
    var linha = linhaDoEmail_(aba, email);

    if (linha) {
      var envios = Number(aba.getRange(linha, 5).getValue()) || 1;
      aba.getRange(linha, 3).setValue(perfil);      // perfil pode ter mudado
      aba.getRange(linha, 5).setValue(envios + 1);
      return resposta_('ok: repetido');
    }

    aba.appendRow([new Date(), email, perfil, origem, 1]);
    return resposta_('ok: novo');
  } finally {
    trava.releaseLock();
  }
}

/**
 * Abrir a URL no navegador não deve despejar dado de ninguém.
 * A planilha é o painel; esta URL só recebe.
 */
function doGet() {
  return resposta_('AXIS — endpoint de cadastro. Use POST.');
}

function resposta_(texto) {
  return ContentService.createTextOutput(texto)
    .setMimeType(ContentService.MimeType.TEXT);
}
