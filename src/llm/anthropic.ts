import Anthropic from "@anthropic-ai/sdk"
import { ErrorLlm } from "./adapter.ts"
import type { Bloque, HerramientaLlm, LlmAdapter, MensajeLlm, MotivoFin, RespuestaLlm } from "./adapter.ts"

const MODELO_POR_DEFECTO = "claude-haiku-5-5"
const TIEMPO_MAXIMO_MS = 60_000
const MAX_TOKENS_RESPUESTA = 16_000

/** Implementación de LlmAdapter con la API de Anthropic. La clave se lee de ANTHROPIC_API_KEY (nunca se registra). */
export class AnthropicAdapter implements LlmAdapter {
  readonly proveedor = "anthropic"
  readonly modelo = process.env.MODEL || MODELO_POR_DEFECTO
  private cliente: Anthropic | null = null

  async enviar(mensajes: MensajeLlm[], herramientas: HerramientaLlm[]): Promise<RespuestaLlm> {
    try {
      const respuesta = await this.obtenerCliente().messages.create({
        model: this.modelo,
        max_tokens: MAX_TOKENS_RESPUESTA,
        cache_control: { type: "ephemeral" },
        system: textoSistema(mensajes),
        messages: aMensajesAnthropic(mensajes),
        tools: herramientas.map(aHerramientaAnthropic),
      })
      return {
        contenido: respuesta.content.map(desdeBloqueAnthropic),
        motivo: motivoDe(respuesta.stop_reason),
        uso: usoDe(respuesta.usage),
      }
    } catch (error) {
      throw new ErrorLlm(mensajeDeError(error))
    }
  }

  /** El cliente se crea en el primer envío: si falta la clave, el servidor igual arranca y responde un error claro. */
  private obtenerCliente(): Anthropic {
    this.cliente ??= new Anthropic({ timeout: TIEMPO_MAXIMO_MS, maxRetries: 0 })
    return this.cliente
  }
}

// ---------- Conversión de ida ----------

function textoSistema(mensajes: MensajeLlm[]): string {
  return mensajes.flatMap((m) => (m.rol === "sistema" ? [m.texto] : [])).join("\n\n")
}

function aMensajesAnthropic(mensajes: MensajeLlm[]): Anthropic.MessageParam[] {
  return mensajes.flatMap((m): Anthropic.MessageParam[] => {
    if (m.rol === "sistema") return []
    const role = m.rol === "usuario" ? "user" : "assistant"
    return [{ role, content: m.contenido.map(aBloqueAnthropic) }]
  })
}

function aBloqueAnthropic(bloque: Bloque): Anthropic.ContentBlockParam {
  switch (bloque.tipo) {
    case "texto":
      return { type: "text", text: bloque.texto }
    case "llamada":
      return { type: "tool_use", id: bloque.id, name: bloque.nombre, input: bloque.args }
    case "resultado":
      return { type: "tool_result", tool_use_id: bloque.idLlamada, content: bloque.contenido, is_error: bloque.esError }
    case "opaco":
      // Solo este adaptador crea bloques opacos, a partir de bloques de Anthropic: se devuelven tal cual.
      return bloque.datos as Anthropic.ContentBlockParam
  }
}

function aHerramientaAnthropic(h: HerramientaLlm): Anthropic.Tool {
  return { name: h.nombre, description: h.descripcion, input_schema: { ...h.esquema, type: "object" } }
}

// ---------- Conversión de vuelta ----------

function desdeBloqueAnthropic(bloque: Anthropic.ContentBlock): Bloque {
  if (bloque.type === "text") return { tipo: "texto", texto: bloque.text }
  if (bloque.type === "tool_use") return { tipo: "llamada", id: bloque.id, nombre: bloque.name, args: bloque.input }
  return { tipo: "opaco", datos: bloque } // razonamiento u otros bloques del proveedor
}

function motivoDe(motivo: Anthropic.StopReason | null): MotivoFin {
  if (motivo === "tool_use") return "herramientas"
  if (motivo === "max_tokens" || motivo === "model_context_window_exceeded") return "limite_tokens"
  if (motivo === "refusal") return "rechazo"
  return "fin_turno"
}

function usoDe(uso: Anthropic.Usage): RespuestaLlm["uso"] {
  const entrada = uso.input_tokens + (uso.cache_creation_input_tokens ?? 0) + (uso.cache_read_input_tokens ?? 0)
  return { entrada, salida: uso.output_tokens }
}

/** Traduce el error del SDK a un mensaje en español. Nunca incluye la clave ni el detalle crudo del proveedor. */
function mensajeDeError(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "El modelo de lenguaje no respondió en 60 segundos. Intenta de nuevo en un momento."
  if (error instanceof Anthropic.AuthenticationError) return "El servidor no tiene una clave válida del proveedor de lenguaje. Revisa la configuración (ANTHROPIC_API_KEY)."
  if (error instanceof Anthropic.RateLimitError) return "El proveedor de lenguaje está limitando las solicitudes. Espera unos segundos e intenta de nuevo."
  if (error instanceof Anthropic.APIConnectionError) return "No se pudo conectar con el proveedor de lenguaje. Revisa la conexión e intenta de nuevo."
  if (error instanceof Anthropic.APIError) return `El proveedor de lenguaje devolvió un error (HTTP ${error.status ?? "desconocido"}). Intenta de nuevo.`
  return "No se pudo usar el proveedor de lenguaje. Revisa la configuración del servidor (ANTHROPIC_API_KEY y MODEL)."
}
