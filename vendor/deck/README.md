# Gerador do deck de status

A rota `/api/produtos/[id]/status-pptx` monta o conteúdo do slide (o spec JSON)
e delega o desenho a um gerador externo, para o deck sair no padrão visual da
sua empresa em vez de numa imitação dele.

**Este diretório vem vazio de propósito.** O template e o gerador da Nimbus são
material interno e não são distribuídos aqui.

Para habilitar a exportação, coloque neste diretório:

```
vendor/deck/
  scripts/build_deck.py     gerador: lê um spec JSON e escreve um .pptx
  assets/template.pptx      o Master da sua marca
```

O contrato do spec que a rota produz está em `src/app/api/produtos/[id]/status-pptx/route.ts`:
um slide por página de colunas, cada coluna uma janela de prazo e cada card uma
entrega, com `marco`, `data`, `texto`, `status`, `dono` e `chave`.

Sem esses arquivos, o botão "PowerPoint" responde com uma mensagem explicando o
que falta — a tabela de entregas e o status em texto continuam funcionando.

Dependência: Python 3 com `python-pptx` (`npm run setup:pptx`).
