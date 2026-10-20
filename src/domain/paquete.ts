import path from "node:path"
import type { z } from "zod"
import { AprobacionArchivoSchema, CorreoArchivoSchema, SolicitudSchema } from "./esquemas.ts"
import type { Cotizacion, Factura, Paquete } from "./esquemas.ts"
import { carpetaCaso, leerTextoSiExiste } from "./rutas.ts"

export type ResultadoLectura = { paquete: Paquete; faltantes: string[] }

/** Lee y normaliza el paquete (PRD 7.2). Lanza un Error legible si falta o está mal la solicitud o el correo. */
export function leerPaquete(directory: string, caso: string): ResultadoLectura {
  const carpeta = carpetaCaso(directory, caso)
  const leer = (archivo: string) => leerTextoSiExiste(path.join(carpeta, archivo))
  const faltantes: string[] = []
  const marcarFaltante = <T>(archivo: string, valor: T | null): T | null => {
    if (valor === null) faltantes.push(archivo)
    return valor
  }

  const correo = leerJsonObligatorio("correo.json", leer("correo.json"), CorreoArchivoSchema)
  const solicitud = leerJsonObligatorio("solicitud.json", leer("solicitud.json"), SolicitudSchema)
  const cotizacionTexto = marcarFaltante("cotizacion.txt", leer("cotizacion.txt"))
  const aprobacionTexto = marcarFaltante("aprobacion.json", leer("aprobacion.json"))
  const facturaTexto = leer("factura.txt") // la factura es opcional: no se reporta como faltante

  const paquete: Paquete = {
    correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
    solicitud,
    cotizacion: cotizacionTexto === null ? null : parsearCotizacion(cotizacionTexto),
    aprobacion: aprobacionTexto === null ? null : normalizarAprobacion(aprobacionTexto),
    factura: facturaTexto === null ? null : parsearFactura(facturaTexto),
  }
  return { paquete, faltantes }
}

function leerJsonObligatorio<T extends z.ZodType>(archivo: string, texto: string | null, esquema: T): z.infer<T> {
  if (texto === null) throw new Error(`Falta ${archivo} en el paquete. Pídelo al solicitante.`)
  return parsearJson(archivo, texto, esquema)
}

export function parsearJson<T extends z.ZodType>(archivo: string, texto: string, esquema: T): z.infer<T> {
  let datos: unknown
  try {
    datos = JSON.parse(texto)
  } catch {
    throw new Error(`${archivo} no es un JSON válido. Pide al solicitante que lo reenvíe.`)
  }
  const resultado = esquema.safeParse(datos)
  if (!resultado.success) {
    const campos = resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`${archivo} tiene campos inválidos (${campos}).`)
  }
  return resultado.data
}

function normalizarAprobacion(texto: string): NonNullable<Paquete["aprobacion"]> {
  const archivo = parsearJson("aprobacion.json", texto, AprobacionArchivoSchema)
  return {
    de: archivo.de,
    fecha: archivo.fecha,
    aprobado: archivo.cuerpo.toLowerCase().includes("aprobado"),
    texto: archivo.cuerpo,
  }
}

// ---------- Texto de cotización y factura ----------

/** Busca "Etiqueta: valor" al inicio de una línea y devuelve el valor. */
function campo(texto: string, etiqueta: RegExp): string | null {
  const linea = texto.split(/\r?\n/).find((l) => etiqueta.test(l))
  if (!linea) return null
  return linea.slice(linea.indexOf(":") + 1).trim()
}

/** "900.555.111-2" → "900555111" (sin dígito de verificación). */
function limpiarNit(nit: string): string {
  return nit.split("-")[0]!.replace(/\D/g, "")
}

/** "COP 11.400.000" → { moneda: "COP", valor: 11400000 }. Punto = miles, coma = decimales. */
function parsearMonto(texto: string): { moneda: string; valor: number } | null {
  const coincidencia = texto.match(/([A-Z]{3})\s*([\d.,]+)/)
  if (!coincidencia) return null
  const valor = Number(coincidencia[2]!.replace(/\./g, "").replace(",", "."))
  return Number.isFinite(valor) ? { moneda: coincidencia[1]!, valor } : null
}

function sumarDias(fecha: string, dias: number): string {
  const fechaBase = new Date(`${fecha}T00:00:00Z`)
  fechaBase.setUTCDate(fechaBase.getUTCDate() + dias)
  return fechaBase.toISOString().slice(0, 10)
}

function calcularValidez(texto: string): string | null {
  const fecha = campo(texto, /^Fecha:/)
  const dias = campo(texto, /^Validez/)?.match(/\d+/)?.[0]
  if (!fecha || !dias) return null
  return sumarDias(fecha, Number(dias))
}

export function parsearCotizacion(texto: string): Cotizacion {
  const total = parsearMonto(campo(texto, /^TOTAL/) ?? "")
  if (!total) throw new Error("cotizacion.txt no tiene un TOTAL numérico. Pide al proveedor una cotización legible.")
  const nit = campo(texto, /^NIT:/)
  return {
    proveedor: campo(texto, /^Proveedor:/) ?? "",
    nit: nit ? limpiarNit(nit) : null,
    total: total.valor,
    moneda: total.moneda,
    validez_hasta: calcularValidez(texto),
    texto,
  }
}

/** Número de la cotización: "COTIZACIÓN COT-TS-2026-0451" → "COT-TS-2026-0451". */
export function referenciaCotizacion(texto: string): string | null {
  return texto.match(/^COTIZACI[OÓ]N\s+(\S+)/m)?.[1] ?? null
}

export function parsearFactura(texto: string): Factura {
  const total = parsearMonto(campo(texto, /^TOTAL/) ?? "")
  const fecha = campo(texto, /^Fecha/)
  if (!total || !fecha) throw new Error("factura.txt no tiene fecha o TOTAL legibles.")
  return {
    numero: texto.match(/No\.\s*(\S+)/)?.[1] ?? "",
    fecha,
    total: total.valor,
  }
}
