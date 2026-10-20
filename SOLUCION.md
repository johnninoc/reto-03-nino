# SOLUCIÓN — Reto 03: Agente "Órdenes de Compra SAP"

## 1. Problema en una frase

La analista administrativa digita a mano en SAP cada orden de compra y verifica de memoria proveedor, aprobador, topes y valores; eso cuesta tiempo, genera errores que se corrigen en el cierre contable y no deja medir cuántas OC se crean después de la factura. Le duele a la analista (tiempo), a contabilidad y auditoría (control) y a la dirección (medición).

## 2. Arquitectura

```
┌───────────────────────┐   HTTP (JSON)   ┌──────────────────────────────────────────────┐
│ web/index.html        │ ──────────────▶ │ src/server.ts (Bun.serve)                    │
│ chat, tarjetas de     │ ◀────────────── │  /api/chat · /api/sessions/:id · /api/health │
│ herramientas, aviso   │                 │  sesiones en memoria                         │
│ de confirmación       │                 └──────────────────┬───────────────────────────┘
└───────────────────────┘                                    │
                                          ┌──────────────────▼───────────────────────────┐
  agent/prompt.md (comportamiento) ─────▶ │ src/agent/loop.ts — ciclo del agente         │
  src/knowledge/ordenes-compra.md ──────▶ │  MAX_ITER · tope de tokens · salvaguarda de  │
  (conocimiento)    = system prompt       │  confirmación · validación zod de args       │
                                          └───────┬──────────────────────────┬───────────┘
                                                  │                          │
                              ┌───────────────────▼─────┐      ┌─────────────▼──────────────┐
                              │ src/llm/adapter.ts      │      │ src/tools/oc.ts (ejecución)│
                              │ LlmAdapter (neutral)    │      │ 5 herramientas oc_*        │
                              │ src/llm/anthropic.ts    │      │ → src/domain/ (reglas,     │
                              └─────────────────────────┘      │   paquete, payload, logs)  │
                                                               └──────┬──────────────┬──────┘
                                                                      │              │
                                                 fixtures/ (solo lectura)   out/ (escritura)
                                                 paquetes y maestros        control.csv, log.jsonl,
                                                                            <caso>/…, sap/ordenes.jsonl
                                                                            ▲
                                                               src/sap/mock.ts (SapAdapter)
```

- **Comportamiento**: `agent/prompt.md`. **Conocimiento**: `src/knowledge/ordenes-compra.md`. El servidor une ambos archivos en el system prompt al arrancar.
- **Ejecución**: `src/tools/oc.ts` expone solo las 5 herramientas (cada export se publica como `oc_<export>`). La lógica de negocio vive en `src/domain/`, importable desde `demo.ts` sin servidor ni modelo.
- **SAP**: la interfaz `SapAdapter` (PRD 7.4) está en `src/sap/adapter.ts` y el simulador sobre archivos en `src/sap/mock.ts`.
- Cambiar una regla de negocio toca `src/domain/reglas.ts` y el conocimiento, nunca el servidor.

## 3. Ciclo del agente

- **Bucle** (`src/agent/loop.ts`): mensaje del usuario → modelo → si pide herramientas, se ejecutan todas y sus resultados vuelven juntos al modelo → se repite hasta que el modelo responde sin pedir herramientas.
- **Herramientas**: el JSON Schema que ve el modelo se genera desde los `args` zod de cada herramienta. Antes de ejecutar, el ciclo valida los argumentos con zod; si no cumplen, el error vuelve al modelo y queda en `out/log.jsonl`. Cada herramienta devuelve `{ ok, data | error }` y nunca lanza.
- **Tope de iteraciones**: `MAX_ITER` (25 por defecto) pasos por turno. Al llegar, el servidor responde (sin llamar al modelo) qué herramientas se ejecutaron, si la OC quedó creada y qué falta.
- **Tope de tokens por sesión**: `MAX_TOKENS_SESSION` (200.000). Cuenta entrada + salida + **10 % de los tokens leídos de la caché del prompt**, porque esa lectura cuesta ~10 % de la entrada normal. Se revisa al inicio del turno y antes de cada iteración; al superarlo, la sesión ya no acepta mensajes.
- **Confirmación humana**: el prompt ordena terminar el turno con una pregunta de sí o no. Además hay una **salvaguarda en el servidor**: si el modelo llama a `oc_crear` con `confirmado: true` y el último mensaje del usuario no es una confirmación (sí, si, confirmo, confirmado, adelante, procede, ok, dale, sin la palabra "no"), el servidor fuerza `confirmado: false` y devuelve "requiere confirmación explícita". `needsConfirmation` se calcula en el servidor (confirmaciones pendientes y ninguna OC creada en el turno), y el front lo resalta.
- **Defensa contra montos "arreglados"**: `oc_crear` relee el paquete desde los fixtures, revalida y solo crea si el payload recibido es idéntico al construido desde las fuentes.
- **Errores**: un error del proveedor (timeout de 60 s, clave inválida, límite de solicitudes) o de una herramienta se muestra en español en el chat y la sesión sigue viva.

