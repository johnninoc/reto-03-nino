// Ejecuta los 6 casos llamando directamente a las herramientas, sin modelo de lenguaje.
import { rmSync } from "node:fs"
import path from "node:path"
import type { Derivados, OrdenCompra, Paquete, Validacion } from "./src/domain/esquemas.ts"
import type { Ctx, Respuesta } from "./src/domain/herramienta.ts"
import { construir_payload, crear, generar_evidencia, leer_paquete, validar } from "./src/tools/oc.ts"

const ctx: Ctx = { directory: import.meta.dir, sessionId: "demo" }

type ResultadoCrear = { numero_oc: string; fecha: string | null; idempotente: boolean }

/** Las herramientas devuelven texto JSON; aquí se convierte de vuelta a objeto. */
async function llamar<T>(respuesta: Promise<string>): Promise<Respuesta<T>> {
  return JSON.parse(await respuesta) as Respuesta<T>
}

function codigos(v: Validacion, campo: "bloqueos" | "confirmaciones"): string {
  return v[campo].map((h) => h.codigo).join(",") || "-"
}

function describirCreacion(r: Respuesta<ResultadoCrear>, v: Validacion): string {
  if (!r.ok) return v.apta ? "OC no creada (pendiente de confirmación)" : "OC no creada (bloqueada)"
  return r.data.idempotente ? `OC ${r.data.numero_oc} (idempotente: true)` : `OC ${r.data.numero_oc} creada`
}

async function procesar(caso: string, confirmado = false): Promise<void> {
  const leido = await llamar<Paquete>(leer_paquete.execute({ caso }, ctx))
  if (!leido.ok) return console.log(`${caso} | error al leer: ${leido.error}`)

  const validado = await llamar<Validacion>(validar.execute({ caso, paquete: leido.data }, ctx))
  if (!validado.ok) return console.log(`${caso} | error al validar: ${validado.error}`)
  const v = validado.data

  const construido = await llamar<{ payload: OrdenCompra }>(construir_payload.execute({ caso, paquete: leido.data, derivados: v.derivados }, ctx))
  await generar_evidencia.execute({ caso }, ctx)
  const payload = construido.ok ? construido.data.payload : undefined
  const creacion = await llamar<ResultadoCrear>(crear.execute({ caso, payload, confirmado }, ctx))

  const etiqueta = confirmado ? `${caso} (confirmado)` : caso
  console.log([etiqueta, `apta=${v.apta}`, `bloqueos=${codigos(v, "bloqueos")}`, `confirmaciones=${codigos(v, "confirmaciones")}`, `retroactiva=${v.retroactiva}`, describirCreacion(creacion, v)].join(" | "))
  for (const h of [...v.bloqueos, ...v.confirmaciones]) console.log(`    ${h.codigo}: ${h.detalle}`)
  if (Object.keys(v.derivados).length) console.log(`    derivados: ${formatearDerivados(v.derivados)}`)
}

function formatearDerivados(d: Derivados): string {
  return Object.entries(d).map(([campo, valor]) => `${campo}=${valor}`).join(", ")
}

async function main(): Promise<void> {
  rmSync(path.join(ctx.directory, "out"), { recursive: true, force: true })
  for (const caso of ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]) await procesar(caso)
  console.log("\n-- Idempotencia: sol-001 otra vez --")
  await procesar("sol-001")
  console.log("\n-- Confirmación explícita: sol-004 con confirmado=true --")
  await procesar("sol-004", true)
  console.log("\nSalidas en out/: control.csv, log.jsonl, sap/ordenes.jsonl, <caso>/aprobacion.txt, <caso>/trazabilidad.json")
}

await main()
