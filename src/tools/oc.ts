import { existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { DerivadosSchema, OrdenCompraSchema, PaqueteSchema } from "../domain/esquemas.ts"
import type { Derivados, OrdenCompra, Paquete, Validacion } from "../domain/esquemas.ts"
import { archivoEvidencia, construirEvidencia } from "../domain/evidencia.ts"
import { ejecutarHerramienta } from "../domain/herramienta.ts"
import type { Ctx, Exito } from "../domain/herramienta.ts"
import { buscarProveedor, cargarMaestros } from "../domain/maestros.ts"
import type { Maestros } from "../domain/maestros.ts"
import { leerPaquete } from "../domain/paquete.ts"
import { construirOrden } from "../domain/payload.ts"
import type { Trazabilidad } from "../domain/payload.ts"
import { MENSAJE_PENDIENTE_CONFIRMACION, registrarControl } from "../domain/registro.ts"
import type { ResultadoControl } from "../domain/registro.ts"
import { evaluarReglas } from "../domain/reglas.ts"
import { asegurarCarpeta, carpetaCaso, carpetaSalida, esNombreDeCasoValido, rutaRelativa } from "../domain/rutas.ts"
import { SapMock } from "../sap/mock.ts"

// Cada export de este archivo es una herramienta que el modelo ve como oc_<export>.

const casoArg = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, ej. sol-001")
const paqueteArg = PaqueteSchema.describe("Paquete normalizado tal como lo devolvió oc_leer_paquete")

const argsLeerPaquete = { caso: casoArg }
const argsValidar = { caso: casoArg, paquete: paqueteArg }
const argsConstruirPayload = {
  caso: casoArg,
  paquete: paqueteArg,
  derivados: DerivadosSchema.describe("Derivados tal como los devolvió oc_validar"),
}
const argsGenerarEvidencia = { caso: casoArg }
const argsCrear = {
  caso: casoArg,
  payload: OrdenCompraSchema.optional().describe("Payload devuelto por oc_construir_payload (se omite si el caso está bloqueado)"),
  confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente las confirmaciones pendientes"),
}

// ---------- Ayudas internas (no exportadas) ----------

function exigirCaso(directory: string, caso: string): void {
  if (!esNombreDeCasoValido(caso)) throw new Error(`"${caso}" no es un nombre de caso válido (ej. sol-001).`)
  if (!existsSync(carpetaCaso(directory, caso))) throw new Error(`No existe el caso "${caso}" en fixtures/reto-03/solicitudes/.`)
}

function codigos(validacion: Validacion, campo: "bloqueos" | "confirmaciones"): string[] {
  return validacion[campo].map((h) => h.codigo)
}

function resumenValidacion(v: Validacion): string {
  const lista = (codigosLista: string[]) => codigosLista.join(",") || "ninguno"
  return `apta=${v.apta} bloqueos=${lista(codigos(v, "bloqueos"))} confirmaciones=${lista(codigos(v, "confirmaciones"))} retroactiva=${v.retroactiva}`
}

/** Construye la orden a partir de un paquete y la valida de nuevo contra los maestros. */
function armarOrden(directory: string, caso: string, paquete: Paquete, derivados: Derivados, maestros: Maestros): { orden: OrdenCompra; trazabilidad: Trazabilidad } {
  const validacion = evaluarReglas(paquete, maestros)
  if (!validacion.apta) throw new Error(`No se construye el payload: hay bloqueos (${codigos(validacion, "bloqueos").join(", ")}). Resuélvelos primero.`)
  const { solicitud } = paquete
  const proveedor = buscarProveedor(maestros.proveedores, solicitud.proveedor_nit, solicitud.proveedor_nombre)
  if (!proveedor) throw new Error("Proveedor no encontrado en el maestro.")
  return construirOrden({
    paquete,
    derivados,
    proveedor,
    confirmaciones: validacion.confirmaciones,
    evidenciaSha256: construirEvidencia(directory, caso).sha256,
  })
}

function registrarIntento(directory: string, solicitudId: string, resultado: ResultadoControl, v: Validacion, numeroOc = ""): void {
  registrarControl(directory, {
    solicitud_id: solicitudId,
    resultado,
    numero_oc: numeroOc,
    retroactiva: v.retroactiva,
    bloqueos: codigos(v, "bloqueos"),
    confirmaciones: codigos(v, "confirmaciones"),
  })
}

type ResultadoCrear = { numero_oc: string; fecha: string | null; idempotente: boolean }

/** confirmado_por lo pone oc_crear, así que no cuenta al comparar el payload recibido con el esperado. */
function sinConfirmador(orden: OrdenCompra): OrdenCompra {
  return { ...orden, excepciones: orden.excepciones.map((e) => ({ ...e, confirmado_por: null })) }
}

function detalles(v: Validacion, campo: "bloqueos" | "confirmaciones"): string {
  return v[campo].map((h) => `${h.codigo}: ${h.detalle}`).join(" | ")
}

// ---------- Herramientas ----------

export const leer_paquete = {
  description: "Lee el paquete de un caso (correo, solicitud, cotización, aprobación y factura si existe) y lo devuelve normalizado.",
  args: argsLeerPaquete,
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    return ejecutarHerramienta("oc_leer_paquete", argsLeerPaquete, args, ctx, async ({ caso }) => {
      exigirCaso(ctx.directory, caso)
      const { paquete, faltantes } = leerPaquete(ctx.directory, caso)
      const resumen = faltantes.length ? `paquete leído; faltan: ${faltantes.join(", ")}` : "paquete completo leído"
      return { data: { ...paquete, faltantes }, resumen }
    })
  },
}