## 4. Elección del modelo

- **Proveedor y modelo**: Anthropic, `claude-haiku-5-5` (configurable con `MODEL`).
- **Por qué**: las reglas se deciden en código, no en el modelo. Al modelo solo le toca orquestar 5 herramientas en un orden fijo, explicar resultados y preguntar. Para eso basta un modelo rápido y barato. En las pruebas siguió el proceso completo de `sol-004` y la salvaguarda funcionó.
- **Costo estimado por caso**: el flujo completo de `sol-004` (procesar + "confirmo") midió **26.765 tokens contados** (con la lectura de caché al 10 %). A precios de Haiku 5.5 ($0,10 por millón de tokens de entrada, $0,50 de salida), son entre **$0,003** (si todo fuera entrada) y **$0,013** (si todo fuera salida). Como la mayoría es entrada, se estima **~$0,005 por caso** (medio centavo de dólar). Es una estimación: no se midió por separado la entrada de la salida.

## 5. Matriz de controles

| Regla | Función (`src/domain/reglas.ts`) | Tipo | Caso que la prueba |
|---|---|---|---|
| RC1 | `rc1_proveedorExisteYActivo` | Bloqueo | `sol-002`: proveedor (NIT 901999000) no existe en el maestro |
| RC2 | `rc2_aprobadorValido` | Bloqueo | `sol-003`: fvargas aprueba, pero no es aprobador de CC-2020 |
| RC3 | `rc3_montoDentroDelTope` | Bloqueo | Ningún fixture lo dispara (todos los aprobadores válidos están dentro del tope) |
| RC4 | `rc4_subareaDelCentro` | Bloqueo | Ningún fixture lo dispara |
| RC5 | `rc5_cotizacionCuadra` | Confirmación | `sol-004`: solicitud COP 25.000.000 vs cotización COP 26.500.000 (6 %) |
| RC6 | `rc6_indicadorIva` | Confirmación + derivado | `sol-006`: sin IVA → C1 del proveedor |
| RC7 | `rc7_condicionesPago` | Derivado | `sol-006`: sin condiciones de pago → Z030 del proveedor |
| RC8 | `rc8_facturaRetroactiva` | Confirmación | `sol-005`: factura del 2026-08-10, solicitud del 2026-08-27 → `retroactiva = true` |
| RC9 | `rc9_aprobacionDespuesDeSolicitud` | Confirmación | Ningún fixture lo dispara (en `sol-004` y `sol-006` la aprobación es del mismo día) |
| RC10 | `rc10_cantidadPorPrecio` | Bloqueo | Ningún fixture lo dispara |

`evaluarReglas` junta los resultados en `{ apta, bloqueos, confirmaciones, reglas_cumplidas, derivados, retroactiva }`; cada hallazgo trae `codigo` y un `detalle` con los valores comparados.

**La más difícil: RC2 (junto con RC3).** El caso `sol-003` tiene una trampa: fvargas sí es aprobador en la empresa y su tope (COP 80.000.000) cubre los COP 74.000.000, pero lo es de CC-3030, no de CC-2020. Una validación ingenua ("¿es aprobador con tope suficiente?") lo dejaría pasar. Por eso RC2 busca al aprobador **dentro del centro de costo** de la solicitud, y RC3 solo se evalúa con ese aprobador; si no lo hay, ya bloquea RC2 y no se duplica el bloqueo.

## 6. Diseño del adaptador SAP real

**Opción recomendada: OData `API_PURCHASEORDER_PROCESS_SRV`** (API estándar de SAP S/4HANA para órdenes de compra). Es REST/JSON, la soporta SAP, se puede exponer por SAP API Management o Integration Suite y se consume igual desde Bun. Una creación "profunda" (cabecera + posiciones + imputación) va en una sola llamada.

