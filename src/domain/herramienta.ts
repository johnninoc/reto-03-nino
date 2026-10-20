import { z } from "zod"
import { registrarLlamada } from "./registro.ts"

export type Ctx = { directory: string; sessionId: string }

export type Respuesta<T> = { ok: true; data: T } | { ok: false; error: string }

/** Lo que devuelve el cuerpo de una herramienta: los datos y una frase para el log. */
export type Exito<T> = { data: T; resumen: string }

function mensajeDeError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")
  if (error instanceof Error) return error.message
  return String(error)
}

function casoDe(args: unknown): string {
  if (typeof args === "object" && args !== null && "caso" in args && typeof args.caso === "string") return args.caso
  return ""
}

/**
 * Envoltura común de todas las herramientas: valida los argumentos con zod, ejecuta el cuerpo,
 * nunca lanza, registra la llamada en out/log.jsonl y devuelve el JSON { ok, data | error }.
 */
export async function ejecutarHerramienta<S extends z.ZodRawShape, T>(
  nombre: string,
  esquema: S,
  args: unknown,
  ctx: Ctx,
  cuerpo: (args: z.infer<z.ZodObject<S>>) => Promise<Exito<T>>,
): Promise<string> {
  let respuesta: Respuesta<T>
  let resumen: string
  try {
    const resultado = await cuerpo(z.object(esquema).parse(args))
    respuesta = { ok: true, data: resultado.data }
    resumen = resultado.resumen
  } catch (error) {
    respuesta = { ok: false, error: mensajeDeError(error) }
    resumen = respuesta.error
  }
  try {
    registrarLlamada(ctx.directory, { herramienta: nombre, caso: casoDe(args), ok: respuesta.ok, resumen })
  } catch {
    // si el log falla no se pierde la respuesta de la herramienta
  }
  return JSON.stringify(respuesta)
}
