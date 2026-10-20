import { appendFileSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { cargarMaestros } from "../domain/maestros.ts"
import { asegurarCarpeta, carpetaSalida } from "../domain/rutas.ts"
import type { OrdenCompra, SapAdapter } from "./adapter.ts"

const PRIMER_NUMERO_OC = 4500000001

type OrdenGuardada = { numero_oc: string; fecha: string; solicitud_id: string; orden: OrdenCompra }

/** SAP simulado: cada orden es una línea de out/sap/ordenes.jsonl. */
export class SapMock implements SapAdapter {
  private readonly archivo: string

  constructor(private readonly directory: string) {
    this.archivo = path.join(carpetaSalida(directory, "sap"), "ordenes.jsonl")
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const proveedor = cargarMaestros(this.directory).proveedores.find((p) => p.nit === nit)
    return proveedor ? { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo } : null
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const existente = this.buscar(orden.referencia.solicitud_id)
    if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha }

    const nueva: OrdenGuardada = {
      numero_oc: String(PRIMER_NUMERO_OC + this.leerOrdenes().length),
      fecha: new Date().toISOString().slice(0, 10),
      solicitud_id: orden.referencia.solicitud_id,
      orden,
    }
    asegurarCarpeta(path.dirname(this.archivo))
    appendFileSync(this.archivo, JSON.stringify(nueva) + "\n", "utf8")
    return { numero_oc: nueva.numero_oc, fecha: nueva.fecha }
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const existente = this.buscar(solicitud_id)
    return existente ? { numero_oc: existente.numero_oc } : null
  }

  private buscar(solicitud_id: string): OrdenGuardada | null {
    return this.leerOrdenes().find((o) => o.solicitud_id === solicitud_id) ?? null
  }

  private leerOrdenes(): OrdenGuardada[] {
    if (!existsSync(this.archivo)) return []
    return readFileSync(this.archivo, "utf8")
      .split("\n")
      .filter((linea) => linea.trim() !== "")
      .map((linea) => JSON.parse(linea) as OrdenGuardada)
  }
}