- **Alternativa 1 — RFC/BAPI `BAPI_PO_CREATE1`**: sirve para ECC o S/4 on-premise sin OData publicado. Requiere un conector RFC (SAP NW RFC SDK) y un servicio intermedio, porque el agente no debe hablar RFC directamente.
- **Alternativa 2 — carga por archivo** (Migration Cockpit, LSMW o un programa Z de carga masiva): no requiere integración en línea. Es el Plan B (abajo).

**Mapeo del payload (7.4) a la API** (los nombres exactos se validan con el equipo SAP de Periferia):

| Payload | `A_PurchaseOrder` / posición |
|---|---|
| `sociedad`, `organizacion_compras` | `CompanyCode`, `PurchasingOrganization` (+ `PurchasingGroup` y `PurchaseOrderType`, p. ej. "NB", definidos por configuración) |
| `proveedor.codigo_sap` | `Supplier` |
| `moneda`, `condiciones_pago` | `DocumentCurrency`, `PaymentTerms` |
| `referencia.solicitud_id` | Campo de referencia externa de la cabecera (p. ej. `CorrespncExternalReference`) o texto de cabecera; es la llave de idempotencia |
| `posiciones[].numero`, `descripcion`, `cantidad`, `unidad` | `PurchaseOrderItem`, `PurchaseOrderItemText`, `OrderQuantity`, `PurchaseOrderQuantityUnit` |
| `posiciones[].precio_unitario` | `NetPriceAmount`. **Ojo**: es precio neto, y las cotizaciones de los fixtures traen el precio con IVA incluido. Hay que definir con contabilidad si `valor_unitario` de la solicitud es neto o bruto |
| `posiciones[].indicador_iva` | `TaxCode` |
| `posiciones[].centro_costo` | Imputación de la posición (`AccountAssignmentCategory` = "K", `CostCenter` + `GLAccount`) |
| `posiciones[].subarea` | Sin campo estándar: se define con contabilidad (orden interna, centro de beneficio o texto) |
| `aprobador`, evidencia | Adjunto de la OC con el servicio de adjuntos de SAP (`API_CV_ATTACHMENT_SRV`), con el sha256 en la descripción |
| `excepciones` | Texto de cabecera con las confirmaciones y quién las aceptó |

**Autenticación y credenciales**: el agente nunca ve credenciales. Un servicio de integración (o SAP Integration Suite) guarda un usuario técnico con permisos mínimos (crear OC y adjuntos) en un vault de secretos o en variables de entorno de ese servicio, y se autentica con OAuth 2.0 (client credentials) o certificado. El agente solo llama a `SapAdapter`, y la implementación real habla con ese servicio. Las credenciales no aparecen en el prompt ni en los logs.

**Idempotencia y reintentos**: antes de crear, `buscarOrdenPorReferencia(solicitud_id)` consulta en SAP las OC con esa referencia (igual que el mock). Si existe, se devuelve su número. Ante un timeout sin respuesta, no se reintenta a ciegas: primero se vuelve a buscar por referencia y solo se crea si no apareció.

**Errores parciales**: la creación profunda es atómica, así que si SAP rechaza la OC no queda nada a medias y el error se traduce a lenguaje claro para la analista. El caso parcial real es "OC creada pero falló el adjunto de evidencia". Ahí se registra el número de OC en `control.csv` con un estado de evidencia pendiente y se reintenta solo el adjunto, sin crear otra OC.

**Plan B (si la conexión no es viable)**: el agente hace todo igual hasta la validación y el payload. En vez de crear, genera un archivo CSV en el formato de carga masiva de SAP (una fila por posición, con la referencia `solicitud_id`), más la evidencia y la trazabilidad. La analista lo carga en lote o copia los valores ya validados. El ahorro principal (leer, validar, completar y detectar retroactivas) se mantiene; solo cambia el último paso. Gracias a `SapAdapter`, el cambio es otra implementación de `crearOrden`, sin tocar el agente.

## 7. Lectura del proceso

**[BORRADOR – John revisa]**

El caso `sol-005` muestra el patrón que la dirección quiere medir: la cotización es del 5 de agosto, la factura del 10 y la solicitud del 27. La aprobación llegó el 28 con el texto "ya llegó la factura, por favor crear la OC para poder radicarla". La OC se usa como trámite para pagar, no como control previo a la compra.