export const validar = {
  description: "Valida el paquete contra los maestros y las reglas RC1–RC10; devuelve apta, bloqueos, confirmaciones, derivados y retroactiva.",
  args: argsValidar,
  async execute(args: { caso: string; paquete: Paquete }, ctx: Ctx): Promise<string> {
    return ejecutarHerramienta("oc_validar", argsValidar, args, ctx, async ({ paquete }) => {
      const validacion = evaluarReglas(paquete, cargarMaestros(ctx.directory))
      return { data: validacion, resumen: resumenValidacion(validacion) }
    })
  },
}

export const construir_payload = {
  description: "Construye la orden de compra exactamente como quedaría en SAP y guarda la trazabilidad de cada valor en out/<caso>/trazabilidad.json.",
  args: argsConstruirPayload,
  async execute(args: { caso: string; paquete: Paquete; derivados: Derivados }, ctx: Ctx): Promise<string> {
    return ejecutarHerramienta("oc_construir_payload", argsConstruirPayload, args, ctx, async ({ caso, paquete, derivados }) => {
      exigirCaso(ctx.directory, caso)
      const { orden, trazabilidad } = armarOrden(ctx.directory, caso, paquete, derivados, cargarMaestros(ctx.directory))
      const ruta = path.join(asegurarCarpeta(carpetaSalida(ctx.directory, caso)), "trazabilidad.json")
      writeFileSync(ruta, JSON.stringify({ caso, fuentes: trazabilidad }, null, 2), "utf8")
      return { data: { payload: orden, trazabilidad: rutaRelativa(ctx.directory, ruta) }, resumen: `payload construido para ${orden.referencia.solicitud_id}` }
    })
  },
}

export const generar_evidencia = {
  description: "Genera out/<caso>/aprobacion.txt con el correo de aprobación (de, para, fecha, asunto, cuerpo) y su sha256.",
  args: argsGenerarEvidencia,
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    return ejecutarHerramienta("oc_generar_evidencia", argsGenerarEvidencia, args, ctx, async ({ caso }) => {
      exigirCaso(ctx.directory, caso)
      const evidencia = construirEvidencia(ctx.directory, caso)
      const ruta = path.join(asegurarCarpeta(carpetaSalida(ctx.directory, caso)), "aprobacion.txt")
      writeFileSync(ruta, archivoEvidencia(evidencia), "utf8")
      return { data: { ruta: rutaRelativa(ctx.directory, ruta), sha256: evidencia.sha256 }, resumen: `evidencia sha256=${evidencia.sha256.slice(0, 12)}…` }
    })
  },
}

export const crear = {
  description: "Crea la OC en SAP solo si el caso es apto y, si tiene confirmaciones, el usuario confirmó explícitamente (confirmado=true); es idempotente por solicitud.",
  args: argsCrear,
  async execute(args: { caso: string; payload?: OrdenCompra; confirmado?: boolean }, ctx: Ctx): Promise<string> {
    return ejecutarHerramienta("oc_crear", argsCrear, args, ctx, async ({ caso, payload, confirmado }): Promise<Exito<ResultadoCrear>> => {
      exigirCaso(ctx.directory, caso)
      // Se relee todo desde las fuentes: el modelo no puede cambiar montos ni saltarse reglas.
      const { paquete } = leerPaquete(ctx.directory, caso)
      const maestros = cargarMaestros(ctx.directory)
      const validacion = evaluarReglas(paquete, maestros)
      const solicitudId = paquete.solicitud.solicitud_id
      const sap = new SapMock(ctx.directory)

      const existente = await sap.buscarOrdenPorReferencia(solicitudId)
      if (existente) {
        registrarIntento(ctx.directory, solicitudId, "idempotente", validacion, existente.numero_oc)
        return { data: { numero_oc: existente.numero_oc, fecha: null, idempotente: true }, resumen: `ya existía OC ${existente.numero_oc}` }
      }
      if (!validacion.apta) {
        registrarIntento(ctx.directory, solicitudId, "bloqueada", validacion)
        throw new Error(`OC no creada, bloqueada por: ${detalles(validacion, "bloqueos")}`)
      }
      if (validacion.confirmaciones.length > 0 && confirmado !== true) {
        registrarIntento(ctx.directory, solicitudId, "pendiente_confirmacion", validacion)
        throw new Error(`${MENSAJE_PENDIENTE_CONFIRMACION}: ${detalles(validacion, "confirmaciones")} Pregunta al usuario y, si confirma, repite con confirmado=true.`)
      }
      if (!payload) throw new Error("Falta el payload: llama primero a oc_construir_payload.")

      const esperado = armarOrden(ctx.directory, caso, paquete, validacion.derivados, maestros).orden
      if (JSON.stringify(sinConfirmador(payload)) !== JSON.stringify(sinConfirmador(esperado))) {
        throw new Error("El payload no coincide con el construido desde las fuentes. Vuelve a llamar a oc_construir_payload y usa su resultado sin cambios.")
      }
      const confirmadoPor = `analista (sesión ${ctx.sessionId})`
      const orden: OrdenCompra = { ...esperado, excepciones: esperado.excepciones.map((e) => ({ ...e, confirmado_por: confirmadoPor })) }
      const creada = await sap.crearOrden(orden)
      registrarIntento(ctx.directory, solicitudId, "creada", validacion, creada.numero_oc)
      return { data: { ...creada, idempotente: false }, resumen: `OC ${creada.numero_oc} creada` }
    })
  },
}
