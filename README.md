# LaCitadel

Stats de **Deadlock** en español, hechas para la comunidad de LATAM y España.

Una app de escritorio gratis y open source para ver win rates, builds, items y leaderboards sin tener que estar peleando con páginas en inglés ni con data que nunca está actualizá.

---

## ¿Por qué hice esto?

Soy de Puerto Rico y llevo años haciendo contenido de gaming en español. Cuando empecé a jugar Deadlock en stream me topé con dos cosas que me tenían cansao:

1. **Todo está en inglés.** Las herramientas de stats que hay son buenas, pero para explicarle un build a mi chat en español yo tenía que estar traduciendo nombres de items al vuelo. Un dolor de cabeza.
2. **El routing de servidores desde PR es un desastre.** Si juegas desde el Caribe sabes de lo que hablo — uno termina en servidores de Norteamérica cuando lo que quiere es jugar con la gente de Suramérica. Eso me llevó por un hoyo de configuraciones (saludos a ExitLag) y de paso me dio ganas de tener mis propias herramientas.

Así que en vez de quejarme más, me senté a construir LaCitadel. La idea siempre fue sencilla: **una app en español, gratis, que cualquiera en la comunidad pueda bajar y usar sin pagar nada ni meter una API key.**

No es perfecta y la sigo puliendo poco a poco, pero hace lo que necesito y espero que a ti también te sirva.

---

## ¿Qué hace?

- **Plantel de héroes** — win rate y pick rate de los 38 héroes, filtrable por rango (badge).
- **Builds** — el build más popular de cada héroe, ordenado por favoritos y vistas de la semana.
- **Items** — stats de items por héroe: win rate y qué tan seguido se compran.
- **Clasificación** — leaderboards por región (Suramérica, Norteamérica, Europa, Asia, Oceanía), con los héroes principales de cada jugador.
- **Errores / Logs** — una pestaña para ver qué pasó si algo falla. Si encuentras un bug, le das a "Copiar sesión" y me lo mandas. Así arreglo las cosas más rápido.

Todo en **español por defecto**, con un botón para cambiar a inglés si lo prefieres.

---

## Instalación

### La forma fácil

Baja el instalador (`LaCitadel Setup.exe`) desde la sección de [Releases](https://github.com/chanlaser/lacitadel/releases), lo corres, y ya. Como cualquier programa de Windows.

### Para los que quieren correrlo desde el código

Necesitas [Node.js](https://nodejs.org) instalado.

```
git clone https://github.com/chanlaser/lacitadel.git
cd lacitadel
npm install
npm start
```

---

## ¿De dónde sale la data?

Toda la información viene de [deadlock-api.com](https://deadlock-api.com), un proyecto comunitario buenísimo que mantiene la data de Deadlock abierta y gratis. **La app llama a esa API directamente desde tu PC** — no hay servidor mío en el medio, no recojo nada tuyo, y no hay costos. Cada quien usa su propia conexión.

Si algún día Deadlock saca héroes o items nuevos, la app los agarra sola sin que yo tenga que actualizar nada.

---

## ¿Encontraste un bug? ¿Tienes una idea?

Abre un [issue](https://github.com/chanlaser/lacitadel/issues) o, si eres de la comunidad, escríbeme directo. Toda la ayuda es bienvenida — esto lo hago en mi tiempo libre y se agradece cualquier mano.

---

## Licencia

MIT. Haz lo que quieras con esto, solo deja el crédito. Mira el archivo [LICENSE](LICENSE) para los detalles.

---

Hecho con cariño (y bastante café) desde Puerto Rico 🇵🇷
por **Chanlaser** · [Twitch](https://twitch.tv/chanlaser) · LaCitadel.gg

*Desarrollado con la ayuda de Claude (Anthropic) como pair-programmer.*
