import { readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { CentroCostoSchema, CodigoSchema, ProveedorSchema } from "./esquemas.ts"
import type { CentroCosto, Proveedor } from "./esquemas.ts"
import { carpetaMaestros } from "./rutas.ts"

export type Maestros = {
  proveedores: Proveedor[]
  centrosCosto: CentroCosto[]
  indicadoresIva: z.infer<typeof CodigoSchema>[]
  condicionesPago: z.infer<typeof CodigoSchema>[]
}

function leerMaestro<T extends z.ZodType>(directory: string, archivo: string, esquema: T): z.infer<T> {
  const texto = readFileSync(path.join(carpetaMaestros(directory), archivo), "utf8")
  return esquema.parse(JSON.parse(texto))
}

/** Lee los cuatro maestros. Lanza si alguno falta o está mal formado (las herramientas lo capturan). */
export function cargarMaestros(directory: string): Maestros {
  return {
    proveedores: leerMaestro(directory, "proveedores.json", z.array(ProveedorSchema)),
    centrosCosto: leerMaestro(directory, "centros-costo.json", z.array(CentroCostoSchema)),
    indicadoresIva: leerMaestro(directory, "indicadores-iva.json", z.array(CodigoSchema)),
    condicionesPago: leerMaestro(directory, "condiciones-pago.json", z.array(CodigoSchema)),
  }
}

/** Minúsculas, sin tildes, sin puntuación y con espacios simples: "Cloud Andina S.A.S." → "cloud andina sas". */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Busca por NIT si lo hay; si no, por nombre normalizado. */
export function buscarProveedor(proveedores: Proveedor[], nit: string | undefined, nombre: string): Proveedor | null {
  if (nit) return proveedores.find((p) => p.nit === nit) ?? null
  const buscado = normalizarNombre(nombre)
  return proveedores.find((p) => normalizarNombre(p.nombre) === buscado) ?? null
}

export function buscarCentro(centros: CentroCosto[], centro: string): CentroCosto | null {
  return centros.find((c) => c.centro_costo === centro) ?? null
}
