# Setups CyM

Web para suscriptores de **CyM Inversores** en Patreon: consulta de los setups semanales de acciones y ETFs a partir de los Excel que prepara CyM. Pensada primero para el móvil.

- Acceso con **Patreon**. El nivel se comprueba **en el servidor**: a cada persona solo le llegan los datos de su nivel.
- **Panel de administración** para subir los Excel (vista previa, publicar, volver a una carga anterior).
- Lista de seguimiento (342 acciones, 69 ETFs): añadir o quitar valores sueltos o subir el archivo completo.
- Página de **Recursos** (enlaces fijos para Estrategia Superior) y **lista de invitados** (acceso sin Patreon).
- Aviso legal educativo siempre visible. Todos los textos en español de España.

> Todo el contenido es educativo e informativo. No es asesoramiento financiero.

## Qué ve cada nivel

| | Sin suscripción | Esencial | Intermedio | Superior | Admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Guía de uso | opcional* | ✔ | ✔ | ✔ | ✔ |
| ETFs: lista corta, indicadores, breakout, rebote, performance | – | ✔ | ✔ | ✔ | ✔ |
| Listas de seguimiento | – | ✔ | ✔ | ✔ | ✔ |
| Acciones: lista corta, indicadores, breakout, rebote, performance | – | – | ✔ | ✔ | ✔ |
| Top fuerza relativa (RS vs SPY) | – | – | ✔ | ✔ | ✔ |
| Recursos | – | – | – | ✔ | ✔ |
| Administración | – | – | – | – | ✔ |

\* Se activa en Administración → Ajustes de acceso («Mostrar la guía a cuentas sin suscripción»). Por defecto está desactivado. El texto de la guía es contenido general y viaja en el código de la web (`public/app.js`); lo que se protege en el servidor son los datos.

Las personas de un nivel inferior ven una tarjeta con candado, el nivel necesario y, como orientación, cuántas acciones hay esta semana, pero **no reciben los datos**.

## Cómo funciona por dentro

- **Node 22** + **Express 5**, **PostgreSQL** (los datos de cada carga se guardan como JSON versionado: borrador → publicado → historial de 12).
- Sin dependencias de interfaz: HTML, CSS y JavaScript propios; tipografías alojadas en la propia web (`public/fonts`), sin servicios externos. Cabeceras de seguridad estrictas (CSP).
- **Sesiones** propias en base de datos (cookie `__Host-sid`, `HttpOnly`, `Secure`, `SameSite=Lax`), token CSRF en todas las peticiones que cambian datos y comprobación de `Origin`.
- **Patreon API v2** (OAuth). Se guardan nombre, email, id y nivel. El token de renovación se guarda **cifrado** (AES-256-GCM).
- Cada **12 horas** (`RECHECK_HOURS`), cuando la persona usa la web, se vuelve a preguntar a Patreon si la suscripción sigue activa. Si Patreon no responde, se mantiene el nivel hasta **48 h** (`PATREON_GRACE_HOURS`). Si Patreon dice que se ha revocado el permiso, se cierra la sesión. Pagos fallidos, bajas y pausas → sin acceso.
- **Webhook** opcional (`/webhooks/patreon`, firma HMAC-MD5): bajas y cambios de nivel casi al instante.
- Cada vez que se publica una carga, se guarda la fecha **del propio Excel** (no la del día de subida).

### Qué corrige el importador de Excel

Los Excel no hay que cambiarlos. Al importar:

- La **fuerza relativa** que llega como entero (5393) se lee como 5,393.
- Los **volúmenes** menores de un millón que llegan con decimales (887,173) se leen como 887.173.
- Las **rentabilidades** guardadas como porcentaje nativo de Excel (−0,0866) se leen como −8,66 %.
- Los **números guardados como texto** («4.44%», «10,009,277») se convierten a número.
- Las celdas `#VALUE!` de la lista corta se ignoran; las etiquetas `(D,HB)` se separan del símbolo (insignia HB).
- Si **falta una pestaña o columna**, no se publica nada y se explica qué falta. Si la fecha del Excel es anterior a la publicada, o repetida, se avisa antes de publicar.

