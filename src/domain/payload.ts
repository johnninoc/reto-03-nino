import type { Derivados, Hallazgo, OrdenCompra, Paquete, Proveedor } from "./esquemas.ts"
import { OrdenCompraSchema } from "./esquemas.ts"
import { referenciaCotizacion } from "./paquete.ts"

const LARGO_TEXTO_BREVE = 40 // límite SAP para el texto breve de la posición

/** Fuente de cada valor del payload (HU-3). */
export type Trazabilidad = Record<string, string>

type Entrada = {
  paquete: Paquete
  derivados: Derivados
  proveedor: Proveedor
  confirmaciones: Hallazgo[]
  evidenciaSha256: string
}

/** "H" si la descripción habla de horas; si no, "UN". */
function unidadDe(descripcion: string): "H" | "UN" {
  return /\bhoras?\b/i.test(descripcion) ? "H" : "UN"
}

function textoBreve(descripcion: string): string {
  return descripcion.slice(0, LARGO_TEXTO_BREVE).trimEnd()
}

function exigir<T>(valor: T | undefined, mensaje: string): T {
  if (valor === undefined) throw new Error(mensaje)
  return valor
}

export function construirOrden(e: Entrada): { orden: OrdenCompra; trazabilidad: Trazabilidad } {
  const { solicitud, correo, cotizacion, aprobacion } = e.paquete
  if (!aprobacion) throw new Error("Sin aprobación no se puede construir el payload.")
  const indicadorIva = exigir(solicitud.indicador_iva ?? e.derivados.indicador_iva, "Falta indicador de IVA (ni en la solicitud ni derivado).")
  const condicionesPago = exigir(solicitud.condiciones_pago ?? e.derivados.condiciones_pago, "Faltan condiciones de pago (ni en la solicitud ni derivadas).")

  const orden = OrdenCompraSchema.parse({
    referencia: {
      solicitud_id: solicitud.solicitud_id,
      correo_id: correo.id,
      cotizacion_ref: cotizacion ? referenciaCotizacion(cotizacion.texto) : null,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: e.proveedor.codigo_sap, nit: e.proveedor.nit, nombre: e.proveedor.nombre },
    moneda: solicitud.moneda,
    condiciones_pago: condicionesPago,
    aprobador: { email: aprobacion.de, fecha_aprobacion: aprobacion.fecha, evidencia_sha256: e.evidenciaSha256 },
    posiciones: [
      {
        numero: 10,
        descripcion: textoBreve(solicitud.descripcion),
        cantidad: solicitud.cantidad,
        unidad: unidadDe(solicitud.descripcion),
        precio_unitario: solicitud.valor_unitario,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva: indicadorIva,
      },
    ],
    excepciones: e.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  })
  return { orden, trazabilidad: trazar(e.paquete) }
}

function trazar(paquete: Paquete): Trazabilidad {
  const { solicitud } = paquete
  return {
    "referencia.solicitud_id": "solicitud",
    "referencia.correo_id": "correo",
    "referencia.cotizacion_ref": paquete.cotizacion ? "cotizacion" : "derivado",
    sociedad: "derivado",
    organizacion_compras: "derivado",
    "proveedor.codigo_sap": "maestro.proveedores",
    "proveedor.nit": "maestro.proveedores",
    "proveedor.nombre": "maestro.proveedores",
    moneda: "solicitud",
    condiciones_pago: solicitud.condiciones_pago ? "solicitud" : "derivado",
    "aprobador.email": "aprobacion",
    "aprobador.fecha_aprobacion": "aprobacion",
    "aprobador.evidencia_sha256": "derivado",
    "posiciones[0].numero": "derivado",
    "posiciones[0].descripcion": "solicitud",
    "posiciones[0].cantidad": "solicitud",
    "posiciones[0].unidad": "derivado",
    "posiciones[0].precio_unitario": "solicitud",
    "posiciones[0].centro_costo": "solicitud",
    "posiciones[0].subarea": "solicitud",
    "posiciones[0].indicador_iva": solicitud.indicador_iva ? "solicitud" : "derivado",
    excepciones: "derivado",
  }
}
