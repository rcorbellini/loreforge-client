// O CONTRATO DO CONTEXTO, DO LADO DA TELA (spec 067) — trava de regressão.
//
// POR QUE ESTE ARQUIVO EXISTE — e por que ele é o PRIMEIRO teste deste repositório.
//
// Em 2026-09-06 o Draven aparecia na tela com ZERO memórias e ZERO compromissos. O
// mundo tinha 38 memórias vivas e um compromisso ativo; `get_context` devolvia as duas
// coisas certas. Quem estava errado era esta tela:
//
//     renderMemories(context.memories);      // → undefined
//     renderIntentions(context.intentions);  // → undefined
//
// A spec 067 reorganizou o contexto em DOIS nós de raiz (`self` e `scene`) e moveu
// memória e compromisso para dentro de `self`. Onze acessos foram migrados; estes dois
// ficaram. E não estouraram: leram uma chave inexistente, receberam `undefined`, e a
// tela pintou uma lista vazia com toda a confiança do mundo.
//
// ESSA É A CLASSE DE ERRO QUE ESTE ARQUIVO EXISTE PARA PEGAR: em JavaScript, ler chave
// que não existe não é erro — é `undefined`. A deriva de contrato não faz barulho, e a
// única prova de que aconteceu é o jogador dizendo "tá estranho". Um teste de tela
// completo exigiria DOM e um servidor de pé; este aqui não precisa de nenhum dos dois,
// porque a pergunta que ele faz é estática: *esta tela lê alguma chave que o contrato
// não tem?*
//
// Rode com:  node --test
// (Node ≥ 20, sem dependência nenhuma — o mesmo runner que o conector já usa.)

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// A RAIZ do contrato, em `docs/contrato-do-contexto.md`: "Nada mais fica na raiz."
// Se o server passar a devolver um terceiro nó, é esta lista que se atualiza.
const RAIZ_DO_CONTRATO = ["scene", "self"];

// Os nós de segundo nível, para o teste 2. Copiados da saída real de `get_context`
// (`draven-vigia`, 2026-09-07), não inventados.
const CAMPOS = {
  self: ["attributes", "id", "intentions", "inventory", "is_busy", "is_deep_asleep",
         "is_resting", "known_elsewhere", "memories", "name", "needs", "physics",
         "prose", "skills", "status", "transit"],
  scene: ["characters", "exits", "items", "objects", "place"],
};

const APP = path.join(__dirname, "..", "app.js");
const fonte = () => fs.readFileSync(APP, "utf8").split("\n");

// Uma linha de comentário não é código. Sem isto, a própria prosa que explica o bug
// (que cita `context.memories`) faria o teste falhar.
const ehComentario = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

test("a tela não lê nenhuma chave fora da raiz do contrato", () => {
  const violacoes = [];
  fonte().forEach((linha, i) => {
    if (ehComentario(linha)) return;
    for (const m of linha.matchAll(/\bcontext\.([a-z_][a-z0-9_]*)/gi)) {
      if (!RAIZ_DO_CONTRATO.includes(m[1])) {
        violacoes.push(`app.js:${i + 1} lê context.${m[1]}`);
      }
    }
  });
  assert.deepStrictEqual(violacoes, [],
    "A raiz do contexto tem só `self` e `scene` (spec 067). Cada linha abaixo lê uma\n"
    + "chave que não existe e recebe `undefined` em SILÊNCIO — foi assim que a tela\n"
    + "mostrou zero memórias para um personagem que tinha 38:\n  "
    + violacoes.join("\n  "));
});

test("o que a tela lê de `self`/`scene` existe mesmo no contrato", () => {
  const violacoes = [];
  fonte().forEach((linha, i) => {
    if (ehComentario(linha)) return;
    for (const m of linha.matchAll(/\bcontext\.(self|scene)\.([a-z_][a-z0-9_]*)/gi)) {
      const [, no, campo] = m;
      if (!CAMPOS[no].includes(campo)) {
        violacoes.push(`app.js:${i + 1} lê context.${no}.${campo}`);
      }
    }
  });
  assert.deepStrictEqual(violacoes, [],
    "campo que `get_context` não devolve — mesma falha silenciosa, um nível abaixo:\n  "
    + violacoes.join("\n  "));
});

test("memória e compromisso são lidos de dentro de `self`", () => {
  // A trava explícita do defeito de 2026-09-06. Os testes acima já pegariam a
  // regressão, mas por uma regra genérica; esta asserção nomeia o caso, para que quem
  // a quebrar leia o que aconteceu em vez de deduzir.
  const texto = fonte().filter((l) => !ehComentario(l)).join("\n");
  assert.match(texto, /renderMemories\(\s*context\.self/,
    "renderMemories voltou a ler a raiz: a tela vai mostrar zero memórias");
  assert.match(texto, /renderIntentions\(\s*context\.self/,
    "renderIntentions voltou a ler a raiz: a tela vai mostrar zero compromissos");
});
