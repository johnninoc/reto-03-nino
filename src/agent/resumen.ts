import { z } from "zod"
import { MENSAJE_PENDIENTE_CONFIRMACION } from "../domain/registro.ts"
import type { RespuestaHerramienta } from "./herramientas.ts"

const LARGO_MAXIMO = 220

const ValidacionSchema = z.object({
  apta: z.boolean(),
  bloqueos: z.array(z.object({ codigo: z.string() })),
  confirmaciones: z.array(z.object({ codigo: z.string() })),
  retroactiva: z.boolean(),
})
const OcSchema = z.object({ numero_oc: z.string(), idempotente: z.boolean() })
const EvidenciaSchema = z.object({ ruta: z.string(), sha256: z.string() })
const PayloadSchema = z.object({ payload: z.unknown(), trazabilidad: z.string() })
const PaqueteSchema = z.object({ solicitud: z.object({ solicitud_id: z.string() }), faltantes: z.array(z.string()) })

function codigos(lista: Array<{ codigo: string }>): string {
  return lista.map((h) => h.codigo).join(", ") || "ninguna"
}

function recortar(texto: string): string {
  return texto.length > LARGO_MAXIMO ? `${texto.slice(0, LARGO_MAXIMO)}…` : texto
}

/** Frase corta para mostrar en el chat qué devolvió una herramienta. */
export function resumir(respuesta: RespuestaHerramienta): string {
  if (!respuesta.ok) return recortar(respuesta.error)
  const data = respuesta.data
  const validacion = ValidacionSchema.safeParse(data)
  if (validacion.success) {
    const v = validacion.data
    return `apta: ${v.apta ? "sí" : "no"} · bloqueos: ${codigos(v.bloqueos)} · confirmaciones: ${codigos(v.confirmaciones)} · retroactiva: ${v.retroactiva ? "sí" : "no"}`
  }
  const oc = OcSchema.safeParse(data)
  if (oc.success) return oc.data.idempotente ? `OC ${oc.data.numero_oc} (ya existía)` : `OC ${oc.data.numero_oc} creada`
  const evidencia = EvidenciaSchema.safeParse(data)
  if (evidencia.success) return `evidencia en ${evidencia.data.ruta}`
  const payload = PayloadSchema.safeParse(data)
  if (payload.success) return `payload construido · trazabilidad en ${payload.data.trazabilidad}`
  const paquete = PaqueteSchema.safeParse(data)
  if (paquete.success) {
    const faltan = paquete.data.faltantes.length ? ` · faltan: ${paquete.data.faltantes.join(", ")}` : ""
    return `paquete ${paquete.data.solicitud.solicitud_id} leído${faltan}`
  }
  return "ok"
}

/** true si la herramienta dejó confirmaciones pendientes (validación apta con confirmaciones, o oc_crear sin confirmar). */
export function dejaConfirmacionPendiente(nombre: string, respuesta: RespuestaHerramienta): boolean {
  if (nombre === "oc_crear") return !respuesta.ok && respuesta.error.includes(MENSAJE_PENDIENTE_CONFIRMACION)
  if (nombre !== "oc_validar" || !respuesta.ok) return false
  const validacion = ValidacionSchema.safeParse(respuesta.data)
  return validacion.success && validacion.data.apta && validacion.data.confirmaciones.length > 0
}

export function creoOrden(nombre: string, respuesta: RespuestaHerramienta): boolean {
  return nombre === "oc_crear" && respuesta.ok
}
