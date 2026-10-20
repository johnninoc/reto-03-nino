import { ErrorLlm } from "../llm/adapter.ts"
import type { Bloque, BloqueLlamada, BloqueResultado, LlmAdapter, MensajeLlm, RespuestaLlm } from "../llm/adapter.ts"
import { definicionesHerramientas, ejecutarLlamada } from "./herramientas.ts"
import { creoOrden, dejaConfirmacionPendiente, resumir } from "./resumen.ts"

export type LlamadaVisible = { nombre: string; args: unknown; ok: boolean; resumen: string }

export type ResultadoTurno = { reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean }

export type EntradaHistorial =
  | { rol: "usuario"; texto: string; ts: string }
  | ({ rol: "agente"; ts: string } & ResultadoTurno)

export type Sesion = {
  id: string
  mensajes: MensajeLlm[] // conversación que ve el modelo (sin el system prompt)
  historial: EntradaHistorial[] // lo que se muestra en el chat
  tokens: number
}

export type ConfigAgente = {
  llm: LlmAdapter
  sistema: string
  directory: string
  maxIter: number
  maxTokensSesion: number
}

/** Estado de un turno mientras corre el ciclo. */
type Turno = { texto: string; llamadas: LlamadaVisible[]; pendiente: boolean; creada: boolean }

export function nuevaSesion(id: string): Sesion {
  return { id, mensajes: [], historial: [], tokens: 0 }
}

/** Un turno completo: mensaje del usuario → modelo ↔ herramientas → respuesta. Nunca lanza. */
export async function procesarTurno(sesion: Sesion, texto: string, config: ConfigAgente): Promise<ResultadoTurno> {
  sesion.historial.push({ rol: "usuario", texto, ts: new Date().toISOString() })
  const resultado = await correrCiclo(sesion, texto, config)
  sesion.historial.push({ rol: "agente", ts: new Date().toISOString(), ...resultado })
  return resultado
}

async function correrCiclo(sesion: Sesion, texto: string, config: ConfigAgente): Promise<ResultadoTurno> {
  const turno: Turno = { texto, llamadas: [], pendiente: false, creada: false }
  if (sesion.tokens >= config.maxTokensSesion) return cerrar(turno, mensajeLimiteTokens(config))

  sesion.mensajes.push({ rol: "usuario", contenido: [{ tipo: "texto", texto }] })
  for (let iteracion = 0; iteracion < config.maxIter; iteracion++) {
    if (sesion.tokens >= config.maxTokensSesion) return cerrar(turno, mensajeLimiteTokens(config))
    let respuesta: RespuestaLlm
    try {
      respuesta = await config.llm.enviar([{ rol: "sistema", texto: config.sistema }, ...sesion.mensajes], definicionesHerramientas())
    } catch (error) {
      return cerrar(turno, error instanceof ErrorLlm ? error.message : "Ocurrió un error inesperado al consultar el modelo. Intenta de nuevo.")
    }
    sesion.tokens += tokensConsumidos(respuesta.uso)
    sesion.mensajes.push({ rol: "asistente", contenido: respuesta.contenido })

    const llamadas = respuesta.contenido.filter((b): b is BloqueLlamada => b.tipo === "llamada")
    if (respuesta.motivo !== "herramientas" || llamadas.length === 0) return cerrar(turno, textoFinal(respuesta))

    const resultados = await ejecutarTodas(llamadas, turno, sesion.id, config.directory)
    sesion.mensajes.push({ rol: "usuario", contenido: resultados })
  }
  return cerrar(turno, mensajeTopeIteraciones(turno, config.maxIter))
}

/** Ejecuta las llamadas en orden y devuelve todos los resultados juntos, como pide la API. */
async function ejecutarTodas(llamadas: BloqueLlamada[], turno: Turno, sessionId: string, directory: string): Promise<BloqueResultado[]> {
  const resultados: BloqueResultado[] = []
  for (const llamada of llamadas) {
    const respuesta = await ejecutarLlamada(llamada.nombre, llamada.args, { directory, sessionId }, turno.texto)
    turno.llamadas.push({ nombre: llamada.nombre, args: llamada.args, ok: respuesta.ok, resumen: resumir(respuesta) })
    turno.pendiente ||= dejaConfirmacionPendiente(llamada.nombre, respuesta)
    turno.creada ||= creoOrden(llamada.nombre, respuesta)
    resultados.push({ tipo: "resultado", idLlamada: llamada.id, contenido: JSON.stringify(respuesta), esError: !respuesta.ok })
  }
  return resultados
}

/** Lo leído de la caché cuesta ~10 % de la entrada normal, así que cuenta al 10 % para el tope de la sesión. */
const FACTOR_CACHE = 0.1

function tokensConsumidos(uso: RespuestaLlm["uso"]): number {
  return Math.round(uso.entrada + uso.entradaCache * FACTOR_CACHE + uso.salida)
}

function cerrar(turno: Turno, reply: string): ResultadoTurno {
  return { reply, toolCalls: turno.llamadas, needsConfirmation: turno.pendiente && !turno.creada }
}

function textoFinal(respuesta: RespuestaLlm): string {
  if (respuesta.motivo === "rechazo") return "El modelo declinó responder esta solicitud. Reformula el pedido, por favor."
  const texto = respuesta.contenido
    .filter((b): b is Extract<Bloque, { tipo: "texto" }> => b.tipo === "texto")
    .map((b) => b.texto)
    .join("\n")
    .trim()
  const corte = respuesta.motivo === "limite_tokens" ? "\n\n(La respuesta se cortó por longitud.)" : ""
  return (texto || "El modelo no devolvió texto. Intenta de nuevo.") + corte
}

function mensajeLimiteTokens(config: ConfigAgente): string {
  return `Esta sesión alcanzó el límite de ${config.maxTokensSesion} tokens y no acepta más mensajes. Abre una sesión nueva para continuar.`
}

function mensajeTopeIteraciones(turno: Turno, maxIter: number): string {
  const hechas = turno.llamadas.map((l) => `${l.nombre} (${l.ok ? "ok" : "falló"})`).join(", ") || "ninguna herramienta"
  const oc = turno.creada ? "La OC sí quedó creada." : "La OC no se creó en este turno."
  return `Llegué al tope de ${maxIter} pasos en este turno. Hecho: ${hechas}. ${oc} Pendiente: terminar el proceso; escribe "continúa" para seguir.`
}
