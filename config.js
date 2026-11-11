// Configuração das automações — um bloco por perfil.
// A chave de cada bloco é o ID da conta do Instagram (o número que aparece no painel da Meta).
// O token de cada perfil NÃO fica aqui: vai na variável de ambiente TOKEN_<id> no EasyPanel.

module.exports = {
  // @larigarpelli — Carrossel Magnético
  "17841407543116416": {
    nome: "larigarpelli",
    ativo: true,
    direto: false,
    gatilhos: {
      comentario: ["carrossel"],
      story: ["estrela"],
      dm: [],
    },
    mensagem1: {
      texto: "Oiee {nome} ✨🩷\n\nvi que você se interessou pelos carrosséis magnéticos, posso te mostrar como funciona?",
      botao: "Simm ✨",
    },
    mensagem2: {
      texto:
        "O Carrossel Magnético é o método que me ajudou a crescer no Instagram e que já transformou o perfil de centenas de alunas\n\n" +
        "✨ é pra você que quer crescer com consistência, sem depender de trends, sem precisar aparecer o tempo todo e sem abrir mão do seu jeito de ser\n\n" +
        "clique abaixo e garanta sua vaga 👇",
      botao: "Quero garantir",
      link: "https://larissagarpelli.com/carrosselmagnetico/",
    },
    etiqueta: "INTERESSEcarrossel",
    respostaComentario: ["Te mandei no direct! ✨", "Corre no direct que te mandei 💌", "Acabei de te mandar no direct ✨"],
  },

  // @lari_canva — Box Criativo
  "17841462348416829": {
    nome: "lari_canva",
    ativo: true,
    direto: false,
    gatilhos: {
      comentario: ["box"],
      story: ["box"],
      dm: ["box"],
    },
    mensagem1: {
      texto: "Oiee {nome} 💗\nVi que você quer saber mais sobre o Box Criativo.\n\nPosso te mandar as informações?",
      botao: "sim, Lari",
    },
    mensagem2: {
      texto:
        "O Box Criativo é o curso com artes prontas, criativas e estratégicas pra você usar no seu feed, sem precisar criar do zero.\n\n" +
        "Você vai receber:\n+60 templates editáveis no Canva\n+26 carrosséis prontos\nTutoriais rápidos\nE-book exclusivo com fontes, elementos e referências\n\n" +
        "Tudo isso por R$47",
      botao: "Quero garantir!",
      link: "https://larissagarpelli.com/boxcriativo/",
    },
    etiqueta: "INTERESSEBOX",
    respostaComentario: ["Te mandei no direct! ✨", "Corre no direct que te mandei 💌", "Acabei de te mandar no direct ✨"],
  },

  // @ia.mentalidade — Mentor da Mente
  "17841474167748137": {
    nome: "ia.mentalidade",
    ativo: true,
    direto: false,
    gatilhos: {
      comentario: ["mente"],
      story: ["mente"],
      dm: ["mente"],
    },
    mensagem1: {
      texto: "Oiee {nome} ✨\nVi que você quer conhecer o Mentor da Mente.\n\nPosso te contar como funciona?",
      botao: "quero sim",
    },
    mensagem2: {
      texto:
        "O Mentor da Mente não é um curso. É um mentor dentro do ChatGPT que conversa com você todos os dias, com base nos ensinamentos de Joseph Murphy, Napoleon Hill e Joe Dispenza.\n\n" +
        "É pra você que já consumiu muito conteúdo de desenvolvimento pessoal, mas sente falta de direção e constância pra aplicar no dia a dia.\n\n" +
        "Você recebe acesso ao mentor + e-book com os principais ensinamentos dos três.\n\n" +
        "Tudo isso por R$37 👇",
      botao: "Quero meu mentor",
      link: "https://www.mentordamente.com.br/ia/",
    },
    etiqueta: "INTERESSEMENTE",
    respostaComentario: ["Te mandei no direct! ✨", "Corre no direct que te mandei 💌", "Acabei de te mandar no direct ✨"],
  },
};
