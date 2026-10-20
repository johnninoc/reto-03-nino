import { readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { nuevaSesion, procesarTurno } from "./agent/loop.ts"
import type { ConfigAgente, Sesion } from "./agent/loop.ts"
import { AnthropicAdapter } from "./llm/anthropic.ts"

const RAIZ = path.join(import.meta.dir, "..")

/** Número entero positivo desde una variable de entorno, o el valor por defecto. */
function enteroDeEntorno(nombre: string, porDefecto: number): number {
  const valor = Number(process.env[nombre])
  return Number.isInteger(valor) && valor > 0 ? valor : porDefecto
}

/** System prompt = comportamiento (agent/prompt.md) + conocimiento (src/knowledge/ordenes-compra.md). */
function cargarSistema(): string {
  const comportamiento = readFileSync(path.join(RAIZ, "agent", "prompt.md"), "utf8")
  const conocimiento = readFileSync(path.join(RAIZ, "src", "knowledge", "ordenes-compra.md"), "utf8")
  return `${comportamiento}\n\n${conocimiento}`
}

const llm = new AnthropicAdapter()
const config: ConfigAgente = {
  llm,
  sistema: cargarSistema(),
  directory: RAIZ,
  maxIter: enteroDeEntorno("MAX_ITER", 25),
  maxTokensSesion: enteroDeEntorno("MAX_TOKENS_SESSION", 200_000),
}

const sesiones = new Map<string, Sesion>()
const ocupadas = new Set<string>() // sesiones con un turno en curso

const ChatSchema = z.object({
  sessionId: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(4000),
})

function obtenerSesion(id: string): Sesion {
  const existente = sesiones.get(id)
  if (existente) return existente
  const sesion = nuevaSesion(id)
  sesiones.set(id, sesion)
  return sesion
}

function errorJson(mensaje: string, status: number): Response {
  return Response.json({ error: mensaje }, { status })
}

async function leerCuerpo(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

async function chat(req: Request): Promise<Response> {
  const cuerpo = ChatSchema.safeParse(await leerCuerpo(req))
  if (!cuerpo.success) return errorJson('El cuerpo debe ser JSON con "sessionId" y "message" (texto no vacío).', 400)
  const { sessionId, message } = cuerpo.data
  if (ocupadas.has(sessionId)) return errorJson("Esta sesión todavía está procesando el mensaje anterior. Espera la respuesta.", 409)

  ocupadas.add(sessionId)
  try {
    return Response.json(await procesarTurno(obtenerSesion(sessionId), message, config))
  } catch {
    return Response.json({ reply: "Ocurrió un error inesperado en el servidor. La sesión sigue activa; intenta de nuevo.", toolCalls: [], needsConfirmation: false })
  } finally {
    ocupadas.delete(sessionId)
  }
}

function historial(id: string): Response {
  const sesion = sesiones.get(id)
  if (!sesion) return errorJson(`No existe la sesión "${id}".`, 404)
  return Response.json({ sessionId: sesion.id, tokens: sesion.tokens, historial: sesion.historial })
}

const servidor = Bun.serve({
  port: enteroDeEntorno("PORT", 3000),
  idleTimeout: 255, // segundos: un turno con varias herramientas puede tardar más que el valor por defecto
  routes: {
    "/": () => new Response(Bun.file(path.join(RAIZ, "web", "index.html"))),
    "/api/health": () => Response.json({ ok: true, provider: llm.proveedor, model: llm.modelo }),
    "/api/chat": { POST: chat },
    "/api/sessions/:id": (req) => historial(req.params.id),
  },
  fetch: () => errorJson("Ruta no encontrada.", 404),
})

console.log(`Servidor escuchando en http://localhost:${servidor.port} (proveedor ${llm.proveedor}, modelo ${llm.modelo})`)
