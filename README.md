# Asistente de Órdenes de Compra — Periferia IT (Reto 03)

Agente conversacional que lee el paquete de una compra (correo, solicitud, cotización, aprobación y factura), lo valida contra los maestros con las reglas RC1–RC10, arma la orden de compra y la crea en un SAP simulado.
Lo que no cumple se bloquea; lo dudoso se pregunta antes de crear, y las OC retroactivas quedan marcadas en `out/control.csv`.
Chat web + backend en Bun + herramientas tipadas con zod + modelo de Anthropic.

**Enlace público:** ENLACE_PUBLICO

## Requisitos

- [Bun](https://bun.sh) 1.4 o superior.
- Una clave de API de Anthropic (solo para el chat; `demo.ts` no la necesita).

## Correr en local

```bash
cp .env.example .env      # y completa ANTHROPIC_API_KEY
bun install && bun run dev
```

Abre http://localhost:3000. Bun lee `.env` automáticamente.

## Variables de entorno

| Variable | Para qué | Por defecto |
|---|---|---|
| `ANTHROPIC_API_KEY` | Clave del modelo. Solo vive en el backend; nunca llega al front, a los logs ni a las respuestas. | (obligatoria para el chat) |
| `PORT` | Puerto HTTP. | `3000` |
| `MODEL` | Modelo de Anthropic. | `claude-haiku-5-5` |
| `MAX_ITER` | Tope de pasos modelo → herramientas por turno. | `25` |
| `MAX_TOKENS_SESSION` | Tope de tokens por sesión (la lectura de caché cuenta al 10 %). | `200000` |

## Demo sin modelo

```bash
bun install && bun run demo.ts
```

Limpia `out/`, procesa los 6 casos llamando directamente a las herramientas, repite `sol-001` (idempotencia) y confirma `sol-004`. Debe imprimir:

```
sol-001 | apta=true | bloqueos=- | confirmaciones=- | retroactiva=false | OC 4500000001 creada
sol-002 | apta=false | bloqueos=RC1 | confirmaciones=- | retroactiva=false | OC no creada (bloqueada)
sol-003 | apta=false | bloqueos=RC2 | confirmaciones=- | retroactiva=false | OC no creada (bloqueada)
sol-004 | apta=true | bloqueos=- | confirmaciones=RC5 | retroactiva=false | OC no creada (pendiente de confirmación)
sol-005 | apta=true | bloqueos=- | confirmaciones=RC8 | retroactiva=true | OC no creada (pendiente de confirmación)
sol-006 | apta=true | bloqueos=- | confirmaciones=RC6 | retroactiva=false | OC no creada (pendiente de confirmación)
sol-001 | ... | OC 4500000001 (idempotente: true)
sol-004 (confirmado) | ... | OC 4500000002 creada
```

Debajo de cada caso aparece el detalle de cada bloqueo o confirmación (por ejemplo, `RC5: Solicitud COP 25.000.000 vs cotización COP 26.500.000`). Archivos generados en `out/`: `control.csv`, `log.jsonl`, `sap/ordenes.jsonl`, `<caso>/aprobacion.txt` y `<caso>/trazabilidad.json`.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls: [{ nombre, args, ok, resumen }], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | `{ sessionId, tokens, historial }` con los mensajes y respuestas de la sesión |
| `GET` | `/api/health` | `{ ok: true, provider, model }` (sin claves) |
| `GET` | `/` | Chat web (`web/index.html`) |

Ejemplo:

```bash
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" \
  -d '{"sessionId":"prueba","message":"Procesa la solicitud sol-004"}'
```

Las sesiones viven en memoria: se pierden al reiniciar el servidor.

## Despliegue (Docker en Render)

El repositorio trae `Dockerfile` (imagen oficial `oven/bun:1.4.3`) y `.dockerignore`.

1. En Render: **New → Web Service**, conecta el repositorio y elige el entorno **Docker**.
2. Variables de entorno: `ANTHROPIC_API_KEY` (como secreto) y, si quieres, `MODEL`, `MAX_ITER` y `MAX_TOKENS_SESSION`. Render define `PORT` solo; el servidor lo lee y escucha en `0.0.0.0`.
3. Health check: `/api/health`.

Para probar la imagen en local:

```bash
docker build -t reto03 .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=... reto03
```

Nota: el disco de Render es efímero. `out/` (control, log, SAP simulado) y las sesiones se reinician en cada despliegue o reinicio.

## Documentación

- `SOLUCION.md`: planteamiento de la solución (las 12 secciones del PRD 9.1).
- `SUPUESTOS.md`: supuestos tomados al interpretar el PRD.
- `agent/prompt.md`: comportamiento del agente. `src/knowledge/ordenes-compra.md`: conocimiento del proceso.
