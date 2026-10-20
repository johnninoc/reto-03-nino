// Interfaz neutral del proveedor de lenguaje. El ciclo del agente solo conoce estos tipos;
// cambiar de proveedor es escribir otra implementación de LlmAdapter.

export type BloqueTexto = { tipo: "texto"; texto: string }
export type BloqueLlamada = { tipo: "llamada"; id: string; nombre: string; args: unknown }
export type BloqueResultado = { tipo: "resultado"; idLlamada: string; contenido: string; esError: boolean }
/** Bloque propio del proveedor (ej. razonamiento) que se devuelve sin cambios en el siguiente envío. */
export type BloqueOpaco = { tipo: "opaco"; datos: unknown }

export type Bloque = BloqueTexto | BloqueLlamada | BloqueResultado | BloqueOpaco

export type MensajeLlm =
  | { rol: "sistema"; texto: string }
  | { rol: "usuario"; contenido: Bloque[] }
  | { rol: "asistente"; contenido: Bloque[] }

export type HerramientaLlm = {
  nombre: string
  descripcion: string
  esquema: Record<string, unknown> // JSON Schema de los argumentos
}

export type MotivoFin = "fin_turno" | "herramientas" | "limite_tokens" | "rechazo"

export type RespuestaLlm = {
  contenido: Bloque[]
  motivo: MotivoFin
  uso: { entrada: number; salida: number }
}

/** Error del proveedor con un mensaje en español apto para mostrar al usuario. */
export class ErrorLlm extends Error {}

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: MensajeLlm[], herramientas: HerramientaLlm[]): Promise<RespuestaLlm>
}
