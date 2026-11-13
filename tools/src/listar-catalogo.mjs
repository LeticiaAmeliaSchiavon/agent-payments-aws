import { PRODUTOS } from './catalogo.mjs';
import { logarErro, MENSAGEM_ERRO_INTERNO } from './erros.mjs';

export function listarCatalogo({ categoria } = {}) {
  // O modelo às vezes manda "" em vez de omitir o campo: tratamos como "sem filtro".
  const filtro = typeof categoria === 'string' ? categoria.trim().toLowerCase() : '';
  const lista = filtro ? PRODUTOS.filter((p) => p.categoria === filtro) : PRODUTOS;

  return {
    produtos: lista.map(({ id, nome, preco, moeda, estoque }) => ({ id, nome, preco, moeda, estoque })),
  };
}

export const handler = async (event) => {
  try {
    return listarCatalogo(event ?? {});
  } catch (e) {
    logarErro('listar_catalogo', e);
    return { erro: 'ERRO_INTERNO', mensagem: MENSAGEM_ERRO_INTERNO };
  }
};