Qué le diría a la dirección:
- **Ya se puede medir.** Cada intento queda en `out/control.csv` con `retroactiva = true/false`. El porcentaje de OC retroactivas por centro de costo, proveedor y aprobador sale directo de ese archivo.
- **Una OC retroactiva no es solo un atraso administrativo.** Significa que el compromiso con el proveedor se hizo sin verificar que el aprobador tuviera autoridad ni que el precio coincidiera con lo cotizado. El control llega cuando ya no puede impedir nada.
- **Cambio de proceso propuesto:** política "sin OC no hay pago", con un periodo de transición en el que las retroactivas se aceptan solo con marca y con la confirmación explícita de la analista (como hace hoy el agente). Además, un reporte mensual por centro de costo para hablar con los líderes que más las generan. Como el agente reduce el tiempo de crear una OC, se pierde la excusa principal para crearla tarde.
- **Decisión pendiente** (fuera del alcance del reto): si después de la transición las OC retroactivas se toleran con marca o se rechazan.

## 8. Decisiones y trade-offs

**[BORRADOR – John revisa]**

1. **Reglas en código, no decididas por el modelo.** RC1–RC10 son funciones TypeScript deterministas, y el modelo solo orquesta y explica. *Descartado*: dejar que el modelo evalúe las reglas leyendo los maestros. Sería más flexible, pero no reproducible, difícil de auditar y expuesto a que el modelo "arregle" un monto. Con reglas en código, `demo.ts` prueba todo sin modelo y `oc_crear` puede revalidar desde las fuentes.
2. **Haiku en vez de Sonnet.** *Descartado*: `claude-sonnet-5-5`, unas 20 veces más caro por token. Como las reglas están en código, la tarea del modelo es acotada, y Haiku la cumplió en las pruebas. Si en producción aparecen errores de orquestación, se cambia con la variable `MODEL`, sin tocar código.
3. **Lectura de caché al 10 % en el tope de tokens.** *Descartado*: contar todo al 100 %. Con eso, el flujo de `sol-004` consumía 85.260 tokens (43 % del tope) y una sesión se agotaba en 4–5 casos, aunque el gasto real fuera mucho menor. Contar la caché a su costo real (26.765 tokens) mantiene el tope como protección del gasto. El precio es que el número ya no es un conteo bruto de tokens.
4. **HTML plano sin framework para el front.** *Descartado*: React o Svelte con un paso de build. Un solo archivo sin build se entiende de una lectura, arranca con el servidor y no suma dependencias. Lo que se pierde (componentes, estado complejo) no hace falta para un chat de una pantalla.
5. **La salvaguarda de confirmación también en el servidor**, no solo en el prompt. *Descartado*: confiar solo en la instrucción del prompt. Un modelo puede equivocarse; el servidor no deja crear con `confirmado: true` si el usuario no confirmó.

## 9. Supuestos

El detalle está en `SUPUESTOS.md`, una línea por supuesto. Los principales:
- **Archivos del paquete**: `correo.json` y `solicitud.json` son obligatorios (sin ellos, error legible); cotización y aprobación ausentes se devuelven como `null` en `faltantes`, y la factura es opcional.
- **Lectura de la cotización**: el NIT se toma sin dígito de verificación, los montos en formato colombiano y `validez_hasta` = fecha + días de validez.
- **Interpretación de reglas**: RC1 busca por el NIT de la solicitud o por nombre normalizado, RC3 solo con un aprobador válido para el centro, y RC9 compara solo la fecha.
- **Payload**: una posición; unidad "H" si la descripción habla de horas, si no "UN"; descripción recortada a 40 caracteres. La trazabilidad agrega las fuentes `correo` y `aprobacion`.
- **`oc_crear`**: `payload` opcional para registrar intentos bloqueados; relee y revalida desde las fuentes; ignora `confirmado_por` al comparar porque lo llena la propia herramienta.
- **Ciclo**: confirmación por palabras clave sin "no"; 60 s de timeout sin reintentos; tokens con la caché al 10 %; un mensaje a la vez por sesión.
- **Front y despliegue**: marked fijado con hash de integridad, HTML del modelo escapado y solo enlaces http(s); el contenedor corre con un usuario sin privilegios.

## 10. Cobertura

| Historia | Estado | Notas |
|---|---|---|
| HU-1 Leer el paquete | Hecho | `oc_leer_paquete`; adjuntos ausentes → `null` + `faltantes` |
| HU-2 Validar | Hecho | RC1–RC10 con bloqueos, confirmaciones, derivados y `retroactiva` |
| HU-3 Construir el payload | Hecho | Esquema zod de 7.4 + `out/<caso>/trazabilidad.json` |
| HU-4 Evidencia de aprobación | Hecho (P0) | `out/<caso>/aprobacion.txt` con sha256; el PDF (P1) no está hecho |
| HU-5 Crear la OC | Hecho | Números desde 4500000001, idempotencia y `control.csv` en cada intento |
| HU-6 Manejo de errores | Hecho | `{ ok: false, error }` legible; errores del modelo en español; la sesión sobrevive |

