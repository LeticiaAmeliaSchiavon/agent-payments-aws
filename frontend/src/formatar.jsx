/**
 * Transforma **texto** em negrito. É tudo que o agente usa, e o React escapa o resto,
 * então nenhum conteúdo da conversa vira HTML.
 */
export function formatar(texto) {
  return texto
    .split(/(\*\*[^*\n]+\*\*)/g)
    .map((parte, i) =>
      /^\*\*[^*\n]+\*\*$/.test(parte) ? <strong key={i}>{parte.slice(2, -2)}</strong> : parte,
    );
}
