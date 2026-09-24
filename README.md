# AeroRoute 3D

Planejador e simulador de rotas com Expo SDK 57, React e Globe.gl, para web, Android e iOS.

## Executar

```bash
npm install
npm start
```

- **Celular:** abra o QR code no Expo Go compatível com SDK 57. O celular e o computador devem estar na mesma rede.
- **Web:** pressione `w` no terminal ou execute `npm run web`.
- **Emulador Android:** execute `npm run android` com o emulador aberto.
- **Simulador iOS:** execute `npm run ios` em um Mac.

Para gerar aplicativos instaláveis, use EAS Build: `npx eas-cli@latest build --platform android` ou `npx eas-cli@latest build --platform ios` (requer conta e configuração do EAS).

## Como funciona nas plataformas

`src/AeroRoute.tsx` usa a diretiva `"use dom"` do Expo. A mesma interface HTML/CSS roda diretamente na web e dentro da WebView fornecida pelo Expo no Android/iOS. Não é necessário hospedar um site para abrir o aplicativo instalado.

- `src/app/index.tsx` cuida da área segura, da área de transferência nativa e da pausa ao colocar o app em segundo plano.
- `src/geo.ts` mantém os cálculos de rota compartilhados.
- Os JSON de aeroportos e waypoints são importados para o bundle, sem `fetch` de arquivos locais.
- `public/globe.html` é incluído pelo Expo no build nativo e usa `EXPO_BASE_URL` para localizar o arquivo. A comunicação valida a janela de origem e suporta tanto HTTP(S) quanto os arquivos locais do aplicativo.
- Em telas pequenas, o globo fica acima dos controles, que podem ser rolados.

**É necessária conexão com a internet para carregar o Globe.gl e as texturas do globo e das estrelas, que vêm de CDN.** A base de aeroportos e waypoints fica incluída no aplicativo.

Esta adaptação prioriza reaproveitar a interface existente. Alterações em DOM Components e arquivos de `public` devem ser distribuídas em um novo build nativo; não dependemos de EAS Update para atualizá-los. Referência: [Expo DOM Components](https://docs.expo.dev/guides/dom-components/).

## Verificar

```bash
npm run lint
npm run typecheck
npm test
npx expo export --platform all
```

A exportação verifica os bundles das três plataformas; a validação final de gestos, teclado, clipboard e WebGL deve ser feita também em aparelhos reais.
