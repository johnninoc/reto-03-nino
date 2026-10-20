import type { CentroCosto, Derivados, Hallazgo, Paquete, Proveedor, Validacion } from "./esquemas.ts"
import { buscarCentro, buscarProveedor } from "./maestros.ts"
import type { Maestros } from "./maestros.ts"

const TOLERANCIA_COTIZACION = 0.02 // RC5: 2 %
const TOLERANCIA_TOTAL = 1 // RC10: ± 1 unidad monetaria

/** Todo lo que necesitan las reglas, ya buscado en los maestros. */
type Contexto = {
  paquete: Paquete
  proveedor: Proveedor | null
  centro: CentroCosto | null
}

/** "25000000" → "25.000.000" */
export function formatearMonto(valor: number): string {
  return Math.round(valor)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

function hallazgo(codigo: string, detalle: string): Hallazgo {
  return { codigo, detalle }
}

function aprobadorDelCentro(ctx: Contexto) {
  const email = ctx.paquete.aprobacion?.de.toLowerCase()
  return ctx.centro?.aprobadores.find((a) => a.email.toLowerCase() === email) ?? null
}

/** Fecha AAAA-MM-DD de un ISO como "2026-08-21T10:02:00-05:00" (fecha local del correo). */
function soloFecha(iso: string): string {
  return iso.slice(0, 10)
}

// ---------- Bloqueos ----------

export function rc1_proveedorExisteYActivo(ctx: Contexto): Hallazgo | null {
  const { proveedor_nombre, proveedor_nit } = ctx.paquete.solicitud
  const nombre = `${proveedor_nombre} (NIT ${proveedor_nit ?? "no informado"})`
  if (!ctx.proveedor) return hallazgo("RC1", `El proveedor ${nombre} no existe en el maestro de proveedores. Solicitar su creación antes de la OC.`)
  if (!ctx.proveedor.activo) return hallazgo("RC1", `El proveedor ${nombre} está inactivo en el maestro. Solicitar su reactivación o usar otro proveedor.`)
  return null
}

export function rc2_aprobadorValido(ctx: Contexto): Hallazgo | null {
  const { aprobacion, solicitud } = ctx.paquete
  if (!aprobacion) return hallazgo("RC2", "Falta el correo de aprobación. Pedirlo al líder del centro de costo.")
  if (!aprobacion.aprobado) return hallazgo("RC2", `El correo de ${aprobacion.de} no contiene "Aprobado". Pedir aprobación explícita.`)
  if (aprobadorDelCentro(ctx)) return null
  const validos = ctx.centro?.aprobadores.map((a) => a.email).join(", ") ?? "ninguno (centro inexistente)"
  return hallazgo("RC2", `${aprobacion.de} no es aprobador de ${solicitud.centro_costo} (aprobadores válidos: ${validos}). Pedir aprobación a uno de ellos.`)
}

export function rc3_montoDentroDelTope(ctx: Contexto): Hallazgo | null {
  const aprobador = aprobadorDelCentro(ctx)
  if (!aprobador) return null // sin aprobador válido ya bloquea RC2
  const total = ctx.paquete.solicitud.valor_total
  if (total <= aprobador.tope) return null
  return hallazgo("RC3", `Valor ${formatearMonto(total)} supera el tope de ${aprobador.email} (${formatearMonto(aprobador.tope)}). Pedir aprobación a un aprobador con mayor tope.`)
}

export function rc4_subareaDelCentro(ctx: Contexto): Hallazgo | null {
  const { centro_costo, subarea } = ctx.paquete.solicitud
  if (!ctx.centro) return hallazgo("RC4", `El centro de costo ${centro_costo} no existe en el maestro.`)
  if (ctx.centro.subareas.includes(subarea)) return null
  return hallazgo("RC4", `La subárea "${subarea}" no pertenece a ${centro_costo} (válidas: ${ctx.centro.subareas.join(", ")}).`)
}

export function rc10_cantidadPorPrecio(ctx: Contexto): Hallazgo | null {
  const { cantidad, valor_unitario, valor_total } = ctx.paquete.solicitud
  const calculado = cantidad * valor_unitario
  if (Math.abs(calculado - valor_total) <= TOLERANCIA_TOTAL) return null
  return hallazgo("RC10", `Cantidad × valor unitario = ${formatearMonto(calculado)} pero valor_total = ${formatearMonto(valor_total)}. Corregir la solicitud.`)
}

// ---------- Confirmaciones y derivados ----------

export function rc5_cotizacionCuadra(ctx: Contexto): Hallazgo | null {
  const { cotizacion, solicitud } = ctx.paquete
  if (!cotizacion) return hallazgo("RC5", "No hay cotización del proveedor. Confirmar que se crea la OC sin cotización.")
  const diferencia = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total
  if (diferencia <= TOLERANCIA_COTIZACION) return null
  const porcentaje = (diferencia * 100).toFixed(2)
  return hallazgo("RC5", `Solicitud ${solicitud.moneda} ${formatearMonto(solicitud.valor_total)} vs cotización ${cotizacion.moneda} ${formatearMonto(cotizacion.total)} (diferencia ${porcentaje} %, máximo 2 %).`)
}

export function rc6_indicadorIva(ctx: Contexto): { derivado: string | null; confirmacion: Hallazgo | null } {
  if (ctx.paquete.solicitud.indicador_iva || !ctx.proveedor) return { derivado: null, confirmacion: null }
  const derivado = ctx.proveedor.indicador_iva_default
  const confirmacion = hallazgo("RC6", `La solicitud no trae indicador de IVA; se usa ${derivado} (default del proveedor ${ctx.proveedor.nombre}). Confirmar.`)
  return { derivado, confirmacion }
}

export function rc7_condicionesPago(ctx: Contexto): string | null {
  if (ctx.paquete.solicitud.condiciones_pago || !ctx.proveedor) return null
  return ctx.proveedor.condiciones_pago_default
}

export function rc8_facturaRetroactiva(ctx: Contexto): Hallazgo | null {
  const { factura, solicitud } = ctx.paquete
  if (!factura || factura.fecha >= solicitud.fecha_solicitud) return null
  return hallazgo("RC8", `OC retroactiva: la factura ${factura.numero} (${factura.fecha}) es anterior a la solicitud (${solicitud.fecha_solicitud}). Confirmar y queda marcada en control.`)
}

export function rc9_aprobacionDespuesDeSolicitud(ctx: Contexto): Hallazgo | null {
  const { aprobacion, solicitud } = ctx.paquete
  if (!aprobacion) return null // sin aprobación ya bloquea RC2
  const fechaAprobacion = soloFecha(aprobacion.fecha)
  if (fechaAprobacion >= solicitud.fecha_solicitud) return null
  return hallazgo("RC9", `La aprobación (${fechaAprobacion}) es anterior a la solicitud (${solicitud.fecha_solicitud}). Confirmar.`)
}

// ---------- Evaluación completa ----------

const TODAS_LAS_REGLAS = ["RC1", "RC2", "RC3", "RC4", "RC5", "RC6", "RC7", "RC8", "RC9", "RC10"]

/** Reglas que no se pudieron evaluar porque dependen de un dato que ya falló en otra regla. */
function reglasNoEvaluadas(ctx: Contexto): string[] {
  const { solicitud, aprobacion } = ctx.paquete
  const noEvaluadas: string[] = []
  if (!aprobadorDelCentro(ctx)) noEvaluadas.push("RC3") // sin aprobador válido (RC2)
  if (!solicitud.indicador_iva && !ctx.proveedor) noEvaluadas.push("RC6") // sin proveedor (RC1)
  if (!solicitud.condiciones_pago && !ctx.proveedor) noEvaluadas.push("RC7") // sin proveedor (RC1)
  if (!aprobacion) noEvaluadas.push("RC9") // sin aprobación (RC2)
  return noEvaluadas
}

/** Reglas evaluadas que no generaron bloqueo ni confirmación. */
function reglasCumplidas(ctx: Contexto, hallazgos: Hallazgo[]): string[] {
  const descartadas = new Set([...hallazgos.map((h) => h.codigo), ...reglasNoEvaluadas(ctx)])
  return TODAS_LAS_REGLAS.filter((codigo) => !descartadas.has(codigo))
}

function sinNulos(lista: Array<Hallazgo | null>): Hallazgo[] {
  return lista.filter((h): h is Hallazgo => h !== null)
}

export function evaluarReglas(paquete: Paquete, maestros: Maestros): Validacion {
  const { solicitud } = paquete
  const ctx: Contexto = {
    paquete,
    proveedor: buscarProveedor(maestros.proveedores, solicitud.proveedor_nit, solicitud.proveedor_nombre),
    centro: buscarCentro(maestros.centrosCosto, solicitud.centro_costo),
  }
  const iva = rc6_indicadorIva(ctx)
  const condiciones = rc7_condicionesPago(ctx)
  const retroactiva = rc8_facturaRetroactiva(ctx)

  const bloqueos = sinNulos([rc1_proveedorExisteYActivo(ctx), rc2_aprobadorValido(ctx), rc3_montoDentroDelTope(ctx), rc4_subareaDelCentro(ctx), rc10_cantidadPorPrecio(ctx)])
  const confirmaciones = sinNulos([rc5_cotizacionCuadra(ctx), iva.confirmacion, retroactiva, rc9_aprobacionDespuesDeSolicitud(ctx)])

  const derivados: Derivados = {}
  if (iva.derivado) derivados.indicador_iva = iva.derivado
  if (condiciones) derivados.condiciones_pago = condiciones

  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    reglas_cumplidas: reglasCumplidas(ctx, [...bloqueos, ...confirmaciones]),
    derivados,
    retroactiva: retroactiva !== null,
  }
}
