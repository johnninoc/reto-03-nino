import { z } from "zod"
import type { Ctx } from "../domain/herramienta.ts"
import { registrarLlamada } from "../domain/registro.ts"
import type { HerramientaLlm } from "../llm/adapter.ts"
import * as oc from "../tools/oc.ts"
import { esConfirmacion } from "./confirmacion.ts"

type Herramienta = {
  description: string
  args: z.ZodRawShape
  execute(args: Record<string, unknown>, ctx: Ctx): Promise<string>
}

/** Archivos de herramientas: cada export de src/tools/<archivo>.ts se publica como <archivo>_<export>. */
const ARCHIVOS: Record<string, Record<string, Herramienta>> = { oc }

const HERRAMIENTAS = new Map<string, Herramienta>(
  Object.entries(ARCHIVOS).flatMap(([archivo, exportados]) =>
    Object.entries(exportados).map(([nombre, h]): [string, Herramienta] => [`${archivo}_${nombre}`, h]),
  ),
)

export const RespuestaHerramientaSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
])
export type RespuestaHerramienta = z.infer<typeof RespuestaHerramientaSchema>

/** Definiciones para el modelo: nombre, descripción y JSON Schema generado desde los args zod. */
export function definicionesHerramientas(): HerramientaLlm[] {
  return [...HERRAMIENTAS].map(([nombre, h]) => ({ nombre, descripcion: h.description, esquema: esquemaJson(h.args) }))
}

function esquemaJson(args: z.ZodRawShape): Record<string, unknown> {
  const { $schema: _omitido, ...esquema } = z.toJSONSchema(z.object(args), { io: "input" })
  return esquema
}

function fallo(error: string): RespuestaHerramienta {
  return { ok: false, error }
}

function registrarFallo(ctx: Ctx, nombre: string, args: unknown, error: string): void {
  const caso = z.object({ caso: z.string() }).safeParse(args)
  try {
    registrarLlamada(ctx.directory, { herramienta: nombre, caso: caso.success ? caso.data.caso : "", ok: false, resumen: error })
  } catch {
    // si el log falla, el error igual vuelve al modelo
  }
}

function leerRespuesta(texto: string): RespuestaHerramienta {
  const inesperada = fallo("La herramienta devolvió una respuesta con formato inesperado.")
  try {
    const resultado = RespuestaHerramientaSchema.safeParse(JSON.parse(texto))
    return resultado.success ? resultado.data : inesperada
  } catch {
    return inesperada
  }
}

/**
 * Ejecuta una llamada del modelo: valida los args con zod (si fallan, el error vuelve al modelo)
 * y aplica la salvaguarda de confirmación de oc_crear.
 */
export async function ejecutarLlamada(nombre: string, argsCrudos: unknown, ctx: Ctx, ultimoMensajeUsuario: string): Promise<RespuestaHerramienta> {
  const herramienta = HERRAMIENTAS.get(nombre)
  if (!herramienta) return fallo(`La herramienta "${nombre}" no existe.`)

  const validacion = z.object(herramienta.args).safeParse(argsCrudos)
  if (!validacion.success) {
    const error = `Argumentos inválidos: ${validacion.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}`
    registrarFallo(ctx, nombre, argsCrudos, error)
    return fallo(error)
  }

  const forzarSinConfirmar = nombre === "oc_crear" && validacion.data.confirmado === true && !esConfirmacion(ultimoMensajeUsuario)
  const args = forzarSinConfirmar ? { ...validacion.data, confirmado: false } : validacion.data
  const respuesta = leerRespuesta(await herramienta.execute(args, ctx))
  if (forzarSinConfirmar && !respuesta.ok) {
    return fallo(`Requiere confirmación explícita: el último mensaje del usuario no confirma, así que se ignoró confirmado=true. ${respuesta.error}`)
  }
  return respuesta
}
