// Catálogo fixo (mesmos produtos da Fase 1).
export const PRODUTOS = [
  { id: 'prod_001', nome: 'Mouse Gamer',      preco: 129.9,  moeda: 'BRL', estoque: 20, categoria: 'perifericos' },
  { id: 'prod_002', nome: 'Teclado Mecânico', preco: 349.9,  moeda: 'BRL', estoque: 15, categoria: 'perifericos' },
  { id: 'prod_003', nome: 'Fone Bluetooth',   preco: 249.9,  moeda: 'BRL', estoque: 12, categoria: 'audio' },
  { id: 'prod_004', nome: 'Monitor 27"',      preco: 1199.9, moeda: 'BRL', estoque: 5,  categoria: 'monitores' },
  { id: 'prod_005', nome: 'Webcam Full HD',   preco: 199.9,  moeda: 'BRL', estoque: 8,  categoria: 'perifericos' },
];

export function buscarProduto(id) {
  return PRODUTOS.find((p) => p.id === id);
}
