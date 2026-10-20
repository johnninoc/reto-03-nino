# Conocimiento del proceso: órdenes de compra

## El paquete

Cada compra llega por correo con:
- **Solicitud**: qué se compra, a qué proveedor, cuánto cuesta, centro de costo y subárea.
- **Cotización** del proveedor: el precio que ofreció.
- **Aprobación** del líder: un correo que dice "Aprobado".
- **Factura**: solo a veces, cuando el proveedor ya facturó.

## Tres tipos de resultado

- **Bloqueo**: algo que impide crear la OC. No se puede saltar con una confirmación. Hay que corregirlo en el origen (por ejemplo, crear al proveedor o conseguir otra aprobación) y volver a procesar.
- **Confirmación**: una duda que no impide la OC, pero que una persona debe aceptar de forma explícita antes de crearla. Queda registrada como excepción en la OC.
- **Derivado**: un dato que faltaba en la solicitud y que el agente completó con los maestros (por ejemplo, las condiciones de pago habituales del proveedor). Siempre se informa a la analista.

## Reglas de control

| Regla | Qué revisa, en palabras de negocio | Tipo |
|---|---|---|
| RC1 | El proveedor existe en el maestro de proveedores (se busca por NIT o, si no hay NIT, por nombre) y está activo. Si no, hay que pedir su creación o reactivación. | Bloqueo |
| RC2 | Hay un correo de aprobación, dice "Aprobado" y lo envió alguien autorizado para aprobar en ese centro de costo. | Bloqueo |
| RC3 | El valor de la compra no supera el tope de quien aprobó. Si lo supera, debe aprobar alguien con un tope mayor. | Bloqueo |
| RC4 | La subárea pertenece al centro de costo indicado. | Bloqueo |
| RC5 | La cotización y la solicitud coinciden en valor (diferencia máxima 2 %). Si difieren, o si no hay cotización, se pide confirmación mostrando ambos valores. | Confirmación |
| RC6 | Si la solicitud no trae indicador de IVA, se usa el habitual del proveedor y se pide confirmación. | Confirmación y derivado |
| RC7 | Si la solicitud no trae condiciones de pago, se usan las habituales del proveedor. Solo se informa. | Derivado |
| RC8 | Si la factura es anterior a la solicitud, la OC es retroactiva: se pide confirmación y queda marcada en el registro de control. | Confirmación |
| RC9 | La aprobación debe ser del mismo día de la solicitud o posterior. Si es anterior, se pide confirmación. | Confirmación |
| RC10 | Cantidad × valor unitario debe dar el valor total (con tolerancia de 1 peso). Si no, la solicitud tiene un error y hay que corregirla. | Bloqueo |

## OC retroactiva

Una OC es **retroactiva** cuando se crea después de que el proveedor ya facturó: la fecha de la factura es anterior a la fecha de la solicitud. Significa que la compra se hizo sin el proceso previo de cotización y aprobación. No se rechaza, pero se marca `retroactiva = true` en `out/control.csv`, porque la dirección quiere medir cuántas OC llegan así.

## Qué pedir según el problema

- Proveedor inexistente o inactivo: pedir a compras su creación o reactivación en SAP.
- Aprobador sin autoridad o con tope insuficiente: pedir la aprobación a uno de los aprobadores válidos del centro de costo.
- Subárea o centro de costo inválido, o cantidad × precio que no cuadra: pedir al solicitante una solicitud corregida.
- Falta un archivo del paquete: pedirlo al solicitante.