**Extras para la demo**: `oc_validar` devuelve también `reglas_cumplidas` (qué reglas pasaron), y el agente siempre lista las que pasaron y las que no. `oc_crear` responde `ya_existia: true` con un mensaje claro cuando la OC ya existía. El botón "Reiniciar datos de demo" (`POST /api/reset`) borra `out/` para repetir la demo desde la OC 4500000001.

**P1 y bonus no hechos**: `out/<caso>/aprobacion.pdf`, `oc_leer_excel` y el módulo reutilizable `modulo/` (9.4). **Link público**: pendiente (ENLACE_PUBLICO); el `Dockerfile` está listo, pero la imagen no se construyó en la máquina de desarrollo porque no tiene Docker.

**Qué falta para producción**: el adaptador SAP real (sección 6), autenticación y límite de sesiones por usuario, sesiones y registros persistentes (hoy en memoria y en disco efímero), evidencia en PDF, pruebas automatizadas de las reglas y del ciclo, y un candado de concurrencia en la escritura de `ordenes.jsonl` y `control.csv`.

## 11. Uso de IA

- **Claude Code (Opus 5.5)** escribió el código por tramos (herramientas y SAP simulado; ciclo, adaptador y API; front, documentación y Dockerfile) bajo la dirección de John, que definió cada tramo, revisó los resultados y pidió correcciones.
- **Claude (chat)** se usó para elegir el reto, armar el runbook de la sesión y redactar los prompts de cada tramo.
- **Decisiones de John**: la elección del reto, el modelo (`claude-haiku-5-5`), la opción de contar la caché al 10 % entre las alternativas propuestas, la división de commits por tramo y la redacción del producto en español.
- **Descartado de lo que propuso la IA**:
  - *Contar los tokens de caché al 100 %* (primera versión): agotaba la sesión en 4–5 casos sin reflejar el gasto real. Se cambió a 10 %.
  - *Dejar que el modelo llenara `confirmado_por`*: en la prueba de humo, el modelo escribió su propio texto en ese campo y `oc_crear` rechazó el payload por no coincidir. Además afirmó después que el campo había quedado vacío, lo que era falso. Se decidió que solo la herramienta lo llena: la comparación lo ignora y el prompt lo aclara.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| El modelo afirma un valor que no salió de una herramienta (pasó una vez en las pruebas) | Prompt con reglas duras; las tarjetas de herramientas muestran los resultados reales al lado de la respuesta; los valores que van a SAP salen del payload revalidado, no del texto del modelo |
| El modelo altera montos o se salta reglas | `oc_crear` relee y revalida desde las fuentes y rechaza payloads distintos; la salvaguarda del servidor exige confirmación real |
| Instrucciones maliciosas dentro de una cotización o un correo (inyección de prompt) | El modelo no puede crear sin pasar por las reglas en código; el front escapa el HTML del modelo y solo permite enlaces http(s) |
| Gasto descontrolado de la clave con el link público | Tope de pasos por turno y de tokens por sesión. **Pendiente**: cualquiera puede abrir sesiones nuevas; en producción, autenticación o clave de acceso y límite por IP |
| Cualquiera con el link puede borrar los datos de demo (`POST /api/reset` borra `out/`: OC simuladas, control y log) | Solo borra `out/`, nunca `fixtures/` ni código; pide confirmación en el front y se niega si hay un mensaje en proceso. En producción, este endpoint no existiría o requeriría autenticación de administrador |
| Fuga de la clave | Solo vive en variables de entorno del backend; no aparece en el front, los logs, `/api/health` ni los mensajes de error |
| Pérdida de datos al reiniciar (sesiones en memoria, disco efímero en Render) | Aceptable para el reto. En producción: base de datos o almacenamiento persistente para sesiones, control y log |
| La conexión a SAP no es viable a corto plazo | Plan B de la sección 6 (archivo de carga masiva), sin cambiar el agente |
| Precio con o sin IVA mal interpretado al llevarlo a SAP | Señalado en el mapeo (sección 6); definirlo con contabilidad antes de producción |