Se puede probar un Excel sin subirlo a la web: `npm run preview -- etf|acc|rs|list archivo.xlsx`.

## Puesta en marcha en Scalingo (paso a paso)

Datos del proyecto: aplicación en **osc-fr1** (región estándar), contenedor **M** y base de datos **PostgreSQL Starter 512 MB**; código en GitHub (`cyminversores2020-cmyk/setups-cym`).

### 1. Base de datos

En la app de Scalingo → **Resources → Addons → Add an addon → PostgreSQL** (plan Starter 512 MB). Scalingo crea solo la variable `SCALINGO_POSTGRESQL_URL`; la web la usa directamente (no hace falta crear `DATABASE_URL`). Las tablas se crean solas al arrancar.

### 2. Variables de entorno

En **Environment** de la app de Scalingo (nunca en el repositorio):

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `BASE_URL` | `https://setups.cyminversores.com` |
| `SESSION_SECRET` | una cadena aleatoria larga (en tu ordenador: `openssl rand -base64 48`) |
| `PATREON_CLIENT_ID` | `tPt4PYC5ukHtxwRfkIVQJjv3ACJodY1ciJofWjGhhHOIkRZ3HFvv7D302oRtpyvQ` |
| `PATREON_CLIENT_SECRET` | el *Client Secret* del portal de Patreon. **Cópialo tú directamente del portal a Scalingo; no lo envíes por chat ni lo guardes en ningún documento.** |
| `ADMIN_EMAILS` | el email de la cuenta de Patreon con la que entráis a administrar (varios, separados por comas) |
| `PATREON_PAGE_URL` | (opcional) la dirección pública de vuestra página en Patreon, para el botón «Ver niveles» |

Opcionales: `PATREON_CAMPAIGN_ID` (se detecta sola, ver más abajo), `PATREON_WEBHOOK_SECRET`, `ADMIN_PATREON_IDS`, `RECHECK_HOURS`, `PATREON_GRACE_HOURS`, `SESSION_DAYS`, `SEED_WATCHLIST`. Hay una lista comentada en `.env.example`.

Si falta algo obligatorio, la web **no arranca** y el registro de Scalingo explica qué falta.

### 3. Desplegar desde GitHub

Scalingo → **Deploy → Method → GitHub** → enlazar el repositorio `cyminversores2020-cmyk/setups-cym`, rama `main`, y activar **Automatic deployment** si queréis que cada cambio se publique solo. Pulsad **Manual deploy** la primera vez. El fichero `Procfile` ya indica cómo arrancar (`web: node server.js`). Cuando termine, `https://<app>.osc-fr1.scalingo.io/healthz` debe responder `{"ok":true}`.

### 4. Dominio `setups.cyminversores.com`

