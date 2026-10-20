import { z } from "zod"

// ---------- Fixtures del caso (PRD 7.1) ----------

export const SolicitudSchema = z.object({
  solicitud_id: z.string().describe("Identificador de la solicitud, ej. SOL-2026-001"),
  solicitante: z.string().describe("Nombre de quien pide la compra"),
  proveedor_nombre: z.string().describe("Nombre del proveedor según la solicitud"),
  proveedor_nit: z.string().optional().describe("NIT del proveedor sin dígito de verificación"),
  descripcion: z.string().describe("Descripción de la compra"),
  centro_costo: z.string().describe("Centro de costo, ej. CC-1010"),
  subarea: z.string().describe("Subárea dentro del centro de costo"),
  cantidad: z.number().describe("Cantidad solicitada"),
  valor_unitario: z.number().describe("Valor unitario"),
  valor_total: z.number().describe("Valor total de la solicitud"),
  moneda: z.string().describe("Moneda, ej. COP"),
  indicador_iva: z.string().optional().describe("Código de IVA, ej. C1"),
  condiciones_pago: z.string().optional().describe("Código de condiciones de pago, ej. Z030"),
  fecha_solicitud: z.string().describe("Fecha de la solicitud AAAA-MM-DD"),
})
export type Solicitud = z.infer<typeof SolicitudSchema>

export const CorreoArchivoSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
})

export const AprobacionArchivoSchema = z.object({
  de: z.string(),
  para: z.string(),
  fecha: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
})
export type AprobacionArchivo = z.infer<typeof AprobacionArchivoSchema>

// ---------- Paquete normalizado (PRD 7.2) ----------

export const PaqueteSchema = z.object({
  correo: z
    .object({
      id: z.string().describe("Id del correo"),
      de: z.string().describe("Remitente"),
      asunto: z.string().describe("Asunto"),
      fecha: z.string().describe("Fecha ISO del correo"),
    })
    .describe("Correo que trajo el paquete"),
  solicitud: SolicitudSchema.describe("Solicitud de compra normalizada"),
  cotizacion: z
    .object({
      proveedor: z.string().describe("Proveedor según la cotización"),
      nit: z.string().nullable().describe("NIT sin dígito de verificación"),
      total: z.number().describe("Total de la cotización"),
      moneda: z.string().describe("Moneda del total"),
      validez_hasta: z.string().nullable().describe("Fecha AAAA-MM-DD hasta la que es válida"),
      texto: z.string().describe("Texto completo de la cotización"),
    })
    .nullable()
    .describe("Cotización del proveedor, null si falta"),
  aprobacion: z
    .object({
      de: z.string().describe("Correo de quien aprueba"),
      fecha: z.string().describe("Fecha ISO de la aprobación"),
      aprobado: z.boolean().describe("true si el cuerpo contiene 'aprobado'"),
      texto: z.string().describe("Cuerpo del correo de aprobación"),
    })
    .nullable()
    .describe("Correo de aprobación del líder, null si falta"),
  factura: z
    .object({
      numero: z.string().describe("Número de la factura"),
      fecha: z.string().describe("Fecha de emisión AAAA-MM-DD"),
      total: z.number().describe("Total de la factura"),
    })
    .nullable()
    .describe("Factura del proveedor, solo si ya llegó"),
})
export type Paquete = z.infer<typeof PaqueteSchema>
export type Cotizacion = NonNullable<Paquete["cotizacion"]>
export type Factura = NonNullable<Paquete["factura"]>

// ---------- Maestros (PRD 7.1) ----------

export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
export type Proveedor = z.infer<typeof ProveedorSchema>

export const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), tope: z.number() })),
})
export type CentroCosto = z.infer<typeof CentroCostoSchema>

export const CodigoSchema = z.object({ codigo: z.string(), descripcion: z.string() })

// ---------- Resultado de validación (PRD 7.3) ----------

export const HallazgoSchema = z.object({
  codigo: z.string().describe("Regla que lo genera, ej. RC5"),
  detalle: z.string().describe("Explicación con los valores comparados"),
})
export type Hallazgo = z.infer<typeof HallazgoSchema>

export const DerivadosSchema = z.object({
  indicador_iva: z.string().optional().describe("Indicador de IVA tomado del maestro de proveedores"),
  condiciones_pago: z.string().optional().describe("Condiciones de pago tomadas del maestro de proveedores"),
})
export type Derivados = z.infer<typeof DerivadosSchema>

export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  reglas_cumplidas: string[] // códigos RC evaluados sin bloqueo ni confirmación
  derivados: Derivados
  retroactiva: boolean
}

// ---------- Orden de compra (PRD 7.4) ----------

export const OrdenCompraSchema = z.object({
  referencia: z
    .object({
      solicitud_id: z.string().describe("Id de la solicitud"),
      correo_id: z.string().describe("Id del correo"),
      cotizacion_ref: z.string().nullable().describe("Número de la cotización"),
    })
    .describe("Referencias al paquete de origen"),
  sociedad: z.literal("1000").describe("Sociedad SAP"),
  organizacion_compras: z.literal("1000").describe("Organización de compras SAP"),
  proveedor: z
    .object({
      codigo_sap: z.string().describe("Código SAP del proveedor"),
      nit: z.string().describe("NIT del proveedor"),
      nombre: z.string().describe("Nombre del proveedor"),
    })
    .describe("Proveedor según el maestro"),
  moneda: z.enum(["COP", "USD"]).describe("Moneda de la orden"),
  condiciones_pago: z.string().describe("Código de condiciones de pago, ej. Z030"),
  aprobador: z
    .object({
      email: z.string().describe("Correo del aprobador"),
      fecha_aprobacion: z.string().describe("Fecha ISO de la aprobación"),
      evidencia_sha256: z.string().describe("sha256 de la evidencia de aprobación"),
    })
    .describe("Aprobación que sustenta la orden"),
  posiciones: z
    .array(
      z.object({
        numero: z.number().describe("Número de posición: 10, 20, 30..."),
        descripcion: z.string().max(40).describe("Texto breve, máximo 40 caracteres"),
        cantidad: z.number().describe("Cantidad"),
        unidad: z.enum(["UN", "H", "MES"]).describe("Unidad de medida"),
        precio_unitario: z.number().describe("Precio unitario"),
        centro_costo: z.string().describe("Centro de costo"),
        subarea: z.string().describe("Subárea"),
        indicador_iva: z.string().describe("Código de IVA, ej. C1"),
      }),
    )
    .min(1)
    .describe("Posiciones de la orden"),
  excepciones: z
    .array(
      z.object({
        codigo: z.string().describe("Regla, ej. RC5"),
        detalle: z.string().describe("Detalle de la excepción"),
        confirmado_por: z.string().nullable().describe("Quién la confirmó, null si está pendiente"),
      }),
    )
    .describe("Confirmaciones asociadas a la orden"),
})
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>