1. En Scalingo → **Settings → Domains → Add a domain**: `setups.cyminversores.com`. Scalingo muestra el destino al que apuntar.
2. En **Webempresa** (DNS de `cyminversores.com`), crear un registro **CNAME**: nombre `setups`, valor el destino que indica Scalingo.
3. Esperar a que el DNS se propague. Scalingo emite el certificado HTTPS (Let's Encrypt) automáticamente al detectarlo.

### 5. Patreon

En el portal de desarrolladores de Patreon, el cliente «Setups CyM» ya tiene la *Redirect URI* `https://setups.cyminversores.com/auth/patreon/callback`. Debe ser **exactamente** esa (si cambiáis el subdominio, hay que cambiarla también aquí y en `BASE_URL`).

Permisos que pide la web (se ven en la pantalla de Patreon al entrar): identidad, email y suscripciones (`identity`, `identity[email]`, `identity.memberships`). No puede publicar ni cobrar nada.

### 6. Primera entrada y comprobaciones

1. Entrad con la **cuenta de creador** de CyM (la misma cuyo email está en `ADMIN_EMAILS`). Al entrar, la web **detecta sola el ID de campaña** de vuestra página de Patreon (si no, se puede escribir en Administración → Ajustes de acceso).
2. En **Administración → Ajustes de acceso → Niveles de Patreon** aparecerán los niveles de pago a medida que entre gente de cada uno. Por defecto, el nivel se deduce del nombre (si contiene «Esencial», «Intermedio» o «Superior»). Si algún nombre no coincide, asignadlo a mano ahí.
3. **Cargas de datos**: subid los tres Excel de setups (ETFs y sectores, Lista base de acciones, RS vs SPY), revisad la vista previa y publicad. La lista de seguimiento inicial (342 acciones y 69 ETFs, del 06/10/2026) ya viene cargada.
4. **Recursos**: poned los tres enlaces (Discord/Patreon).
5. **Antes de abrir**: probad con cuentas de cada nivel (podéis dar acceso temporal a una cuenta de prueba en **Invitados**) y comprobad que cada una ve solo lo suyo.

### 7. Aviso inmediato de bajas (webhook, opcional)

En el portal de Patreon → vuestro cliente → **Webhooks** → crear uno con la dirección `https://setups.cyminversores.com/webhooks/patreon` y los eventos de *members* (crear, actualizar, borrar). Copiad el secreto que da Patreon a la variable `PATREON_WEBHOOK_SECRET` en Scalingo. Sin webhook todo funciona igual, con la comprobación periódica.

## Rutina semanal

1. Administración → **Cargas de datos** → «Subir Excel» en el conjunto que toque (ETFs una vez por semana, acciones dos veces, RS vs SPY una vez).
2. Revisar la **vista previa**: filas leídas, lista corta, valores que entran o salen respecto a lo publicado, avisos.
3. **Publicar**. Si algo está mal, en «Versiones anteriores» se puede volver a la carga previa.
4. La lista de seguimiento solo se toca cuando cambie (subiendo el Excel completo o añadiendo/quitando valores sueltos). Recordad añadir también el símbolo en el scanner de la plataforma: los setups salen de los Excel semanales.

## Desarrollo en local

Necesita Node 22 y un PostgreSQL.

```bash
npm install
cp .env.example .env      # y rellenarlo (en local basta SESSION_SECRET y DATABASE_URL)
# Variables para probar sin Patreon:
export NODE_ENV=development DEV_LOGIN=true DATABASE_URL=postgres://usuario@localhost/setups SESSION_SECRET=$(openssl rand -base64 48) ADMIN_EMAILS=admin@example.test PATREON_CLIENT_ID=prueba BASE_URL=http://localhost:3000
npm start
```

Con `DEV_LOGIN=true` (solo fuera de producción) la pantalla de acceso muestra enlaces para entrar como cada nivel. **Nunca se activa en producción.**

### Pruebas

```bash
npm test                                   # pruebas unitarias (importador, accesos, cifrado, webhook)
TEST_DATABASE_URL=postgres://… npm test    # añade las de extremo a extremo (usa una base de PRUEBA: la vacía)
```

## Pendiente de confirmar

- **Importador de la lista de seguimiento**: está probado con datos de ejemplo y con la lista inicial cargada a partir del prototipo, pero **no con el archivo Excel real** del 06/10/2026 (no se ha podido leer desde aquí). Antes de usarlo, subid ese archivo en Cargas de datos → Listas de seguimiento: la vista previa mostrará cuántas acciones y ETFs lee y qué cambia. Si no lo lee bien, mandadlo y se ajusta.
- **Acceso sin suscripción**: decidir si las cuentas de Patreon sin pago ven la guía (interruptor en Ajustes de acceso).
- **Industrias**: se muestran en inglés, como vienen de la plataforma. Los sectores sí están en español.
- **Textos legales**: consultar con un abogado o gestor qué debe llevar la web (aviso legal, privacidad, recomendaciones de inversión). La web enlaza al aviso legal y a la política de privacidad de cyminversores.com.
- Datos personales: la web guarda nombre, email, id de Patreon y nivel de cada persona que entra. Conviene reflejarlo en la política de privacidad.
